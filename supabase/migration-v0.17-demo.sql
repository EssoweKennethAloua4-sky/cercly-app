-- =====================================================================
-- Cercly v0.17 : mode demo pour les visiteurs (bouton « Essayer la démo »)
-- A executer une fois dans Supabase (apres la v0.16.1) : SQL Editor > New query > Run.
--
-- AVANT DE L'EXECUTER :
--   1. Authentication > Users > Add user > Create new user :
--        e-mail : kennethaloua3+cercly-demo@gmail.com (alias de votre Gmail : les e-mails eventuels arrivent chez vous)
--        mot de passe : celui que vous mettrez dans VITE_DEMO_PASSWORD
--        cochez « Auto Confirm User ».
--      (Pour une autre adresse, changez-la aussi a la ligne « v_email » plus bas.)
--   2. Faire une sauvegarde de la base.
--
-- Ce que fait cette migration :
--   1. Un faux groupe « Tontine des Amis (démo) » : 10 faux membres, 6 mois de cotisations
--      (validees, en attente, en retard, une rejetee), 4 prets (en cours, au vote, rembourse,
--      en attente du garant), des annonces et des notifications.
--   2. Le compte demo n'appartient qu'a ce groupe, et rien d'autre ne peut y entrer.
--   3. Le compte demo ne peut pas : changer son mot de passe ni son e-mail, activer la 2FA,
--      inviter, creer un groupe, rejoindre un groupe, gerer les membres, regler le groupe,
--      publier, envoyer une cotisation ou un fichier, creer un lien de pret.
--      Il peut : tout consulter, valider ou rejeter, voter, confirmer comme garant,
--      decider d'un pret, enregistrer un remboursement.
--   4. Chaque nuit a 3 h (UTC, heure de Lome), le groupe est remis a zero.
--
-- Changer plus tard le mot de passe du compte demo (une seule execution) :
--   select set_config('cercly.demo_admin', 'on', true);
--   update auth.users set encrypted_password = extensions.crypt('NOUVEAU', extensions.gen_salt('bf'))
--    where id = (select user_id from public.demo_settings);
-- Tout est dans une transaction : en cas d'erreur, rien n'est modifie.
-- =====================================================================

begin;

-- =====================================================================
-- 1. QUI EST LE COMPTE DEMO, QUEL EST LE FAUX GROUPE
-- =====================================================================

create table if not exists public.demo_settings (
  id boolean primary key default true check (id),   -- une seule ligne
  user_id uuid not null references auth.users (id) on delete cascade,
  group_id uuid not null
);
alter table public.demo_settings enable row level security;   -- aucune lecture directe
revoke all on public.demo_settings from anon, authenticated;

create or replace function public.is_demo_user() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.demo_settings d where d.user_id = (select auth.uid())) $$;

create or replace function public.demo_group_id() returns uuid
language sql stable security definer set search_path = '' as $$
  select d.group_id from public.demo_settings d $$;

-- =====================================================================
-- 2. GARDE-FOUS
-- =====================================================================

-- Ecritures interdites au compte demo (les fonctions comme create_group ou accept_invitation
-- ecrivent dans ces tables : elles sont bloquees elles aussi).
create or replace function public.demo_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if public.is_demo_user() then
    raise exception 'Compte de démonstration : cette action est désactivée';
  end if;
  -- Le compte demo n'est jamais membre d'un autre groupe, et personne d'autre n'entre dans le groupe demo
  -- (les faux membres sont crees par demo_reset, appele sans session).
  if tg_table_name = 'memberships' and tg_op <> 'DELETE' then
    if new.user_id = (select d.user_id from public.demo_settings d) and new.group_id is distinct from public.demo_group_id() then
      raise exception 'Le compte de démonstration ne peut appartenir qu''au groupe de démonstration';
    end if;
    if new.group_id = public.demo_group_id() and (select auth.uid()) is not null then
      raise exception 'Le groupe de démonstration est fermé';
    end if;
  end if;
  return coalesce(new, old);
end $$;

do $$
declare t text;
begin
  foreach t in array array['groups','group_modules','memberships','invitations','announcements','reminders','loan_links']
  loop
    execute format('drop trigger if exists demo_guard on public.%I', t);
    execute format('create trigger demo_guard before insert or update or delete on public.%I '
                   'for each row execute function public.demo_guard()', t);
  end loop;
