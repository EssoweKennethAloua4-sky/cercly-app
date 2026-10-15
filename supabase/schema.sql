-- =====================================================================
-- Cercly — schéma de base de données v0.4 (PostgreSQL / Supabase)
-- À exécuter dans l'éditeur SQL d'un projet Supabase vierge.
-- v0.2 : notifications obligatoires, transfert de présidence, langues (fr/en).
-- v0.4 : totaux du groupe et par membre (fonctions group_total / group_totals), calculés à partir des cotisations validées.
-- v0.3 : un validateur ne peut jamais traiter son propre justificatif ;
--        motif de rejet obligatoire (aussi imposé par la base) ; prêts : vote de 7 jours,
--        quorum, jamais de validation automatique, décision du président tracée.
-- Les droits suivent la fiche de droits. Les points marqués [À CONFIRMER]
-- correspondent aux questions ouvertes du README.
-- =====================================================================

create extension if not exists pgcrypto with schema extensions;

-- Aucun accès par défaut pour les futurs objets
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on functions from public, anon, authenticated;

-- ============================ TABLES =================================

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  locale text not null default 'fr' check (locale in ('fr','en')),  -- français par défaut, anglais en option
  created_at timestamptz not null default now()
);

create table public.groups (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 80),
  type text not null default 'autre' check (type in ('tontine','association','famille','equipe','classe','autre')),
  currency text not null default 'XOF' check (char_length(currency) = 3),
  period text not null default 'mois' check (period in ('jour','semaine','mois','annee')),
  visibility text not null default 'tous' check (visibility in ('tous','soi')),
  vocabulary jsonb not null default '{}'::jsonb,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

create table public.group_modules (
  group_id uuid not null references public.groups(id) on delete cascade,
  module text not null check (module in ('annonces','cotisations','rappels','prets')),
  enabled boolean not null default false,
  primary key (group_id, module)
);

create table public.memberships (
  group_id uuid not null references public.groups(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 60),
  is_president boolean not null default false,
  can_validate boolean not null default false,
  can_publish boolean not null default false,
  status text not null default 'active' check (status in ('active','removed')),
  joined_at timestamptz not null default now(),
  primary key (group_id, user_id)
);
create unique index one_president_per_group on public.memberships (group_id) where is_president and status = 'active';

