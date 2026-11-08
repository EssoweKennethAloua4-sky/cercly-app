-- =====================================================================
-- Cercly v0.15 : le secretaire du groupe
-- A executer une fois dans Supabase (apres la v0.14) : SQL Editor > New query > Run.
--
--   - Un seul secretaire par groupe, nomme (ou retire) par le PRESIDENT et par lui seul.
--   - Le secretaire a les memes droits que le president (valider, accorder un pret, regler le groupe,
--     gerer les membres...) pour agir quand le president est occupe.
--   - Il ne peut pas : nommer ou retirer le secretaire, transmettre la presidence, retirer le president.
-- =====================================================================

alter table public.memberships add column if not exists is_secretary boolean not null default false;
create unique index if not exists one_secretary_per_group on public.memberships (group_id) where is_secretary and status = 'active';

-- Le vrai president (pour les actions qu'il est seul a pouvoir faire)
create or replace function public.is_true_president(gid uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.memberships m where m.group_id = gid and m.user_id = (select auth.uid()) and m.status = 'active' and m.is_president) $$;

-- Toutes les verifications « president » acceptent maintenant aussi le secretaire
create or replace function public.is_president(gid uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.memberships m where m.group_id = gid and m.user_id = (select auth.uid()) and m.status = 'active'
                 and (m.is_president or m.is_secretary)) $$;
create or replace function public.can_validate(gid uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.memberships m where m.group_id = gid and m.user_id = (select auth.uid()) and m.status = 'active'
                 and (m.can_validate or m.is_secretary)) $$;
create or replace function public.can_publish(gid uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.memberships m where m.group_id = gid and m.user_id = (select auth.uid()) and m.status = 'active'
                 and (m.can_publish or m.is_president or m.is_secretary)) $$;
grant execute on function public.is_true_president(uuid) to authenticated;

-- Le titre ne change que par set_secretary ; un membre retire perd le titre
create or replace function public.memberships_guard() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if current_setting('app.internal', true) = 'on' then return new; end if;
  if new.group_id <> old.group_id or new.user_id <> old.user_id or new.is_president <> old.is_president
     or new.is_secretary <> old.is_secretary then
    raise exception 'Modification interdite';
  end if;
  if new.can_validate <> old.can_validate or new.can_publish <> old.can_publish or new.status <> old.status then
    if not public.is_president(new.group_id) then raise exception 'Réservé au président'; end if;
    if not public.is_aal2() then raise exception 'Double authentification requise'; end if;
    if old.is_president and (new.status <> 'active' or not new.can_validate) then
      raise exception 'Le président ne peut pas être retiré ni perdre ses droits';
    end if;
    if old.is_secretary and new.status <> 'active' and not public.is_true_president(new.group_id) then
      raise exception 'Seul le président peut retirer le secrétaire';
    end if;
  end if;
  if new.status <> 'active' then new.is_secretary := false; end if;
  if new.can_validate and new.status = 'active' and (not old.can_validate or old.status <> 'active') then
    if (select count(*) from public.memberships m
         where m.group_id = new.group_id and m.can_validate and m.status = 'active' and m.user_id <> new.user_id) >= public.max_validators() then
      raise exception 'Maximum % validateurs par groupe', public.max_validators();
    end if;
  end if;
  return new;
end $$;

alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check check (kind in (
  'annonce','rappel_nouveau','cotisation_nouvelle','cotisation_pour_vous','cotisation_validee','cotisation_rejetee',
  'cotisation_validee_groupe',
  'pret_demande','pret_garant_demande','pret_garant_confirme','pret_garant_refuse','pret_ouvert_au_vote',
  'pret_validee','pret_refusee','pret_remboursee','pret_annulee','membre_rejoint','presidence_transmise',
  'pret_echeance','pret_remboursement','secretaire_nomme','secretaire_retire'));

-- Nommer (p_user) ou retirer (p_user = null) le secretaire : le president seul
create or replace function public.set_secretary(p_group uuid, p_user uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_name text; v_old text;
begin
  if not public.is_true_president(p_group) then raise exception 'Seul le président peut nommer le secrétaire'; end if;
  if not public.is_aal2() then raise exception 'Double authentification requise'; end if;
  select m.display_name into v_old from public.memberships m where m.group_id = p_group and m.is_secretary and m.status = 'active';
  if p_user is not null then
    if p_user = (select auth.uid()) then raise exception 'Choisissez un autre membre'; end if;
    select m.display_name into v_name from public.memberships m where m.group_id = p_group and m.user_id = p_user and m.status = 'active';
    if not found then raise exception 'Ce membre ne fait pas partie du groupe'; end if;
  end if;
  perform set_config('app.internal', 'on', true);
  update public.memberships set is_secretary = false where group_id = p_group and is_secretary;
  if p_user is not null then
    update public.memberships set is_secretary = true where group_id = p_group and user_id = p_user;
  end if;
  perform set_config('app.internal', 'off', true);
  if p_user is not null then
    perform public.notify(p_group, 'secretaire_nomme', null, jsonb_build_object('name', v_name), 'all');
  elsif v_old is not null then
    perform public.notify(p_group, 'secretaire_retire', null, jsonb_build_object('name', v_old), 'all');
  end if;
end $$;
grant execute on function public.set_secretary(uuid, uuid) to authenticated;

-- Transmettre la presidence : le president seul. Le nouveau president perd le titre de secretaire.
create or replace function public.transfer_presidency(p_group uuid, p_new uuid) returns void language plpgsql security definer set search_path = '' as $$
declare v_name text;
begin
  if not public.is_true_president(p_group) then raise exception 'Réservé au président'; end if;
  if not public.is_aal2() then raise exception 'Double authentification requise'; end if;
  if p_new = (select auth.uid()) then raise exception 'Choisissez un autre membre'; end if;
  select m.display_name into v_name from public.memberships m where m.group_id = p_group and m.user_id = p_new and m.status = 'active';
  if not found then raise exception 'Ce membre ne fait pas partie du groupe'; end if;
  perform set_config('app.internal', 'on', true);
  update public.memberships set is_president = false, can_validate = false, can_publish = false
    where group_id = p_group and user_id = (select auth.uid());
  update public.memberships set is_president = true, is_secretary = false, can_validate = true, can_publish = true
    where group_id = p_group and user_id = p_new;
  perform set_config('app.internal', 'off', true);
  perform public.notify(p_group, 'presidence_transmise', null, jsonb_build_object('name', v_name), 'all');
end $$;

-- Quitter le groupe : seul le vrai president doit d'abord transmettre son role ; le secretaire perd son titre.
create or replace function public.leave_group(p_group uuid) returns void language plpgsql security definer set search_path = '' as $$
begin
  if public.is_true_president(p_group) then raise exception 'Le président doit d''abord transmettre son rôle'; end if;
  perform set_config('app.internal', 'on', true);
  update public.memberships set status = 'removed', can_validate = false, can_publish = false, is_secretary = false
    where group_id = p_group and user_id = (select auth.uid());
  perform set_config('app.internal', 'off', true);
end $$;

-- Rappels d'echeance 72 h / 48 h : le secretaire est prevenu comme le president
create or replace function public.send_loan_due_reminders() returns int
language plpgsql security definer set search_path = '' as $$
declare
  l record;
  v_deadline timestamptz;
  v_stage int;
  v_name text;
  v_details jsonb;
  v_count int := 0;
begin
  for l in select * from public.loans where status = 'validee' loop
    v_deadline := (l.due_date + 1)::timestamp at time zone 'UTC';   -- fin du jour d'echeance (Lome)
    if now() >= v_deadline then continue; end if;
    select min(s) into v_stage from unnest(array[72, 48, 24, 12]) s where now() >= v_deadline - make_interval(hours => s);
    if v_stage is null then continue; end if;
    if exists (select 1 from public.loan_due_reminders r where r.loan_id = l.id and r.stage <= v_stage) then continue; end if;

    select m.display_name into v_name from public.memberships m
     where m.group_id = l.group_id and m.user_id = l.borrower_member_id;
    if v_name is null then select b.name into v_name from public.loan_borrowers b where b.loan_id = l.id; end if;
    v_details := jsonb_build_object('amount', l.amount, 'hours', v_stage, 'name', coalesce(v_name, ''), 'due_date', l.due_date);

    insert into public.notifications (user_id, group_id, kind, entity_id, details)
    select m.user_id, l.group_id, 'pret_echeance', l.id, v_details
      from public.memberships m
     where m.group_id = l.group_id and m.status = 'active'
       and (v_stage <= 24
            or m.is_president or m.is_secretary
            or m.user_id = l.guarantor_member_id
            or m.user_id = l.borrower_member_id);

    insert into public.loan_due_reminders (loan_id, stage)
    select l.id, s from unnest(array[72, 48, 24, 12]) s where s >= v_stage
    on conflict do nothing;
    v_count := v_count + 1;
  end loop;
  return v_count;
end $$;
revoke execute on function public.send_loan_due_reminders() from public, anon, authenticated;