end $$;
-- Cotisations et justificatifs : le compte demo valide ou rejette (mise a jour), mais n'envoie rien.
drop trigger if exists demo_guard on public.contributions;
create trigger demo_guard before insert on public.contributions for each row execute function public.demo_guard();
drop trigger if exists demo_guard on public.contribution_files;
create trigger demo_guard before insert on public.contribution_files for each row execute function public.demo_guard();

drop policy if exists demo_no_upload on storage.objects;
create policy demo_no_upload on storage.objects as restrictive for insert to authenticated
  with check (not public.is_demo_user());

-- Compte demo : mot de passe, e-mail et telephone ne changent pas (le changement est ignore).
create or replace function public.demo_protect_auth_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if old.id = (select d.user_id from public.demo_settings d)
     and coalesce(current_setting('cercly.demo_admin', true), '') <> 'on' then
    new.encrypted_password := old.encrypted_password;
    new.email := old.email;
    new.email_change := old.email_change;
    new.phone := old.phone;
    new.phone_change := old.phone_change;
  end if;
  return new;
end $$;
drop trigger if exists demo_protect_auth_user on auth.users;
create trigger demo_protect_auth_user before update on auth.users
  for each row execute function public.demo_protect_auth_user();

-- Compte demo : pas de double authentification (un visiteur qui l'activerait bloquerait tous les autres).
create or replace function public.demo_no_mfa() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.user_id = (select d.user_id from public.demo_settings d) then
    raise exception 'Compte de démonstration : double authentification désactivée';
  end if;
  return new;
end $$;
do $$
begin
  drop trigger if exists demo_no_mfa on auth.mfa_factors;
  create trigger demo_no_mfa before insert on auth.mfa_factors for each row execute function public.demo_no_mfa();
exception when insufficient_privilege then
  -- Si Supabase refuse ce declencheur : la 2FA du compte demo est ignoree (ci-dessous) et effacee chaque nuit.
  raise notice 'Declencheur sur auth.mfa_factors refuse : protection de secours seulement';
end $$;

-- 2FA : le compte demo n'en a jamais (meme si un facteur existait), et ses actions n'en demandent pas.
-- Il n'est membre que du groupe demo : cette exception ne s'applique nulle part ailleurs.
create or replace function public.has_verified_mfa(p_user uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from auth.mfa_factors f where f.user_id = p_user and f.status = 'verified')
     and not exists (select 1 from public.demo_settings d where d.user_id = p_user) $$;

create or replace function public.is_aal2() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select auth.jwt()) ->> 'aal', '') = 'aal2'
      or (not public.has_verified_mfa((select auth.uid())) and not public.holds_sensitive_role())
      or public.is_demo_user() $$;

create or replace function public.my_security_status() returns table (has_mfa boolean, needs_mfa boolean)
language sql stable security definer set search_path = '' as $$
  select public.has_verified_mfa((select auth.uid())),
         public.holds_sensitive_role() and not public.has_verified_mfa((select auth.uid())) and not public.is_demo_user() $$;

-- Le journal reste en lecture seule, sauf pour la remise a zero du groupe demo.
create or replace function public.audit_immutable() returns trigger language plpgsql set search_path = '' as $$
begin
  if coalesce(current_setting('cercly.demo_reset', true), '') = 'on' and old.group_id = public.demo_group_id() then
    return old;
  end if;
  raise exception 'Le journal est en lecture seule';
end $$;

-- =====================================================================
-- 3. REMISE A ZERO DU GROUPE DEMO (aussi utilisee pour le creer)
-- =====================================================================

