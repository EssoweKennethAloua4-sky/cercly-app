-- Scenarios de securite Cercly. Chaque test affiche OK (comportement sur) ou FAILLE (comportement dangereux).
\set QUIET on
set client_min_messages = warning;

create table if not exists _res (n serial, test text, ok boolean, detail text);
truncate _res;
grant insert, select on _res to authenticated;
grant usage on sequence _res_n_seq to authenticated;

create or replace function _as(uid uuid, aal text default 'aal1') returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'aal', aal, 'role', 'authenticated')::text, false);
end $$;
create or replace function _ok(t text, ok boolean, d text default '') returns void language sql as $$
  insert into _res (test, ok, detail) values (t, ok, d) $$;

-- ------------------------------------------------------------------ jeu de donnees
insert into auth.users (id, email, email_confirmed_at) values
 ('00000000-0000-0000-0000-00000000000a','pres@x.fr',now()),   -- president, 2FA activee
 ('00000000-0000-0000-0000-00000000000b','valid@x.fr',now()),  -- validateur, sans 2FA
 ('00000000-0000-0000-0000-00000000000c','m1@x.fr',now()),     -- membre simple
 ('00000000-0000-0000-0000-00000000000d','jean@x.fr',now()),   -- membre « Jean Kossi »
 ('00000000-0000-0000-0000-00000000000e','m3@x.fr',now()),     -- membre votant
 ('00000000-0000-0000-0000-00000000000f','inconnu@x.fr',now()); -- inconnu qui recoit le lien
insert into auth.mfa_factors (user_id, status) values ('00000000-0000-0000-0000-00000000000a','verified');

select _as('00000000-0000-0000-0000-00000000000a','aal2');
set role authenticated;
select public.create_group('Tontine test','tontine','XOF','Président') as gid \gset
reset role;

insert into public.memberships (group_id, user_id, display_name, can_validate) values
 (:'gid','00000000-0000-0000-0000-00000000000b','Valideur', true),
 (:'gid','00000000-0000-0000-0000-00000000000c','Membre Un', false),
 (:'gid','00000000-0000-0000-0000-00000000000d','Jean Kossi', false),
 (:'gid','00000000-0000-0000-0000-00000000000e','Membre Trois', false);
update public.group_modules set enabled = true where group_id = :'gid' and module = 'prets';

-- une cotisation du membre 1 avec justificatif
insert into public.contributions (id, group_id, payer_id, for_user_id, amount)
 values ('11111111-0000-0000-0000-000000000001', :'gid','00000000-0000-0000-0000-00000000000c','00000000-0000-0000-0000-00000000000c', 5000);
insert into public.contribution_files (contribution_id, group_id, storage_path, mime_type, size_bytes, uploaded_by)
 values ('11111111-0000-0000-0000-000000000001', :'gid', :'gid' || '/11111111-0000-0000-0000-000000000001/a.jpg', 'image/jpeg', 100, '00000000-0000-0000-0000-00000000000c');

-- ------------------------------------------------------------------ T1 mot de passe seul sur un compte 2FA
do $$ declare n int; begin
  perform _as('00000000-0000-0000-0000-00000000000a','aal1');
  set local role authenticated;
  select count(*) into n from public.contributions;
  reset role;
  perform _ok('T1 Mot de passe vole du president (2FA) : lecture des cotisations', n = 0, n || ' ligne(s) lue(s)');
end $$;

-- ------------------------------------------------------------------ T2 validateur sans 2FA valide une cotisation
do $$ begin
  begin
    perform _as('00000000-0000-0000-0000-00000000000b','aal1');
    set local role authenticated;
    perform public.review_contribution('11111111-0000-0000-0000-000000000001','validee');
    reset role;
    perform _ok('T2 Validateur sans 2FA valide une cotisation', false, 'validation acceptee');
  exception when others then
    perform _ok('T2 Validateur sans 2FA valide une cotisation', sqlerrm like '%Double authentification%', sqlerrm);
  end;
end $$;

