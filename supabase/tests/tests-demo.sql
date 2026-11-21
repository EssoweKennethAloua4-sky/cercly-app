-- Scenarios du mode demo (v0.17). Base : ./build_db.sh demo with_v016 with_demo
-- Chaque ligne affiche OK (comportement attendu) ou FAILLE.
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
-- Essaie une instruction en tant que compte demo : true si elle a ete refusee
create or replace function _demo_refused(q text) returns text language plpgsql as $$
declare me uuid := (select user_id from public.demo_settings);
begin
  perform _as(me, 'aal1');
  set local role authenticated;
  execute q;
  reset role;
  return null;
exception when others then
  reset role;
  return sqlerrm;
end $$;

select user_id as me, group_id as gid from public.demo_settings \gset

-- Un vrai groupe a cote, avec un vrai president
insert into auth.users (id, email, email_confirmed_at) values ('00000000-0000-0000-0000-0000000000a1', 'vrai@x.fr', now());
select _as('00000000-0000-0000-0000-0000000000a1', 'aal2');
set role authenticated;
select public.create_group('Vraie tontine', 'tontine', 'XOF', 'Kenneth') as real_gid \gset
select public.create_invite_link(:'real_gid') as real_token \gset
reset role;

-- ------------------------------------------------------------------ donnees de depart
do $$ declare gid uuid := (select group_id from public.demo_settings); n int; p int; v int; r int; lo int; nt int; begin
  select count(*) into n from public.memberships where group_id = gid and status = 'active';
  select count(*) filter (where status = 'en_attente'), count(*) filter (where status = 'validee'), count(*) filter (where status = 'rejetee')
    into p, v, r from public.contributions where group_id = gid;
  select count(*) into lo from public.loans where group_id = gid;
  select count(*) into nt from public.notifications where group_id = gid;
  perform _ok('S1 Groupe demo rempli : 11 membres, 3 en attente, 1 rejetee, 4 prets',
              n = 11 and p = 3 and r = 1 and v > 50 and lo = 4, format('membres %s, attente %s, validees %s, rejetees %s, prets %s, notifs %s', n, p, v, r, lo, nt));
end $$;

-- ------------------------------------------------------------------ ce que le visiteur peut faire
do $$ declare me uuid := (select user_id from public.demo_settings); n int; g int; begin
  perform _as(me, 'aal1');
  set local role authenticated;
  select count(*) into g from public.groups;
  select count(*) into n from public.contributions;
  reset role;
  perform _ok('D1 Le visiteur voit le groupe demo et lui seul', g = 1, g::text);
  perform _ok('D2 Le visiteur voit les cotisations du groupe', n > 50, n::text);
end $$;

do $$ declare me uuid := (select user_id from public.demo_settings); st text; begin
  perform _as(me, 'aal1');
  set local role authenticated;
  perform public.review_contribution('dddddddd-0000-4000-8000-000000000201', 'validee');
  perform public.review_contribution('dddddddd-0000-4000-8000-000000000202', 'rejetee', 'Montant différent');
  reset role;
  select status into st from public.contributions where id = 'dddddddd-0000-4000-8000-000000000201';
  perform _ok('D3 Le visiteur valide et rejette un justificatif sans 2FA', st = 'validee', st);
exception when others then reset role; perform _ok('D3 Le visiteur valide un justificatif', false, sqlerrm); end $$;

do $$ declare me uuid := (select user_id from public.demo_settings); st text; begin
  perform _as(me, 'aal1');
  set local role authenticated;
  insert into public.loan_votes (loan_id, voter_id, vote) values ('dddddddd-0000-4000-8000-000000000302', me, 'pour');
  perform public.respond_as_guarantor('dddddddd-0000-4000-8000-000000000304', true);
  perform public.record_loan_repayment('dddddddd-0000-4000-8000-000000000301', 5000, current_date, null);
  reset role;
  select status into st from public.loans where id = 'dddddddd-0000-4000-8000-000000000304';
  perform _ok('D4 Le visiteur vote, confirme comme garant, enregistre un remboursement', st = 'en_vote', st);
exception when others then reset role; perform _ok('D4 Prets', false, sqlerrm); end $$;

do $$ declare me uuid := (select user_id from public.demo_settings); r record; begin
  perform _as(me, 'aal1');
  set local role authenticated;
  select * into r from public.my_security_status();
  reset role;
  perform _ok('D5 Pas de bandeau « 2FA obligatoire » pour le visiteur', not r.needs_mfa, r::text);
end $$;

-- ------------------------------------------------------------------ ce qui lui est interdit
select _ok('B1 Envoyer une cotisation', e is not null, e) from (select _demo_refused(format(
  $q$insert into public.contributions (group_id, payer_id, for_user_id, amount) values (%L, %L, %L, 1000)$q$, :'gid', :'me', :'me')) e) x;
