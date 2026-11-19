set client_min_messages = warning;
truncate _res;
-- R1 Jean confirme la demande faite a son nom -> le vote s'ouvre
do $$ declare lid uuid; st text; begin
  select l.id into lid from public.loans l join public.loan_borrowers b on b.loan_id = l.id where b.phone = '+22890000001';
  perform _as('00000000-0000-0000-0000-00000000000d','aal1');
  set local role authenticated;
  perform public.respond_as_guarantor(lid, true);
  reset role;
  select status into st from public.loans where id = lid;
  perform _ok('R1 Jean confirme sa propre demande : le vote s''ouvre', st = 'en_vote', st);
exception when others then perform _ok('R1 Jean confirme', false, sqlerrm); end $$;
-- R2 notifications recues par Jean
do $$ declare k text; begin
  select string_agg(kind, ',') into k from public.notifications where user_id = '00000000-0000-0000-0000-00000000000d';
  perform _ok('R2 Jean a ete prevenu de la demande', k like '%pret_garant_demande%', k);
end $$;
-- R3 telephone visible du president (2FA) via la fonction
do $$ declare n int; begin
  perform _as('00000000-0000-0000-0000-00000000000a','aal2');
  set local role authenticated;
  select count(*) into n from public.loan_borrower_phones(array(select loan_id from public.loan_borrowers));
  reset role;
  perform _ok('R3 Le president voit les telephones', n >= 1, n::text);
end $$;
-- R4 un votant simple ne les a pas via la fonction
do $$ declare n int; begin
  perform _as('00000000-0000-0000-0000-00000000000e','aal1');
  set local role authenticated;
  select count(*) into n from public.loan_borrower_phones(array(select loan_id from public.loan_borrowers));
  reset role;
  perform _ok('R4 Un simple votant n''a pas les telephones', n = 0, n::text);
end $$;
-- R5 statut securite du validateur sans 2FA
do $$ declare r record; begin
  perform _as('00000000-0000-0000-0000-00000000000b','aal1');
  set local role authenticated;
  select * into r from public.my_security_status();
  reset role;
  perform _ok('R5 L''appli sait que le validateur doit activer la 2FA', r.needs_mfa and not r.has_mfa, r::text);
end $$;
-- R6 validateur sans 2FA voit toujours le groupe
do $$ declare n int; begin
  perform _as('00000000-0000-0000-0000-00000000000b','aal1');
  set local role authenticated;
  select count(*) into n from public.contributions;
  reset role;
  perform _ok('R6 Le validateur sans 2FA peut encore consulter', n >= 1, n::text);
end $$;
-- R7 invitation par e-mail : entree directe
do $$ declare gid uuid; tok text; st text; begin
  select group_id into gid from public.memberships where user_id = '00000000-0000-0000-0000-00000000000a';
  insert into auth.users (id, email, email_confirmed_at) values ('00000000-0000-0000-0000-000000000010','invite@x.fr', now());
  perform _as('00000000-0000-0000-0000-00000000000a','aal2');
  set local role authenticated;
  tok := public.invite_member(gid, 'invite@x.fr');
  perform _as('00000000-0000-0000-0000-000000000010','aal1');
  perform public.accept_invitation(tok, 'Invité');
  reset role;
  select status into st from public.memberships where user_id = '00000000-0000-0000-0000-000000000010';
  perform _ok('R7 Invitation par e-mail : entree directe (inchange)', st = 'active', st);
end $$;
-- R8 personne en attente : refusee par le president
do $$ declare gid uuid; tok text; st text; pend int; begin
  select group_id into gid from public.memberships where user_id = '00000000-0000-0000-0000-00000000000a';
  insert into auth.users (id, email, email_confirmed_at) values ('00000000-0000-0000-0000-000000000011','spam@x.fr', now());
  perform _as('00000000-0000-0000-0000-00000000000a','aal2');
  set local role authenticated;
  tok := public.create_invite_link(gid);
  perform _as('00000000-0000-0000-0000-000000000011','aal1');
  perform public.accept_invitation(tok, 'Spam');
  select count(*) into pend from public.my_pending_groups();
  perform _as('00000000-0000-0000-0000-00000000000a','aal2');
  perform public.review_member(gid, '00000000-0000-0000-0000-000000000011', false);
  reset role;
  select status into st from public.memberships where user_id = '00000000-0000-0000-0000-000000000011';
  perform _ok('R8 Personne en attente informee puis refusee', pend = 1 and st = 'removed', pend || ' / ' || st);
end $$;
-- R9 le president est prevenu des arrivees en attente
do $$ declare n int; begin
  select count(*) into n from public.notifications where user_id = '00000000-0000-0000-0000-00000000000a' and kind = 'membre_en_attente';
  perform _ok('R9 Le president est prevenu des demandes d''entree', n >= 1, n::text);
end $$;
-- R10 une personne en attente ne peut pas s'activer elle-meme
do $$ declare gid uuid; st text; begin
  select group_id into gid from public.memberships where user_id = '00000000-0000-0000-0000-00000000000a';
  insert into auth.users (id, email, email_confirmed_at) values ('00000000-0000-0000-0000-000000000012','malin@x.fr', now());
  insert into public.memberships (group_id, user_id, display_name, status) values (gid, '00000000-0000-0000-0000-000000000012', 'Malin', 'en_attente');
  begin
    perform _as('00000000-0000-0000-0000-000000000012','aal1');
    set local role authenticated;
    update public.memberships set status = 'active' where user_id = '00000000-0000-0000-0000-000000000012';
    reset role;
  exception when others then null; end;
  select status into st from public.memberships where user_id = '00000000-0000-0000-0000-000000000012';
  perform _ok('R10 Une personne en attente ne peut pas s''activer seule', st = 'en_attente', st);
end $$;
select case when ok then 'OK    ' else 'FAILLE' end as resultat, test, detail from _res order by n;
