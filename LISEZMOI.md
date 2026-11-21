# Cercly — application (v0.16)

Interface React + TypeScript branchée sur Supabase. Les règles de sécurité sont dans `supabase/schema.sql` puis dans les migrations `supabase/migration-v0.5` à `migration-v0.16`, à exécuter dans l'ordre : l'application ne fait que les afficher, c'est la base qui les impose.

## Sécurité (v0.16)

1. Double authentification : facultative pour un simple membre, **obligatoire pour le président, le secrétaire et les validateurs** (sans elle, ils peuvent consulter mais ni valider, ni décider, ni régler). Elle s'active dans Réglages > Mon compte.
2. Un compte qui a activé la 2FA ne peut plus rien lire ni faire avec le seul mot de passe (règle restrictive sur toutes les tables et sur les justificatifs).
3. Lien d'invitation : valable 7 jours ; la personne arrive « en attente » et le président ou le secrétaire l'accepte dans l'onglet Membres. L'invitation par e-mail reste une entrée directe.
4. Le téléphone de l'emprunteur n'est visible que du président, du secrétaire, des validateurs, du garant et du membre dont le lien a servi (fonction `loan_borrower_phones`).
5. Formulaire public de prêt : aucune demande ne passe au vote sans la confirmation d'un membre ; le membre au nom duquel la demande est faite est prévenu ; 3 demandes au plus par téléphone et par jour.
6. Remboursements : ajouts et annulations tracés dans le journal ; une annulation exige un motif et prévient tout le groupe.

Encore à faire : test anti-robot (captcha) sur le formulaire public, tests automatiques, test d'intrusion.

## Ce qui est fait

1. Inscription, connexion, double authentification (code à 6 chiffres) : voir « Sécurité (v0.16) ».
2. Création de groupe, invitation de membres par lien, changement de groupe.
3. Annonces (publication réservée au président et aux publieurs).
4. Cotisations : montant, date, pour qui, 1 à 5 justificatifs (images ou PDF), statuts orange / vert / rouge.
5. Validation par les validateurs : jamais pour son propre justificatif, motif obligatoire pour un rejet.
6. Suivi : total du groupe et somme de chaque membre (selon la visibilité choisie).
7. Membres : droits de validation et de publication, retrait, transmission de la présidence.
8. Notifications obligatoires dans l'application.
9. Français (par défaut) et anglais.
10. Thème sombre, adapté à l'ordinateur, à la tablette et au téléphone.
11. Prêts par formulaire : chaque membre a son lien personnel (fixe, régénérable, en pause possible) ; l'emprunteur remplit lui-même la demande sur une page publique, sans compte, et indique le nom de son garant.
12. Écran Prêts : confirmation du garant, vote de 7 jours, quorum, décision du président, remboursement, effacement des informations de l'emprunteur, demandes écartées.
13. Réglages du groupe (président) : modules, qui décide des prêts, visibilité des cotisations, périodicité.
14. Application installable (PWA) : icône sur l'écran d'accueil, plein écran, bouton « Installer l'application » dans Réglages. Les icônes sont générées depuis `public/icon.svg` avec `npm run icons`.

## Pas encore fait

1. Versement et remboursements de prêts avec justificatifs, intérêts.
2. Rappels et graphiques par jour / semaine / mois / année.
3. Envoi automatique des e-mails d'invitation et notifications sur le téléphone (aujourd'hui : le président copie le lien d'invitation et l'envoie lui-même).
4. Publication sur Google Play et l'App Store (la version installable PWA est faite).
5. Test anti-robot sur le formulaire public, tests automatiques et test d'intrusion.

## Mise en route

1. Installez Node.js 20 ou plus récent.
2. Créez un projet sur https://supabase.com.
3. Dans Supabase, ouvrez « SQL Editor » : collez et exécutez d'abord `supabase/schema.sql`, puis chaque migration dans l'ordre, de `migration-v0.5-prets.sql` à `migration-v0.16.1-fonctions-anon.sql` (une seule fois chacune).
4. Dans « Authentication » :
   - confirmation d'e-mail obligatoire ;
   - authentification multifacteur (TOTP) activée ;
   - longueur minimale du mot de passe : 12 ;
   - « Site URL » et « Redirect URLs » : `http://localhost:5173` pour les essais, puis l'adresse du site en production ;
   - limites de débit au plus strict raisonnable.
5. Copiez `.env.example` en `.env` et remplissez l'adresse du projet et la clé « anon » (Project Settings > API). Jamais la clé « service_role ».
6. Dans un terminal : `npm install` puis `npm run dev`, et ouvrez http://localhost:5173.

## Premier essai

