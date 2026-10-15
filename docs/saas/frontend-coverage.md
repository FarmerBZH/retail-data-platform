# Couverture de l’explorateur publié

Le [manifeste exécutable](../../frontend/test/coverage-manifest.ts) associe chaque
ressource, champ et chemin imbriqué à `PublishedDetail / PublishedValue` et au
scénario synthétique correspondant dans
[published-data.test.tsx](../../frontend/src/published-data.test.tsx).
Il contient 426 champs de premier niveau et 74 chemins enfants, sans doublons.

La [projection frontend](../../frontend/src/published-contract.ts) reprend uniquement
les projections publiques du [registre](../../src/retail_data_platform/api/resources.json)
et des [modèles imbriqués](../../src/retail_data_platform/api/resources.py).
Le test compare les champs au registre et les enfants aux projections de leurs
ressources sources. Il vérifie récursivement que chaque valeur synthétique est
rendue sous son champ, sans coercition des décimaux ni interprétation HTML.
Toute évolution du contrat nécessite de réconcilier ces ensembles et la
[matrice cible](data-coverage.md), puis d’adapter la projection et ses tests.

Les collections métier présentes dans le catalogue authentifié sont accessibles
par Données et pagination manuelle. Les fiches relisent la clé complète et rendent
les champs autorisés ; les objets et toutes les valeurs de listes sont consultables.
Les listes vides, null, zéro et texte vide ont des représentations distinctes.
Le transport borne les réponses à 2 MB. Les grandes listes conservent tous leurs
éléments et se consultent par pages locales de 50, sans requêtes par élément.
Les limites varchar publiées et la validation des valeurs exactes restent appliquées.
Le détail du référentiel magasin réutilise le même composant. Les collections
supplémentaires ne reçoivent un filtre magasin fixe que si le catalogue l’autorise.
Le retour depuis Données préserve la sélection et les mois du magasin en mémoire
de session, sans garder son écran de données monté.

T18 rend `import_runs` et `analytics_refresh_runs` consultables dans Qualité
uniquement selon le catalogue authentifié. Le manifeste associe désormais ces
champs à cet accès OPS ; l’explorateur Données ne les propose ni ne les appelle.
La présence d’une valeur dans le détail natif ne signifie pas que toutes les
analyses métier ou tous les écrans P0 sont livrés. Les graphiques, indicateurs,
filiations et limites de couverture restent soumis à leurs tâches respectives.

Les tests navigateur complètent le rendu exhaustif par des parcours synthétiques :
produit sans vente en deuxième page, règle inutilisée, observation non rapprochée,
clé composite, liste multiple sans requêtes automatiques, accès refusé, HTML inerte,
grande liste de 10 001 éléments, contexte magasin fixe et navigation conservée,
clavier, axe, zoom et absence de stockage. Ces vérifications locales ne remplacent
ni une recette d’identité réelle ni l’exécution de la CI hébergée.

T14 complète la consultation native de `analytics_register_product_month` avec
le tableau et les graphiques de `ProductSales`. Son détail utilise toujours
`PublishedDetail`, puis ouvre explicitement `register_observations` et `products`
selon le catalogue. Les scénarios de
[ProductSales.test.tsx](../../frontend/src/ProductSales.test.tsx) et
[product-sales.spec.ts](../../frontend/e2e/product-sales.spec.ts) vérifient les
GTIN non rapprochés distincts, retours, mois absents, ambiguïtés, lectures
incomplètes et disparition du produit vivant, sans appels automatiques par ID.

T15 ajoute les courbes séparées et dénominateurs de `Presence` pour
`analytics_store_category_month`. Les collections produit de présence et linéaire
se lisent explicitement par catégorie, avec leurs champs et identifiants dans
`PublishedDetail`. Les tests [Presence.test.tsx](../../frontend/src/Presence.test.tsx),
[presence-data.test.ts](../../frontend/src/presence-data.test.ts) et
[presence.spec.ts](../../frontend/e2e/presence.spec.ts) couvrent absence inférée,
ambiguïtés, catégories inconnues, mois absents, dénominateur nul, ratios supérieurs
à 100 %, lectures incomplètes et absence d'appels automatiques par identifiant.
Aucune moyenne de ratios ni comparaison d'unités de linéaire inconnues n'est créée.

