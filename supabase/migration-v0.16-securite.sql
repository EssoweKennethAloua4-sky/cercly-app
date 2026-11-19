-- =====================================================================
-- Cercly v0.16 : corrections de securite (revue du 18 novembre 2026)
-- A executer une fois dans Supabase (apres la v0.15) : SQL Editor > New query > Run.
--
-- AVANT DE L'EXECUTER SUR LA VRAIE BASE :
--   1. Deployer la nouvelle version de l'application (bouton « Activer la double authentification »).
--   2. Le president, le secretaire et les validateurs activent la double authentification.
--      Sans elle, apres cette migration, ils peuvent encore tout VOIR mais plus rien VALIDER, DECIDER ni REGLER.
--   3. Faire une sauvegarde de la base.
--
-- Ce qui change :
--   1. Double authentification obligatoire pour les roles sensibles (president, secretaire, validateurs).
--      Pour un compte qui a active la 2FA : plus aucune lecture ni action avec le seul mot de passe.
--   2. Lien d'invitation ouvert : la personne arrive « en attente », le president ou le secretaire accepte ou refuse.
--      Lien valable 7 jours au lieu de 30.
--   3. Le telephone de l'emprunteur n'est plus visible que des responsables, du garant et du membre dont le lien a servi.
--   4. Formulaire de pret : plus aucune demande ne passe au vote sans qu'un membre confirme.
--      Le membre au nom duquel une demande est faite est prevenu. Limite de 3 demandes par telephone et par jour.
--   5. Remboursements : chaque ajout et chaque annulation est trace dans le journal, l'annulation exige un motif
--      et tout le groupe est prevenu.
-- Tout est dans une transaction : en cas d'erreur, rien n'est modifie.
-- =====================================================================

begin;

-- =====================================================================
-- 1. DOUBLE AUTHENTIFICATION
-- =====================================================================

-- La personne a-t-elle une 2FA activee (verifiee) ?
create or replace function public.has_verified_mfa(p_user uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from auth.mfa_factors f where f.user_id = p_user and f.status = 'verified') $$;

-- La session respecte-t-elle la 2FA du compte ? (compte sans 2FA : oui ; compte avec 2FA : seulement apres le code)
create or replace function public.mfa_session_ok() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select auth.jwt()) ->> 'aal', '') = 'aal2'
      or not public.has_verified_mfa((select auth.uid())) $$;

-- La personne a-t-elle un role sensible dans au moins un groupe ?
create or replace function public.holds_sensitive_role() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.memberships m
                 where m.user_id = (select auth.uid()) and m.status = 'active'
                   and (m.is_president or m.is_secretary or m.can_validate)) $$;

-- Actions sensibles : code 2FA exige. Seul un simple membre sans 2FA peut s'en passer.
create or replace function public.is_aal2() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select auth.jwt()) ->> 'aal', '') = 'aal2'
      or (not public.has_verified_mfa((select auth.uid())) and not public.holds_sensitive_role()) $$;

