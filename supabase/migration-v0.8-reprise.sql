-- =====================================================================
-- Cercly v0.8 : valider les cotisations reprises d'un cahier, sans justificatif
-- A executer une fois dans Supabase : SQL Editor > New query > Run.
--
-- Probleme : review_contribution refuse de valider une cotisation sans justificatif joint
-- (« Aucun justificatif joint »). Les cotisations reprises du cahier n'en ont pas.
--
-- Solution : une marque « importee », posee uniquement par un administrateur (SQL Editor) :
--   - les membres ne peuvent pas la poser (pas de droit d'ecriture sur cette colonne),
--     donc les cotisations envoyees depuis l'app gardent le justificatif obligatoire ;
--   - les cotisations importees se valident sans justificatif.
-- Toutes les autres regles restent : droit de validation, jamais sa propre cotisation, motif si rejet.
-- =====================================================================

alter table public.contributions add column if not exists imported boolean not null default false;

-- Les cotisations deja reprises du cahier (scripts supabase/imports/) sont marquees comme importees.
update public.contributions set imported = true where note like 'Reprise du cahier%' and not imported;

create or replace function public.review_contribution(p_id uuid, p_status text, p_reason text default null) returns void language plpgsql security definer set search_path = '' as $$
declare c public.contributions;
begin
  select * into c from public.contributions where id = p_id for update;
  if not found then raise exception 'Cotisation introuvable'; end if;
  if not public.can_validate(c.group_id) then raise exception 'Droit de validation requis'; end if;
  if not public.is_aal2() then raise exception 'Double authentification requise'; end if;
  if p_status not in ('validee','rejetee') then raise exception 'Statut invalide'; end if;
  if p_status = 'rejetee' and coalesce(trim(p_reason), '') = '' then raise exception 'Un motif est obligatoire pour un rejet'; end if;
  if c.status <> 'en_attente' then raise exception 'Déjà traitée'; end if;
  if c.payer_id = (select auth.uid()) then   -- jamais son propre justificatif, un autre validateur doit le traiter
    raise exception 'Vous ne pouvez pas traiter votre propre justificatif : un autre validateur doit le faire';
  end if;
  -- justificatif obligatoire, sauf pour une cotisation reprise d'un cahier (marque posee par un administrateur)
  if p_status = 'validee' and not c.imported
     and not exists (select 1 from public.contribution_files f where f.contribution_id = p_id) then
    raise exception 'Aucun justificatif joint';
  end if;
  update public.contributions
    set status = p_status, reviewed_by = (select auth.uid()), reviewed_at = now(), reject_reason = left(p_reason, 500)
    where id = p_id;
end $$;
