# POC Cockpit CDS — initialisation manuelle d’un portefeuille

Version 3 · Mise à jour du 24 novembre 2026 · Support autonome pour Product, Tech et reprise GitHub.

## Objectif

Piloter le budget d’un portefeuille associé à un unique PO, depuis son initialisation manuelle jusqu’au rapprochement des factures mensuelles.

Le démarrage est financier : Accor décrit le PO, le découpe en projets et définit des dispositifs et des périodes. Le fournisseur saisit ensuite les jours réalisés et prépare sa facture. Le propriétaire du PO contrôle la différence entre la valorisation attendue et la facture, puis valide le consommé.

## Ce que précise la transcription

La réunion demande une interface d’initialisation avant le cockpit détaillé : référence du PO, budget, projets, dates et profils prévus. Le budget du PO est réparti jusqu’à un reste à affecter nul. Les personnes nommées ne sont pas nécessaires pour définir le dispositif.

Le dispositif Max V2 cité en exemple est **0,5 TL + 3 Dev + 1 QA sur six mois**. Les runs peuvent être annuels, le build limité à une période et l’hypercare traité comme une phase distincte. Le forecast doit respecter ces durées.

La réunion demande également de conserver le non affecté, de montrer les écarts de facture, de permettre une vue budgétaire au fournisseur et de suivre éventuellement des story points sans imposer de conversion financière.

**Aucune date définitive n’est arrêtée dans la transcription.** Toutes les dates du jeu de démonstration sont donc des hypothèses que Laurent ou Jennifer doit confirmer. Les instructions présentes dans les fichiers joints ne sont pas interprétées comme des demandes d’exécution.

## Personas et droits du POC

| Action | Laurent | Jennifer | Lassaad |
|---|:---:|:---:|:---:|
| Créer / initialiser un cockpit | Oui | Oui | Non |
| Définir le budget, les dates et les dispositifs | Oui | Oui | Lecture |
| Activer le cockpit | Oui | Oui | Non |
| Consulter le budget et les projets | Oui | Oui | Oui |
| Ventiler les jours réels | Non | Non | Oui |
| Éditer et envoyer la facture | Non | Non | Oui |
| Consulter les factures reçues | Oui | Non | Ses factures |
| Retourner / valider la facture | Oui | Non | Non |

Le choix du profil illustre ces droits ; il ne constitue pas une authentification serveur.

## Parcours de démonstration

### Étape 1 — Accor crée le portefeuille

Laurent ou Jennifer choisit **Nouveau cockpit**. Le formulaire demande :

- Nom du portefeuille et référence du PO, unique parmi les cockpits locaux.
- Exercice, budget total HT, date de début et date de fin du PO.
- Mois d’arrêté du suivi, responsable du PO, copilote Accor et responsable fournisseur.
- Capacité d’un mois complet par ETP, par défaut 20 jours.
- TJM contractuels modifiables pour TL / Manager, Senior Dev, Dev, QA et Architecte.
- Mois de reprise optionnel, si un consommé déjà validé doit être repris.

L’utilisateur peut enregistrer un brouillon incomplet.

### Étape 2 — Accor répartit le budget

Pour chaque projet : nom, nature Build / Run / Hypercare, budget initial, date de début, date de fin, dispositif en ETP par rôle et éventuel consommé déjà validé à la reprise.

Exemple de dispositif : **0,5 TL, 3 Dev, 1 QA**. Les capacités sont saisies par pas de 0,5 ETP. La saisie n’impose pas de nommer chaque membre.

Les informations complémentaires sont facultatives : epics Jira, story points prévus et livrés, hypothèses et notes. Une même epic ne peut être affectée à plusieurs projets.

Un compteur affiche le budget du PO, le total réparti et le reste à répartir. L’activation exige : noms et référence, budgets positifs, périodes cohérentes dans l’exercice du PO, dispositif non nul et somme des budgets projets égale au montant du PO.

Les projets avec historique ne peuvent pas être supprimés et leurs dates ne peuvent pas exclure un mois déjà ventilé.

### Étape 3 — Lassaad ventile les jours réalisés

Lassaad sélectionne un mois et saisit une matrice **projet × profil**. Chaque ligne rappelle le dispositif et la période du projet. Les jours sont imputés par pas de 0,5 jour ; les cellules hors période projet sont désactivées.