select _ok('B2 Deposer un fichier', e is not null, e) from (select _demo_refused(format(
  $q$insert into storage.objects (bucket_id, name) values ('justificatifs', %L)$q$, :'gid' || '/dddddddd-0000-4000-8000-000000000203/x.png')) e) x;
select _ok('B3 Creer un groupe', e is not null, e) from (select _demo_refused(
  $q$select public.create_group('Mon groupe', 'tontine', 'XOF', 'Moi')$q$) e) x;
select _ok('B4 Creer un lien d''invitation', e is not null, e) from (select _demo_refused(format(
  $q$select public.create_invite_link(%L)$q$, :'gid')) e) x;
select _ok('B5 Inviter par e-mail', e is not null, e) from (select _demo_refused(format(
  $q$select public.invite_member(%L, 'quelquun@x.fr')$q$, :'gid')) e) x;
select _ok('B6 Rejoindre un vrai groupe avec son lien', e is not null, e) from (select _demo_refused(format(
  $q$select public.accept_invitation(%L, 'Intrus')$q$, :'real_token')) e) x;
select _ok('B7 Transmettre la presidence', e is not null, e) from (select _demo_refused(format(
  $q$select public.transfer_presidency(%L, 'dddddddd-0000-4000-8000-000000000102')$q$, :'gid')) e) x;
select _ok('B8 Nommer le secretaire', e is not null, e) from (select _demo_refused(format(
  $q$select public.set_secretary(%L, 'dddddddd-0000-4000-8000-000000000102')$q$, :'gid')) e) x;
select _ok('B9 Retirer un membre', e is not null, e) from (select _demo_refused(format(
  $q$update public.memberships set status = 'removed' where group_id = %L and user_id = 'dddddddd-0000-4000-8000-000000000104'$q$, :'gid')) e) x;
select _ok('B10 Changer les reglages du groupe', e is not null, e) from (select _demo_refused(format(
  $q$update public.groups set name = 'Pirate' where id = %L$q$, :'gid')) e) x;
select _ok('B11 Desactiver un module', e is not null, e) from (select _demo_refused(format(
  $q$update public.group_modules set enabled = false where group_id = %L and module = 'prets'$q$, :'gid')) e) x;
select _ok('B12 Publier une annonce', e is not null, e) from (select _demo_refused(format(
  $q$insert into public.announcements (group_id, author_id, title, body) values (%L, %L, 't', 'b')$q$, :'gid', :'me')) e) x;
select _ok('B13 Creer un lien de pret public', e is not null, e) from (select _demo_refused(format(
  $q$select public.get_or_create_loan_link(%L)$q$, :'gid')) e) x;
select _ok('B14 Quitter le groupe', e is not null, e) from (select _demo_refused(format(
  $q$select public.leave_group(%L)$q$, :'gid')) e) x;
-- Verifications apres coup : les refus n'ont rien laisse
do $$ declare n int; begin
  select count(*) into n from public.groups where name in ('Mon groupe', 'Pirate');
  perform _ok('B15 Aucun groupe cree ni renomme', n = 0, n::text);
  select count(*) into n from public.memberships m join public.demo_settings d on d.user_id = m.user_id;
  perform _ok('B16 Le visiteur n''est membre que d''un groupe', n = 1, n::text);
end $$;

-- Mot de passe, e-mail, 2FA du compte demo
do $$ declare me uuid := (select user_id from public.demo_settings); pw text; em text; begin
  update auth.users set encrypted_password = 'pirate', email = 'pirate@x.fr' where id = me;
  select encrypted_password, email into pw, em from auth.users where id = me;
  perform _ok('B17 Mot de passe et e-mail du compte demo inchanges', pw = 'hash-initial' and em = 'kennethaloua3+cercly-demo@gmail.com', pw || ' ' || em);
end $$;
do $$ declare me uuid := (select user_id from public.demo_settings); begin
  insert into auth.mfa_factors (user_id, status) values (me, 'unverified');
  perform _ok('B18 Activer la 2FA du compte demo', false, 'facteur cree');
exception when others then perform _ok('B18 Activer la 2FA du compte demo', true, sqlerrm); end $$;
do $$ declare me uuid := (select user_id from public.demo_settings); pw text; begin
  perform set_config('cercly.demo_admin', 'on', true);
  update auth.users set encrypted_password = 'nouveau-hash' where id = me;
  perform set_config('cercly.demo_admin', '', true);
  select encrypted_password into pw from auth.users where id = me;
  perform _ok('B19 L''administrateur peut changer le mot de passe demo', pw = 'nouveau-hash', pw);
  update auth.users set encrypted_password = 'hash-initial' where id = me;  -- ignore (protection revenue)
