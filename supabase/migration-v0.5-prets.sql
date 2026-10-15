-- =====================================================================
-- Cercly — migration v0.4 -> v0.5 : prêts par formulaire (lien par membre)
-- À exécuter UNE SEULE FOIS dans l'éditeur SQL de Supabase, sur une base
-- où schema.sql (v0.4) est déjà installé.
--
-- Ce qui change :
--  1. Chaque membre a un lien personnel (fixe, régénérable, pouvant être mis en pause).
--  2. L'emprunteur remplit lui-même le formulaire, sans compte, et indique le nom de son garant.
--  3. Le garant désigné confirme, puis le groupe décide (vote de tous, ou des responsables seulement).
--  4. Les informations de l'emprunteur sont dans une table à part, avec un accès restreint.
--
-- Si la table loans contient déjà des données, la migration s'arrête sans rien modifier.
-- Pas encore dans cette version : versement et remboursements avec justificatifs (v0.6).
-- =====================================================================

begin;

do $$ begin
  if exists (select 1 from public.loans) then
    raise exception 'La table loans contient déjà des données : migration annulée.';
  end if;
end $$;

create extension if not exists unaccent with schema extensions;

-- ===================== ANCIEN MODULE PRÊTS ===========================
drop table public.loan_votes cascade;
drop table public.loans cascade;