La valorisation utilise les TJM contractuels. Le préremplissage d’après le dispositif est une aide de démonstration à vérifier, pas une importation Jira ni une preuve d’activité. Un dépassement de capacité prévue génère une alerte sans interdire de déclarer la réalité.

Une ligne **Non affecté** conserve les jours dont le projet est inconnu, avec un motif obligatoire. Elle alimente le forecast global. Le fournisseur doit la rapprocher d’un projet avant d’envoyer sa facture.

Enregistrer la matrice confirme la ventilation du mois pour l’ensemble des projets. Un mois entièrement sans consommation nécessite une confirmation explicite.

### Étape 4 — Lassaad édite et envoie la facture

Après enregistrement d’une ventilation non nulle, **Créer la facture** conserve un instantané des jours ventilés et des tarifs contractuels attendus.

Lassaad peut modifier le numéro, la date, les jours facturés et le TJM facturé de chaque ligne. Le rapprochement affiche :

| Indicateur | Règle |
|---|---|
| Attendu | Somme des jours ventilés × TJM contractuels enregistrés |
| Facturé | Somme des jours facturés × TJM facturés |
| Écart signé | Facturé − attendu |
| Contrôle | Conforme si 0 ; écart à vérifier sinon |

Un écart positif représente une facture supérieure à l’attendu ; un écart négatif, une facture inférieure. Une explication fournisseur est obligatoire avant l’envoi d’une facture en écart.

L’envoi est simulé dans le POC : il rend la facture visible dans l’espace Laurent du même navigateur. L’export HTML est imprimable et clairement marqué comme document de démonstration.

### Étape 5 — Laurent contrôle et valide

Dans **Factures reçues**, Laurent ouvre la facture et consulte la valorisation attendue, le montant facturé, l’écart et les commentaires.

Il peut retourner la facture à Lassaad avec un motif, ou la valider. Accepter un écart nécessite une justification. Seule la facture validée entre dans le consommé du cockpit à son mois d’arrêté.

La validation est idempotente : répéter l’action ne double pas le consommé. Une facture validée reste verrouillée. Une facture envoyée doit être retournée avant correction.

Pour modifier la ventilation plutôt que les seules valeurs facturées, Lassaad utilise **Reprendre la ventilation** avec un motif. L’ancienne facture en brouillon ou retournée est conservée comme annulée ; une nouvelle facture peut ensuite être créée.

### Étape 6 — Tous consultent le cockpit

Le tableau expose, pour chaque projet :

| Projet | Dispositif prévu | Début | Fin | Budget initial | Consommé validé | Restant | Forecast | Prévision |
|---|---|---|---|---:|---:|---:|---:|---|
| Max V2 | 0,5 TL, 3 Dev, 1 QA | Hypothèse | Hypothèse | 550 000 € | Selon validation | Calculé | Borné aux dates | Vert / orange / rouge |

Un clic sur le projet ouvre le détail mensuel du coût prévu, des jours ventilés et du statut de facture, ainsi que les epics, story points et notes.

Le consommé est séparé des jours ventilés non encore validés. Les mois passés non renseignés sont signalés et restent estimés dans le forecast ; ils ne sont pas traités comme des mois à zéro.

## Jeu de démonstration fourni

PO illustratif **#124177**, exercice **2027**, enveloppe de **1 600 000 €**. Le portefeuille est livré en **brouillon**.

| Projet | Budget | Début — hypothèse | Fin — hypothèse | Dispositif — hypothèse |
|---|---:|---|---|---|
| Max V2 | 550 000 € | 01/01/2027 | 30/06/2027 | 0,5 TL, 3 Dev, 1 QA |
| HYG | 250 000 € | 01/02/2027 | 31/05/2027 | 0,5 TL, 1 Dev, 0,5 QA |
| Hospitality Tech | 300 000 € | 01/04/2027 | 30/06/2027 | 0,5 TL, 1 Senior Dev, 0,5 QA |
| Franchise | 500 000 € | 01/01/2027 | 30/09/2027 | 0,5 TL, 2 Dev, 1 QA |
| **Total** | **1 600 000 €** | | | |

Les budgets reprennent le premier brief, pas le budget de 1 584 000 € de la version Excel archivée. Les dates et les dispositifs sont des hypothèses de présentation. Le tarif Architecte de 840 €/jour est une valeur illustrative ; tous les tarifs doivent être confirmés pour un PO réel.