-- ------------------------------------------------------------------ T3 simple membre sans 2FA : usage normal
do $$ begin
  begin
    perform _as('00000000-0000-0000-0000-00000000000e','aal1');
    set local role authenticated;
    insert into public.contributions (group_id, payer_id, for_user_id, amount)
      select m.group_id, m.user_id, m.user_id, 2500 from public.memberships m where m.user_id = '00000000-0000-0000-0000-00000000000e';
    reset role;
    perform _ok('T3 Membre simple sans 2FA declare une cotisation (doit marcher)', true, 'ok');
  exception when others then
    perform _ok('T3 Membre simple sans 2FA declare une cotisation (doit marcher)', false, sqlerrm);
  end;
end $$;

-- ------------------------------------------------------------------ T4 lien d'invitation ouvert
do $$ declare tok text; gid uuid; n int; st text; exp interval; begin
  select group_id into gid from public.memberships where user_id = '00000000-0000-0000-0000-00000000000a';
  perform _as('00000000-0000-0000-0000-00000000000a','aal2');
  set local role authenticated;
  tok := public.create_invite_link(gid);
  reset role;
  select expires_at - now() into exp from public.invitations where group_id = gid and email is null and status = 'en_attente';
  perform _ok('T4a Lien d''invitation valable 7 jours au plus', exp <= interval '7 days 1 minute', exp::text);

  perform _as('00000000-0000-0000-0000-00000000000f','aal1');
  set local role authenticated;
  perform public.accept_invitation(tok, 'Inconnu');
  select count(*) into n from public.memberships where group_id = gid;
  reset role;
  select status into st from public.memberships where user_id = '00000000-0000-0000-0000-00000000000f';
  perform _ok('T4b Un inconnu avec le lien n''entre pas tout seul', st = 'en_attente', 'statut ' || st);
  perform _ok('T4c Un inconnu avec le lien ne voit pas les membres', n <= 1, n || ' membre(s) visible(s)');
end $$;

-- T4d le president accepte la personne
do $$ declare gid uuid; st text; begin
  select group_id into gid from public.memberships where user_id = '00000000-0000-0000-0000-00000000000a';
  begin
    perform _as('00000000-0000-0000-0000-00000000000a','aal2');
    set local role authenticated;
    perform public.review_member(gid, '00000000-0000-0000-0000-00000000000f', true);
    reset role;
  exception when others then null; end;
  select status into st from public.memberships where user_id = '00000000-0000-0000-0000-00000000000f';
  perform _ok('T4d Le president accepte la personne en attente', st = 'active', 'statut ' || st);
end $$;

-- ------------------------------------------------------------------ T5 pret au nom d'un membre sans son accord
do $$ declare tok text; gid uuid; st text; begin
  select group_id into gid from public.memberships where user_id = '00000000-0000-0000-0000-00000000000a';
  perform _as('00000000-0000-0000-0000-00000000000c','aal1');
  set local role authenticated;
  tok := public.get_or_create_loan_link(gid);
  reset role;
  set local role anon;
  perform public.submit_loan_request(tok, 'Jean Kossi', '+22890000001', 50000, current_date + 30, 'test', 'Jean Kossi', true);
  reset role;
  select l.status into st from public.loans l join public.loan_borrowers b on b.loan_id = l.id where b.phone = '+22890000001';
  perform _ok('T5 Demande de pret au nom de Jean, sans que Jean confirme, ouverte au vote', st = 'a_examiner', 'statut ' || st);
end $$;

-- ------------------------------------------------------------------ T6 telephone de l'emprunteur
do $$ declare ph text; nm text; begin
  begin
    perform _as('00000000-0000-0000-0000-00000000000e','aal1');
    set local role authenticated;
    select b.name into nm from public.loan_borrowers b limit 1;
    reset role;
    perform _ok('T6a Un votant voit encore le nom de l''emprunteur (doit marcher)', nm is not null, coalesce(nm, 'rien'));
  exception when others then perform _ok('T6a Un votant voit encore le nom de l''emprunteur (doit marcher)', false, sqlerrm); end;
  begin
    perform _as('00000000-0000-0000-0000-00000000000e','aal1');
    set local role authenticated;
    select b.phone into ph from public.loan_borrowers b limit 1;
    reset role;
    perform _ok('T6b Un simple votant lit le telephone de l''emprunteur', ph is null, coalesce(ph, 'rien'));
  exception when others then perform _ok('T6b Un simple votant lit le telephone de l''emprunteur', true, 'refuse : ' || sqlerrm); end;
end $$;