T16 ajoute les trois séries distinctes de `Activity` pour `analytics_activity_month`,
alignées sur un contexte ventes lu indépendamment. `PublishedDetail` conserve chaque
champ et identifiant ; les observations `store_activity_metrics` s’ouvrent une par
une, à la demande. Les tests [Activity.test.tsx](../../frontend/src/Activity.test.tsx),
[activity-data.test.ts](../../frontend/src/activity-data.test.ts) et
[activity.spec.ts](../../frontend/e2e/activity.spec.ts) couvrent types/mois absents,
zéro, ambiguïtés, preuves multiples, changement de période, erreurs locales et
observations disparues ou incohérentes. Aucune somme intertypes ou causalité n’est
déduite de l’alignement temporel ; la planification reste séparée de l’observation.

T17 ajoute `Typologies` : tables mensuelles distinctes pour `analytics_typology_month`,
`analytics_assortment_candidates` et `analytics_retailer_assortment_month`.
Chaque ligne conserve ses champs et listes dans `PublishedDetail`. Les références
vivantes, y compris les règles d'un assortiment, s'ouvrent explicitement par ID.
Les scénarios synthétiques couvrent contradictions, mapping ambigu, règles multiples,
mois absents, contexte enseigne sans candidat, lots incomplets et annulation.

T18 utilise le lecteur partagé pour `analytics_monthly_link_quality`, au grain
réseau dataset/mois/statut sans filtre magasin. Les pages ne deviennent pas des
agrégats, et les nombres de lignes ne mesurent pas du CA perdu. Les audits conservent
leurs champs publics dans `PublishedDetail`, notamment les `source_run_ids`.
Les imports sources s’ouvrent explicitement avec contrôle renouvelé du catalogue,
de l’identité, de l’unicité et de la fraîcheur. Les tests
[Quality.test.tsx](../../frontend/src/Quality.test.tsx),
[SourceImports.test.tsx](../../frontend/src/SourceImports.test.tsx) et
[quality.spec.ts](../../frontend/e2e/quality.spec.ts) vérifient l’accès ordinaire/OPS,
la révocation, les refus locaux, les secondes pages, null/zéro, le changement de
lecteur, les champs privés exclus et l’absence de requêtes anticipées par ID.

T19 réconcilie les ensembles avec les modèles publics API réellement chargés,
leurs types sérialisés, nullabilité, clés, filtres et droits, sans connexion base.
[coverage-contract.test.ts](../../frontend/src/coverage-contract.test.ts) compare
ces modèles, le registre, la projection, le manifeste et la matrice cible.
[coverage-render.test.tsx](../../frontend/src/coverage-render.test.tsx) vérifie
chaque état admis (null, texte/liste vide, booléen), y compris les chemins enfants,
et prouve que retirer un champ affiché fait échouer le contrôle de rendu.
[coverage-journeys.test.tsx](../../frontend/src/coverage-journeys.test.tsx) ouvre
le détail natif de chaque collection, sous catalogue ordinaire ou OPS approprié.
Les tests des détails spécialisés vérifient chaque valeur sous son champ, pas
uniquement le nombre de libellés. La synthèse et les comparaisons conservent leurs
tests de calculs propres ; leurs champs supplémentaires restent dans le détail natif.

Le manifeste indique les destinations métier et le secours natif de chaque champ.
T23 ajoute le secours natif dans Données pour les quatre vues réseau publiées :
101 champs supplémentaires. R désigne leur destination métier cible, dont
l’écran dédié sera livré dans la seconde partie de T23.
Les autres destinations R et S (sélections, classements et cohortes) restent différées ;
leur présence dans la matrice cible n’est pas une preuve de livraison. Les audits
ont leur secours dans Qualité ; les autres collections dans Données. Cette
réconciliation ne garantit ni identité réelle, ni charge, ni réception du P0 complet.

T20 ajoute un parcours clavier de bout en bout par Tab/Entrée, sans focus imposé,
avec libellés longs, référentiel, détails natifs et retour à la connexion. Les tests
[accessibility.spec.ts](../../frontend/e2e/accessibility.spec.ts) contrôlent aussi
les rôles de chargement/erreur, la reprise au clavier, le texte agrandi et le mouvement
réduit. Les graphiques mensuels conservent leurs alternatives et leurs tests axe.
Le zoom CSS ou le texte agrandi ne prouvent pas le zoom navigateur réel. La recette
humaine du zoom 200 % et des annonces du lecteur d’écran reste requise ; voir le
[guide frontend](../../frontend/README.md#responsive-and-accessibility-qualification).