create table public.invitations (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  email text not null check (email = lower(email)),
  token_hash text not null unique,
  invited_by uuid not null references public.profiles(id),
  status text not null default 'en_attente' check (status in ('en_attente','acceptee','annulee')),
  expires_at timestamptz not null,
  accepted_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.announcements (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  author_id uuid not null,
  title text not null check (char_length(title) between 1 and 120),
  body text not null check (char_length(body) between 1 and 5000),
  created_at timestamptz not null default now(),
  foreign key (group_id, author_id) references public.memberships (group_id, user_id)
);

create table public.reminders (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 120),
  due_date date not null,
  kind text not null default 'autre' check (kind in ('cotisation','pret','autre')),
  done boolean not null default false,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

create table public.contributions (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  payer_id uuid not null,
  for_user_id uuid not null,
  amount numeric(14,2) not null check (amount > 0),
  paid_on date not null default current_date,
  note text check (char_length(note) <= 500),
  status text not null default 'en_attente' check (status in ('en_attente','validee','rejetee')),
  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz,
  reject_reason text check (char_length(reject_reason) <= 500),
  created_at timestamptz not null default now(),
  foreign key (group_id, payer_id) references public.memberships (group_id, user_id),
  foreign key (group_id, for_user_id) references public.memberships (group_id, user_id),
  -- Garde-fous imposés par la base elle-même, en plus de la fonction review_contribution :
  check (reviewed_by is null or reviewed_by <> payer_id),                                  -- jamais son propre justificatif
  check (status <> 'rejetee' or coalesce(btrim(reject_reason), '') <> '')                  -- motif obligatoire au rejet
);
create index on public.contributions (group_id, created_at desc);

create table public.contribution_files (
  id uuid primary key default gen_random_uuid(),
  contribution_id uuid not null references public.contributions(id) on delete cascade,
  group_id uuid not null references public.groups(id) on delete cascade,
  storage_path text not null unique,
  mime_type text not null check (mime_type in ('image/jpeg','image/png','image/webp','application/pdf')),
  size_bytes integer not null check (size_bytes between 1 and 5242880),
  uploaded_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  check (storage_path like group_id::text || '/' || contribution_id::text || '/%')
);

create table public.loans (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  requester_id uuid not null,
  amount numeric(14,2) not null check (amount > 0),
  reason text check (char_length(reason) <= 500),
  due_date date not null,
  status text not null default 'en_vote' check (status in ('en_vote','validee','refusee','remboursee')),
  closes_at timestamptz not null default now() + interval '7 days',
  decided_by uuid references public.profiles(id),
  decided_at timestamptz,
  decision_basis text check (decision_basis in ('majorite','egalite','sans_quorum')),  -- comment la décision a été prise (visible de tous)
  created_at timestamptz not null default now(),
  foreign key (group_id, requester_id) references public.memberships (group_id, user_id)
);

create table public.loan_votes (
  loan_id uuid not null references public.loans(id) on delete cascade,
  voter_id uuid not null references public.profiles(id),
  vote text not null check (vote in ('pour','contre')),
  created_at timestamptz not null default now(),
  primary key (loan_id, voter_id)
);

create table public.audit_log (
  id bigint generated always as identity primary key,
  group_id uuid references public.groups(id) on delete cascade,
  actor_id uuid,
  action text not null,
  entity text not null,
  entity_id uuid,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- Notifications obligatoires : créées uniquement par des triggers, impossibles à supprimer.
-- Le texte est affiché par l'application (français ou anglais) à partir de kind + details.
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  group_id uuid not null references public.groups(id) on delete cascade,
  kind text not null check (kind in ('annonce','rappel_nouveau','cotisation_nouvelle','cotisation_pour_vous','cotisation_validee',
    'cotisation_rejetee','pret_demande','pret_validee','pret_refusee','pret_remboursee','membre_rejoint','presidence_transmise')),
  entity_id uuid,
  details jsonb not null default '{}'::jsonb,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index on public.notifications (user_id, created_at desc);

-- ===================== FONCTIONS D'AIDE (droits) =====================

create function public.max_validators() returns int language sql immutable set search_path = '' as $$ select 3 $$;  -- confirmé : président compris

create function public.is_member(gid uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.memberships m where m.group_id = gid and m.user_id = (select auth.uid()) and m.status = 'active') $$;

create function public.is_president(gid uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.memberships m where m.group_id = gid and m.user_id = (select auth.uid()) and m.status = 'active' and m.is_president) $$;

create function public.can_validate(gid uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.memberships m where m.group_id = gid and m.user_id = (select auth.uid()) and m.status = 'active' and m.can_validate) $$;

create function public.can_publish(gid uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.memberships m where m.group_id = gid and m.user_id = (select auth.uid()) and m.status = 'active' and (m.can_publish or m.is_president)) $$;

create function public.module_enabled(gid uuid, mod text) returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.group_modules gm where gm.group_id = gid and gm.module = mod and gm.enabled) $$;

-- Double authentification exigée pour les actions sensibles.
-- En développement seulement, on peut remplacer le corps par : select true
create function public.is_aal2() returns boolean language sql stable set search_path = '' as $$
  select coalesce((select auth.jwt()) ->> 'aal', '') = 'aal2' $$;

-- ===================== TRIGGERS DE PROTECTION ========================

create function public.handle_new_user() returns trigger language plpgsql security definer set search_path = '' as $$
begin insert into public.profiles (id) values (new.id); return new; end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

create function public.memberships_guard() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if current_setting('app.internal', true) = 'on' then return new; end if;
  if new.group_id <> old.group_id or new.user_id <> old.user_id or new.is_president <> old.is_president then
    raise exception 'Modification interdite';
  end if;
  if new.can_validate <> old.can_validate or new.can_publish <> old.can_publish or new.status <> old.status then
    if not public.is_president(new.group_id) then raise exception 'Réservé au président'; end if;
    if not public.is_aal2() then raise exception 'Double authentification requise'; end if;
    if old.is_president and (new.status <> 'active' or not new.can_validate) then
      raise exception 'Le président ne peut pas être retiré ni perdre ses droits';
    end if;
  end if;
  if new.can_validate and new.status = 'active' and (not old.can_validate or old.status <> 'active') then
    if (select count(*) from public.memberships m
         where m.group_id = new.group_id and m.can_validate and m.status = 'active' and m.user_id <> new.user_id) >= public.max_validators() then
      raise exception 'Maximum % validateurs par groupe', public.max_validators();
    end if;
  end if;
  return new;
end $$;
create trigger memberships_guard before update on public.memberships for each row execute function public.memberships_guard();

create function public.limit_files() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if (select count(*) from public.contribution_files f where f.contribution_id = new.contribution_id) >= 5 then
    raise exception 'Maximum 5 justificatifs par cotisation';
  end if;
  return new;
end $$;
create trigger limit_files before insert on public.contribution_files for each row execute function public.limit_files();

-- Journal d'audit : alimenté par triggers, en lecture seule ensuite
create function public.audit_row() returns trigger language plpgsql security definer set search_path = '' as $$
declare r jsonb := to_jsonb(coalesce(new, old)); gid uuid;
begin
  gid := case when tg_table_name = 'groups' then (r ->> 'id')::uuid else (r ->> 'group_id')::uuid end;
  insert into public.audit_log (group_id, actor_id, action, entity, entity_id, details)
  values (gid, (select auth.uid()), lower(tg_op), tg_table_name, (r ->> 'id')::uuid,
          jsonb_build_object('status', r ->> 'status', 'user_id', r ->> 'user_id'));
  return coalesce(new, old);
end $$;

create function public.audit_immutable() returns trigger language plpgsql set search_path = '' as $$
begin raise exception 'Le journal est en lecture seule'; end $$;
create trigger audit_no_change before update or delete on public.audit_log for each row execute function public.audit_immutable();

create trigger audit_groups after insert or update on public.groups for each row execute function public.audit_row();
create trigger audit_modules after insert or update on public.group_modules for each row execute function public.audit_row();
create trigger audit_memberships after insert or update on public.memberships for each row execute function public.audit_row();
create trigger audit_invitations after insert or update on public.invitations for each row execute function public.audit_row();
create trigger audit_announcements after insert or update or delete on public.announcements for each row execute function public.audit_row();
create trigger audit_contributions after insert or update on public.contributions for each row execute function public.audit_row();
create trigger audit_loans after insert or update on public.loans for each row execute function public.audit_row();

-- ===================== NOTIFICATIONS (triggers) ======================
-- Audience : 'all' = tous les membres actifs, 'validators' = validateurs et président,
-- 'president', 'user' = uniquement p_extra. p_exclude = personne à ne pas notifier.
create function public.notify(p_group uuid, p_kind text, p_entity uuid, p_details jsonb, p_audience text, p_exclude uuid default null, p_extra uuid default null)
returns void language sql security definer set search_path = '' as $$
  insert into public.notifications (user_id, group_id, kind, entity_id, details)
  select m.user_id, p_group, p_kind, p_entity, p_details from public.memberships m
  where m.group_id = p_group and m.status = 'active'
    and (p_exclude is null or m.user_id <> p_exclude)
    and case p_audience when 'all' then true when 'validators' then (m.can_validate or m.is_president)
         when 'president' then m.is_president when 'user' then m.user_id = p_extra else false end
$$;

create function public.notify_events() returns trigger language plpgsql security definer set search_path = '' as $$
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
  elsif tg_table_name = 'loans' and tg_op = 'INSERT' then
    perform public.notify(new.group_id, 'pret_demande', new.id, jsonb_build_object('amount', new.amount), 'all', new.requester_id);
  elsif tg_table_name = 'loans' and tg_op = 'UPDATE' and new.status <> old.status then
    perform public.notify(new.group_id, 'pret_' || new.status, new.id, jsonb_build_object('amount', new.amount), 'all');
  end if;
  return new;
end $$;
create trigger notify_announcements after insert on public.announcements for each row execute function public.notify_events();
create trigger notify_reminders after insert on public.reminders for each row execute function public.notify_events();
create trigger notify_contributions after insert or update on public.contributions for each row execute function public.notify_events();
create trigger notify_loans after insert or update on public.loans for each row execute function public.notify_events();
-- Les rappels à échéance (le jour J) demanderont une tâche planifiée (pg_cron) : étape suivante.

-- ================== FONCTIONS MÉTIER (actions sensibles) =============

create function public.create_group(p_name text, p_type text default 'autre', p_currency text default 'XOF', p_display_name text default 'Président')
returns uuid language plpgsql security definer set search_path = '' as $$
declare gid uuid;
begin
  if (select auth.uid()) is null then raise exception 'Connexion requise'; end if;
  if (select count(*) from public.groups g where g.created_by = (select auth.uid())) >= 10 then
    raise exception 'Limite de groupes atteinte';
  end if;
  insert into public.groups (name, type, currency, created_by) values (trim(p_name), p_type, upper(p_currency), (select auth.uid())) returning id into gid;
  insert into public.memberships (group_id, user_id, display_name, is_president, can_validate, can_publish)
    values (gid, (select auth.uid()), trim(p_display_name), true, true, true);
  insert into public.group_modules (group_id, module, enabled)
    values (gid, 'annonces', true), (gid, 'cotisations', true), (gid, 'rappels', true), (gid, 'prets', false);
  return gid;
end $$;

create function public.invite_member(p_group uuid, p_email text) returns text language plpgsql security definer set search_path = '' as $$
declare v_token text; v_email text := lower(trim(p_email));
begin
  if not public.is_president(p_group) then raise exception 'Réservé au président'; end if;
  if not public.is_aal2() then raise exception 'Double authentification requise'; end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Adresse e-mail invalide'; end if;
  if (select count(*) from public.memberships m where m.group_id = p_group and m.status = 'active') >= 200 then
    raise exception 'Groupe complet';
  end if;
  update public.invitations set status = 'annulee' where group_id = p_group and email = v_email and status = 'en_attente';
  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  insert into public.invitations (group_id, email, token_hash, invited_by, expires_at)
    values (p_group, v_email, encode(extensions.digest(v_token, 'sha256'), 'hex'), (select auth.uid()), now() + interval '7 days');
  return v_token;  -- l'e-mail d'invitation est envoyé côté serveur (fonction Edge), jamais affiché aux autres membres
end $$;

create function public.accept_invitation(p_token text, p_display_name text) returns uuid language plpgsql security definer set search_path = '' as $$
declare inv public.invitations; v_email text;
begin
  if (select auth.uid()) is null then raise exception 'Connexion requise'; end if;
  select * into inv from public.invitations
    where token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex') and status = 'en_attente' and expires_at > now() for update;
  if not found then raise exception 'Invitation invalide ou expirée'; end if;
  select u.email into v_email from auth.users u where u.id = (select auth.uid()) and u.email_confirmed_at is not null;
  if v_email is null or lower(v_email) <> inv.email then raise exception 'Cette invitation est destinée à une autre adresse'; end if;
  perform set_config('app.internal', 'on', true);
  insert into public.memberships (group_id, user_id, display_name) values (inv.group_id, (select auth.uid()), trim(p_display_name))
    on conflict (group_id, user_id) do update set status = 'active', display_name = excluded.display_name, can_validate = false, can_publish = false;
  perform set_config('app.internal', 'off', true);
  update public.invitations set status = 'acceptee', accepted_at = now() where id = inv.id;
  perform public.notify(inv.group_id, 'membre_rejoint', null, jsonb_build_object('name', trim(p_display_name)), 'president');
  return inv.group_id;
end $$;

-- Le président transmet son rôle : il devient simple membre, le nouveau reçoit tous les droits de président.
create function public.transfer_presidency(p_group uuid, p_new uuid) returns void language plpgsql security definer set search_path = '' as $$
declare v_name text;
begin
  if not public.is_president(p_group) then raise exception 'Réservé au président'; end if;
  if not public.is_aal2() then raise exception 'Double authentification requise'; end if;
  if p_new = (select auth.uid()) then raise exception 'Choisissez un autre membre'; end if;
  select m.display_name into v_name from public.memberships m where m.group_id = p_group and m.user_id = p_new and m.status = 'active';
  if not found then raise exception 'Ce membre ne fait pas partie du groupe'; end if;
  perform set_config('app.internal', 'on', true);
  update public.memberships set is_president = false, can_validate = false, can_publish = false
    where group_id = p_group and user_id = (select auth.uid());
  update public.memberships set is_president = true, can_validate = true, can_publish = true
    where group_id = p_group and user_id = p_new;
  perform set_config('app.internal', 'off', true);
  perform public.notify(p_group, 'presidence_transmise', null, jsonb_build_object('name', v_name), 'all');
end $$;

create function public.leave_group(p_group uuid) returns void language plpgsql security definer set search_path = '' as $$
begin
  if public.is_president(p_group) then raise exception 'Le président doit d''abord transmettre son rôle'; end if;
  perform set_config('app.internal', 'on', true);
  update public.memberships set status = 'removed', can_validate = false, can_publish = false
    where group_id = p_group and user_id = (select auth.uid());
  perform set_config('app.internal', 'off', true);
end $$;

create function public.review_contribution(p_id uuid, p_status text, p_reason text default null) returns void language plpgsql security definer set search_path = '' as $$
declare c public.contributions;
begin
  select * into c from public.contributions where id = p_id for update;
  if not found then raise exception 'Cotisation introuvable'; end if;
  if not public.can_validate(c.group_id) then raise exception 'Droit de validation requis'; end if;
  if not public.is_aal2() then raise exception 'Double authentification requise'; end if;
  if p_status not in ('validee','rejetee') then raise exception 'Statut invalide'; end if;
  if p_status = 'rejetee' and coalesce(trim(p_reason), '') = '' then raise exception 'Un motif est obligatoire pour un rejet'; end if;
  if c.status <> 'en_attente' then raise exception 'Déjà traitée'; end if;
  if c.payer_id = (select auth.uid()) then   -- confirmé : jamais son propre justificatif, un autre validateur doit le traiter
    raise exception 'Vous ne pouvez pas traiter votre propre justificatif : un autre validateur doit le faire';
  end if;
  if p_status = 'validee' and not exists (select 1 from public.contribution_files f where f.contribution_id = p_id) then
    raise exception 'Aucun justificatif joint';
  end if;
  update public.contributions
    set status = p_status, reviewed_by = (select auth.uid()), reviewed_at = now(), reject_reason = left(p_reason, 500)
    where id = p_id;
end $$;

create function public.loan_tally(p_loan uuid) returns table (pour bigint, contre bigint) language plpgsql stable security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.loans l where l.id = p_loan and public.is_member(l.group_id)) then raise exception 'Accès refusé'; end if;
  return query select count(*) filter (where v.vote = 'pour'), count(*) filter (where v.vote = 'contre')
                 from public.loan_votes v where v.loan_id = p_loan;
