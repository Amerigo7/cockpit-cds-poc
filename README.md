# Cockpit CDS — Max / WeMax

Version 3 : un démarrage manuel du suivi financier. **Laurent et Jennifer initialisent un PO et ses projets ; Lassaad ventile les jours réalisés et édite la facture ; Laurent contrôle et valide.**

Chaque projet expose son budget initial, son dispositif en ETP, sa date de début, sa date de fin, son consommé validé, son restant et son forecast à terminaison.

## Démarrage local

Node.js et Python 3, sans dépendance applicative :

```bash
npm start
```

Ouvrir `http://localhost:4173`. Vérification :

```bash
npm run check
npm test
```

## Démonstration en cinq minutes

1. Choisir **Laurent** ou **Jennifer**. Ouvrir **Initialisation**, examiner le PO de démonstration #124177, le budget de 1 600 000 €, les quatre projets, les dates et le dispositif. Modifier les champs voulus ; le reste à répartir doit être de 0 €. Confirmer et activer le cockpit.
2. Changer de profil pour **Lassaad**. Dans **Ventilation mensuelle**, choisir janvier 2027. Saisir les jours réalisés par projet et par profil, par pas de 0,5 jour. Le bouton de préremplissage utilise le plan et demande de vérifier les jours réellement travaillés.
3. Enregistrer la ventilation, puis **Créer la facture**. Les jours et les TJM facturés sont modifiables. Le montant attendu conserve les jours ventilés et les tarifs contractuels. Tout écart apparaît avec son signe et nécessite une explication avant envoi.
4. Envoyer à Laurent dans la simulation. Changer de profil pour **Laurent**, ouvrir **Factures reçues**. Retourner la facture avec un motif, ou la valider. Accepter un écart nécessite une justification.
5. Consulter le cockpit : la validation ajoute le montant facturé au consommé une seule fois. Le forecast intègre les jours non encore validés et le coût du dispositif pour le reste de la période de chaque projet.

**Jennifer dispose de la même initialisation et du cockpit, sans l’onglet des factures reçues. Lassaad peut également consulter les enveloppes budgétaires.**

## Paramétrage

- Un cockpit par PO ; plusieurs portefeuilles peuvent être créés via **Nouveau cockpit**.
- PO : référence, nom du portefeuille, exercice, budget, période, arrêté mensuel, responsables, jours facturables mensuels, TJM.
- Projets : nom, nature Build / Run / Hypercare, budget, début, fin, ETP par rôle, consommé de reprise optionnel, epics Jira, story points et notes.
- Dispositif : Tech Lead / Manager, Senior Dev, Dev, QA et Architecte, par pas de 0,5 ETP.
- Reprise historique optionnelle : montant consommé validé par projet et mois de reprise. Les nouvelles ventilations commencent après ce mois pour éviter le double comptage.
- L’activation exige un paramétrage complet et une répartition exacte du budget du PO.

## Dates et données de démonstration

La transcription de `IA practical.docx` demande des périodes par projet, mais ne donne **aucun calendrier définitif**. Elle cite notamment un dispositif Max V2 de 3 Dev + 0,5 TL + 1 QA sur six mois, des runs annuels et une phase d’hypercare distincte.

Le jeu initial reprend les montants du premier scénario : Max V2 550 000 €, HYG 250 000 €, Hospitality Tech 300 000 € et Franchise 500 000 €. Les dates en 2027, les autres dispositifs et les TJM sont des **hypothèses éditables**, signalées dans l’interface. Elles ne sont pas présentées comme des décisions de la réunion ou comme un import validé du classeur Excel. Un nouveau cockpit s’ouvre avec des dates de projets vides.

## Calculs

- `Consommé validé = reprise + factures validées par Laurent jusqu’à l’arrêté`.
- `Restant = budget initial − consommé validé`.
- `Attendu facture = somme(jours ventilés × TJM contractuel enregistré)`.
- `Facturé = somme(jours facturés × TJM facturé)` ; `écart = facturé − attendu`.
- `Forecast = consommé validé + ventilations non validées + coût prévu pour les périodes non renseignées et à venir`.
- Un mois complet représente par défaut 20 jours par ETP. Un mois partiel est proratisé sur les jours de semaine actifs, sans prise en compte des jours fériés. La prévision s’arrête à la date de fin de chaque projet.
- Un mois passé manquant reste estimé selon le dispositif et fait l’objet d’une alerte. Un mois sans coût doit être explicitement confirmé.
- Les jours « Non affectés » sont conservés dans le forecast global et bloquent l’envoi de la facture jusqu’à affectation.
- Vert sous 95 % du budget, orange de 95 à 100 % inclus, rouge au-delà. Le statut devient gris en présence d’une ventilation non affectée.