create or replace function public.demo_reset() returns void
language plpgsql security definer set search_path = '' as $$
declare
  gid uuid := public.demo_group_id();
  me uuid := (select d.user_id from public.demo_settings d);
  -- Faux membres : 1 secretaire, 2 et 3 validateurs, 7 et 9 en retard
  names text[] := array['Afi Mensah','Kodjo Amegah','Ama Kpodar','Yao Adjovi','Akossiwa Dogbe',
                        'Komi Lawson','Abla Tete','Edem Agbodjan','Sena Atsu','Mawuli Kouassi'];
  ids uuid[] := array[]::uuid[];
  payers uuid[];
  this_month date := date_trunc('month', current_date)::date;
  m_start date;
  v_paid date;
  v_reviewer uuid;
  k int;
  i int;
  pend int[] := array[6, 8, 10];   -- cotisations du mois en attente de validation
  pend_notes text[] := array['Envoi Mobile Money', 'Frais compris', 'Cotisation du mois'];
  l1 uuid := 'dddddddd-0000-4000-8000-000000000301';
  l2 uuid := 'dddddddd-0000-4000-8000-000000000302';
  l3 uuid := 'dddddddd-0000-4000-8000-000000000303';
  l4 uuid := 'dddddddd-0000-4000-8000-000000000304';
  a1 uuid := 'dddddddd-0000-4000-8000-000000000401';
