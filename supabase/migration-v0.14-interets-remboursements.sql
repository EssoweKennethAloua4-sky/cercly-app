-- =====================================================================
-- Cercly v0.14 : interets et remboursements (y compris partiels) des prets
-- A executer une fois dans Supabase (apres la v0.13) : SQL Editor > New query > Run.
--
--   - Bareme des taux du groupe selon la duree du pret (groups.loan_rates), regle par le president.
--     Par defaut, celui du cahier : jusqu'a 14 jours 10 %, 1 mois 15 %, 2 mois 20 %, au-dela 25 %.
--   - Chaque pret garde son taux et son interet (calcules a la demande, modifiables par le president).
--     Total du = montant prete + interet.
--   - Les remboursements sont enregistres un par un (president ou validateur). Quand le total du
--     est atteint, le pret passe tout seul a « Rembourse ». Tout le groupe est prevenu.
--   - La caisse tient compte de ce qui est rembourse, interets compris.
-- =====================================================================

-- ---------------------------- BAREME --------------------------------
alter table public.groups add column if not exists loan_rates jsonb
  not null default '[{"days":14,"rate":10},{"days":31,"rate":15},{"days":62,"rate":20},{"days":92,"rate":25}]'::jsonb
  check (jsonb_typeof(loan_rates) = 'array');
grant update (loan_rates) on public.groups to authenticated;

-- Taux pour une duree en jours : la premiere tranche qui couvre la duree, sinon la derniere.
create or replace function public.loan_rate_for(p_group uuid, p_days int) returns numeric
language sql stable security definer set search_path = '' as $$
  with t as (
    select (e->>'days')::int as days, (e->>'rate')::numeric as rate
      from public.groups g, jsonb_array_elements(g.loan_rates) e where g.id = p_group
  )
  select coalesce((select rate from t where days >= p_days order by days limit 1),
                  (select rate from t order by days desc limit 1), 0)
$$;

-- --------------------------- PRETS ----------------------------------
alter table public.loans add column if not exists interest_rate numeric(5,2) check (interest_rate >= 0 and interest_rate <= 100);
alter table public.loans add column if not exists interest numeric(14,2) not null default 0 check (interest >= 0);

-- A la demande : taux et interet calcules selon la duree (date de la demande -> echeance)
create or replace function public.loan_set_interest() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.interest_rate is null then
    new.interest_rate := public.loan_rate_for(new.group_id, greatest(1, new.due_date - coalesce(new.created_at, now())::date));
    new.interest := round(new.amount * new.interest_rate / 100);
  end if;
  return new;
end $$;
drop trigger if exists loans_set_interest on public.loans;
create trigger loans_set_interest before insert on public.loans for each row execute function public.loan_set_interest();

-- Les demandes deja enregistrees sans taux (hors reprise du cahier, traitee a part) : bareme actuel
update public.loans l
   set interest_rate = public.loan_rate_for(l.group_id, greatest(1, l.due_date - l.created_at::date)),
       interest = round(l.amount * public.loan_rate_for(l.group_id, greatest(1, l.due_date - l.created_at::date)) / 100)
 where l.interest_rate is null
   and not exists (select 1 from public.loan_borrowers b where b.loan_id = l.id and b.reason like 'Reprise du cahier%');

-- Le president corrige le taux d'un pret (l'interet est recalcule) ou donne directement l'interet.
create or replace function public.set_loan_interest(p_loan uuid, p_rate numeric, p_interest numeric default null) returns void
language plpgsql security definer set search_path = '' as $$
declare l public.loans;
begin
  select * into l from public.loans where id = p_loan for update;
  if not found then raise exception 'Prêt introuvable'; end if;
  if not public.is_president(l.group_id) then raise exception 'Réservé au président'; end if;
  if not public.is_aal2() then raise exception 'Double authentification requise'; end if;
  if l.status in ('remboursee', 'refusee', 'annulee') then raise exception 'Ce prêt est terminé'; end if;
  if p_rate is null or p_rate < 0 or p_rate > 100 then raise exception 'Taux invalide (0 à 100 %%)'; end if;
  if p_interest is not null and p_interest < 0 then raise exception 'Intérêt invalide'; end if;
  update public.loans set interest_rate = p_rate, interest = coalesce(p_interest, round(l.amount * p_rate / 100))
   where id = p_loan;