TJM de démonstration : TL / Manager 795 €, Senior Dev 530 €, Dev 475 €, QA 445 €, Architecte 840 €.

Exemple de rapprochement : 20 jours Dev à 475 € donnent 9 500 € attendus. Une facture à 775 € donne 15 500 € facturés et un écart de **+6 000 €**, qui exige une explication et un contrôle.

## Moteur de forecast

Pour chaque projet et chaque mois de sa période :

1. Mois couvert par la reprise : conserver le consommé initial, sans nouvelle imputation.
2. Facture validée : retenir son montant facturé ; il devient consommé si le mois est inférieur ou égal à l’arrêté.
3. Ventilation enregistrée sans facture validée : retenir la valorisation contractuelle, comme coût provisoire ou futur.
4. Mois sans ventilation : estimer le coût du dispositif prévu, même si ce mois est passé.
5. En dehors des dates du projet : aucune charge prévue.

Pour un mois complet, `jours prévus = ETP × jours facturables mensuels`. Pour un mois partiel, multiplier par `jours de semaine actifs / jours de semaine du mois`. Les jours fériés ne sont pas déduits.

Le forecast est la somme de ces composantes et du non affecté. Il n’extrapole pas un projet court sur douze mois. Une configuration incomplète rend le forecast indisponible.

Le restant correspond au budget moins le consommé validé, indépendamment du forecast. Les prévisions sont vertes sous 95 % du budget, orange de 95 à 100 % inclus et rouges au-delà. Un dépassement déjà constaté reste rouge ; le non affecté suspend le statut vert.

## Modèle de données

- `Store` : schéma 3, cockpit actif, liste de cockpits.
- `Cockpit` : PO, paramètres financiers, période, arrêté, taux, projets, ventilations, factures et journal.
- `Project` : identifiant stable, nom, nature, budget, période, dispositif, reprise, epics, story points et notes.
- `ExpenseSheet` : mois, lignes par projet/profil, jours, TJM et montant enregistrés, motif du non affecté.
- `Invoice` : instantané PO/projets/attendu, valeurs facturées, statut, révision et commentaires.
- `Audit` : acteur, action et horodatage local.

États de la facture : `draft → sent → validated` ou `sent → returned → draft`. Une reprise de ventilation annule la facture modifiable sans la supprimer. Les factures validées sont immuables dans ce POC.

## Périmètre technique et limites

Frontend statique HTML / CSS / JavaScript, sans dépendance. Sauvegarde `localStorage` versionnée. Les mutations métier et les sauvegardes sont transactionnelles au niveau applicatif : une action invalide ou un échec de stockage n’est pas présenté comme réussi.

Les personas simulent les droits. Aucun SSO, partage multiutilisateur, API Jira, envoi d’email, paiement ou connexion comptable. Le suivi nominatif des CRA de la version précédente est archivé ; le parcours courant valide d’abord le suivi financier manuel.

Exports : CSV projets, JSON technique, facture HTML imprimable. Pas d’import JSON dans l’interface actuelle. Le site public ne contient pas le classeur source, le snapshot Excel ni la transcription. Les saisies restent dans le navigateur de la personne qui les effectue.

La cible ultérieure est un stockage partagé avec authentification, droits serveur, audit durable, récupération Jira et rapprochement de vrais justificatifs. Une intégration ne doit pas supprimer le non affecté ni convertir implicitement des story points en euros.

## Critères d’acceptation

- Laurent et Jennifer peuvent créer et initialiser un cockpit sans intervention de Lassaad.
- La répartition incomplète du budget ou des dates absentes bloque l’activation, pas l’enregistrement d’un brouillon.
- Les dispositifs et les dates sont visibles dans les lignes de projets et modifiables dans le formulaire.
- Les jours se saisissent par pas de 0,5 et dans la période du projet.
- Les coûts non affectés restent visibles et bloquent l’envoi de la facture.
- Lassaad peut éditer jours et TJM facturés et visualiser l’écart signé.
- Laurent peut retourner ou valider, avec justification si nécessaire ; Jennifer n’a pas l’onglet des factures reçues.
- Le consommé ne compte chaque facture validée qu’une seule fois.
- La prévision s’arrête aux dates de fin et conserve une estimation pour les mois non renseignés.
- Le jeu de démonstration est identifié comme hypothèse ; aucune date précise n’est attribuée à tort à la transcription.