-- ------------------------------------------------------------------ T7 limite par telephone
do $$ declare tok text; gid uuid; i int; nb int := 0; begin
  select token into tok from public.loan_links limit 1;
  for i in 1..5 loop
    begin
      -- 5 groupes differents simules : on change de lien a chaque fois n'est pas possible ici, on reutilise le meme
      set local role anon;
      perform public.submit_loan_request(tok, 'Robot ' || i, '+22899999999', 1000, current_date + 30, null, 'Personne Inconnue', true);
      reset role;
      nb := nb + 1;
      -- liberer la regle « une demande deja en cours pour ce numero » pour tester la limite journaliere
      update public.loans set status = 'annulee' where id in (select loan_id from public.loan_borrowers where phone = '+22899999999');
    exception when others then null; end;
  end loop;
  perform _ok('T7 Pas plus de 3 demandes par telephone et par jour', nb <= 3, nb || ' demande(s) acceptee(s)');
end $$;

-- ------------------------------------------------------------------ T8 annulation d'un remboursement
do $$ declare gid uuid; lid uuid; rid uuid; n_audit int; n_notif int; ok_reason boolean := false; begin
  select group_id into gid from public.memberships where user_id = '00000000-0000-0000-0000-00000000000a';
  insert into public.loans (group_id, link_member_id, guarantor_name, guarantor_check, amount, due_date, status)
    values (gid, '00000000-0000-0000-0000-00000000000c', 'Membre Un', 'inconnu', 10000, current_date + 30, 'validee') returning id into lid;
  perform _as('00000000-0000-0000-0000-00000000000a','aal2');
  set local role authenticated;
  perform public.record_loan_repayment(lid, 4000, current_date, null);
  reset role;
  select id into rid from public.loan_repayments where loan_id = lid;
  -- sans motif
  begin
    set local role authenticated;
    execute 'select public.delete_loan_repayment($1, $2)' using rid, '';
    reset role;
  exception when others then ok_reason := true; end;
  perform _ok('T8a Annuler un remboursement sans motif est refuse', ok_reason, '');
  begin
    set local role authenticated;
    execute 'select public.delete_loan_repayment($1, $2)' using rid, 'Saisie en double';
    reset role;
  exception when others then
    begin
      set local role authenticated;
      execute 'select public.delete_loan_repayment($1)' using rid;
      reset role;
    exception when others then null; end;
  end;
  select count(*) into n_audit from public.audit_log where entity = 'loan_repayments' and entity_id = rid;
  select count(*) into n_notif from public.notifications where entity_id = lid and kind like 'pret_remboursement%';
  perform _ok('T8b Le journal garde l''ajout ET l''annulation du remboursement', n_audit = 2, n_audit || ' trace(s)');
end $$;

-- ------------------------------------------------------------------ T9 sans compte
do $$ declare n int; begin
  begin
    set local role anon;
    select count(*) into n from public.memberships;
    reset role;
    perform _ok('T9 Sans compte : lecture des membres', false, n || ' ligne(s)');
  exception when others then perform _ok('T9 Sans compte : lecture des membres', true, 'refuse'); end;
end $$;

-- ------------------------------------------------------------------ T10 president avec code 2FA : tout marche
do $$ declare n int; begin
  begin
    perform _as('00000000-0000-0000-0000-00000000000a','aal2');
    set local role authenticated;
    select count(*) into n from public.contributions;
    perform public.review_contribution('11111111-0000-0000-0000-000000000001','validee');
    reset role;
    perform _ok('T10 President avec code 2FA : lecture et validation (doit marcher)', n >= 1, n || ' cotisation(s), validation ok');
  exception when others then perform _ok('T10 President avec code 2FA : lecture et validation (doit marcher)', false, sqlerrm); end;
end $$;

-- ------------------------------------------------------------------ T11 rappels automatiques (pg_cron, sans session)
do $$ begin
  perform set_config('request.jwt.claims', '', false);
  perform public.send_loan_due_reminders();
  perform _ok('T11 Rappels automatiques d''echeance toujours fonctionnels', true, 'ok');
exception when others then perform _ok('T11 Rappels automatiques d''echeance toujours fonctionnels', false, sqlerrm);
end $$;

select case when ok then 'OK    ' else 'FAILLE' end as resultat, test, detail from _res order by n;