end $$;

-- Quorum = au moins la moitié des membres pouvant voter (le demandeur ne vote pas), avec un minimum de 2 votes.
create function public.loan_quorum(p_loan uuid) returns int language plpgsql stable security definer set search_path = '' as $$
declare l public.loans;
begin
  select * into l from public.loans where id = p_loan;
  if not found or not public.is_member(l.group_id) then raise exception 'Accès refusé'; end if;
  return greatest(2, ceil((select count(*) from public.memberships m
    where m.group_id = l.group_id and m.status = 'active' and m.user_id <> l.requester_id) / 2.0)::int);
end $$;

-- Règle (v0.3) : le vote dure 7 jours et ne peut être clôturé qu'après l'échéance.
--  - Quorum atteint : majorité des votes ; en cas d'égalité, le président tranche.
--  - Quorum non atteint (y compris aucun vote) : jamais validé d'office, le président décide.
-- Dans les cas où le président décide : p_decision = 'validee' ou 'refusee'.
create function public.close_loan(p_loan uuid, p_decision text default null) returns text language plpgsql security definer set search_path = '' as $$
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
    if l.requester_id = (select auth.uid()) then
      raise exception 'Vous êtes le demandeur : vous ne pouvez pas trancher votre propre demande (transmettez d''abord la présidence)';
    end if;
    if p_decision is null or p_decision not in ('validee','refusee') then
      raise exception 'Quorum non atteint ou égalité : le président doit décider (validee ou refusee)';
    end if;
    v_status := p_decision;
    v_basis := case when v_pour + v_contre >= v_quorum then 'egalite' else 'sans_quorum' end;
  end if;
  update public.loans set status = v_status, decision_basis = v_basis, decided_by = (select auth.uid()), decided_at = now() where id = p_loan;
  return v_status;