-- ======================= RÉGLAGE DU GROUPE ===========================
-- 'vote_tous' : tous les membres votent (sauf l'emprunteur) et voient les informations de l'emprunteur.
-- 'responsables' : seuls le président et les validateurs votent et voient ces informations.
alter table public.groups add column loan_decision_mode text not null default 'vote_tous'
  check (loan_decision_mode in ('vote_tous','responsables'));
grant update (loan_decision_mode) on public.groups to authenticated;

-- ======================== NOTIFICATIONS ==============================
alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check check (kind in (
  'annonce','rappel_nouveau','cotisation_nouvelle','cotisation_pour_vous','cotisation_validee','cotisation_rejetee',
  'pret_demande','pret_garant_demande','pret_garant_confirme','pret_garant_refuse','pret_ouvert_au_vote',
  'pret_validee','pret_refusee','pret_remboursee','pret_annulee','membre_rejoint','presidence_transmise'));

-- Les notifications de prêts sont maintenant envoyées par les fonctions ci-dessous.
create or replace function public.notify_events() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_table_name = 'announcements' then
    perform public.notify(new.group_id, 'annonce', new.id, jsonb_build_object('title', new.title), 'all', new.author_id);
  elsif tg_table_name = 'reminders' then
    perform public.notify(new.group_id, 'rappel_nouveau', new.id, jsonb_build_object('title', new.title, 'due_date', new.due_date), 'all', new.created_by);
  elsif tg_table_name = 'contributions' and tg_op = 'INSERT' then
    perform public.notify(new.group_id, 'cotisation_nouvelle', new.id, jsonb_build_object('amount', new.amount), 'validators', new.payer_id);
    if new.for_user_id <> new.payer_id then
      perform public.notify(new.group_id, 'cotisation_pour_vous', new.id, jsonb_build_object('amount', new.amount), 'user', null, new.for_user_id);
    end if;
  elsif tg_table_name = 'contributions' and tg_op = 'UPDATE' and new.status <> old.status then
    perform public.notify(new.group_id, 'cotisation_' || new.status, new.id,
      jsonb_build_object('amount', new.amount, 'reason', new.reject_reason), 'user', null, new.payer_id);
  end if;
  return new;
end $$;

-- ============================ TABLES =================================

create function public.norm_name(t text) returns text language sql stable set search_path = '' as $$
  select lower(extensions.unaccent(regexp_replace(trim(coalesce(t, '')), '\s+', ' ', 'g'))) $$;

-- Un lien par membre et par groupe. Le jeton est lisible uniquement par son propriétaire.
create table public.loan_links (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null,
  member_id uuid not null,
  token text not null unique,
  status text not null default 'actif' check (status in ('actif','pause','desactive')),
  created_at timestamptz not null default now(),
  foreign key (group_id, member_id) references public.memberships (group_id, user_id) on delete cascade
);
create unique index one_live_link_per_member on public.loan_links (group_id, member_id) where status in ('actif','pause');

create table public.loans (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  link_id uuid references public.loan_links(id) on delete set null,
  link_member_id uuid not null,                     -- membre dont le lien a été utilisé
  borrower_member_id uuid,                          -- si l'emprunteur est un membre (reconnu par son nom, ou fixé par le président)
  guarantor_name text not null check (char_length(guarantor_name) between 2 and 100),   -- nom écrit par l'emprunteur
  guarantor_member_id uuid,                         -- membre reconnu comme garant
  guarantor_check text not null check (guarantor_check in ('lien','autre_membre','inconnu','corrige')),
  guarantor_response text not null default 'en_attente' check (guarantor_response in ('en_attente','confirme','refuse')),
  amount numeric(14,2) not null check (amount > 0),
  due_date date not null,
  status text not null default 'a_examiner' check (status in ('a_examiner','garant_refuse','en_vote','validee','refusee','remboursee','annulee')),
  closes_at timestamptz,                            -- fin du vote (7 jours après l'ouverture)
  decided_by uuid references public.profiles(id),
  decided_at timestamptz,
  decision_basis text check (decision_basis in ('majorite','egalite','sans_quorum')),
  dismiss_reason text check (char_length(dismiss_reason) <= 500),
  created_at timestamptz not null default now(),
  foreign key (group_id, link_member_id) references public.memberships (group_id, user_id),
  foreign key (group_id, borrower_member_id) references public.memberships (group_id, user_id),
  foreign key (group_id, guarantor_member_id) references public.memberships (group_id, user_id)
);
create index on public.loans (group_id, created_at desc);

-- Informations personnelles de l'emprunteur : table séparée, accès restreint, effaçable.
create table public.loan_borrowers (
  loan_id uuid primary key references public.loans(id) on delete cascade,
  name text not null check (char_length(name) between 2 and 100),
  phone text not null check (phone ~ '^\+?[0-9]{6,15}$'),
  reason text check (char_length(reason) <= 500),
  consent_at timestamptz not null
);

create table public.loan_votes (
  loan_id uuid not null references public.loans(id) on delete cascade,
  voter_id uuid not null references public.profiles(id),
  vote text not null check (vote in ('pour','contre')),
  created_at timestamptz not null default now(),
  primary key (loan_id, voter_id)
);

-- ======================== FONCTIONS D'AIDE ===========================

-- Qui peut voter : tous les membres actifs sauf l'emprunteur (mode 'vote_tous'), ou le président et les validateurs (mode 'responsables').
create function public.loan_is_voter(p_loan uuid, p_user uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.loans l
    join public.groups g on g.id = l.group_id
    join public.memberships m on m.group_id = l.group_id and m.user_id = p_user and m.status = 'active'
    where l.id = p_loan and l.borrower_member_id is distinct from p_user
      and (g.loan_decision_mode = 'vote_tous' or m.is_president or m.can_validate)) $$;

create function public.can_vote_loan(p_loan uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.loans l
    where l.id = p_loan and l.status = 'en_vote' and l.closes_at > now()
      and public.module_enabled(l.group_id, 'prets') and public.loan_is_voter(l.id, (select auth.uid()))) $$;

create function public.loan_can_see_borrower(p_loan uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.loans l
    where l.id = p_loan and public.is_member(l.group_id) and public.module_enabled(l.group_id, 'prets')
      and (public.is_president(l.group_id) or public.can_validate(l.group_id)
           or l.guarantor_member_id = (select auth.uid()) or l.link_member_id = (select auth.uid())
           or l.borrower_member_id = (select auth.uid())
           or public.loan_is_voter(l.id, (select auth.uid())))) $$;

-- Quorum = au moins la moitié des personnes pouvant voter, avec un minimum de 2 votes.
create or replace function public.loan_quorum(p_loan uuid) returns int language plpgsql stable security definer set search_path = '' as $$
declare l public.loans; n int;
begin
  select * into l from public.loans where id = p_loan;
  if not found or not public.is_member(l.group_id) then raise exception 'Accès refusé'; end if;
  select count(*) into n from public.memberships m where m.group_id = l.group_id and m.status = 'active' and public.loan_is_voter(l.id, m.user_id);
  return greatest(2, ceil(n / 2.0)::int);
end $$;

-- Ouvre le vote pour 7 jours et prévient les votants (usage interne).
create function public._open_loan_vote(p_loan uuid) returns void language plpgsql security definer set search_path = '' as $$
declare l public.loans; v_mode text;
begin
  update public.loans set status = 'en_vote', guarantor_response = 'confirme', closes_at = now() + interval '7 days'
    where id = p_loan and status = 'a_examiner' returning * into l;
  if not found then return; end if;
  select g.loan_decision_mode into v_mode from public.groups g where g.id = l.group_id;
  perform public.notify(l.group_id, 'pret_ouvert_au_vote', l.id, jsonb_build_object('amount', l.amount),
    case when v_mode = 'vote_tous' then 'all' else 'validators' end, l.borrower_member_id);
end $$;

-- ===================== LIENS PERSONNELS DES MEMBRES ==================

create function public.get_or_create_loan_link(p_group uuid) returns text language plpgsql security definer set search_path = '' as $$
declare v text;
begin
  if not public.is_member(p_group) then raise exception 'Accès refusé'; end if;
  if not public.module_enabled(p_group, 'prets') then raise exception 'Le module Prêts est désactivé'; end if;
  select lk.token into v from public.loan_links lk
    where lk.group_id = p_group and lk.member_id = (select auth.uid()) and lk.status in ('actif','pause');
  if found then return v; end if;
  v := encode(extensions.gen_random_bytes(32), 'hex');
  insert into public.loan_links (group_id, member_id, token) values (p_group, (select auth.uid()), v);
  return v;
end $$;

-- Régénérer : l'ancien lien est désactivé immédiatement, le nouveau fonctionne tout de suite.
create function public.regenerate_loan_link(p_group uuid) returns text language plpgsql security definer set search_path = '' as $$
declare v text;
begin
  if not public.is_member(p_group) then raise exception 'Accès refusé'; end if;
  if not public.module_enabled(p_group, 'prets') then raise exception 'Le module Prêts est désactivé'; end if;
  if not public.is_aal2() then raise exception 'Double authentification requise'; end if;
  update public.loan_links set status = 'desactive'
    where group_id = p_group and member_id = (select auth.uid()) and status in ('actif','pause');
  v := encode(extensions.gen_random_bytes(32), 'hex');
  insert into public.loan_links (group_id, member_id, token) values (p_group, (select auth.uid()), v);
  return v;
end $$;

create function public.set_loan_link_paused(p_group uuid, p_paused boolean) returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.loan_links set status = case when p_paused then 'pause' else 'actif' end
    where group_id = p_group and member_id = (select auth.uid()) and status in ('actif','pause');
end $$;

-- Un membre retiré du groupe perd son lien.
create function public.deactivate_links_on_removal() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.loan_links set status = 'desactive'
    where group_id = new.group_id and member_id = new.user_id and status in ('actif','pause');
  return new;
end $$;
create trigger memberships_deactivate_links after update of status on public.memberships
  for each row when (new.status = 'removed') execute function public.deactivate_links_on_removal();

-- ===================== FORMULAIRE PUBLIC (sans compte) ===============

-- Permet à la page du formulaire d'afficher « groupe X, lien de Y ». Ne renvoie rien si le lien n'est pas valide.
create function public.get_loan_link_info(p_token text) returns table (group_name text, currency text, member_name text)
language sql stable security definer set search_path = '' as $$
  select g.name, g.currency, m.display_name
  from public.loan_links lk
  join public.groups g on g.id = lk.group_id
  join public.memberships m on m.group_id = lk.group_id and m.user_id = lk.member_id and m.status = 'active'
  where lk.token = p_token and lk.status = 'actif' and public.module_enabled(g.id, 'prets') $$;

create function public.submit_loan_request(p_token text, p_borrower_name text, p_phone text, p_amount numeric,
  p_due_date date, p_reason text, p_guarantor_name text, p_consent boolean)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  lk public.loan_links;
  v_phone text := regexp_replace(trim(coalesce(p_phone, '')), '[\s().-]', '', 'g');
  v_bname text := regexp_replace(trim(coalesce(p_borrower_name, '')), '\s+', ' ', 'g');
  v_gname text := regexp_replace(trim(coalesce(p_guarantor_name, '')), '\s+', ' ', 'g');
  v_bm uuid; v_gm uuid; v_check text; v_id uuid; v_confirmed boolean;
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
  v_confirmed := v_gm is not null and v_gm = v_bm;   -- un membre qui emprunte pour lui-même : pas de confirmation à demander

  insert into public.loans (group_id, link_id, link_member_id, borrower_member_id, guarantor_name, guarantor_member_id, guarantor_check, amount, due_date)
    values (lk.group_id, lk.id, lk.member_id, v_bm, v_gname, v_gm, v_check, p_amount, p_due_date) returning id into v_id;
  insert into public.loan_borrowers (loan_id, name, phone, reason, consent_at)
    values (v_id, v_bname, v_phone, nullif(trim(coalesce(p_reason, '')), ''), now());

  perform public.notify(lk.group_id, 'pret_demande', v_id, jsonb_build_object('amount', p_amount, 'check', v_check), 'validators');
  if v_confirmed then
    perform public._open_loan_vote(v_id);
  elsif v_gm is not null then
    perform public.notify(lk.group_id, 'pret_garant_demande', v_id, jsonb_build_object('amount', p_amount), 'user', null, v_gm);
  end if;
  return true;
end $$;

-- ===================== TRAITEMENT DES DEMANDES =======================

create function public.respond_as_guarantor(p_loan uuid, p_accept boolean) returns void language plpgsql security definer set search_path = '' as $$
declare l public.loans;
begin
  select * into l from public.loans where id = p_loan for update;
  if not found or l.guarantor_member_id is distinct from (select auth.uid()) or not public.is_member(l.group_id) then
    raise exception 'Réservé au garant désigné';
  end if;
  if not public.is_aal2() then raise exception 'Double authentification requise'; end if;
  if l.status <> 'a_examiner' or l.guarantor_response <> 'en_attente' then raise exception 'Cette demande n''attend plus de réponse du garant'; end if;
  if p_accept then
    perform public._open_loan_vote(p_loan);
    perform public.notify(l.group_id, 'pret_garant_confirme', p_loan, jsonb_build_object('amount', l.amount), 'validators', (select auth.uid()));
  else
    update public.loans set status = 'garant_refuse', guarantor_response = 'refuse' where id = p_loan;
    perform public.notify(l.group_id, 'pret_garant_refuse', p_loan, jsonb_build_object('amount', l.amount), 'validators', (select auth.uid()));
  end if;
end $$;

-- Le président peut corriger l'emprunteur et le garant reconnus (nom mal écrit, garant inconnu...).
create function public.link_loan_parties(p_loan uuid, p_borrower_member uuid, p_guarantor_member uuid) returns void language plpgsql security definer set search_path = '' as $$
declare l public.loans;
begin
  select * into l from public.loans where id = p_loan for update;
  if not found then raise exception 'Demande introuvable'; end if;
  if not public.is_president(l.group_id) then raise exception 'Réservé au président'; end if;
  if not public.is_aal2() then raise exception 'Double authentification requise'; end if;
  if l.status <> 'a_examiner' then raise exception 'Cette demande n''est plus modifiable'; end if;
  if p_borrower_member is not null and not exists (select 1 from public.memberships m where m.group_id = l.group_id and m.user_id = p_borrower_member and m.status = 'active') then
    raise exception 'Emprunteur : membre introuvable';
  end if;
  if p_guarantor_member is not null and not exists (select 1 from public.memberships m where m.group_id = l.group_id and m.user_id = p_guarantor_member and m.status = 'active') then
    raise exception 'Garant : membre introuvable';
  end if;
  update public.loans set borrower_member_id = p_borrower_member, guarantor_member_id = p_guarantor_member,
    guarantor_check = 'corrige', guarantor_response = 'en_attente' where id = p_loan;
  if p_guarantor_member is not null and p_guarantor_member = p_borrower_member then
    perform public._open_loan_vote(p_loan);
  elsif p_guarantor_member is not null then
    perform public.notify(l.group_id, 'pret_garant_demande', p_loan, jsonb_build_object('amount', l.amount), 'user', null, p_guarantor_member);
  end if;
end $$;

-- Écarter une demande (spam, doublon, erreur) : président ou validateur, avec un motif.
create function public.dismiss_loan(p_loan uuid, p_reason text) returns void language plpgsql security definer set search_path = '' as $$
declare l public.loans;
begin
  select * into l from public.loans where id = p_loan for update;
  if not found then raise exception 'Demande introuvable'; end if;
  if not (public.is_president(l.group_id) or public.can_validate(l.group_id)) then raise exception 'Réservé au président et aux validateurs'; end if;
  if not public.is_aal2() then raise exception 'Double authentification requise'; end if;
  if l.status <> 'a_examiner' then raise exception 'Cette demande n''est plus modifiable'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'Un motif est obligatoire'; end if;
  update public.loans set status = 'annulee', dismiss_reason = left(trim(p_reason), 500) where id = p_loan;
  perform public.notify(l.group_id, 'pret_annulee', p_loan, jsonb_build_object('amount', l.amount), 'validators', (select auth.uid()));
end $$;

-- Règle : le vote dure 7 jours et ne se clôture qu'après l'échéance.
--  - Quorum atteint : majorité des votes ; en cas d'égalité, le président tranche.
--  - Quorum non atteint (y compris aucun vote) : jamais validé d'office, le président décide.
-- Quand le président décide : p_decision = 'validee' ou 'refusee'. L'emprunteur ne peut pas trancher sa propre demande.
create or replace function public.close_loan(p_loan uuid, p_decision text default null) returns text language plpgsql security definer set search_path = '' as $$
declare l public.loans; v_pour int; v_contre int; v_quorum int; v_status text; v_basis text;
begin
  select * into l from public.loans where id = p_loan for update;
  if not found then raise exception 'Demande introuvable'; end if;
  if l.status <> 'en_vote' then raise exception 'Vote déjà clôturé'; end if;
  if not public.is_president(l.group_id) then raise exception 'Réservé au président'; end if;
  if not public.is_aal2() then raise exception 'Double authentification requise'; end if;
  if l.closes_at > now() then raise exception 'Le vote est encore ouvert'; end if;
  select count(*) filter (where vote = 'pour'), count(*) filter (where vote = 'contre') into v_pour, v_contre
    from public.loan_votes where loan_id = p_loan;
  v_quorum := public.loan_quorum(p_loan);
  if v_pour + v_contre >= v_quorum and v_pour > v_contre then
    v_status := 'validee'; v_basis := 'majorite';
  elsif v_pour + v_contre >= v_quorum and v_contre > v_pour then
    v_status := 'refusee'; v_basis := 'majorite';
  else
    if l.borrower_member_id = (select auth.uid()) then
      raise exception 'Vous êtes l''emprunteur : vous ne pouvez pas trancher votre propre demande (transmettez d''abord la présidence)';
    end if;
    if p_decision is null or p_decision not in ('validee','refusee') then
      raise exception 'Quorum non atteint ou égalité : le président doit décider (validee ou refusee)';
    end if;
    v_status := p_decision;
    v_basis := case when v_pour + v_contre >= v_quorum then 'egalite' else 'sans_quorum' end;
  end if;
  update public.loans set status = v_status, decision_basis = v_basis, decided_by = (select auth.uid()), decided_at = now() where id = p_loan;
  perform public.notify(l.group_id, 'pret_' || v_status, p_loan, jsonb_build_object('amount', l.amount), 'all');
  return v_status;
end $$;

create or replace function public.mark_loan_repaid(p_loan uuid) returns void language plpgsql security definer set search_path = '' as $$
declare l public.loans;
begin
  select * into l from public.loans where id = p_loan for update;
  if not found or l.status <> 'validee' then raise exception 'Prêt introuvable ou non validé'; end if;
  if not public.is_president(l.group_id) then raise exception 'Réservé au président'; end if;
  if not public.is_aal2() then raise exception 'Double authentification requise'; end if;
  update public.loans set status = 'remboursee' where id = p_loan;
  perform public.notify(l.group_id, 'pret_remboursee', p_loan, jsonb_build_object('amount', l.amount), 'all');
end $$;

-- Effacer les informations personnelles de l'emprunteur une fois le dossier terminé.
create function public.purge_loan_borrower(p_loan uuid) returns void language plpgsql security definer set search_path = '' as $$
declare l public.loans;
begin
  select * into l from public.loans where id = p_loan;
  if not found then raise exception 'Demande introuvable'; end if;
  if not public.is_president(l.group_id) then raise exception 'Réservé au président'; end if;
  if not public.is_aal2() then raise exception 'Double authentification requise'; end if;
  if l.status not in ('garant_refuse','refusee','remboursee','annulee') then raise exception 'Le dossier n''est pas terminé'; end if;
  delete from public.loan_borrowers where loan_id = p_loan;
end $$;

-- ===================== JOURNAL, SÉCURITÉ, DROITS =====================

create trigger audit_loans after insert or update on public.loans for each row execute function public.audit_row();

alter table public.loan_links enable row level security;
alter table public.loans enable row level security;
alter table public.loan_borrowers enable row level security;
alter table public.loan_votes enable row level security;

create policy loan_links_select on public.loan_links for select to authenticated using (member_id = (select auth.uid()));
create policy loans_select on public.loans for select to authenticated
  using (public.is_member(group_id) and public.module_enabled(group_id, 'prets'));
create policy loan_borrowers_select on public.loan_borrowers for select to authenticated using (public.loan_can_see_borrower(loan_id));
create policy votes_select on public.loan_votes for select to authenticated using (voter_id = (select auth.uid()));
create policy votes_insert on public.loan_votes for insert to authenticated
  with check (voter_id = (select auth.uid()) and public.can_vote_loan(loan_id));

-- Aucune écriture directe : tout passe par les fonctions ci-dessus (sauf le vote).
grant select on public.loan_links, public.loans, public.loan_borrowers, public.loan_votes to authenticated;
grant insert (loan_id, voter_id, vote) on public.loan_votes to authenticated;

revoke all on function public.norm_name(text), public.loan_is_voter(uuid, uuid), public.can_vote_loan(uuid),
  public.loan_can_see_borrower(uuid), public._open_loan_vote(uuid), public.get_or_create_loan_link(uuid),
  public.regenerate_loan_link(uuid), public.set_loan_link_paused(uuid, boolean), public.deactivate_links_on_removal(),
  public.get_loan_link_info(text), public.submit_loan_request(text, text, text, numeric, date, text, text, boolean),
  public.respond_as_guarantor(uuid, boolean), public.link_loan_parties(uuid, uuid, uuid), public.dismiss_loan(uuid, text),
  public.purge_loan_borrower(uuid) from public, anon, authenticated;

grant execute on function public.loan_is_voter(uuid, uuid), public.can_vote_loan(uuid), public.loan_can_see_borrower(uuid) to authenticated;
grant execute on function public.get_or_create_loan_link(uuid), public.regenerate_loan_link(uuid), public.set_loan_link_paused(uuid, boolean),
  public.respond_as_guarantor(uuid, boolean), public.link_loan_parties(uuid, uuid, uuid), public.dismiss_loan(uuid, text),
  public.purge_loan_borrower(uuid) to authenticated;
-- Seules fonctions ouvertes sans connexion : le formulaire de l'emprunteur
grant execute on function public.get_loan_link_info(text), public.submit_loan_request(text, text, text, numeric, date, text, text, boolean) to anon, authenticated;

commit;