-- Les verifications de droits echouent si la session n'a pas fourni le code 2FA du compte.
-- Comme toutes les regles et fonctions s'appuient sur elles, un mot de passe vole ne suffit plus.
create or replace function public.is_member(gid uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select public.mfa_session_ok() and exists (select 1 from public.memberships m
    where m.group_id = gid and m.user_id = (select auth.uid()) and m.status = 'active') $$;
create or replace function public.is_true_president(gid uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select public.mfa_session_ok() and exists (select 1 from public.memberships m
    where m.group_id = gid and m.user_id = (select auth.uid()) and m.status = 'active' and m.is_president) $$;
create or replace function public.is_president(gid uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select public.mfa_session_ok() and exists (select 1 from public.memberships m
    where m.group_id = gid and m.user_id = (select auth.uid()) and m.status = 'active' and (m.is_president or m.is_secretary)) $$;
create or replace function public.can_validate(gid uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select public.mfa_session_ok() and exists (select 1 from public.memberships m
    where m.group_id = gid and m.user_id = (select auth.uid()) and m.status = 'active' and (m.can_validate or m.is_secretary)) $$;
create or replace function public.can_publish(gid uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select public.mfa_session_ok() and exists (select 1 from public.memberships m
    where m.group_id = gid and m.user_id = (select auth.uid()) and m.status = 'active' and (m.can_publish or m.is_president or m.is_secretary)) $$;

-- Pour l'application : dire a la personne si elle doit activer la 2FA (role sensible sans 2FA).
create or replace function public.my_security_status() returns table (has_mfa boolean, needs_mfa boolean)
language sql stable security definer set search_path = '' as $$
  select public.has_verified_mfa((select auth.uid())),
         public.holds_sensitive_role() and not public.has_verified_mfa((select auth.uid())) $$;

-- Regle « restrictive » sur toutes les tables : s'ajoute aux regles existantes (ET logique).
-- Elle couvre aussi les tables dont les regles ne passent pas par is_member (profil, notifications, votes...).
do $$
declare t text;
begin
  foreach t in array array['profiles','groups','group_modules','memberships','invitations','announcements','reminders',
    'contributions','contribution_files','loans','loan_votes','audit_log','notifications','loan_links','loan_borrowers',
    'loan_repayments','loan_due_reminders']
  loop
    execute format('drop policy if exists mfa_guard on public.%I', t);
    execute format('create policy mfa_guard on public.%I as restrictive for all to authenticated '
                   'using (public.mfa_session_ok()) with check (public.mfa_session_ok())', t);
  end loop;
end $$;

drop policy if exists justificatifs_mfa_guard on storage.objects;
create policy justificatifs_mfa_guard on storage.objects as restrictive for all to authenticated
  using (bucket_id <> 'justificatifs' or public.mfa_session_ok())
  with check (bucket_id <> 'justificatifs' or public.mfa_session_ok());

revoke all on function public.has_verified_mfa(uuid), public.holds_sensitive_role() from public, anon, authenticated;
grant execute on function public.mfa_session_ok(), public.is_true_president(uuid), public.my_security_status() to authenticated;
grant execute on function public.is_aal2(), public.is_member(uuid), public.is_president(uuid), public.can_validate(uuid),
  public.can_publish(uuid) to authenticated;

-- =====================================================================
-- 2. LIEN D'INVITATION : ARRIVEE EN ATTENTE
-- =====================================================================

alter table public.memberships drop constraint if exists memberships_status_check;
alter table public.memberships add constraint memberships_status_check check (status in ('active','removed','en_attente'));

-- Une personne en attente voit sa propre ligne (pour savoir qu'elle attend), rien d'autre du groupe.
drop policy if exists memberships_select_own on public.memberships;
create policy memberships_select_own on public.memberships for select to authenticated using (user_id = (select auth.uid()));

alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check check (kind in (
  'annonce','rappel_nouveau','cotisation_nouvelle','cotisation_pour_vous','cotisation_validee','cotisation_rejetee',
  'cotisation_validee_groupe',
  'pret_demande','pret_garant_demande','pret_garant_confirme','pret_garant_refuse','pret_ouvert_au_vote',
  'pret_validee','pret_refusee','pret_remboursee','pret_annulee','membre_rejoint','presidence_transmise',
  'pret_echeance','pret_remboursement','secretaire_nomme','secretaire_retire',
  'membre_en_attente','pret_a_votre_nom','pret_remboursement_annule'));

-- Lien ouvert : 7 jours (au lieu de 30). Creer un nouveau lien annule l'ancien.
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
            (select auth.uid()), now() + interval '7 days');
  return v_token;
end $$;

-- Rejoindre : invitation par e-mail = entree directe (le president a choisi l'adresse) ;
-- lien ouvert = « en attente » jusqu'a l'accord du president ou du secretaire.
-- Un membre deja actif ne perd jamais ses droits en rouvrant le lien.
create or replace function public.accept_invitation(p_token text, p_display_name text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare inv public.invitations; v_email text; v_new uuid; v_status text; v_name text := trim(coalesce(p_display_name, ''));
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
  v_status := case when inv.email is null then 'en_attente' else 'active' end;
  if v_status = 'en_attente'
     and (select count(*) from public.memberships m where m.group_id = inv.group_id and m.status = 'en_attente') >= 50 then
    raise exception 'Trop de demandes en attente pour ce groupe';
  end if;

  perform set_config('app.internal', 'on', true);
  insert into public.memberships as mb (group_id, user_id, display_name, status)
    values (inv.group_id, (select auth.uid()), v_name, v_status)
    on conflict (group_id, user_id) do update
      set status = excluded.status, display_name = excluded.display_name, can_validate = false, can_publish = false
      where mb.status = 'removed' or (mb.status = 'en_attente' and excluded.status = 'active')
    returning mb.user_id into v_new;
  perform set_config('app.internal', 'off', true);

  if inv.email is not null then
    update public.invitations set status = 'acceptee', accepted_at = now() where id = inv.id;
  end if;
  if v_new is not null then
    if v_status = 'active' then
      perform public.notify(inv.group_id, 'membre_rejoint', null, jsonb_build_object('name', v_name), 'all', v_new);
    else
      insert into public.notifications (user_id, group_id, kind, entity_id, details)
      select m.user_id, inv.group_id, 'membre_en_attente', v_new, jsonb_build_object('name', v_name)
        from public.memberships m
       where m.group_id = inv.group_id and m.status = 'active' and (m.is_president or m.is_secretary);
    end if;
  end if;
  return inv.group_id;
end $$;

-- Le president ou le secretaire accepte (p_accept = true) ou refuse une personne en attente.
create or replace function public.review_member(p_group uuid, p_user uuid, p_accept boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare v_name text;
begin
  if not public.is_president(p_group) then raise exception 'Réservé au président et au secrétaire'; end if;
  if not public.is_aal2() then raise exception 'Double authentification requise'; end if;
  select m.display_name into v_name from public.memberships m
    where m.group_id = p_group and m.user_id = p_user and m.status = 'en_attente' for update;
  if not found then raise exception 'Cette personne n''est pas en attente'; end if;
  if p_accept and (select count(*) from public.memberships m where m.group_id = p_group and m.status = 'active') >= 200 then
    raise exception 'Groupe complet';
  end if;
  perform set_config('app.internal', 'on', true);
  update public.memberships
     set status = case when p_accept then 'active' else 'removed' end, can_validate = false, can_publish = false
   where group_id = p_group and user_id = p_user;
  perform set_config('app.internal', 'off', true);
  if p_accept then
    perform public.notify(p_group, 'membre_rejoint', null, jsonb_build_object('name', v_name), 'all', p_user);
  end if;
end $$;

-- Groupes ou la personne attend une reponse (pour l'afficher dans l'application).
create or replace function public.my_pending_groups() returns table (group_id uuid, group_name text)
language sql stable security definer set search_path = '' as $$
  select g.id, g.name from public.memberships m join public.groups g on g.id = m.group_id
   where m.user_id = (select auth.uid()) and m.status = 'en_attente' $$;

revoke all on function public.review_member(uuid, uuid, boolean), public.my_pending_groups() from public, anon;
grant execute on function public.review_member(uuid, uuid, boolean), public.my_pending_groups() to authenticated;

-- =====================================================================
-- 3. TELEPHONE DE L'EMPRUNTEUR
-- =====================================================================

-- Tous ceux qui votent voient le nom et le motif ; plus le telephone.
revoke select on public.loan_borrowers from authenticated;
grant select (loan_id, name, reason, consent_at) on public.loan_borrowers to authenticated;

-- Telephone : president, secretaire, validateurs, garant, membre dont le lien a servi, emprunteur membre.
create or replace function public.loan_borrower_phones(p_loans uuid[]) returns table (loan_id uuid, phone text)
language sql stable security definer set search_path = '' as $$
  select b.loan_id, b.phone
    from public.loan_borrowers b join public.loans l on l.id = b.loan_id
   where b.loan_id = any(p_loans)
     and public.is_member(l.group_id)
     and (public.is_president(l.group_id) or public.can_validate(l.group_id)
          or l.guarantor_member_id = (select auth.uid()) or l.link_member_id = (select auth.uid())
          or l.borrower_member_id = (select auth.uid())) $$;
revoke all on function public.loan_borrower_phones(uuid[]) from public, anon;
grant execute on function public.loan_borrower_phones(uuid[]) to authenticated;

-- =====================================================================
-- 4. FORMULAIRE PUBLIC DE PRET
-- =====================================================================

create or replace function public.submit_loan_request(p_token text, p_borrower_name text, p_phone text, p_amount numeric,
  p_due_date date, p_reason text, p_guarantor_name text, p_consent boolean)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  lk public.loan_links;
  v_phone text := regexp_replace(trim(coalesce(p_phone, '')), '[\s().-]', '', 'g');
  v_bname text := regexp_replace(trim(coalesce(p_borrower_name, '')), '\s+', ' ', 'g');
  v_gname text := regexp_replace(trim(coalesce(p_guarantor_name, '')), '\s+', ' ', 'g');
  v_bm uuid; v_gm uuid; v_check text; v_id uuid;
begin
  select * into lk from public.loan_links where token = p_token and status = 'actif';
  if not found
     or not exists (select 1 from public.memberships m where m.group_id = lk.group_id and m.user_id = lk.member_id and m.status = 'active')
     or not public.module_enabled(lk.group_id, 'prets') then
    raise exception 'Ce lien n''est plus valide';
  end if;
  if p_consent is not true then raise exception 'Vous devez accepter l''enregistrement de vos informations'; end if;
  if char_length(v_bname) not between 2 and 100 then raise exception 'Nom invalide'; end if;
  if char_length(v_gname) not between 2 and 100 then raise exception 'Nom du garant invalide'; end if;
  if v_phone !~ '^\+?[0-9]{6,15}$' then raise exception 'Numéro de téléphone invalide'; end if;
  if p_amount is null or p_amount <= 0 or p_amount > 1000000000 then raise exception 'Montant invalide'; end if;
  if p_due_date is null or p_due_date <= current_date or p_due_date > current_date + 730 then raise exception 'Date de remboursement invalide'; end if;
  if char_length(coalesce(p_reason, '')) > 500 then raise exception 'Motif trop long'; end if;
  if (select count(*) from public.loans l where l.link_id = lk.id and l.created_at > now() - interval '1 day') >= 10 then
    raise exception 'Trop de demandes aujourd''hui avec ce lien';
  end if;
  if (select count(*) from public.loan_borrowers b join public.loans l on l.id = b.loan_id
       where b.phone = v_phone and l.created_at > now() - interval '1 day') >= 3 then
    raise exception 'Trop de demandes aujourd''hui avec ce numéro';
  end if;
  if (select count(*) from public.loans l where l.group_id = lk.group_id and l.status = 'a_examiner') >= 50 then
    raise exception 'Trop de demandes en attente pour ce groupe';
  end if;
  if exists (select 1 from public.loan_borrowers b join public.loans l on l.id = b.loan_id
             where l.group_id = lk.group_id and b.phone = v_phone and l.status in ('a_examiner','en_vote','validee')) then
    raise exception 'Une demande est déjà en cours pour ce numéro';
  end if;

  -- Reconnaissance des membres par leur nom (une seule correspondance possible, sinon aucune)
  select case when count(*) = 1 then (array_agg(m.user_id))[1] end into v_bm from public.memberships m
    where m.group_id = lk.group_id and m.status = 'active' and public.norm_name(m.display_name) = public.norm_name(v_bname);
  select case when count(*) = 1 then (array_agg(m.user_id))[1] end into v_gm from public.memberships m
    where m.group_id = lk.group_id and m.status = 'active' and public.norm_name(m.display_name) = public.norm_name(v_gname);
  v_check := case when v_gm = lk.member_id then 'lien' when v_gm is not null then 'autre_membre' else 'inconnu' end;

  insert into public.loans (group_id, link_id, link_member_id, borrower_member_id, guarantor_name, guarantor_member_id, guarantor_check, amount, due_date)
    values (lk.group_id, lk.id, lk.member_id, v_bm, v_gname, v_gm, v_check, p_amount, p_due_date) returning id into v_id;
  insert into public.loan_borrowers (loan_id, name, phone, reason, consent_at)
    values (v_id, v_bname, v_phone, nullif(trim(coalesce(p_reason, '')), ''), now());

  perform public.notify(lk.group_id, 'pret_demande', v_id, jsonb_build_object('amount', p_amount, 'check', v_check), 'validators');
  -- Plus d'ouverture automatique du vote : le garant reconnu doit toujours confirmer dans l'application,
  -- meme quand il est aussi l'emprunteur (sinon n'importe qui pourrait emprunter au nom d'un membre).
  if v_gm is not null then
    perform public.notify(lk.group_id, 'pret_garant_demande', v_id, jsonb_build_object('amount', p_amount), 'user', null, v_gm);
  end if;
  -- Le membre au nom duquel la demande est faite est toujours prevenu.
  if v_bm is not null and v_bm is distinct from v_gm then
    perform public.notify(lk.group_id, 'pret_a_votre_nom', v_id, jsonb_build_object('amount', p_amount), 'user', null, v_bm);
  end if;
  return true;
end $$;
revoke all on function public.submit_loan_request(text, text, text, numeric, date, text, text, boolean) from public;
grant execute on function public.submit_loan_request(text, text, text, numeric, date, text, text, boolean) to anon, authenticated;

-- =====================================================================
-- 5. REMBOURSEMENTS TRACES
-- =====================================================================

create or replace function public.audit_repayment() returns trigger language plpgsql security definer set search_path = '' as $$
declare r public.loan_repayments := coalesce(new, old);
begin
  insert into public.audit_log (group_id, actor_id, action, entity, entity_id, details)
  values (r.group_id, (select auth.uid()), lower(tg_op), 'loan_repayments', r.id,
          jsonb_build_object('loan_id', r.loan_id, 'amount', r.amount, 'paid_on', r.paid_on,
                             'reason', nullif(current_setting('cercly.reason', true), '')));
  return r;
end $$;
drop trigger if exists audit_loan_repayments on public.loan_repayments;
create trigger audit_loan_repayments after insert or delete on public.loan_repayments
  for each row execute function public.audit_repayment();

-- Annuler un remboursement : motif obligatoire, trace dans le journal, tout le groupe est prevenu.
drop function if exists public.delete_loan_repayment(uuid);
create or replace function public.delete_loan_repayment(p_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare r public.loan_repayments; l public.loans; v_reason text := left(trim(coalesce(p_reason, '')), 300);
begin
  select * into r from public.loan_repayments where id = p_id;
  if not found then raise exception 'Remboursement introuvable'; end if;
  select * into l from public.loans where id = r.loan_id for update;
  if not public.is_president(l.group_id) then raise exception 'Réservé au président'; end if;
  if not public.is_aal2() then raise exception 'Double authentification requise'; end if;
  if v_reason = '' then raise exception 'Un motif est obligatoire pour annuler un remboursement'; end if;
  perform set_config('cercly.reason', v_reason, true);
  delete from public.loan_repayments where id = p_id;
  perform set_config('cercly.reason', '', true);
  if l.status = 'remboursee'
     and coalesce((select sum(amount) from public.loan_repayments where loan_id = l.id), 0) < l.amount + l.interest then
    update public.loans set status = 'validee' where id = l.id;
  end if;
  perform public.notify(l.group_id, 'pret_remboursement_annule', l.id,
    jsonb_build_object('amount', r.amount, 'name', public._loan_name(l), 'reason', v_reason), 'all', (select auth.uid()));
end $$;
revoke all on function public.delete_loan_repayment(uuid, text) from public, anon;
grant execute on function public.delete_loan_repayment(uuid, text) to authenticated;

commit;