end $$;

create function public.mark_loan_repaid(p_loan uuid) returns void language plpgsql security definer set search_path = '' as $$
declare l public.loans;
begin
  select * into l from public.loans where id = p_loan for update;
  if not found or l.status <> 'validee' then raise exception 'Prêt introuvable ou non validé'; end if;
  if not public.is_president(l.group_id) then raise exception 'Réservé au président'; end if;
  if not public.is_aal2() then raise exception 'Double authentification requise'; end if;
  update public.loans set status = 'remboursee' where id = p_loan;
end $$;

-- Totaux (registre, aucun argent n'est détenu) : additions des déclarations, calculées côté serveur.
-- Seules les cotisations validées comptent ; celles en attente sont renvoyées à part ; les rejetées sont ignorées.
-- Total du groupe : visible de tous les membres.
create function public.group_total(p_group uuid) returns table (validated numeric, pending numeric)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_member(p_group) or not public.module_enabled(p_group, 'cotisations') then raise exception 'Accès refusé'; end if;
  return query
    select coalesce(sum(c.amount) filter (where c.status = 'validee'), 0),
           coalesce(sum(c.amount) filter (where c.status = 'en_attente'), 0)
    from public.contributions c where c.group_id = p_group;
end $$;

-- Somme de chaque membre (cotisations faites POUR lui). Selon la visibilité choisie par le président :
-- 'tous' = chacun voit tout le monde ; 'soi' = un membre ne voit que sa propre ligne.
-- Le président et les validateurs voient toujours toutes les lignes.
create function public.group_totals(p_group uuid) returns table (user_id uuid, display_name text, validated numeric, pending numeric)
language plpgsql stable security definer set search_path = '' as $$
declare v_all boolean;
begin
  if not public.is_member(p_group) or not public.module_enabled(p_group, 'cotisations') then raise exception 'Accès refusé'; end if;
  v_all := public.is_president(p_group) or public.can_validate(p_group)
           or exists (select 1 from public.groups g where g.id = p_group and g.visibility = 'tous');
  return query
    select m.user_id, m.display_name,
           coalesce(sum(c.amount) filter (where c.status = 'validee'), 0),
           coalesce(sum(c.amount) filter (where c.status = 'en_attente'), 0)
    from public.memberships m
    left join public.contributions c on c.group_id = m.group_id and c.for_user_id = m.user_id
    where m.group_id = p_group and m.status = 'active'
      and (v_all or m.user_id = (select auth.uid()))
    group by m.user_id, m.display_name
    order by m.display_name;
end $$;

-- ======================= SÉCURITÉ AU NIVEAU DES LIGNES ===============

alter table public.profiles enable row level security;
alter table public.groups enable row level security;
alter table public.group_modules enable row level security;
alter table public.memberships enable row level security;
alter table public.invitations enable row level security;
alter table public.announcements enable row level security;
alter table public.reminders enable row level security;
alter table public.contributions enable row level security;
alter table public.contribution_files enable row level security;
alter table public.loans enable row level security;
alter table public.loan_votes enable row level security;
alter table public.audit_log enable row level security;
alter table public.notifications enable row level security;

create policy profiles_select on public.profiles for select to authenticated using (id = (select auth.uid()));
create policy profiles_update on public.profiles for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));