end $$;

-- ------------------------ REMBOURSEMENTS ----------------------------
create table if not exists public.loan_repayments (
  id uuid primary key default gen_random_uuid(),
  loan_id uuid not null references public.loans (id) on delete cascade,
  group_id uuid not null references public.groups (id) on delete cascade,
  amount numeric(14,2) not null check (amount > 0),
  paid_on date not null,
  note text check (char_length(note) <= 300),
  recorded_by uuid,
  created_at timestamptz not null default now()
);
create index if not exists loan_repayments_loan on public.loan_repayments (loan_id);
alter table public.loan_repayments enable row level security;
drop policy if exists loan_repayments_select on public.loan_repayments;
create policy loan_repayments_select on public.loan_repayments for select to authenticated
  using (public.is_member(group_id) and public.module_enabled(group_id, 'prets'));
grant select on public.loan_repayments to authenticated;   -- ecriture uniquement par les fonctions

-- Ce qui a ete rembourse sur un pret. Un pret marque « Rembourse » avant la v0.14 compte comme solde.
create or replace function public.loan_repaid(p_loan uuid) returns numeric
language sql stable security definer set search_path = '' as $$
  select case when l.status = 'remboursee' then greatest(coalesce(r.s, 0), l.amount + l.interest) else coalesce(r.s, 0) end
    from public.loans l
    left join (select loan_id, sum(amount) s from public.loan_repayments where loan_id = p_loan group by loan_id) r on r.loan_id = l.id
   where l.id = p_loan
$$;

alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check check (kind in (
  'annonce','rappel_nouveau','cotisation_nouvelle','cotisation_pour_vous','cotisation_validee','cotisation_rejetee',
  'cotisation_validee_groupe',
  'pret_demande','pret_garant_demande','pret_garant_confirme','pret_garant_refuse','pret_ouvert_au_vote',
  'pret_validee','pret_refusee','pret_remboursee','pret_annulee','membre_rejoint','presidence_transmise',
  'pret_echeance','pret_remboursement'));

create or replace function public._loan_name(l public.loans) returns text
language sql stable security definer set search_path = '' as $$
  select coalesce((select m.display_name from public.memberships m where m.group_id = l.group_id and m.user_id = l.borrower_member_id),
                  (select b.name from public.loan_borrowers b where b.loan_id = l.id), '')
$$;

