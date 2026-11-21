# Tests de sécurité de la base (hors Supabase)

Ces scripts rejouent des scénarios d'attaque sur une copie locale de la base, avec PostgreSQL 16
et une imitation minimale de Supabase (`supabase_stub.sql` : auth, storage, pg_cron).

1. Lancer un PostgreSQL local sur le port 5433 (socket dans /tmp), utilisateur `postgres`.
2. `./build_db.sh avant` : base en v0.15. `./build_db.sh apres with_v016` : base en v0.16.
3. `psql -h /tmp -p 5433 -U postgres -d apres -f tests.sql` puis `-f tests2.sql`.

Chaque ligne affiche OK (comportement sûr) ou FAILLE. En v0.15 : 8 failles. En v0.16 : aucune.

Mode démo (v0.17) : `./build_db.sh demo with_v016 with_demo` puis `psql -h /tmp -p 5433 -U postgres -d demo -f tests-demo.sql`.
35 scénarios : ce que le visiteur peut faire, ce qui lui est refusé, le cloisonnement avec les vrais groupes, la remise à zéro.
`tests.sql` et `tests2.sql` donnent les mêmes résultats avec ou sans la v0.17.