create policy groups_select on public.groups for select to authenticated using (public.is_member(id));
create policy groups_update on public.groups for update to authenticated
  using (public.is_president(id) and public.is_aal2()) with check (public.is_president(id));

create policy modules_select on public.group_modules for select to authenticated using (public.is_member(group_id));
create policy modules_update on public.group_modules for update to authenticated   -- confirmé : seul le président active les modules, prêts compris
  using (public.is_president(group_id) and public.is_aal2()) with check (public.is_president(group_id));

create policy memberships_select on public.memberships for select to authenticated using (public.is_member(group_id));
create policy memberships_update on public.memberships for update to authenticated
  using (user_id = (select auth.uid()) or public.is_president(group_id))
  with check (user_id = (select auth.uid()) or public.is_president(group_id));

create policy invitations_select on public.invitations for select to authenticated using (public.is_president(group_id));

create policy announcements_select on public.announcements for select to authenticated
  using (public.is_member(group_id) and public.module_enabled(group_id, 'annonces'));
create policy announcements_insert on public.announcements for insert to authenticated
  with check (author_id = (select auth.uid()) and public.can_publish(group_id) and public.module_enabled(group_id, 'annonces'));
create policy announcements_update on public.announcements for update to authenticated
  using (public.is_president(group_id) or (author_id = (select auth.uid()) and public.can_publish(group_id)))
  with check (public.can_publish(group_id));