1. Créez un compte, confirmez l'e-mail, connectez-vous, enregistrez la double authentification.
2. Créez un groupe : vous en êtes le président.
3. Onglet Membres : invitez une deuxième adresse e-mail, copiez le lien, ouvrez-le dans un autre navigateur avec l'autre compte.
4. Donnez-lui le droit de valider (il faut 2 validateurs pour que chacun puisse faire traiter ses propres justificatifs).
5. Envoyez une cotisation avec un justificatif depuis l'un des comptes, validez-la depuis l'autre.

## Essayer les prêts

1. Réglages : activez le module Prêts.
2. Onglet Prêts : créez votre lien, copiez-le et ouvrez-le dans une fenêtre privée (sans être connecté).
3. Remplissez le formulaire en indiquant comme garant le nom d'un autre membre.
4. Connectez-vous avec ce membre : il confirme qu'il se porte garant, puis le vote s'ouvre.

## Mode démo (bouton « Essayer la démo »)

Un visiteur entre en un clic, sans inscription, dans un groupe fictif déjà rempli : 10 faux membres, 6 mois de cotisations (validées, en attente, en retard, une rejetée), 3 justificatifs à valider, 4 prêts (en cours de remboursement, au vote, remboursé, en attente du garant).

Mise en place (une fois) :

1. Authentication > Users > Add user : `kennethaloua3+cercly-demo@gmail.com`, un mot de passe, « Auto Confirm User » coché. Ce compte ne doit servir qu'à la démo.
2. SQL Editor : exécutez `supabase/migration-v0.17-demo.sql`.
3. Déposez les 3 faux justificatifs : `SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… node supabase/demo/upload-justificatifs.mjs` (ou à la main, voir l'en-tête du script).
4. Sur Vercel, ajoutez `VITE_DEMO_EMAIL` et `VITE_DEMO_PASSWORD`, puis redéployez. Sans ces deux variables, le bouton n'apparaît pas.

Sécurité : le mot de passe de la démo est lisible dans l'application, c'est donc la base qui limite ce compte.

- Il n'appartient qu'au groupe démo, et personne d'autre ne peut y entrer. Il ne voit aucun vrai groupe.
- Il ne peut pas changer son mot de passe ni son e-mail, activer la double authentification, inviter, rejoindre ou créer un groupe, gérer les membres, modifier les réglages, publier, envoyer une cotisation ou un fichier, ni créer un lien de prêt public.
- Il peut consulter, valider ou rejeter, voter, confirmer comme garant, décider d'un prêt, enregistrer un remboursement.
- Chaque nuit à 3 h (heure de Lomé), `demo_reset()` remet le groupe à zéro (tâche pg_cron `cercly-demo-reset`).
- Les visiteurs partagent le même compte : dans la journée, l'un peut voir ce qu'un autre a validé.

## Mise en ligne (Vercel)

1. Envoyez le projet sur GitHub (le fichier `.env` est ignoré).
2. Sur Vercel, importez le dépôt et ajoutez les deux variables `VITE_SUPABASE_URL` et `VITE_SUPABASE_ANON_KEY`.
3. `vercel.json` ajoute les en-têtes de sécurité (CSP, anti-clickjacking, HTTPS strict). Vérifiez après la mise en ligne que l'application fonctionne avec cette CSP, car elle n'a pas pu être testée en conditions réelles.
4. Dans Supabase (Authentication > URL Configuration) : mettez l'adresse du site comme « Site URL » et ajoutez-la aux « Redirect URLs ».
5. Sur le téléphone, ouvrez l'adresse du site : Android propose « Installer l'application » ; sur iPhone, Safari > Partager > « Sur l'écran d'accueil ».

## Points de sécurité à connaître

1. Seule la clé « anon » est dans l'application. Les droits sont vérifiés par la base (RLS, fonctions, double authentification), pas par l'interface.
2. Les images de justificatifs sont ré-encodées avant l'envoi : les données cachées (position GPS) sont supprimées. Les PDF sont envoyés tels quels.
3. Le jeton d'invitation est retiré de l'adresse dès l'ouverture du lien. Il ne fonctionne qu'avec l'adresse e-mail invitée, confirmée, et une seule fois.
4. Une capture de paiement peut être falsifiée : le validateur doit comparer avec le compte qui reçoit réellement l'argent.

## Structure

- `src/screens/` : écrans (connexion, 2FA, groupes, annonces, cotisations, suivi, membres)
- `src/components/` : logo, langue, notifications
- `src/lib/` : formats et préparation des fichiers
- `src/i18n.tsx` : textes en français et en anglais
- `supabase/schema.sql` : base de données et règles de sécurité