begin
  if gid is null or me is null then raise exception 'Mode démo non configuré'; end if;
  for i in 1..10 loop
    ids := ids || ('dddddddd-0000-4000-8000-0000000001' || lpad(i::text, 2, '0'))::uuid;
  end loop;
  payers := ids || me;

  perform set_config('request.jwt.claims', '', true);   -- toujours sans session, meme lancee depuis une session
  perform set_config('cercly.demo_reset', 'on', true);
  perform set_config('app.internal', 'on', true);

  -- ---------- on vide ----------
  delete from public.notifications where group_id = gid;
  delete from public.loans where group_id = gid;               -- votes, emprunteurs, remboursements suivent
  delete from public.contributions where group_id = gid;       -- justificatifs (lignes) suivent
  delete from public.announcements where group_id = gid;
  delete from public.reminders where group_id = gid;
  delete from public.loan_links where group_id = gid;
  delete from public.invitations where group_id = gid;
  delete from public.memberships where group_id = gid;
  delete from auth.mfa_factors where user_id = me;

  -- ---------- le groupe ----------
  insert into public.groups (id, name, type, currency, period, visibility, created_by, loan_decision_mode,
                             expected_amount, initial_amount, start_month, fee_table)
  values (gid, 'Tontine des Amis (démo)', 'tontine', 'XOF', 'mois', 'tous', me, 'vote_tous',
          10000, 0, (this_month - interval '5 months')::date,
          '[{"max":5000,"fee":100},{"max":20000,"fee":300},{"max":50000,"fee":600},{"max":100000,"fee":1000}]'::jsonb)
  on conflict (id) do update set name = excluded.name, type = excluded.type, currency = excluded.currency,
    period = excluded.period, visibility = excluded.visibility, loan_decision_mode = excluded.loan_decision_mode,
    expected_amount = excluded.expected_amount, initial_amount = excluded.initial_amount,
    start_month = excluded.start_month, fee_table = excluded.fee_table,
    loan_rates = '[{"days":14,"rate":10},{"days":31,"rate":15},{"days":62,"rate":20},{"days":92,"rate":25}]'::jsonb;

  insert into public.group_modules (group_id, module, enabled)
  values (gid, 'annonces', true), (gid, 'cotisations', true), (gid, 'rappels', true), (gid, 'prets', true)
  on conflict (group_id, module) do update set enabled = true;

  -- ---------- les membres ----------
  insert into public.memberships (group_id, user_id, display_name, is_president, can_validate, can_publish, joined_at)
  values (gid, me, 'Vous (visiteur)', true, true, true, now() - interval '6 months');
  for i in 1..10 loop
    insert into public.memberships (group_id, user_id, display_name, is_secretary, can_validate, can_publish, joined_at)
    values (gid, ids[i], names[i], i = 1, i in (2, 3), i = 1, now() - interval '6 months' + make_interval(days => i));
  end loop;

  -- ---------- six mois de cotisations ----------
  -- 10 300 envoyes = 10 000 de cotisation + 300 de frais d'envoi
  for k in reverse 5..1 loop
    m_start := (this_month - make_interval(months => k))::date;
    for i in 1..11 loop
      continue when (i = 7 and k in (1, 2)) or (i = 9 and k = 1);   -- en retard
      v_paid := case when i = 7 and k = 3 then m_start + 19 else m_start + ((i * 3 + k) % 6 + 1) end;
      v_reviewer := case when payers[i] = ids[2] then ids[3] else ids[2] end;
      if i = 4 and k = 1 then   -- une capture illisible, rejetee puis renvoyee
        insert into public.contributions (group_id, payer_id, for_user_id, amount, fee, paid_on, status,
                                          reviewed_by, reviewed_at, reject_reason, created_at)
        values (gid, payers[i], payers[i], 10300, 300, v_paid, 'rejetee', v_reviewer, v_paid + 1,
                'Capture illisible : le montant et la référence ne se lisent pas.', v_paid);
        v_paid := v_paid + 2;
      end if;
      insert into public.contributions (group_id, payer_id, for_user_id, amount, fee, penalty, paid_on, status,
                                        reviewed_by, reviewed_at, note, created_at)
      values (gid, payers[i], payers[i],
              case when i = 7 and k = 3 then 10800 else 10300 end, 300,
              case when i = 7 and k = 3 then 500 else 0 end,
              v_paid, 'validee', v_reviewer, v_paid + 1,
              case when i = 7 and k = 3 then 'Payé en retard, avec la pénalité de 500 F' end, v_paid);
    end loop;
  end loop;

  -- Mois en cours : 5 validees, 3 en attente avec justificatif (a valider par le visiteur), les autres pas encore payees
  for i in 1..11 loop
    continue when i not in (1, 2, 3, 5, 11);
    v_paid := least(current_date, this_month + i % 4);
    insert into public.contributions (group_id, payer_id, for_user_id, amount, fee, paid_on, status, reviewed_by, reviewed_at, created_at)
    values (gid, payers[i], payers[i], 10300, 300, v_paid, 'validee',
            case when payers[i] = ids[2] then ids[3] else ids[2] end, v_paid, v_paid);
  end loop;
  for i in 1..3 loop
    insert into public.contributions (id, group_id, payer_id, for_user_id, amount, fee, paid_on, status, note, created_at)
    values (('dddddddd-0000-4000-8000-00000000020' || i)::uuid, gid, ids[pend[i]], ids[pend[i]],
            10300, 300, current_date, 'en_attente',
            pend_notes[i], now() - make_interval(hours => 2 + i * 5));
    insert into public.contribution_files (contribution_id, group_id, storage_path, mime_type, size_bytes, uploaded_by)
    values (('dddddddd-0000-4000-8000-00000000020' || i)::uuid, gid,
            gid || '/dddddddd-0000-4000-8000-00000000020' || i || '/recu.png', 'image/png', 60000, ids[pend[i]]);
  end loop;

  -- ---------- quatre prets ----------
  -- 1. Accorde, en cours de remboursement (Yao)
  insert into public.loans (id, group_id, link_member_id, borrower_member_id, guarantor_name, guarantor_member_id,
    guarantor_check, guarantor_response, amount, due_date, status, closes_at, decided_by, decided_at, decision_basis,
    interest_rate, interest, created_at)
  values (l1, gid, ids[4], ids[4], 'Kodjo Amegah', ids[2], 'autre_membre', 'confirme', 50000,
    current_date + 25, 'validee', now() - interval '13 days', ids[1], now() - interval '13 days', 'majorite',
    20, 10000, now() - interval '20 days');
  insert into public.loan_borrowers (loan_id, name, phone, reason, consent_at)
  values (l1, 'Yao Adjovi', '+22899000101', 'Achat de marchandises pour la boutique', now() - interval '20 days');
  insert into public.loan_votes (loan_id, voter_id, vote, created_at)
  select l1, v, case when v = ids[10] then 'contre' else 'pour' end, now() - interval '18 days'
    from unnest(array[ids[1], ids[2], ids[3], ids[5], ids[6], ids[8], ids[10]]) v;
  insert into public.loan_repayments (loan_id, group_id, amount, paid_on, note, recorded_by, created_at)
  values (l1, gid, 20000, current_date - 5, 'Premier versement', ids[2], now() - interval '5 days');

  -- 2. Au vote : il manque une voix pour le quorum, le visiteur peut voter (Ama)
  insert into public.loans (id, group_id, link_member_id, borrower_member_id, guarantor_name, guarantor_member_id,
    guarantor_check, guarantor_response, amount, due_date, status, closes_at, interest_rate, interest, created_at)
  values (l2, gid, ids[3], ids[3], 'Akossiwa Dogbe', ids[5], 'autre_membre', 'confirme', 30000,
    current_date + 30, 'en_vote', now() + interval '4 days', 20, 6000, now() - interval '3 days');
  insert into public.loan_borrowers (loan_id, name, phone, reason, consent_at)
  values (l2, 'Ama Kpodar', '+22899000102', 'Frais de scolarité', now() - interval '3 days');
  insert into public.loan_votes (loan_id, voter_id, vote, created_at)
  select l2, v, case when v = ids[7] then 'contre' else 'pour' end, now() - interval '2 days'
    from unnest(array[ids[1], ids[2], ids[6], ids[7]]) v;

  -- 3. Rembourse, interets compris (une personne exterieure au groupe)
  insert into public.loans (id, group_id, link_member_id, borrower_member_id, guarantor_name, guarantor_member_id,
    guarantor_check, guarantor_response, amount, due_date, status, closes_at, decided_by, decided_at, decision_basis,
    interest_rate, interest, created_at)
  values (l3, gid, ids[6], null, 'Komi Lawson', ids[6], 'lien', 'confirme', 25000,
    current_date - 45, 'remboursee', now() - interval '68 days', ids[1], now() - interval '68 days', 'majorite',
    15, 3750, now() - interval '75 days');
  insert into public.loan_borrowers (loan_id, name, phone, reason, consent_at)
  values (l3, 'Yawa Amouzou', '+22899000103', 'Réparation de la moto', now() - interval '75 days');
  insert into public.loan_votes (loan_id, voter_id, vote, created_at)
  select l3, v, 'pour', now() - interval '72 days' from unnest(array[ids[1], ids[2], ids[3], ids[4], ids[5], ids[8]]) v;
  insert into public.loan_repayments (loan_id, group_id, amount, paid_on, note, recorded_by, created_at)
  values (l3, gid, 15000, current_date - 55, null, ids[2], now() - interval '55 days'),
         (l3, gid, 13750, current_date - 46, 'Solde', ids[3], now() - interval '46 days');

  -- 4. A examiner : le visiteur est cite comme garant et peut confirmer
  insert into public.loans (id, group_id, link_member_id, borrower_member_id, guarantor_name, guarantor_member_id,
    guarantor_check, amount, due_date, interest_rate, interest, created_at)
  values (l4, gid, ids[8], null, 'Vous (visiteur)', me, 'autre_membre', 40000,
    current_date + 28, 15, 6000, now() - interval '1 day');
  insert into public.loan_borrowers (loan_id, name, phone, reason, consent_at)
  values (l4, 'Komlan Agbeko', '+22899000104', 'Fonds de roulement pour le commerce', now() - interval '1 day');

  -- ---------- annonces ----------
  insert into public.announcements (id, group_id, author_id, title, body, created_at)
  values (a1, gid, ids[1], 'Réunion du mois',
          'La réunion mensuelle a lieu samedi à 16 h chez Afi. Ordre du jour : point sur la caisse et la demande de prêt d''Ama.',
          now() - interval '2 days'),
         (gen_random_uuid(), gid, ids[1], 'Cotisations avant le 5',
          'Merci d''envoyer votre cotisation de 10 000 F avant le 5 du mois, avec la capture du paiement. Après le 15, une pénalité de 500 F s''ajoute.',
          now() - interval '12 days');

  -- ---------- notifications du visiteur ----------
  -- (les declencheurs en ont cree des centaines pendant le remplissage : on ne garde que celles-ci)
  delete from public.notifications where group_id = gid;
  insert into public.notifications (user_id, group_id, kind, entity_id, details, created_at)
  values
    (me, gid, 'pret_garant_demande', l4, jsonb_build_object('amount', 40000), now() - interval '1 day'),
    (me, gid, 'pret_ouvert_au_vote', l2, jsonb_build_object('amount', 30000), now() - interval '3 days'),
    (me, gid, 'annonce', a1, jsonb_build_object('title', 'Réunion du mois'), now() - interval '2 days'),
    (me, gid, 'pret_remboursement', l1, jsonb_build_object('amount', 20000, 'left', 40000, 'name', 'Yao Adjovi'), now() - interval '5 days');
  insert into public.notifications (user_id, group_id, kind, entity_id, details, created_at)
  select me, gid, 'cotisation_nouvelle', c.id, jsonb_build_object('amount', c.amount, 'name', m.display_name), c.created_at
    from public.contributions c join public.memberships m on m.group_id = c.group_id and m.user_id = c.payer_id
   where c.group_id = gid and c.status = 'en_attente';

  -- Journal : on repart d'un journal vide
  delete from public.audit_log where group_id = gid;

  perform set_config('app.internal', 'off', true);
  perform set_config('cercly.demo_reset', '', true);
