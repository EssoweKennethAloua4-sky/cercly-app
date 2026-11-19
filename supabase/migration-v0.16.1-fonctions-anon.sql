-- =====================================================================
-- Cercly v0.16.1 : sans compte (anon), seules les 2 fonctions du formulaire public de pret restent appelables.
-- A executer une fois dans Supabase, apres la v0.16. Deja appliquee sur la base de production le 19/11/2026.
-- (Supabase ouvre par defaut l'execution des fonctions du schema public au role anon.)
-- =====================================================================
begin;
do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p
           where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'
             and p.proname not in ('get_loan_link_info', 'submit_loan_request')
  loop
    execute format('revoke execute on function %s from anon, public', f.sig);
  end loop;
end $$;
-- Les fonctions de trigger ne doivent pas etre appelees directement
revoke execute on function public.audit_repayment(), public.loan_set_interest() from authenticated;
-- Les futures fonctions ne seront plus ouvertes a anon par defaut
alter default privileges in schema public revoke execute on functions from anon, public;
commit;
