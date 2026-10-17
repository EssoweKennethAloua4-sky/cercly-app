-- =====================================================================
-- Cercly v0.7 : cotisation attendue par groupe (suivi mensuel)
-- A executer une fois dans Supabase : SQL Editor > New query > Run.
-- Ajoute trois reglages au groupe, modifiables par le president uniquement :
--   expected_amount : montant attendu chaque mois (vide = pas de suivi mensuel)
--   initial_amount  : apport initial unique, compte avant les mois (0 = aucun)
--   start_month     : premier mois du suivi (toujours le 1er du mois)
-- =====================================================================

alter table public.groups
  add column if not exists expected_amount numeric(14,2)
    check (expected_amount is null or expected_amount > 0),
  add column if not exists initial_amount numeric(14,2) not null default 0
    check (initial_amount >= 0),
  add column if not exists start_month date
    check (start_month is null or extract(day from start_month) = 1);

-- Seul le president peut les modifier (la politique groups_update existante s'applique deja)
grant update (expected_amount, initial_amount, start_month) on public.groups to authenticated;