create policy announcements_delete on public.announcements for delete to authenticated
  using (public.is_president(group_id) or (author_id = (select auth.uid()) and public.can_publish(group_id)));

create policy reminders_select on public.reminders for select to authenticated
  using (public.is_member(group_id) and public.module_enabled(group_id, 'rappels'));
create policy reminders_insert on public.reminders for insert to authenticated   -- [À CONFIRMER] validateurs et publieurs ?
  with check (created_by = (select auth.uid()) and public.is_president(group_id) and public.module_enabled(group_id, 'rappels'));
create policy reminders_update on public.reminders for update to authenticated using (public.is_president(group_id)) with check (public.is_president(group_id));
create policy reminders_delete on public.reminders for delete to authenticated using (public.is_president(group_id));

create policy contributions_select on public.contributions for select to authenticated
  using (public.is_member(group_id) and public.module_enabled(group_id, 'cotisations') and (
    payer_id = (select auth.uid()) or for_user_id = (select auth.uid())
    or public.can_validate(group_id) or public.is_president(group_id)
    or exists (select 1 from public.groups g where g.id = contributions.group_id and g.visibility = 'tous')));
create policy contributions_insert on public.contributions for insert to authenticated
  with check (payer_id = (select auth.uid()) and status = 'en_attente'
    and public.is_member(group_id) and public.module_enabled(group_id, 'cotisations')
    and exists (select 1 from public.memberships m where m.group_id = contributions.group_id
                and m.user_id = contributions.for_user_id and m.status = 'active'));

