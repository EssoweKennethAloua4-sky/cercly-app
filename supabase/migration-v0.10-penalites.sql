-- =====================================================================
-- Cercly v0.10 : penalites de retard separees de la cotisation
-- A executer une fois dans Supabase : SQL Editor > New query > Run (apres la v0.9).
--
-- Un paiement se decompose maintenant en trois parts :
--   montant envoye (amount) = cotisation + penalite de retard (penalty) + frais d'envoi (fee)
--   - la cotisation est la seule a compter pour « a jour / en retard »
--   - la penalite entre dans la caisse du groupe (affichee a part)
--   - les frais partent chez l'operateur Mobile Money (affiches a part, non comptes)
-- =====================================================================

alter table public.contributions add column if not exists penalty numeric(14,2) not null default 0;
alter table public.contributions drop constraint if exists contributions_fee_check;
alter table public.contributions drop constraint if exists contributions_split_check;
alter table public.contributions add constraint contributions_split_check
  check (fee >= 0 and penalty >= 0 and fee + penalty < amount);
grant insert (penalty) on public.contributions to authenticated;

-- Totaux : cotisation = envoye - frais - penalite ; frais et penalites donnes a part
drop function if exists public.group_total(uuid);
create function public.group_total(p_group uuid) returns table (validated numeric, pending numeric, fees numeric, penalties numeric)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_member(p_group) or not public.module_enabled(p_group, 'cotisations') then raise exception 'Accès refusé'; end if;
  return query
    select coalesce(sum(c.amount - c.fee - c.penalty) filter (where c.status = 'validee'), 0),
           coalesce(sum(c.amount - c.fee - c.penalty) filter (where c.status = 'en_attente'), 0),
           coalesce(sum(c.fee) filter (where c.status = 'validee'), 0),
           coalesce(sum(c.penalty) filter (where c.status = 'validee'), 0)
    from public.contributions c where c.group_id = p_group;
end $$;

drop function if exists public.group_totals(uuid);
create function public.group_totals(p_group uuid)
returns table (user_id uuid, display_name text, validated numeric, pending numeric, fees numeric, penalties numeric)
language plpgsql stable security definer set search_path = '' as $$
declare v_all boolean;
begin
  if not public.is_member(p_group) or not public.module_enabled(p_group, 'cotisations') then raise exception 'Accès refusé'; end if;
  v_all := public.is_president(p_group) or public.can_validate(p_group)
           or exists (select 1 from public.groups g where g.id = p_group and g.visibility = 'tous');
  return query
    select m.user_id, m.display_name,
           coalesce(sum(c.amount - c.fee - c.penalty) filter (where c.status = 'validee'), 0),
           coalesce(sum(c.amount - c.fee - c.penalty) filter (where c.status = 'en_attente'), 0),
           coalesce(sum(c.fee) filter (where c.status in ('validee', 'en_attente')), 0),
           coalesce(sum(c.penalty) filter (where c.status in ('validee', 'en_attente')), 0)
    from public.memberships m
    left join public.contributions c on c.group_id = m.group_id and c.for_user_id = m.user_id
    where m.group_id = p_group and m.status = 'active'
      and (v_all or m.user_id = (select auth.uid()))
    group by m.user_id, m.display_name
    order by m.display_name;
end $$;

grant execute on function public.group_total(uuid), public.group_totals(uuid) to authenticated;
