-- =====================================================================
-- Cercly v0.13 : argent en caisse + rappels avant l'echeance d'un pret
-- A executer une fois dans Supabase (apres la v0.12) : SQL Editor > New query > Run.
--
-- 1. group_cash : total prete (prets accordes, pas encore rembourses) et ce qui reste en caisse
--    reste en caisse = cotisations validees + penalites - prets en cours
--    (les frais d'envoi partent chez l'operateur ; les interets ne sont pas encore suivis).
-- 2. Rappels d'echeance, verifies toutes les heures (pg_cron).
--    L'echeance d'un pret = la fin du jour indique (minuit, heure de Lome = UTC).
--    72 h et 48 h avant : l'emprunteur, le garant et le president.
--    24 h et 12 h avant : tout le groupe.
--    Chaque rappel n'est envoye qu'une fois.
-- =====================================================================

-- ------------------------------ CAISSE ------------------------------
create or replace function public.group_cash(p_group uuid) returns table (lent numeric, loans_open int, in_cash numeric)
language plpgsql stable security definer set search_path = '' as $$
declare v_in numeric; v_lent numeric; v_n int;
begin
  if not public.is_member(p_group) then raise exception 'Accès refusé'; end if;
  select coalesce(sum(c.amount - c.fee), 0) into v_in
    from public.contributions c where c.group_id = p_group and c.status = 'validee';
  select coalesce(sum(l.amount), 0), count(*) into v_lent, v_n
    from public.loans l where l.group_id = p_group and l.status = 'validee';
  return query select v_lent, v_n, v_in - v_lent;
end $$;
grant execute on function public.group_cash(uuid) to authenticated;

-- ------------------------- RAPPELS D'ECHEANCE -----------------------
alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check check (kind in (
  'annonce','rappel_nouveau','cotisation_nouvelle','cotisation_pour_vous','cotisation_validee','cotisation_rejetee',
  'cotisation_validee_groupe',
  'pret_demande','pret_garant_demande','pret_garant_confirme','pret_garant_refuse','pret_ouvert_au_vote',
  'pret_validee','pret_refusee','pret_remboursee','pret_annulee','membre_rejoint','presidence_transmise',
  'pret_echeance'));

-- Quels rappels ont deja ete envoyes (72, 48, 24, 12)
create table if not exists public.loan_due_reminders (
  loan_id uuid not null references public.loans (id) on delete cascade,
  stage int not null check (stage in (72, 48, 24, 12)),
  sent_at timestamptz not null default now(),
  primary key (loan_id, stage)
);
alter table public.loan_due_reminders enable row level security;  -- aucune lecture directe

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
    -- le rappel le plus proche deja atteint (si le pret a ete accorde tard, on n'envoie que celui-la)
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
            or m.is_president
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

-- Toutes les heures, a la minute 0
create extension if not exists pg_cron;
do $$
begin
  perform cron.unschedule('cercly-rappels-prets') where exists (select 1 from cron.job where jobname = 'cercly-rappels-prets');
  perform cron.schedule('cercly-rappels-prets', '0 * * * *', 'select public.send_loan_due_reminders()');
end $$;
