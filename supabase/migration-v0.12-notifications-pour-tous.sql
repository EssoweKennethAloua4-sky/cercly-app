-- =====================================================================
-- Cercly v0.12 : tout le monde est informé de ce qui arrive dans le groupe
-- A executer une fois dans Supabase (apres la v0.11) : SQL Editor > New query > Run.
--
-- Avant : certaines nouvelles n'allaient qu'au president ou aux validateurs
-- (nouvelle cotisation, demande de pret, garant, demande ecartee, nouveau membre).
-- Maintenant :
--   - ces nouvelles vont a TOUS les membres actifs (sauf la personne qui a fait l'action) ;
--   - la nouvelle cotisation porte le nom de la personne ;
--   - quand une cotisation est validee, tout le groupe le voit (« cotisation_validee_groupe ») ;
--   - restent personnels : « vous etes cite comme garant », « cotisation faite pour vous »,
--     et le motif d'un rejet de cotisation (seul l'interesse le recoit).
-- =====================================================================

alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check check (kind in (
  'annonce','rappel_nouveau','cotisation_nouvelle','cotisation_pour_vous','cotisation_validee','cotisation_rejetee',
  'cotisation_validee_groupe',
  'pret_demande','pret_garant_demande','pret_garant_confirme','pret_garant_refuse','pret_ouvert_au_vote',
  'pret_validee','pret_refusee','pret_remboursee','pret_annulee','membre_rejoint','presidence_transmise'));

-- Les audiences 'validators' et 'president' touchent desormais tout le groupe.
-- 'user' reste reserve a une seule personne (p_extra).
create or replace function public.notify(p_group uuid, p_kind text, p_entity uuid, p_details jsonb, p_audience text,
                                         p_exclude uuid default null, p_extra uuid default null)
returns void language sql security definer set search_path = '' as $$
  insert into public.notifications (user_id, group_id, kind, entity_id, details)
  select m.user_id, p_group, p_kind, p_entity, p_details from public.memberships m
  where m.group_id = p_group and m.status = 'active'
    and (p_exclude is null or m.user_id <> p_exclude)
    and case when p_audience = 'user' then m.user_id = p_extra
             when p_audience in ('all', 'validators', 'president') then true
             else false end
$$;

create or replace function public.notify_events() returns trigger language plpgsql security definer set search_path = '' as $$
declare v_name text;
begin
  if tg_table_name = 'announcements' then
    perform public.notify(new.group_id, 'annonce', new.id, jsonb_build_object('title', new.title), 'all', new.author_id);
  elsif tg_table_name = 'reminders' then
    perform public.notify(new.group_id, 'rappel_nouveau', new.id, jsonb_build_object('title', new.title, 'due_date', new.due_date), 'all', new.created_by);
  elsif tg_table_name = 'contributions' then
    select m.display_name into v_name from public.memberships m
     where m.group_id = new.group_id and m.user_id = new.for_user_id;
    if tg_op = 'INSERT' then
      perform public.notify(new.group_id, 'cotisation_nouvelle', new.id,
        jsonb_build_object('amount', new.amount, 'name', v_name), 'all', new.payer_id);
      if new.for_user_id <> new.payer_id then
        perform public.notify(new.group_id, 'cotisation_pour_vous', new.id, jsonb_build_object('amount', new.amount), 'user', null, new.for_user_id);
      end if;
    elsif tg_op = 'UPDATE' and new.status <> old.status then
      -- la personne concernee : message personnel (avec le motif en cas de rejet)
      perform public.notify(new.group_id, 'cotisation_' || new.status, new.id,
        jsonb_build_object('amount', new.amount, 'reason', new.reject_reason), 'user', null, new.payer_id);
      -- le reste du groupe : seulement les validations, sans motif
      if new.status = 'validee' then
        insert into public.notifications (user_id, group_id, kind, entity_id, details)
        select m.user_id, new.group_id, 'cotisation_validee_groupe', new.id,
               jsonb_build_object('amount', new.amount, 'name', v_name)
          from public.memberships m
         where m.group_id = new.group_id and m.status = 'active'
           and m.user_id <> new.payer_id
           and m.user_id is distinct from (select auth.uid());
      end if;
    end if;
  end if;
  return new;
end $$;
