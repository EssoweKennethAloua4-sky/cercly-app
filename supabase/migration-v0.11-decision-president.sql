-- =====================================================================
-- Cercly v0.11 : le president peut decider d'un pret sans attendre
-- A executer une fois dans Supabase : SQL Editor > New query > Run.
--
-- Probleme : une demande reste « A examiner » tant que le garant n'a pas confirme dans l'app,
-- puis le vote dure 7 jours et beaucoup de membres ne votent pas. Rien n'avance.
--
-- Ajouts :
--   - decide_loan_now : le PRESIDENT accorde ou refuse un pret a tout moment
--     (a examiner, garant refuse ou vote en cours). Jamais sa propre demande.
--   - open_loan_vote_now : le president OU un validateur ouvre le vote sans attendre le garant.
-- =====================================================================

alter table public.loans drop constraint if exists loans_decision_basis_check;
alter table public.loans add constraint loans_decision_basis_check
  check (decision_basis in ('majorite', 'egalite', 'sans_quorum', 'president'));

create or replace function public.decide_loan_now(p_loan uuid, p_decision text) returns void
language plpgsql security definer set search_path = '' as $$
declare l public.loans;
begin
  select * into l from public.loans where id = p_loan for update;
  if not found then raise exception 'Demande introuvable'; end if;
  if not public.is_president(l.group_id) then raise exception 'Réservé au président'; end if;
  if not public.is_aal2() then raise exception 'Double authentification requise'; end if;
  if not public.module_enabled(l.group_id, 'prets') then raise exception 'Le module Prêts est désactivé'; end if;
  if p_decision not in ('validee', 'refusee') then raise exception 'Décision invalide'; end if;
  if l.status not in ('a_examiner', 'garant_refuse', 'en_vote') then raise exception 'Cette demande est déjà décidée'; end if;
  if l.borrower_member_id = (select auth.uid()) then
    raise exception 'Vous êtes l''emprunteur : vous ne pouvez pas décider de votre propre demande';
  end if;
  update public.loans
     set status = p_decision, decision_basis = 'president', decided_by = (select auth.uid()), decided_at = now()
   where id = p_loan;
  perform public.notify(l.group_id, 'pret_' || p_decision, p_loan, jsonb_build_object('amount', l.amount), 'all');
end $$;

create or replace function public.open_loan_vote_now(p_loan uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare l public.loans;
begin
  select * into l from public.loans where id = p_loan for update;
  if not found then raise exception 'Demande introuvable'; end if;
  if not (public.is_president(l.group_id) or public.can_validate(l.group_id)) then raise exception 'Réservé au président et aux validateurs'; end if;
  if not public.is_aal2() then raise exception 'Double authentification requise'; end if;
  if l.status <> 'a_examiner' then raise exception 'Le vote ne peut être ouvert que pour une demande à examiner'; end if;
  perform public._open_loan_vote(p_loan);
end $$;

grant execute on function public.decide_loan_now(uuid, text), public.open_loan_vote_now(uuid) to authenticated;
