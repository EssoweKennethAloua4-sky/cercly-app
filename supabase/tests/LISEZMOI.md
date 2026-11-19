# Tests de sécurité de la base (hors Supabase)

Ces scripts rejouent des scénarios d'attaque sur une copie locale de la base, avec PostgreSQL 16
et une imitation minimale de Supabase (`supabase_stub.sql` : auth, storage, pg_cron).

1. Lancer un PostgreSQL local sur le port 5433 (socket dans /tmp), utilisateur `postgres`.
2. `./build_db.sh avant` : base en v0.15. `./build_db.sh apres with_v016` : base en v0.16.
3. `psql -h /tmp -p 5433 -U postgres -d apres -f tests.sql` puis `-f tests2.sql`.

Chaque ligne affiche OK (comportement sûr) ou FAILLE. En v0.15 : 8 failles. En v0.16 : aucune.
