# Couverture de l’explorateur publié

Le [manifeste exécutable](../../frontend/test/coverage-manifest.ts) associe chaque
ressource, champ et chemin imbriqué à `PublishedDetail / PublishedValue` et au
scénario synthétique correspondant dans
[published-data.test.tsx](../../frontend/src/published-data.test.tsx).
Il contient 325 champs de premier niveau et 74 chemins enfants, sans doublons.

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

`import_runs` et `analytics_refresh_runs` ont des tests de rendu synthétiques,
mais leur accès par un écran habilité reste **à faire en T20**. Le manifeste
les marque explicitement comme tels ; l’explorateur ne les propose ni ne les appelle.
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