end $$;
do $$ declare me uuid := (select user_id from public.demo_settings); pw text; begin
  select encrypted_password into pw from auth.users where id = me;
  perform _ok('B20 Hors administration, la protection est de retour', pw = 'nouveau-hash', pw);
end $$;

-- ------------------------------------------------------------------ cloisonnement avec les vrais groupes
do $$ declare n int; gid uuid := (select group_id from public.demo_settings); begin
  perform _as('00000000-0000-0000-0000-0000000000a1', 'aal1');
  set local role authenticated;
  select count(*) into n from public.contributions where group_id = gid;
  reset role;
  perform _ok('C1 Un vrai membre ne voit rien du groupe demo', n = 0, n::text);
end $$;
do $$ declare me uuid := (select user_id from public.demo_settings); n int; begin
  perform _as(me, 'aal1');
  set local role authenticated;
  select count(*) into n from public.groups where name = 'Vraie tontine';
  reset role;
  perform _ok('C2 Le visiteur ne voit pas les vrais groupes', n = 0, n::text);
end $$;
do $$ declare gid uuid := (select group_id from public.demo_settings); begin
  perform _as('00000000-0000-0000-0000-0000000000a1', 'aal1');
  insert into public.memberships (group_id, user_id, display_name) values (gid, '00000000-0000-0000-0000-0000000000a1', 'Intrus');
  perform _ok('C3 Personne d''autre n''entre dans le groupe demo', false, 'membre ajoute');
exception when others then perform _ok('C3 Personne d''autre n''entre dans le groupe demo', true, sqlerrm); end $$;
do $$ begin
  perform _as('00000000-0000-0000-0000-0000000000a1', 'aal1');
  set local role authenticated;
  perform public.demo_reset();
  reset role;
  perform _ok('C4 Un utilisateur ne peut pas lancer la remise a zero', false, 'execute');
exception when others then reset role; perform _ok('C4 Un utilisateur ne peut pas lancer la remise a zero', true, sqlerrm); end $$;
do $$ declare n int; real uuid; begin
  select id into real from public.groups where name = 'Vraie tontine';
  perform _as('00000000-0000-0000-0000-0000000000a1', 'aal2');
  set local role authenticated;
  perform public.create_invite_link(real);
  update public.groups set name = 'Vraie tontine' where id = real;
  reset role;
  perform _ok('C5 Un vrai president garde tous ses droits', true);
exception when others then reset role; perform _ok('C5 Un vrai president garde tous ses droits', false, sqlerrm); end $$;

-- ------------------------------------------------------------------ remise a zero
select public.demo_reset();
do $$ declare gid uuid := (select group_id from public.demo_settings); p int; v int; st text; a int; nt int; begin
  select count(*) into p from public.contributions where group_id = gid and status = 'en_attente';
  select count(*) into v from public.loan_votes where loan_id = 'dddddddd-0000-4000-8000-000000000302';
  select status into st from public.loans where id = 'dddddddd-0000-4000-8000-000000000304';
  select count(*) into a from public.audit_log where group_id = gid;
  select count(*) into nt from public.notifications where group_id = gid;
  perform _ok('R1 La remise a zero remet tout en place', p = 3 and v = 4 and st = 'a_examiner' and a = 0 and nt = 7,
              format('attente %s, votes %s, pret4 %s, journal %s, notifs %s', p, v, st, a, nt));
end $$;
do $$ declare n int; begin
  select count(*) into n from cron.job where jobname = 'cercly-demo-reset' and schedule = '0 3 * * *';
  perform _ok('R2 Tache de nuit programmee a 3 h', n = 1, n::text);
end $$;
do $$ begin
  delete from public.audit_log where id = (select min(id) from public.audit_log);
  perform _ok('R3 Le journal des vrais groupes reste en lecture seule', false, 'ligne effacee');
exception when others then perform _ok('R3 Le journal des vrais groupes reste en lecture seule', true, sqlerrm); end $$;

-- Ce que voit le visiteur dans Suivi
do $$ declare me uuid := (select user_id from public.demo_settings); gid uuid := (select group_id from public.demo_settings); t record; c record; begin
  perform _as(me, 'aal1');
  set local role authenticated;
  select * into t from public.group_total(gid);
  select * into c from public.group_cash(gid);
  reset role;
  perform _ok('V1 Totaux et caisse calcules', t.validated > 0 and c.in_cash > 0, format('total %s, attente %s, penalites %s | caisse %s', t, '', '', c));
end $$;

select case when ok then 'OK     ' else 'FAILLE ' end || test || case when ok then '' else '  -> ' || coalesce(detail, '') end as resultat
from _res order by n;
