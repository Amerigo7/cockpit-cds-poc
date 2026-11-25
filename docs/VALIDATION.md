# Validation — version manuelle 3

24 novembre 2026.

## Vérifications réalisées

`npm run check` valide la syntaxe des trois modules JavaScript de l’application.

`npm test` : **33 tests passent**, dont 19 pour le parcours manuel et 14 régressions de la version Excel archivée.

L’archive GitHub ne contient que les 19 tests de la version manuelle ; les 14 tests archivés restent dans le dépôt de travail.

Les nouveaux tests couvrent :

- Initialisation par Laurent et Jennifer, brouillon incomplet, dates obligatoires, répartition exacte du budget et valeurs numériques invalides.
- Forecast limité à six mois pour Max V2, absence de coût après la fin, prorata d’un mois partiel et dates calendaires invalides.
- Mois manquant conservé dans le plan ; confirmation explicite d’un mois sans coût.
- Reprise du consommé sans double comptage et traitement d’une facture future par rapport à l’arrêté.
- Ventilation par pas de 0,5 jour, limites des périodes, profils et projets connus.
- Conservation du non affecté, forecast global réconcilié et blocage de l’envoi.
- Édition de facture avec un écart de +6 000 €, explication fournisseur obligatoire et verrouillage après envoi.
- Validation réservée à Laurent, justification d’un écart, idempotence et absence de double imputation.
- Conservation des tarifs attendus historiques après modification du tarif futur.
- Retour motivé, correction, révision et nouvelle facture après reprise de ventilation tracée.
- Protection des projets et périodes avec historique et isolation des portefeuilles.
- Rendu des champs d’initialisation, des colonnes dispositif / dates et des droits de navigation.
- Montants aux centimes, échappement HTML des saisies et absence du snapshot Excel / des chemins privés dans le bundle public.

Le serveur local a répondu en HTTP avec la nouvelle entrée de l’application. Les vues et leurs contrôles ont été vérifiés par tests de rendu statique et revue de code.

## Limites de vérification

Le contrôle interactif du navigateur et la capture d’écran ne sont pas disponibles dans cet environnement. Aucune recette visuelle ou navigation complète par clic sur cette version n’est revendiquée. L’ouverture d’un aperçu dans Codex ne vaut pas inspection visuelle.

Le prototype utilise un stockage local et des profils simulés. Le document de facture est illustratif et non fiscal. Aucun envoi réel ou écriture comptable n’a été effectué. La présentation de la version Excel n’a pas été mise à jour dans cette évolution du site.