create policy files_select on public.contribution_files for select to authenticated
  using (public.is_member(group_id) and (uploaded_by = (select auth.uid()) or public.can_validate(group_id) or public.is_president(group_id)));
create policy files_insert on public.contribution_files for insert to authenticated
  with check (uploaded_by = (select auth.uid()) and exists (
    select 1 from public.contributions c where c.id = contribution_files.contribution_id
      and c.group_id = contribution_files.group_id and c.payer_id = (select auth.uid()) and c.status = 'en_attente'));

create policy loans_select on public.loans for select to authenticated
  using (public.is_member(group_id) and public.module_enabled(group_id, 'prets'));
create policy loans_insert on public.loans for insert to authenticated   -- confirmé : tout membre peut demander un prêt (vote ouvert 7 jours)
  with check (requester_id = (select auth.uid()) and public.is_member(group_id) and public.module_enabled(group_id, 'prets'));

create policy votes_select on public.loan_votes for select to authenticated using (voter_id = (select auth.uid()));
create policy votes_insert on public.loan_votes for insert to authenticated
  with check (voter_id = (select auth.uid()) and exists (
    select 1 from public.loans l where l.id = loan_votes.loan_id and l.status = 'en_vote' and l.closes_at > now()
      and l.requester_id <> (select auth.uid())   -- le demandeur ne vote pas sur sa propre demande
      and public.is_member(l.group_id) and public.module_enabled(l.group_id, 'prets')));

