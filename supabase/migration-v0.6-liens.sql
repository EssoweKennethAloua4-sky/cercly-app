-- =====================================================================
-- Cercly v0.6 : 2FA optionnelle + lien d'invitation par groupe
-- A executer une fois dans Supabase : SQL Editor > New query > Run.
-- =====================================================================

-- 1. Double authentification OPTIONNELLE
-- Avant : les actions sensibles exigeaient toujours un code 2FA.
-- Maintenant : le code n'est exige que si la personne a elle-meme active la 2FA.
create or replace function public.is_aal2() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select auth.jwt()) ->> 'aal', '') = 'aal2'
      or not exists (
        select 1 from auth.mfa_factors f
        where f.user_id = (select auth.uid()) and f.status = 'verified'
      )
$$;

-- 2. Les invitations peuvent ne pas etre liees a une adresse e-mail (email vide = lien ouvert)
alter table public.invitations alter column email drop not null;

-- 3. Le president cree (ou renouvelle) le lien d'invitation du groupe
-- Creer un nouveau lien annule l'ancien. Validite : 30 jours.
create or replace function public.create_invite_link(p_group uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare v_token text;
begin
  if not public.is_president(p_group) then raise exception 'Réservé au président'; end if;
  if not public.is_aal2() then raise exception 'Double authentification requise'; end if;
  update public.invitations set status = 'annulee'
    where group_id = p_group and email is null and status = 'en_attente';
  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  insert into public.invitations (group_id, email, token_hash, invited_by, expires_at)
    values (p_group, null, encode(extensions.digest(v_token, 'sha256'), 'hex'),
            (select auth.uid()), now() + interval '30 days');
  return v_token;
end $$;
grant execute on function public.create_invite_link(uuid) to authenticated;

-- 4. Rejoindre un groupe avec un lien
-- - lien ouvert : reste valable pour plusieurs personnes jusqu'a expiration ou renouvellement
-- - invitation par e-mail (ancien mode) : toujours reservee a cette adresse
-- - un membre deja actif (president, validateur...) ne perd JAMAIS ses droits en rouvrant le lien
create or replace function public.accept_invitation(p_token text, p_display_name text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare inv public.invitations; v_email text; v_new uuid;
begin
  if (select auth.uid()) is null then raise exception 'Connexion requise'; end if;
  select * into inv from public.invitations
    where token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex')
      and status = 'en_attente' and expires_at > now() for update;
  if not found then raise exception 'Invitation invalide ou expirée'; end if;
  select u.email into v_email from auth.users u
    where u.id = (select auth.uid()) and u.email_confirmed_at is not null;
  if v_email is null then raise exception 'Confirmez votre adresse e-mail avant de rejoindre un groupe'; end if;
  if inv.email is not null and lower(v_email) <> inv.email then
    raise exception 'Cette invitation est destinée à une autre adresse';
  end if;
  if (select count(*) from public.memberships m where m.group_id = inv.group_id and m.status = 'active') >= 200 then
    raise exception 'Groupe complet';
  end if;
  perform set_config('app.internal', 'on', true);
  insert into public.memberships as mb (group_id, user_id, display_name)
    values (inv.group_id, (select auth.uid()), trim(p_display_name))
    on conflict (group_id, user_id) do update
      set status = 'active', display_name = excluded.display_name, can_validate = false, can_publish = false
      where mb.status <> 'active'
    returning mb.user_id into v_new;
  perform set_config('app.internal', 'off', true);
  if inv.email is not null then
    update public.invitations set status = 'acceptee', accepted_at = now() where id = inv.id;
  end if;
  if v_new is not null then
    perform public.notify(inv.group_id, 'membre_rejoint', null, jsonb_build_object('name', trim(p_display_name)), 'president');
  end if;
  return inv.group_id;
end $$;