end $$;

revoke all on function public.is_demo_user(), public.demo_group_id(), public.demo_guard(), public.demo_protect_auth_user(),
  public.demo_no_mfa(), public.demo_reset() from public, anon, authenticated;
grant execute on function public.is_demo_user() to authenticated;   -- utilisee par les regles de securite

-- =====================================================================
-- 4. INSTALLATION : faux membres, compte demo, premier remplissage, tache de nuit
-- =====================================================================

do $$
declare
  v_email text := 'kennethaloua3+cercly-demo@gmail.com';
  v_user uuid;
  v_ids uuid[] := array[]::uuid[];
  c text;
  i int;
begin
  select u.id into v_user from auth.users u where lower(u.email) = v_email;
  if v_user is null then
    raise exception 'Créez d''abord le compte % dans Authentication > Users (voir en tête du fichier)', v_email;
  end if;
  if exists (select 1 from public.memberships m where m.user_id = v_user) then
    raise exception 'Le compte % est déjà membre d''un groupe : choisissez un compte réservé à la démo', v_email;
  end if;

  -- Faux membres : comptes sans mot de passe, bloques, adresses reservees (aucun e-mail possible)
  for i in 1..10 loop
    v_ids := v_ids || ('dddddddd-0000-4000-8000-0000000001' || lpad(i::text, 2, '0'))::uuid;
    insert into auth.users (id, email, email_confirmed_at)
    values (v_ids[i], 'demo-membre-' || i || '@example.com', now())
    on conflict (id) do nothing;
  end loop;
  -- Colonnes propres a Supabase Auth (absentes de la copie de test) : valeurs attendues par le service Auth
  for c in select unnest(array['confirmation_token','recovery_token','email_change_token_new','email_change',
                               'email_change_token_current','phone_change','phone_change_token','reauthentication_token'])
  loop
    if exists (select 1 from information_schema.columns where table_schema = 'auth' and table_name = 'users' and column_name = c) then
      execute format('update auth.users set %I = coalesce(%I, '''') where id = any($1)', c, c) using v_ids;
    end if;
  end loop;
  if exists (select 1 from information_schema.columns where table_schema = 'auth' and table_name = 'users' and column_name = 'banned_until') then
    execute 'update auth.users set aud = ''authenticated'', role = ''authenticated'', banned_until = ''2999-01-01'',
               created_at = coalesce(created_at, now()), updated_at = now(),
               instance_id = ''00000000-0000-0000-0000-000000000000'',
               raw_app_meta_data = ''{"provider":"email","providers":["email"]}'', raw_user_meta_data = ''{}''
             where id = any($1)' using v_ids;
  end if;
  insert into public.profiles (id) select unnest(v_ids) on conflict (id) do nothing;
  insert into public.profiles (id) values (v_user) on conflict (id) do nothing;

  insert into public.demo_settings (user_id, group_id) values (v_user, 'dddddddd-0000-4000-8000-000000000001')
  on conflict (id) do update set user_id = excluded.user_id;
end $$;

select public.demo_reset();

do $$
begin
  perform cron.unschedule('cercly-demo-reset') where exists (select 1 from cron.job where jobname = 'cercly-demo-reset');
  perform cron.schedule('cercly-demo-reset', '0 3 * * *', 'select public.demo_reset()');
end $$;

commit;