-- Enregistrer un remboursement (president ou validateur)
create or replace function public.record_loan_repayment(p_loan uuid, p_amount numeric, p_paid_on date, p_note text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare l public.loans; v_paid numeric; v_due numeric;
begin
  select * into l from public.loans where id = p_loan for update;
  if not found then raise exception 'Prêt introuvable'; end if;
  if not (public.is_president(l.group_id) or public.can_validate(l.group_id)) then raise exception 'Réservé au président et aux validateurs'; end if;
  if not public.is_aal2() then raise exception 'Double authentification requise'; end if;
  if l.status <> 'validee' then raise exception 'Seul un prêt accordé et non soldé peut recevoir un remboursement'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Montant invalide'; end if;
  if p_paid_on is null or p_paid_on > current_date then raise exception 'Date invalide'; end if;

  insert into public.loan_repayments (loan_id, group_id, amount, paid_on, note, recorded_by)
  values (p_loan, l.group_id, p_amount, p_paid_on, nullif(trim(coalesce(p_note, '')), ''), (select auth.uid()));

  v_paid := public.loan_repaid(p_loan);
  v_due := l.amount + l.interest;
  if v_paid >= v_due then
    update public.loans set status = 'remboursee' where id = p_loan;
    perform public.notify(l.group_id, 'pret_remboursee', p_loan,
      jsonb_build_object('amount', l.amount, 'name', public._loan_name(l)), 'all', (select auth.uid()));
  else
    perform public.notify(l.group_id, 'pret_remboursement', p_loan,
      jsonb_build_object('amount', p_amount, 'left', v_due - v_paid, 'name', public._loan_name(l)), 'all', (select auth.uid()));
  end if;
end $$;

-- Annuler un remboursement saisi par erreur (president). Le pret redevient « en cours » si besoin.
create or replace function public.delete_loan_repayment(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare r public.loan_repayments; l public.loans;
begin
  select * into r from public.loan_repayments where id = p_id;
  if not found then raise exception 'Remboursement introuvable'; end if;
  select * into l from public.loans where id = r.loan_id for update;
  if not public.is_president(l.group_id) then raise exception 'Réservé au président'; end if;
  if not public.is_aal2() then raise exception 'Double authentification requise'; end if;
  delete from public.loan_repayments where id = p_id;
  if l.status = 'remboursee'
     and coalesce((select sum(amount) from public.loan_repayments where loan_id = l.id), 0) < l.amount + l.interest then
    update public.loans set status = 'validee' where id = l.id;
  end if;
end $$;

-- « Marquer rembourse » : enregistre aussi ce qui restait du, pour que les comptes suivent.
create or replace function public.mark_loan_repaid(p_loan uuid) returns void language plpgsql security definer set search_path = '' as $$
declare l public.loans; v_left numeric;
begin
  select * into l from public.loans where id = p_loan for update;
  if not found or l.status <> 'validee' then raise exception 'Prêt introuvable ou non validé'; end if;
  if not public.is_president(l.group_id) then raise exception 'Réservé au président'; end if;
  if not public.is_aal2() then raise exception 'Double authentification requise'; end if;
  v_left := l.amount + l.interest - public.loan_repaid(p_loan);
  if v_left > 0 then
    insert into public.loan_repayments (loan_id, group_id, amount, paid_on, note, recorded_by)
    values (p_loan, l.group_id, v_left, current_date, 'Solde', (select auth.uid()));
  end if;
  update public.loans set status = 'remboursee' where id = p_loan;
  perform public.notify(l.group_id, 'pret_remboursee', p_loan,
    jsonb_build_object('amount', l.amount, 'name', public._loan_name(l)), 'all');
end $$;

grant execute on function public.set_loan_interest(uuid, numeric, numeric), public.record_loan_repayment(uuid, numeric, date, text),
  public.delete_loan_repayment(uuid), public.loan_repaid(uuid) to authenticated;
revoke execute on function public._loan_name(public.loans) from public, anon, authenticated;

-- ----------------------------- CAISSE -------------------------------
-- lent      : montant prete des prets en cours
-- due_left  : ce qui reste a rembourser (interets compris)
-- interest  : interets deja encaisses
-- in_cash   : cotisations + penalites - tout ce qui a ete prete + tout ce qui a ete rembourse
drop function if exists public.group_cash(uuid);
create function public.group_cash(p_group uuid)
returns table (lent numeric, loans_open int, due_left numeric, interest numeric, in_cash numeric)
language plpgsql stable security definer set search_path = '' as $$
declare v_in numeric;
begin
  if not public.is_member(p_group) then raise exception 'Accès refusé'; end if;
  select coalesce(sum(c.amount - c.fee), 0) into v_in
    from public.contributions c where c.group_id = p_group and c.status = 'validee';
  return query
    with x as (
      select l.status, l.amount, l.amount + l.interest as due, public.loan_repaid(l.id) as paid
        from public.loans l where l.group_id = p_group and l.status in ('validee', 'remboursee')
    )
    select coalesce(sum(amount) filter (where status = 'validee'), 0),
           (count(*) filter (where status = 'validee'))::int,
           coalesce(sum(greatest(0, due - paid)) filter (where status = 'validee'), 0),
           coalesce(sum(greatest(0, paid - amount)), 0),
           v_in - coalesce(sum(amount), 0) + coalesce(sum(paid), 0)
      from x;
end $$;
grant execute on function public.group_cash(uuid) to authenticated;
