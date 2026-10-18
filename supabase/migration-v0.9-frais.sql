-- =====================================================================
-- Cercly v0.9 : frais d'envoi (Mobile Money) separes de la cotisation
-- A executer une fois dans Supabase : SQL Editor > New query > Run (apres la v0.8).
--
-- Probleme : un membre qui doit 2 500 envoie 2 600 (2 500 + 100 de frais de retrait).
-- L'app comptait 2 600 et affichait de fausses « avances ».
--
-- Solution :
--   - chaque paiement a un montant envoye (amount) et des frais (fee) ; la cotisation = amount - fee
--   - le groupe peut avoir un bareme de frais (fee_table), regle par le president ; l'app propose
--     les frais automatiquement, le membre peut les corriger (envoi sans frais, especes...)
--   - les totaux (Suivi) ne comptent que la cotisation ; les frais sont renvoyes a part
-- =====================================================================

-- 1. Frais de chaque paiement (0 par defaut : les paiements existants ne changent pas)
alter table public.contributions add column if not exists fee numeric(14,2) not null default 0;
alter table public.contributions drop constraint if exists contributions_fee_check;
alter table public.contributions add constraint contributions_fee_check check (fee >= 0 and fee < amount);
grant insert (fee) on public.contributions to authenticated;

-- 2. Bareme des frais du groupe : liste de tranches [{"max": 5000, "fee": 100}, ...] triees par max croissant.
--    Vide (null) = pas de frais d'envoi dans ce groupe. Modifiable par le president (politique groups_update).
alter table public.groups add column if not exists fee_table jsonb
  check (fee_table is null or jsonb_typeof(fee_table) = 'array');
grant update (fee_table) on public.groups to authenticated;

-- 3. Totaux : cotisation = envoye - frais ; les frais sont donnes a part
drop function if exists public.group_total(uuid);
create function public.group_total(p_group uuid) returns table (validated numeric, pending numeric, fees numeric)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_member(p_group) or not public.module_enabled(p_group, 'cotisations') then raise exception 'Accès refusé'; end if;
  return query
    select coalesce(sum(c.amount - c.fee) filter (where c.status = 'validee'), 0),
           coalesce(sum(c.amount - c.fee) filter (where c.status = 'en_attente'), 0),
           coalesce(sum(c.fee) filter (where c.status = 'validee'), 0)
    from public.contributions c where c.group_id = p_group;
end $$;

drop function if exists public.group_totals(uuid);
create function public.group_totals(p_group uuid) returns table (user_id uuid, display_name text, validated numeric, pending numeric, fees numeric)
language plpgsql stable security definer set search_path = '' as $$
declare v_all boolean;
begin
  if not public.is_member(p_group) or not public.module_enabled(p_group, 'cotisations') then raise exception 'Accès refusé'; end if;
  v_all := public.is_president(p_group) or public.can_validate(p_group)
           or exists (select 1 from public.groups g where g.id = p_group and g.visibility = 'tous');
  return query
    select m.user_id, m.display_name,
           coalesce(sum(c.amount - c.fee) filter (where c.status = 'validee'), 0),
           coalesce(sum(c.amount - c.fee) filter (where c.status = 'en_attente'), 0),
           coalesce(sum(c.fee) filter (where c.status in ('validee', 'en_attente')), 0)
    from public.memberships m
    left join public.contributions c on c.group_id = m.group_id and c.for_user_id = m.user_id
    where m.group_id = p_group and m.status = 'active'
      and (v_all or m.user_id = (select auth.uid()))
    group by m.user_id, m.display_name
    order by m.display_name;
end $$;

grant execute on function public.group_total(uuid), public.group_totals(uuid) to authenticated;