create policy audit_select on public.audit_log for select to authenticated using (public.is_president(group_id));

create policy notifications_select on public.notifications for select to authenticated using (user_id = (select auth.uid()));
create policy notifications_update on public.notifications for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));   -- pas de delete : notifications obligatoires

-- ============== STOCKAGE PRIVÉ DES JUSTIFICATIFS =====================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('justificatifs', 'justificatifs', false, 5242880, array['image/jpeg','image/png','image/webp','application/pdf'])
on conflict (id) do nothing;

-- Chemin attendu : <group_id>/<contribution_id>/<fichier>
create policy justificatifs_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'justificatifs' and exists (
    select 1 from public.contributions c
    where c.id::text = (storage.foldername(name))[2] and c.group_id::text = (storage.foldername(name))[1]
      and c.payer_id = (select auth.uid()) and c.status = 'en_attente'));
create policy justificatifs_select on storage.objects for select to authenticated
  using (bucket_id = 'justificatifs' and exists (
    select 1 from public.contribution_files f
    where f.storage_path = name and (f.uploaded_by = (select auth.uid()) or public.can_validate(f.group_id) or public.is_president(f.group_id))));
-- Aucune politique update/delete : un justificatif déposé ne peut plus être modifié.

-- ======================= PRIVILÈGES (moindre droit) ==================

revoke all on all tables in schema public from anon, authenticated;
revoke all on all functions in schema public from public, anon, authenticated;

grant usage on schema public to authenticated;
grant select on all tables in schema public to authenticated;   -- filtré par les politiques ci-dessus
revoke select on public.invitations from authenticated;
grant select (id, group_id, email, status, expires_at, accepted_at, created_at) on public.invitations to authenticated;  -- jamais token_hash

grant update (name, type, currency, period, visibility, vocabulary) on public.groups to authenticated;
grant update (enabled) on public.group_modules to authenticated;
grant update (display_name, can_validate, can_publish, status) on public.memberships to authenticated;
grant insert (group_id, author_id, title, body) on public.announcements to authenticated;
grant update (title, body) on public.announcements to authenticated;
grant delete on public.announcements to authenticated;
grant insert (group_id, title, due_date, kind, created_by) on public.reminders to authenticated;
grant update (title, due_date, kind, done) on public.reminders to authenticated;
grant delete on public.reminders to authenticated;
grant insert (group_id, payer_id, for_user_id, amount, paid_on, note) on public.contributions to authenticated;
grant insert (contribution_id, group_id, storage_path, mime_type, size_bytes, uploaded_by) on public.contribution_files to authenticated;
grant insert (group_id, requester_id, amount, reason, due_date) on public.loans to authenticated;
grant insert (loan_id, voter_id, vote) on public.loan_votes to authenticated;
grant update (read_at) on public.notifications to authenticated;
grant update (locale) on public.profiles to authenticated;

grant execute on function public.max_validators(), public.is_member(uuid), public.is_president(uuid), public.can_validate(uuid),
  public.can_publish(uuid), public.module_enabled(uuid, text), public.is_aal2() to authenticated;
grant execute on function public.create_group(text, text, text, text), public.invite_member(uuid, text),
  public.accept_invitation(text, text), public.leave_group(uuid), public.review_contribution(uuid, text, text),
  public.loan_tally(uuid), public.loan_quorum(uuid), public.group_total(uuid), public.group_totals(uuid), public.close_loan(uuid, text), public.mark_loan_repaid(uuid), public.transfer_presidency(uuid, uuid) to authenticated;

-- =====================================================================
-- RÉGLAGES À ACTIVER DANS LE TABLEAU DE BORD SUPABASE
-- 1. Authentification : confirmation d'e-mail obligatoire.
-- 2. Authentification multifacteur (application TOTP) activée.
-- 3. Longueur minimale du mot de passe : 12 ou plus ; protection contre les mots de passe divulgués si disponible.
-- 4. Limites de débit (connexion, e-mails) au plus strict raisonnable.
-- 5. Sauvegardes quotidiennes activées ; clé « service_role » jamais utilisée côté application.
-- =====================================================================