Les story points sont des indicateurs de livraison, sans conversion en jours ou en euros. Les factures conservent un instantané de leur valorisation attendue : un changement de TJM pour le futur ne réécrit pas l’historique.

## Stockage et exports

Les profils simulent les droits métier ; il n’y a pas d’authentification de production. Les données restent dans **ce navigateur**, avec la clé `cockpit-cds-manual-v3`. Les profils partagent cette sauvegarde locale, pas plusieurs ordinateurs.

Le cockpit propose un CSV des projets et une sauvegarde JSON. Chaque facture s’exporte en HTML imprimable. L’envoi et la validation sont simulés ; aucun email, paiement ou écriture comptable n’est réalisé. Le JSON est un export technique ; la restauration par interface n’est pas incluse.

Le snapshot Excel et le parcours CRA de la version 2 sont conservés dans `legacy/`, hors du répertoire public. Les anciennes sauvegardes locales ne sont pas modifiées. Le document de transcription et le classeur original ne sont pas inclus dans le site ni dans l’archive GitHub de la version manuelle.

## Documentation et export GitHub

- [Spécification Markdown autonome](docs/POC_COCKPIT_CDS.md)
- [Contrôles et limites de vérification](docs/VALIDATION.md)

```bash
python3 scripts/package_github.py
```

L’archive de la version manuelle contient le frontend, sa documentation et ses tests. Elle exclut les identifiants d’hébergement, les credentials, les métadonnées Git et les données Excel archivées. Le script adapte la commande de tests au contenu livré : 19 tests manuels dans l’archive, 33 dans le dépôt de travail avec les régressions archivées. Aucun push GitHub n’est effectué par la création de cette archive.

## Structure

```text
dist/
  index.html
  style.css
  app.js             # interactions et persistance locale
  domain.js          # calculs et transitions métier
  views.js           # vues et exports HTML
tests/
  manual.test.mjs     # 19 scénarios de la version 3
  domain.test.mjs     # 14 régressions de la version 2 archivée
legacy/              # ancienne version Excel, non publiée
docs/
  POC_COCKPIT_CDS.md
  VALIDATION.md
scripts/
  package_github.py
  import_workbook.py  # ancien importeur, écrit dans legacy uniquement
```

La présentation existante de la version Excel n’a pas été remaniée dans cette évolution du prototype. La spécification Markdown décrit le nouveau parcours à présenter.

## Contribuer sur GitHub

Depuis une branche de travail, lancez `npm run check` et `npm test`, puis
ouvrez une pull request vers `main`. GitHub Actions vérifie chaque pull
request. Après fusion sur `main`, le workflow publie `dist/` sur GitHub
Pages. À la création du dépôt, choisissez **GitHub Actions** comme source
dans **Settings → Pages**, puis lancez le workflow.

Chaque navigateur conserve son propre état de démonstration. Les
contributions sur GitHub partagent le code et les discussions de revue.

## Instance partagée et Jira OP

Laurent et Jennifer créent les PO avec **Nouveau PO** et gardent un cockpit
par référence. Chaque navigateur sélectionne son PO indépendamment. Les
ventilations et factures restent rattachées au PO sélectionné.

Dans **Initialisation**, ouvrez **Choisir les epics Jira OP** sur un projet.
Cherchez par clé ou titre, choisissez les epics puis enregistrez le
paramétrage. Pour une epic créée plus tard, relancez la recherche depuis
le même projet. Les clés rattachées définissent le périmètre Jira du projet.
Lassaad peut ouvrir **Préremplir depuis Jira** dans la ventilation du mois.
L’aperçu consulte les temps visibles sur les tickets et sous-tâches des
epics rattachées. Il affiche le projet, l’intervenant, les tickets et les heures.
Lassaad choisit les profils, ajuste la durée d’un jour si nécessaire
(8 h par défaut), puis applique les propositions arrondies à la demi-journée.
La grille reste modifiable et doit être enregistrée avant facturation.

L’instance partagée interroge Jira Cloud depuis le serveur. Renseignez
`JIRA_EMAIL` et `JIRA_API_TOKEN` dans Render avec un compte autorisé à
consulter OP et un jeton de lecture compatible avec l’API de recherche Jira.
Le catalogue est accessible à Laurent et Jennifer. Les secrets restent
dans l’environnement du serveur. La démo statique conserve la saisie
manuelle des clés.


Dans l’instance partagée, le mode d’emploi s’affiche lors de la première
connexion par profil et par navigateur. **Help me · Mode d’emploi** permet
de le rouvrir. Laurent et Jennifer peuvent créer des PO. L’owner Accor
est désigné à la création, avec Laurent par défaut. Seul l’owner consulte
les factures reçues de son PO et voit une alerte dans le cockpit lorsqu’une
facture à valider présente un écart de montant. Lassaad valide les
imputations par projet et profil pour le mois choisi avant de créer la
facture fournisseur.
