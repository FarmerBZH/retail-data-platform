# Matrice exhaustive des données publiées vers les écrans

Statut : contrat de couverture du frontend cible, pas inventaire de composants déjà livrés.
Référence : [registre API](../../src/retail_data_platform/api/resources.json) et
[projection des objets](../../src/retail_data_platform/api/resources.py).
Périmètre vérifié : **24 ressources** (13 tables et 11 vues analytiques),
**325 champs de premier niveau**. Une occurrence table/champ correspond à une ligne,
même si un nom existe dans plusieurs tables. Les chemins imbriqués sont listés séparément.

## Lecture de la matrice

Chaque champ doit être réellement consultable, au minimum dans la fiche de détail
indiquée ; une valeur chargée mais jamais affichable ne satisfait pas ce contrat.
Un panneau replié est acceptable. Le nom technique reste accessible dans le détail,
avec un libellé français dans l’interface. Les identifiants et valeurs sources ne
doivent pas être transformés en nombres, instructions ou nouveaux droits d’accès.

| Code écran | Destination cible |
| --- | --- |
| R | Vue réseau, synthèses calculées |
| S | Total de sélection / comparaison de magasins |
| M-SYN | Fiche magasin → Synthèse |
| M-VEN | Fiche magasin → Ventes et produits |
| M-PRE | Fiche magasin → Présence et linéaire |
| M-ACT | Fiche magasin → Activité |
| M-TYP | Fiche magasin → Typologies et assortiments |
| M-REF | Fiche magasin → Données détaillées → Référentiel |
| D-REF | Données → Référentiels → collection et fiche d’une ligne |
| D-OBS | Données → Observations → collection et fiche d’une ligne |
| Q | Qualité des données → Attribution réseau |
| OPS | Qualité des données → Opérations (accès supplémentaire requis) |

## Accès aux lignes et droits

Ajouter **Données** à la navigation pour que les produits sans ventes, assortiments
sans candidat magasin, règles inutilisées et observations non rapprochées restent
consultables. D-REF et D-OBS donnent accès à toutes les lignes publiées de leur
collection, par pagination. M-REF est également accessible depuis la liste Magasins.
Les ressources analytiques restent consultables par collection dans Données →
Analyses mensuelles, y compris une éventuelle ligne sans magasin dans les typologies.
Chaque ressource ci-dessous a ce secours de consultation au grain natif, sans agrégation.

Une fiche magasin ouvre D-OBS dans son contexte uniquement si le catalogue autorise
le filtre store_id. Les produits, règles et assortiments globaux s’ouvrent via leurs
identifiants liés, sans inventer de filtre magasin. Pour une ligne non rapprochée,
afficher le statut et les références sources ; ne pas créer un magasin artificiel.
Les listes restent utilisables sans recherche ou filtre non pris en charge par l’API.
Un mode serveur « non rapprochés uniquement » pour les observations nécessiterait
une extension : ne pas filtrer une seule page en prétendant filtrer toute la collection.

Toutes les ressources métier exigent data:read. Les deux ressources OPS exigent
également operations:read : entrée masquée et aucune requête sans habilitation.
Les autres champs de la base ne font pas partie du contrat public ; cette matrice
n’autorise aucune extension automatique des projections ni accès SQL depuis le web.
Les agrégations R/S suivent [metrics.md](metrics.md) et les dépendances de
[integration.md](integration.md). Un champ consultable n’est pas nécessairement
additif, filtrable ou adapté à un graphique.

## Ressources et champs de premier niveau

### `analytics_activity_month`

Collection : `GET /v1/data/analytics_activity_month`. Droits : `data:read`.

| Champ | Écran | Panneau | Présentation | Règle |
| --- | --- | --- | --- | --- |
| `store_id` | M-ACT | Activité mensuelle par type | Détail / lien de consultation | Identifiant visible ; ouvrir la fiche magasin à la demande si le lien est résolu. |
| `period` | M-ACT | Activité mensuelle par type | Colonne mois / axe temporel | Mois calendaire, premier jour ISO ; aucune conversion de fuseau. |
| `activity_type` | M-ACT | Activité mensuelle par type | Table et fiche de détail | Valeur publiée conservée ; null distinct de zéro. |
| `source_row_count` | M-ACT | Activité mensuelle par type | Colonne qualité / badge et valeur détaillée | Qualifier les mesures ; absence, ambiguïté et zéro restent distincts. |
| `ambiguous` | M-ACT | Activité mensuelle par type | Colonne qualité / badge et valeur détaillée | Qualifier les mesures ; absence, ambiguïté et zéro restent distincts. |
| `activity_count` | M-ACT | Activité mensuelle par type | Table, courbe au grain de la ressource et détail | Valeur publiée conservée ; null distinct de zéro. |
| `observation_ids` | M-ACT | Activité mensuelle par type | Liste dépliable d’identifiants | Conserver chaque élément ; lectures unitaires à la demande, sans requête automatique par élément. |

### `analytics_assortment_candidates`

Collection : `GET /v1/data/analytics_assortment_candidates`. Droits : `data:read`.

| Champ | Écran | Panneau | Présentation | Règle |
| --- | --- | --- | --- | --- |
| `store_id` | M-TYP | Candidats exacts | Détail / lien de consultation | Identifiant visible ; ouvrir la fiche magasin à la demande si le lien est résolu. |
| `period` | M-TYP | Candidats exacts | Colonne mois / axe temporel | Mois calendaire, premier jour ISO ; aucune conversion de fuseau. |
| `assortment_id` | M-TYP | Candidats exacts | Détail / lien de consultation | Identifiant visible ; ouvrir la fiche assortiment à la demande si le lien est résolu. |
| `product_id` | M-TYP | Candidats exacts | Détail / lien de consultation | Identifiant visible ; ouvrir la fiche produit à la demande si le lien est résolu. |
| `gtin` | M-TYP | Candidats exacts | Détail / identité | Conserver le code exact comme texte ; ne pas déduire un filtre API de sa présence. |
| `typology_rank_rule_id` | M-TYP | Candidats exacts | Détail / lien de consultation | Identifiant visible ; ouvrir la fiche règle de rang à la demande si le lien est résolu. |
| `typology_value_ids` | M-TYP | Candidats exacts | Liste dépliable d’identifiants | Conserver chaque élément ; lectures unitaires à la demande, sans requête automatique par élément. |

### `analytics_distribution_product_month`

Collection : `GET /v1/data/analytics_distribution_product_month`. Droits : `data:read`.

| Champ | Écran | Panneau | Présentation | Règle |
| --- | --- | --- | --- | --- |
| `store_id` | M-PRE | Présence par produit et catégorie | Détail / lien de consultation | Identifiant visible ; ouvrir la fiche magasin à la demande si le lien est résolu. |
| `period` | M-PRE | Présence par produit et catégorie | Colonne mois / axe temporel | Mois calendaire, premier jour ISO ; aucune conversion de fuseau. |
| `category_code` | M-PRE | Présence par produit et catégorie | Détail / identité | Conserver le code exact comme texte ; ne pas déduire un filtre API de sa présence. |
| `product_key` | M-PRE | Présence par produit et catégorie | Détail / identité | Conserver le code exact comme texte ; ne pas déduire un filtre API de sa présence. |
| `product_id` | M-PRE | Présence par produit et catégorie | Détail / lien de consultation | Identifiant visible ; ouvrir la fiche produit à la demande si le lien est résolu. |
| `source_row_count` | M-PRE | Présence par produit et catégorie | Colonne qualité / badge et valeur détaillée | Qualifier les mesures ; absence, ambiguïté et zéro restent distincts. |
| `ambiguous` | M-PRE | Présence par produit et catégorie | Colonne qualité / badge et valeur détaillée | Qualifier les mesures ; absence, ambiguïté et zéro restent distincts. |
| `presence_value` | M-PRE | Présence par produit et catégorie | Table, courbe au grain de la ressource et détail | Valeur publiée conservée ; null distinct de zéro. |
| `inferred_absence_rows` | M-PRE | Présence par produit et catégorie | Colonne qualité / badge et valeur détaillée | Qualifier les mesures ; absence, ambiguïté et zéro restent distincts. |
| `observation_ids` | M-PRE | Présence par produit et catégorie | Liste dépliable d’identifiants | Conserver chaque élément ; lectures unitaires à la demande, sans requête automatique par élément. |

### `analytics_monthly_link_quality`

Collection : `GET /v1/data/analytics_monthly_link_quality`. Droits : `data:read`.

| Champ | Écran | Panneau | Présentation | Règle |
| --- | --- | --- | --- | --- |
| `dataset` | Q | Attribution réseau par dataset, mois et statut | Table et fiche de détail | Valeur publiée conservée ; null distinct de zéro. |
| `period` | Q | Attribution réseau par dataset, mois et statut | Colonne mois / axe temporel | Mois calendaire, premier jour ISO ; aucune conversion de fuseau. |
| `store_match_status` | Q | Attribution réseau par dataset, mois et statut | Colonne qualité / badge et valeur détaillée | Qualifier les mesures ; absence, ambiguïté et zéro restent distincts. |
| `source_row_count` | Q | Attribution réseau par dataset, mois et statut | Colonne qualité / badge et valeur détaillée | Qualifier les mesures ; absence, ambiguïté et zéro restent distincts. |

### `analytics_refresh_runs`

Collection : `GET /v1/data/analytics_refresh_runs`. Droits : `data:read + operations:read`.

| Champ | Écran | Panneau | Présentation | Règle |
| --- | --- | --- | --- | --- |
| `id` | OPS | Historique des publications analytiques | Détail / identité | Conserver le code exact comme texte ; ne pas déduire un filtre API de sa présence. |
| `status` | OPS | Historique des publications analytiques | Table et fiche de détail | Valeur publiée conservée ; null distinct de zéro. |
| `started_at` | OPS | Historique des publications analytiques | Horodatage détaillé | Date technique ; ne prouve pas la période métier ou sa couverture. |
| `source_snapshot_at` | OPS | Historique des publications analytiques | Horodatage détaillé | Date technique ; ne prouve pas la période métier ou sa couverture. |
| `completed_at` | OPS | Historique des publications analytiques | Horodatage détaillé | Date technique ; ne prouve pas la période métier ou sa couverture. |
| `source_run_ids` | OPS | Historique des publications analytiques | Liste dépliable d’identifiants | Liens vers import_runs à la demande, uniquement avec operations:read ; aucune filiation ligne/import déduite. |

### `analytics_register_product_month`

Collection : `GET /v1/data/analytics_register_product_month`. Droits : `data:read`.

| Champ | Écran | Panneau | Présentation | Règle |
| --- | --- | --- | --- | --- |
| `store_id` | M-VEN | Ventes par GTIN et mois | Détail / lien de consultation | Identifiant visible ; ouvrir la fiche magasin à la demande si le lien est résolu. |
| `period` | M-VEN | Ventes par GTIN et mois | Colonne mois / axe temporel | Mois calendaire, premier jour ISO ; aucune conversion de fuseau. |
| `source_gtin` | M-VEN | Ventes par GTIN et mois | Détail / identité | Conserver le code exact comme texte ; ne pas déduire un filtre API de sa présence. |
| `product_id` | M-VEN | Ventes par GTIN et mois | Détail / lien de consultation | Identifiant visible ; ouvrir la fiche produit à la demande si le lien est résolu. |
| `source_row_count` | M-VEN | Ventes par GTIN et mois | Colonne qualité / badge et valeur détaillée | Qualifier les mesures ; absence, ambiguïté et zéro restent distincts. |
| `ambiguous` | M-VEN | Ventes par GTIN et mois | Colonne qualité / badge et valeur détaillée | Qualifier les mesures ; absence, ambiguïté et zéro restent distincts. |
| `unmatched_product_rows` | M-VEN | Ventes par GTIN et mois | Colonne qualité / badge et valeur détaillée | Qualifier les mesures ; absence, ambiguïté et zéro restent distincts. |
| `observation_ids` | M-VEN | Ventes par GTIN et mois | Liste dépliable d’identifiants | Conserver chaque élément ; lectures unitaires à la demande, sans requête automatique par élément. |
| `source_kinds` | M-VEN | Ventes par GTIN et mois | Table et fiche de détail | Valeur publiée conservée ; null distinct de zéro. |
| `revenue` | M-VEN | Ventes par GTIN et mois | Table, courbe au grain de la ressource et détail | Valeur publiée conservée ; null distinct de zéro. |
| `units` | M-VEN | Ventes par GTIN et mois | Table, courbe au grain de la ressource et détail | Valeur publiée conservée ; null distinct de zéro. |
| `volume` | M-VEN | Ventes par GTIN et mois | Table et fiche de détail | Grain produit uniquement ; unité physique non présumée comparable entre produits. |
| `revenue_reported_rows` | M-VEN | Ventes par GTIN et mois | Colonne qualité / badge et valeur détaillée | Qualifier les mesures ; absence, ambiguïté et zéro restent distincts. |
| `units_reported_rows` | M-VEN | Ventes par GTIN et mois | Colonne qualité / badge et valeur détaillée | Qualifier les mesures ; absence, ambiguïté et zéro restent distincts. |

### `analytics_retailer_assortment_month`

Collection : `GET /v1/data/analytics_retailer_assortment_month`. Droits : `data:read`.

| Champ | Écran | Panneau | Présentation | Règle |
| --- | --- | --- | --- | --- |
| `store_id` | M-TYP | Contexte assortiment enseigne | Détail / lien de consultation | Identifiant visible ; ouvrir la fiche magasin à la demande si le lien est résolu. |
| `period` | M-TYP | Contexte assortiment enseigne | Colonne mois / axe temporel | Mois calendaire, premier jour ISO ; aucune conversion de fuseau. |
| `assortment_id` | M-TYP | Contexte assortiment enseigne | Détail / lien de consultation | Identifiant visible ; ouvrir la fiche assortiment à la demande si le lien est résolu. |
| `product_id` | M-TYP | Contexte assortiment enseigne | Détail / lien de consultation | Identifiant visible ; ouvrir la fiche produit à la demande si le lien est résolu. |
| `gtin` | M-TYP | Contexte assortiment enseigne | Détail / identité | Conserver le code exact comme texte ; ne pas déduire un filtre API de sa présence. |
| `product_match_status` | M-TYP | Contexte assortiment enseigne | Colonne qualité / badge et valeur détaillée | Qualifier les mesures ; absence, ambiguïté et zéro restent distincts. |
| `typology_match_status` | M-TYP | Contexte assortiment enseigne | Colonne qualité / badge et valeur détaillée | Qualifier les mesures ; absence, ambiguïté et zéro restent distincts. |

### `analytics_shelf_category_month`

Collection : `GET /v1/data/analytics_shelf_category_month`. Droits : `data:read`.

| Champ | Écran | Panneau | Présentation | Règle |
| --- | --- | --- | --- | --- |
| `store_id` | M-PRE | Linéaire par catégorie et mois | Détail / lien de consultation | Identifiant visible ; ouvrir la fiche magasin à la demande si le lien est résolu. |
| `period` | M-PRE | Linéaire par catégorie et mois | Colonne mois / axe temporel | Mois calendaire, premier jour ISO ; aucune conversion de fuseau. |
| `category_code` | M-PRE | Linéaire par catégorie et mois | Détail / identité | Conserver le code exact comme texte ; ne pas déduire un filtre API de sa présence. |
| `source_row_count` | M-PRE | Linéaire par catégorie et mois | Colonne qualité / badge et valeur détaillée | Qualifier les mesures ; absence, ambiguïté et zéro restent distincts. |
| `ambiguous` | M-PRE | Linéaire par catégorie et mois | Colonne qualité / badge et valeur détaillée | Qualifier les mesures ; absence, ambiguïté et zéro restent distincts. |
| `company_value` | M-PRE | Linéaire par catégorie et mois | Table, courbe au grain de la ressource et détail | Valeur publiée conservée ; null distinct de zéro. |
| `total_value` | M-PRE | Linéaire par catégorie et mois | Table, courbe au grain de la ressource et détail | Valeur publiée conservée ; null distinct de zéro. |
| `shelf_share` | M-PRE | Linéaire par catégorie et mois | Table, courbe au grain de la ressource et détail | Valeur publiée conservée ; null distinct de zéro. |
| `observation_ids` | M-PRE | Linéaire par catégorie et mois | Liste dépliable d’identifiants | Conserver chaque élément ; lectures unitaires à la demande, sans requête automatique par élément. |

### `analytics_store_category_month`

Collection : `GET /v1/data/analytics_store_category_month`. Droits : `data:read`.

| Champ | Écran | Panneau | Présentation | Règle |
| --- | --- | --- | --- | --- |
| `store_id` | M-PRE | Synthèse catégorie mensuelle | Détail / lien de consultation | Identifiant visible ; ouvrir la fiche magasin à la demande si le lien est résolu. |
| `period` | M-PRE | Synthèse catégorie mensuelle | Colonne mois / axe temporel | Mois calendaire, premier jour ISO ; aucune conversion de fuseau. |
| `category_code` | M-PRE | Synthèse catégorie mensuelle | Détail / identité | Conserver le code exact comme texte ; ne pas déduire un filtre API de sa présence. |
| `distribution_product_count` | M-PRE | Synthèse catégorie mensuelle | Colonne qualité / badge et valeur détaillée | Qualifier les mesures ; absence, ambiguïté et zéro restent distincts. |
| `distribution_ambiguous_products` | M-PRE | Synthèse catégorie mensuelle | Colonne qualité / badge et valeur détaillée | Qualifier les mesures ; absence, ambiguïté et zéro restent distincts. |
| `distribution_unmatched_products` | M-PRE | Synthèse catégorie mensuelle | Colonne qualité / badge et valeur détaillée | Qualifier les mesures ; absence, ambiguïté et zéro restent distincts. |
| `inferred_absence_rows` | M-PRE | Synthèse catégorie mensuelle | Colonne qualité / badge et valeur détaillée | Qualifier les mesures ; absence, ambiguïté et zéro restent distincts. |
| `present_products` | M-PRE | Synthèse catégorie mensuelle | Table, courbe au grain de la ressource et détail | Valeur publiée conservée ; null distinct de zéro. |
| `observed_presence_rate` | M-PRE | Synthèse catégorie mensuelle | Table, courbe au grain de la ressource et détail | Valeur publiée conservée ; null distinct de zéro. |
| `shelf_source_row_count` | M-PRE | Synthèse catégorie mensuelle | Colonne qualité / badge et valeur détaillée | Qualifier les mesures ; absence, ambiguïté et zéro restent distincts. |
| `shelf_ambiguous` | M-PRE | Synthèse catégorie mensuelle | Colonne qualité / badge et valeur détaillée | Qualifier les mesures ; absence, ambiguïté et zéro restent distincts. |
| `shelf_company_value` | M-PRE | Synthèse catégorie mensuelle | Table et fiche de détail | Valeur publiée conservée ; null distinct de zéro. |
| `shelf_total_value` | M-PRE | Synthèse catégorie mensuelle | Table et fiche de détail | Valeur publiée conservée ; null distinct de zéro. |
| `shelf_share` | M-PRE | Synthèse catégorie mensuelle | Table, courbe au grain de la ressource et détail | Valeur publiée conservée ; null distinct de zéro. |
| `exact_assortment_candidate_count` | M-PRE | Synthèse catégorie mensuelle | Table et fiche de détail | Valeur publiée conservée ; null distinct de zéro. |

### `analytics_store_month`

Collection : `GET /v1/data/analytics_store_month`. Droits : `data:read`.

| Champ | Écran | Panneau | Présentation | Règle |
| --- | --- | --- | --- | --- |
| `store_id` | M-SYN | Synthèse mensuelle | Détail / lien de consultation | Identifiant visible ; ouvrir la fiche magasin à la demande si le lien est résolu. |
| `period` | M-SYN | Synthèse mensuelle | Colonne mois / axe temporel | Mois calendaire, premier jour ISO ; aucune conversion de fuseau. |
| `current_store_name` | M-SYN | Synthèse mensuelle | En-tête au refresh et détail | Attribut actuel au dernier refresh, peut différer du référentiel vivant. |
| `current_retailer_name` | M-SYN | Synthèse mensuelle | En-tête au refresh et détail | Attribut actuel au dernier refresh, peut différer du référentiel vivant. |
| `current_store_format` | M-SYN | Synthèse mensuelle | En-tête au refresh et détail | Attribut actuel au dernier refresh, peut différer du référentiel vivant. |
| `current_region_code` | M-SYN | Synthèse mensuelle | En-tête au refresh et détail | Attribut actuel au dernier refresh, peut différer du référentiel vivant. |
| `current_is_active` | M-SYN | Synthèse mensuelle | En-tête au refresh et détail | Attribut actuel au dernier refresh, peut différer du référentiel vivant. |
| `current_store` | M-REF | Objet au refresh / détail mensuel | Objet ou liste dépliable | Champs enfants explicités dans la section des objets imbriqués ; aucune somme avec les collections équivalentes. |
| `register_product_count` | M-SYN | Synthèse mensuelle | Colonne qualité / badge et valeur détaillée | Qualifier les mesures ; absence, ambiguïté et zéro restent distincts. |
| `register_source_row_count` | M-SYN | Synthèse mensuelle | Colonne qualité / badge et valeur détaillée | Qualifier les mesures ; absence, ambiguïté et zéro restent distincts. |
| `register_ambiguous_products` | M-SYN | Synthèse mensuelle | Colonne qualité / badge et valeur détaillée | Qualifier les mesures ; absence, ambiguïté et zéro restent distincts. |
| `register_unmatched_product_rows` | M-SYN | Synthèse mensuelle | Colonne qualité / badge et valeur détaillée | Qualifier les mesures ; absence, ambiguïté et zéro restent distincts. |
| `register_revenue_product_count` | M-SYN | Synthèse mensuelle | Colonne qualité / badge et valeur détaillée | Qualifier les mesures ; absence, ambiguïté et zéro restent distincts. |
| `register_units_product_count` | M-SYN | Synthèse mensuelle | Colonne qualité / badge et valeur détaillée | Qualifier les mesures ; absence, ambiguïté et zéro restent distincts. |
| `revenue` | M-SYN + R + S | Synthèse mensuelle | Carte, courbe et table mensuelle | R/S : calculs qualifiés selon metrics.md, dépendants du contrat d’agrégation cible. |
| `units` | M-SYN + R + S | Synthèse mensuelle | Carte, courbe et table mensuelle | R/S : calculs qualifiés selon metrics.md, dépendants du contrat d’agrégation cible. |
| `revenue_per_unit` | M-SYN + R + S | Synthèse mensuelle | Carte, courbe et table mensuelle | R/S : calculs qualifiés selon metrics.md, dépendants du contrat d’agrégation cible. |
| `unambiguous_reported_revenue` | M-SYN | Diagnostic ventes partielles | Colonne qualité / badge et valeur détaillée | Somme partielle distincte ; ne remplace pas le CA ou les unités de synthèse. |
| `unambiguous_reported_units` | M-SYN | Diagnostic ventes partielles | Colonne qualité / badge et valeur détaillée | Somme partielle distincte ; ne remplace pas le CA ou les unités de synthèse. |
| `calls` | M-ACT | Synthèse mensuelle | Table et fiche de détail | Type d’activité distinct ; ne pas additionner les trois types. |
| `field_visits` | M-ACT | Synthèse mensuelle | Table et fiche de détail | Type d’activité distinct ; ne pas additionner les trois types. |
| `crowdsourced_visits` | M-ACT | Synthèse mensuelle | Table et fiche de détail | Type d’activité distinct ; ne pas additionner les trois types. |
| `activity_ambiguous_types` | M-ACT | Synthèse mensuelle | Colonne qualité / badge et valeur détaillée | Type d’activité distinct ; ne pas additionner les trois types. |
| `activity_details` | M-ACT | Objet au refresh / détail mensuel | Objet ou liste dépliable | Champs enfants explicités dans la section des objets imbriqués ; aucune somme avec les collections équivalentes. |
| `category_details` | M-PRE | Objet au refresh / détail mensuel | Objet ou liste dépliable | Champs enfants explicités dans la section des objets imbriqués ; aucune somme avec les collections équivalentes. |
| `typology_details` | M-TYP | Objet au refresh / détail mensuel | Objet ou liste dépliable | Champs enfants explicités dans la section des objets imbriqués ; aucune somme avec les collections équivalentes. |
| `typology_snapshot_count` | M-SYN | Synthèse mensuelle | Table et fiche de détail | Valeur publiée conservée ; null distinct de zéro. |
| `typology_snapshot_ids` | M-SYN | Synthèse mensuelle | Liste dépliable d’identifiants | Conserver chaque élément ; lectures unitaires à la demande, sans requête automatique par élément. |
| `has_register` | M-SYN | Synthèse mensuelle | Colonne qualité / badge et valeur détaillée | Qualifier les mesures ; absence, ambiguïté et zéro restent distincts. |
| `has_activity` | M-SYN | Synthèse mensuelle | Colonne qualité / badge et valeur détaillée | Qualifier les mesures ; absence, ambiguïté et zéro restent distincts. |
| `has_category_data` | M-SYN | Synthèse mensuelle | Colonne qualité / badge et valeur détaillée | Qualifier les mesures ; absence, ambiguïté et zéro restent distincts. |
| `has_typology` | M-SYN | Synthèse mensuelle | Colonne qualité / badge et valeur détaillée | Qualifier les mesures ; absence, ambiguïté et zéro restent distincts. |

### `analytics_store_month_changes`

Collection : `GET /v1/data/analytics_store_month_changes`. Droits : `data:read`.

| Champ | Écran | Panneau | Présentation | Règle |
| --- | --- | --- | --- | --- |
| `store_id` | M-SYN | Comparaisons calendaires | Détail / lien de consultation | Comparaison calendaire magasin ; ne pas agréger les ratios sur le réseau. |
| `period` | M-SYN | Comparaisons calendaires | Colonne mois / axe temporel | Comparaison calendaire magasin ; ne pas agréger les ratios sur le réseau. |
| `revenue` | M-SYN | Comparaisons calendaires | Table et fiche de détail | Comparaison calendaire magasin ; ne pas agréger les ratios sur le réseau. |
| `units` | M-SYN | Comparaisons calendaires | Table et fiche de détail | Comparaison calendaire magasin ; ne pas agréger les ratios sur le réseau. |
| `calls` | M-SYN | Comparaisons calendaires | Table et fiche de détail | Comparaison calendaire magasin ; ne pas agréger les ratios sur le réseau. |
| `field_visits` | M-SYN | Comparaisons calendaires | Table et fiche de détail | Comparaison calendaire magasin ; ne pas agréger les ratios sur le réseau. |
| `crowdsourced_visits` | M-SYN | Comparaisons calendaires | Table et fiche de détail | Comparaison calendaire magasin ; ne pas agréger les ratios sur le réseau. |
| `revenue_previous_month` | M-SYN | Comparaisons calendaires | Table et fiche de détail | Comparaison calendaire magasin ; ne pas agréger les ratios sur le réseau. |
| `revenue_previous_year` | M-SYN | Comparaisons calendaires | Table et fiche de détail | Comparaison calendaire magasin ; ne pas agréger les ratios sur le réseau. |
| `units_previous_month` | M-SYN | Comparaisons calendaires | Table et fiche de détail | Comparaison calendaire magasin ; ne pas agréger les ratios sur le réseau. |
| `calls_previous_month` | M-SYN | Comparaisons calendaires | Table et fiche de détail | Comparaison calendaire magasin ; ne pas agréger les ratios sur le réseau. |
| `field_visits_previous_month` | M-SYN | Comparaisons calendaires | Table et fiche de détail | Comparaison calendaire magasin ; ne pas agréger les ratios sur le réseau. |
| `crowdsourced_visits_previous_month` | M-SYN | Comparaisons calendaires | Table et fiche de détail | Comparaison calendaire magasin ; ne pas agréger les ratios sur le réseau. |
| `revenue_month_change` | M-SYN | Comparaisons calendaires | Table et fiche de détail | Comparaison calendaire magasin ; ne pas agréger les ratios sur le réseau. |
| `revenue_month_change_ratio` | M-SYN | Comparaisons calendaires | Table et fiche de détail | Comparaison calendaire magasin ; ne pas agréger les ratios sur le réseau. |
| `revenue_year_change_ratio` | M-SYN | Comparaisons calendaires | Table et fiche de détail | Comparaison calendaire magasin ; ne pas agréger les ratios sur le réseau. |

### `analytics_typology_month`

Collection : `GET /v1/data/analytics_typology_month`. Droits : `data:read`.

| Champ | Écran | Panneau | Présentation | Règle |
| --- | --- | --- | --- | --- |
| `store_id` | M-TYP | Typologies mensuelles et rapprochement | Détail / lien de consultation | Identifiant visible ; ouvrir la fiche magasin à la demande si le lien est résolu. |
| `period` | M-TYP | Typologies mensuelles et rapprochement | Colonne mois / axe temporel | Mois calendaire, premier jour ISO ; aucune conversion de fuseau. |
| `typology_value_id` | M-TYP | Typologies mensuelles et rapprochement | Détail / lien de consultation | Identifiant visible ; ouvrir la fiche valeur de typologie à la demande si le lien est résolu. |
| `snapshot_id` | M-TYP | Typologies mensuelles et rapprochement | Détail / lien de consultation | Identifiant visible ; ouvrir la fiche instantané de typologie à la demande si le lien est résolu. |
| `retailer_name` | M-TYP | Typologies mensuelles et rapprochement | Table et fiche de détail | Valeur publiée conservée ; null distinct de zéro. |
| `region_code` | M-TYP | Typologies mensuelles et rapprochement | Détail / identité | Conserver le code exact comme texte ; ne pas déduire un filtre API de sa présence. |
| `sales_representative_code` | M-TYP | Typologies mensuelles et rapprochement | Détail / identité | Conserver le code exact comme texte ; ne pas déduire un filtre API de sa présence. |
| `category_key` | M-TYP | Typologies mensuelles et rapprochement | Table et fiche de détail | Valeur publiée conservée ; null distinct de zéro. |
| `category_name` | M-TYP | Typologies mensuelles et rapprochement | Table et fiche de détail | Valeur publiée conservée ; null distinct de zéro. |
| `typology_value` | M-TYP | Typologies mensuelles et rapprochement | Table et fiche de détail | Valeur publiée conservée ; null distinct de zéro. |
| `rank_rule_ids` | M-TYP | Typologies mensuelles et rapprochement | Liste dépliable d’identifiants | Conserver chaque élément ; lectures unitaires à la demande, sans requête automatique par élément. |
| `rank_candidate_count` | M-TYP | Typologies mensuelles et rapprochement | Table et fiche de détail | Valeur publiée conservée ; null distinct de zéro. |
| `mapping_issue` | M-TYP | Typologies mensuelles et rapprochement | Colonne qualité / badge et valeur détaillée | Qualifier les mesures ; absence, ambiguïté et zéro restent distincts. |

### `assortments`

Collection : `GET /v1/data/assortments`. Droits : `data:read`.

| Champ | Écran | Panneau | Présentation | Règle |
| --- | --- | --- | --- | --- |
| `id` | D-REF | Assortiments sources | Détail / identité | Conserver le code exact comme texte ; ne pas déduire un filtre API de sa présence. |
| `source_key` | D-REF | Assortiments sources | Détail / identité | Conserver le code exact comme texte ; ne pas déduire un filtre API de sa présence. |
| `period` | D-REF | Assortiments sources | Colonne mois / axe temporel | Mois calendaire, premier jour ISO ; aucune conversion de fuseau. |
| `product_id` | D-REF | Assortiments sources | Détail / lien de consultation | Identifiant visible ; ouvrir la fiche produit à la demande si le lien est résolu. |
| `product_match_status` | D-REF | Assortiments sources | Colonne qualité / badge et valeur détaillée | Qualifier les mesures ; absence, ambiguïté et zéro restent distincts. |
| `typology_mapping_rule_id` | D-REF | Assortiments sources | Détail / lien de consultation | Identifiant visible ; ouvrir la fiche règle de correspondance à la demande si le lien est résolu. |
| `typology_rank_rule_id` | D-REF | Assortiments sources | Détail / lien de consultation | Identifiant visible ; ouvrir la fiche règle de rang à la demande si le lien est résolu. |
| `typology_match_status` | D-REF | Assortiments sources | Colonne qualité / badge et valeur détaillée | Qualifier les mesures ; absence, ambiguïté et zéro restent distincts. |
| `typology_match_method` | D-REF | Assortiments sources | Colonne qualité / badge et valeur détaillée | Qualifier les mesures ; absence, ambiguïté et zéro restent distincts. |
| `source_retailer_name` | D-REF | Assortiments sources | Table et fiche de détail | Valeur publiée conservée ; null distinct de zéro. |
| `source_category_name` | D-REF | Assortiments sources | Table et fiche de détail | Valeur publiée conservée ; null distinct de zéro. |
| `source_product_name` | D-REF | Assortiments sources | Table et fiche de détail | Valeur publiée conservée ; null distinct de zéro. |
| `gtin` | D-REF | Assortiments sources | Détail / identité | Conserver le code exact comme texte ; ne pas déduire un filtre API de sa présence. |
| `source_typology_value` | D-REF | Assortiments sources | Table et fiche de détail | Valeur publiée conservée ; null distinct de zéro. |

### `import_runs`

Collection : `GET /v1/data/import_runs`. Droits : `data:read + operations:read`.

| Champ | Écran | Panneau | Présentation | Règle |
| --- | --- | --- | --- | --- |
| `id` | OPS | Historique des imports | Détail / identité | Conserver le code exact comme texte ; ne pas déduire un filtre API de sa présence. |
| `dataset` | OPS | Historique des imports | Table et fiche de détail | Valeur publiée conservée ; null distinct de zéro. |
| `status` | OPS | Historique des imports | Table et fiche de détail | Valeur publiée conservée ; null distinct de zéro. |
| `rows_read` | OPS | Historique des imports | Table et fiche de détail | Valeur publiée conservée ; null distinct de zéro. |
| `rows_inserted` | OPS | Historique des imports | Table et fiche de détail | Valeur publiée conservée ; null distinct de zéro. |
| `rows_rejected` | OPS | Historique des imports | Table et fiche de détail | Valeur publiée conservée ; null distinct de zéro. |
| `started_at` | OPS | Historique des imports | Horodatage détaillé | Date technique ; ne prouve pas la période métier ou sa couverture. |
| `completed_at` | OPS | Historique des imports | Horodatage détaillé | Date technique ; ne prouve pas la période métier ou sa couverture. |

### `numeric_distribution_observations`

Collection : `GET /v1/data/numeric_distribution_observations`. Droits : `data:read`.

| Champ | Écran | Panneau | Présentation | Règle |
| --- | --- | --- | --- | --- |
| `id` | D-OBS | Observations de présence | Détail / identité | Conserver le code exact comme texte ; ne pas déduire un filtre API de sa présence. |
| `source_key` | D-OBS | Observations de présence | Détail / identité | Conserver le code exact comme texte ; ne pas déduire un filtre API de sa présence. |
| `period` | D-OBS | Observations de présence | Colonne mois / axe temporel | Mois calendaire, premier jour ISO ; aucune conversion de fuseau. |
| `category_code` | D-OBS | Observations de présence | Détail / identité | Conserver le code exact comme texte ; ne pas déduire un filtre API de sa présence. |
| `store_id` | D-OBS | Observations de présence | Détail / lien de consultation | Identifiant visible ; ouvrir la fiche magasin à la demande si le lien est résolu. |
| `store_match_status` | D-OBS | Observations de présence | Colonne qualité / badge et valeur détaillée | Qualifier les mesures ; absence, ambiguïté et zéro restent distincts. |
| `store_match_method` | D-OBS | Observations de présence | Colonne qualité / badge et valeur détaillée | Qualifier les mesures ; absence, ambiguïté et zéro restent distincts. |
| `product_id` | D-OBS | Observations de présence | Détail / lien de consultation | Identifiant visible ; ouvrir la fiche produit à la demande si le lien est résolu. |
| `product_match_status` | D-OBS | Observations de présence | Colonne qualité / badge et valeur détaillée | Qualifier les mesures ; absence, ambiguïté et zéro restent distincts. |
| `product_match_method` | D-OBS | Observations de présence | Colonne qualité / badge et valeur détaillée | Qualifier les mesures ; absence, ambiguïté et zéro restent distincts. |
| `presence_value` | D-OBS | Observations de présence | Table, courbe au grain de la ressource et détail | Valeur publiée conservée ; null distinct de zéro. |
| `value_origin` | D-OBS | Observations de présence | Table et fiche de détail | Valeur publiée conservée ; null distinct de zéro. |
| `source_category_name` | D-OBS | Observations de présence | Table et fiche de détail | Valeur publiée conservée ; null distinct de zéro. |
| `source_store_reference` | D-OBS | Observations de présence | Détail / identité | Conserver le code exact comme texte ; ne pas déduire un filtre API de sa présence. |
| `source_store_label` | D-OBS | Observations de présence | Table et fiche de détail | Valeur publiée conservée ; null distinct de zéro. |
| `source_product_reference` | D-OBS | Observations de présence | Détail / identité | Conserver le code exact comme texte ; ne pas déduire un filtre API de sa présence. |
| `source_product_label` | D-OBS | Observations de présence | Table et fiche de détail | Valeur publiée conservée ; null distinct de zéro. |

### `products`

Collection : `GET /v1/data/products`. Droits : `data:read`.

| Champ | Écran | Panneau | Présentation | Règle |
| --- | --- | --- | --- | --- |
| `id` | D-REF | Référentiel produits actuel | Détail / identité | Conserver le code exact comme texte ; ne pas déduire un filtre API de sa présence. |
| `gtin` | D-REF | Référentiel produits actuel | Détail / identité | Conserver le code exact comme texte ; ne pas déduire un filtre API de sa présence. |
| `erp_code` | D-REF | Référentiel produits actuel | Détail / identité | Conserver le code exact comme texte ; ne pas déduire un filtre API de sa présence. |
| `legacy_erp_code` | D-REF | Référentiel produits actuel | Détail / identité | Conserver le code exact comme texte ; ne pas déduire un filtre API de sa présence. |
| `internal_code` | D-REF | Référentiel produits actuel | Détail / identité | Conserver le code exact comme texte ; ne pas déduire un filtre API de sa présence. |
| `legacy_internal_code` | D-REF | Référentiel produits actuel | Détail / identité | Conserver le code exact comme texte ; ne pas déduire un filtre API de sa présence. |
| `name` | D-REF | Référentiel produits actuel | Table et fiche de détail | Valeur publiée conservée ; null distinct de zéro. |
| `brand` | D-REF | Référentiel produits actuel | Table et fiche de détail | Valeur publiée conservée ; null distinct de zéro. |
| `market` | D-REF | Référentiel produits actuel | Table et fiche de détail | Valeur publiée conservée ; null distinct de zéro. |
| `category` | D-REF | Référentiel produits actuel | Table et fiche de détail | Valeur publiée conservée ; null distinct de zéro. |
| `segment` | D-REF | Référentiel produits actuel | Table et fiche de détail | Valeur publiée conservée ; null distinct de zéro. |
| `content_quantity` | D-REF | Référentiel produits actuel | Table et fiche de détail | Valeur publiée conservée ; null distinct de zéro. |
| `content_unit` | D-REF | Référentiel produits actuel | Table et fiche de détail | Valeur publiée conservée ; null distinct de zéro. |
| `average_price` | D-REF | Référentiel produits actuel | Table et fiche de détail | Prix et devise du référentiel produit ; ne définissent pas la devise ou la fiscalité des ventes. |
| `average_price_currency` | D-REF | Référentiel produits actuel | Table et fiche de détail | Prix et devise du référentiel produit ; ne définissent pas la devise ou la fiscalité des ventes. |
| `category_code` | D-REF | Référentiel produits actuel | Détail / identité | Conserver le code exact comme texte ; ne pas déduire un filtre API de sa présence. |
| `is_active` | D-REF | Référentiel produits actuel | Table et fiche de détail | Valeur publiée conservée ; null distinct de zéro. |
| `created_at` | D-REF | Référentiel produits actuel | Horodatage détaillé | Date technique ; ne prouve pas la période métier ou sa couverture. |
| `updated_at` | D-REF | Référentiel produits actuel | Horodatage détaillé | Date technique ; ne prouve pas la période métier ou sa couverture. |

### `register_observations`

Collection : `GET /v1/data/register_observations`. Droits : `data:read`.

| Champ | Écran | Panneau | Présentation | Règle |
| --- | --- | --- | --- | --- |
| `id` | D-OBS | Observations de ventes | Détail / identité | Conserver le code exact comme texte ; ne pas déduire un filtre API de sa présence. |
| `period` | D-OBS | Observations de ventes | Colonne mois / axe temporel | Mois calendaire, premier jour ISO ; aucune conversion de fuseau. |
| `source_kind` | D-OBS | Observations de ventes | Table et fiche de détail | Valeur publiée conservée ; null distinct de zéro. |
| `source_store_reference` | D-OBS | Observations de ventes | Détail / identité | Conserver le code exact comme texte ; ne pas déduire un filtre API de sa présence. |
| `source_store_secondary_reference` | D-OBS | Observations de ventes | Détail / identité | Conserver le code exact comme texte ; ne pas déduire un filtre API de sa présence. |
| `source_store_label` | D-OBS | Observations de ventes | Table et fiche de détail | Valeur publiée conservée ; null distinct de zéro. |
| `store_id` | D-OBS | Observations de ventes | Détail / lien de consultation | Identifiant visible ; ouvrir la fiche magasin à la demande si le lien est résolu. |
| `store_match_status` | D-OBS | Observations de ventes | Colonne qualité / badge et valeur détaillée | Qualifier les mesures ; absence, ambiguïté et zéro restent distincts. |
| `store_match_method` | D-OBS | Observations de ventes | Colonne qualité / badge et valeur détaillée | Qualifier les mesures ; absence, ambiguïté et zéro restent distincts. |
| `source_gtin` | D-OBS | Observations de ventes | Détail / identité | Conserver le code exact comme texte ; ne pas déduire un filtre API de sa présence. |
| `source_product_label` | D-OBS | Observations de ventes | Table et fiche de détail | Valeur publiée conservée ; null distinct de zéro. |
| `source_brand` | D-OBS | Observations de ventes | Table et fiche de détail | Valeur publiée conservée ; null distinct de zéro. |
| `source_family` | D-OBS | Observations de ventes | Table et fiche de détail | Valeur publiée conservée ; null distinct de zéro. |
| `product_id` | D-OBS | Observations de ventes | Détail / lien de consultation | Identifiant visible ; ouvrir la fiche produit à la demande si le lien est résolu. |
| `product_match_status` | D-OBS | Observations de ventes | Colonne qualité / badge et valeur détaillée | Qualifier les mesures ; absence, ambiguïté et zéro restent distincts. |
| `revenue_value` | D-OBS | Observations de ventes | Table et fiche de détail | Valeur publiée conservée ; null distinct de zéro. |
| `revenue_change_ratio` | D-OBS | Observations de ventes | Table et fiche de détail | Valeur rapportée par la source ; ne pas sommer/moyenner ni confondre avec une variation recalculée. |
| `units_sold` | D-OBS | Observations de ventes | Table et fiche de détail | Valeur publiée conservée ; null distinct de zéro. |
| `units_change_ratio` | D-OBS | Observations de ventes | Table et fiche de détail | Valeur rapportée par la source ; ne pas sommer/moyenner ni confondre avec une variation recalculée. |
| `average_unit_price` | D-OBS | Observations de ventes | Table et fiche de détail | Valeur rapportée par la source ; ne pas sommer/moyenner ni confondre avec une variation recalculée. |
| `average_price_change_ratio` | D-OBS | Observations de ventes | Table et fiche de détail | Valeur rapportée par la source ; ne pas sommer/moyenner ni confondre avec une variation recalculée. |
| `volume_value` | D-OBS | Observations de ventes | Table et fiche de détail | Grain produit uniquement ; unité physique non présumée comparable entre produits. |
| `volume_change_ratio` | D-OBS | Observations de ventes | Table et fiche de détail | Valeur rapportée par la source ; ne pas sommer/moyenner ni confondre avec une variation recalculée. |

### `shelf_share_observations`

Collection : `GET /v1/data/shelf_share_observations`. Droits : `data:read`.

| Champ | Écran | Panneau | Présentation | Règle |
| --- | --- | --- | --- | --- |
| `id` | D-OBS | Observations de linéaire | Détail / identité | Conserver le code exact comme texte ; ne pas déduire un filtre API de sa présence. |
| `source_key` | D-OBS | Observations de linéaire | Détail / identité | Conserver le code exact comme texte ; ne pas déduire un filtre API de sa présence. |
| `period` | D-OBS | Observations de linéaire | Colonne mois / axe temporel | Mois calendaire, premier jour ISO ; aucune conversion de fuseau. |
| `category_code` | D-OBS | Observations de linéaire | Détail / identité | Conserver le code exact comme texte ; ne pas déduire un filtre API de sa présence. |
| `store_id` | D-OBS | Observations de linéaire | Détail / lien de consultation | Identifiant visible ; ouvrir la fiche magasin à la demande si le lien est résolu. |
| `store_match_status` | D-OBS | Observations de linéaire | Colonne qualité / badge et valeur détaillée | Qualifier les mesures ; absence, ambiguïté et zéro restent distincts. |
| `store_match_method` | D-OBS | Observations de linéaire | Colonne qualité / badge et valeur détaillée | Qualifier les mesures ; absence, ambiguïté et zéro restent distincts. |
| `company_value` | D-OBS | Observations de linéaire | Table, courbe au grain de la ressource et détail | Valeur publiée conservée ; null distinct de zéro. |
| `total_value` | D-OBS | Observations de linéaire | Table, courbe au grain de la ressource et détail | Valeur publiée conservée ; null distinct de zéro. |
| `share` | D-OBS | Observations de linéaire | Table et fiche de détail | Valeur publiée conservée ; null distinct de zéro. |
| `source_row_count` | D-OBS | Observations de linéaire | Colonne qualité / badge et valeur détaillée | Qualifier les mesures ; absence, ambiguïté et zéro restent distincts. |
| `source_category_name` | D-OBS | Observations de linéaire | Table et fiche de détail | Valeur publiée conservée ; null distinct de zéro. |
| `source_store_reference` | D-OBS | Observations de linéaire | Détail / identité | Conserver le code exact comme texte ; ne pas déduire un filtre API de sa présence. |
| `source_store_label` | D-OBS | Observations de linéaire | Table et fiche de détail | Valeur publiée conservée ; null distinct de zéro. |

### `store_activity_metrics`

Collection : `GET /v1/data/store_activity_metrics`. Droits : `data:read`.

| Champ | Écran | Panneau | Présentation | Règle |
| --- | --- | --- | --- | --- |
| `id` | D-OBS | Observations d’activité | Détail / identité | Conserver le code exact comme texte ; ne pas déduire un filtre API de sa présence. |
| `source_key` | D-OBS | Observations d’activité | Détail / identité | Conserver le code exact comme texte ; ne pas déduire un filtre API de sa présence. |
| `period` | D-OBS | Observations d’activité | Colonne mois / axe temporel | Mois calendaire, premier jour ISO ; aucune conversion de fuseau. |
| `store_id` | D-OBS | Observations d’activité | Détail / lien de consultation | Identifiant visible ; ouvrir la fiche magasin à la demande si le lien est résolu. |
| `store_match_status` | D-OBS | Observations d’activité | Colonne qualité / badge et valeur détaillée | Qualifier les mesures ; absence, ambiguïté et zéro restent distincts. |
| `store_match_method` | D-OBS | Observations d’activité | Colonne qualité / badge et valeur détaillée | Qualifier les mesures ; absence, ambiguïté et zéro restent distincts. |
| `activity_type` | D-OBS | Observations d’activité | Table et fiche de détail | Valeur publiée conservée ; null distinct de zéro. |
| `activity_count` | D-OBS | Observations d’activité | Table, courbe au grain de la ressource et détail | Valeur publiée conservée ; null distinct de zéro. |
| `source_store_reference` | D-OBS | Observations d’activité | Détail / identité | Conserver le code exact comme texte ; ne pas déduire un filtre API de sa présence. |
| `source_store_label` | D-OBS | Observations d’activité | Table et fiche de détail | Valeur publiée conservée ; null distinct de zéro. |

### `store_typology_values`

Collection : `GET /v1/data/store_typology_values`. Droits : `data:read`.

| Champ | Écran | Panneau | Présentation | Règle |
| --- | --- | --- | --- | --- |
| `id` | D-OBS | Valeurs de typologie | Détail / identité | Conserver le code exact comme texte ; ne pas déduire un filtre API de sa présence. |
| `snapshot_id` | D-OBS | Valeurs de typologie | Détail / lien de consultation | Identifiant visible ; ouvrir la fiche instantané de typologie à la demande si le lien est résolu. |
| `category_key` | D-OBS | Valeurs de typologie | Table et fiche de détail | Valeur publiée conservée ; null distinct de zéro. |
| `category_name` | D-OBS | Valeurs de typologie | Table et fiche de détail | Valeur publiée conservée ; null distinct de zéro. |
| `typology_value` | D-OBS | Valeurs de typologie | Table et fiche de détail | Valeur publiée conservée ; null distinct de zéro. |

### `stores`

Collection : `GET /v1/data/stores`. Droits : `data:read`.

| Champ | Écran | Panneau | Présentation | Règle |
| --- | --- | --- | --- | --- |
| `id` | M-REF | Référentiel magasin actuel | Détail / identité | Conserver le code exact comme texte ; ne pas déduire un filtre API de sa présence. |
| `source_key` | M-REF | Référentiel magasin actuel | Détail / identité | Conserver le code exact comme texte ; ne pas déduire un filtre API de sa présence. |
| `external_network_code` | M-REF | Référentiel magasin actuel | Détail / identité | Conserver le code exact comme texte ; ne pas déduire un filtre API de sa présence. |
| `crm_code` | M-REF | Référentiel magasin actuel | Détail / identité | Conserver le code exact comme texte ; ne pas déduire un filtre API de sa présence. |
| `erp_code` | M-REF | Référentiel magasin actuel | Détail / identité | Conserver le code exact comme texte ; ne pas déduire un filtre API de sa présence. |
| `legacy_store_id` | M-REF | Référentiel magasin actuel | Détail / identité | Conserver le code exact comme texte ; ne pas déduire un filtre API de sa présence. |
| `retail_panel_code` | M-REF | Référentiel magasin actuel | Détail / identité | Conserver le code exact comme texte ; ne pas déduire un filtre API de sa présence. |
| `data_sharing_code` | M-REF | Référentiel magasin actuel | Détail / identité | Conserver le code exact comme texte ; ne pas déduire un filtre API de sa présence. |
| `name` | M-REF | Référentiel magasin actuel | En-tête, liste magasins et détail | Attribut actuel, jamais un historique reconstitué. |
| `legal_name` | M-REF | Référentiel magasin actuel | Table et fiche de détail | Valeur publiée conservée ; null distinct de zéro. |
| `address_line_1` | M-REF | Référentiel magasin actuel | Table et fiche de détail | Valeur publiée conservée ; null distinct de zéro. |
| `address_line_2` | M-REF | Référentiel magasin actuel | Table et fiche de détail | Valeur publiée conservée ; null distinct de zéro. |
| `department_code` | M-REF | Référentiel magasin actuel | Détail / identité | Conserver le code exact comme texte ; ne pas déduire un filtre API de sa présence. |
| `postal_code` | M-REF | Référentiel magasin actuel | Détail / identité | Conserver le code exact comme texte ; ne pas déduire un filtre API de sa présence. |
| `city` | M-REF | Référentiel magasin actuel | Table et fiche de détail | Valeur publiée conservée ; null distinct de zéro. |
| `retailer_code` | M-REF | Référentiel magasin actuel | Détail / identité | Conserver le code exact comme texte ; ne pas déduire un filtre API de sa présence. |
| `retailer_name` | M-REF | Référentiel magasin actuel | En-tête, liste magasins et détail | Attribut actuel, jamais un historique reconstitué. |
| `store_format` | M-REF | Référentiel magasin actuel | En-tête, liste magasins et détail | Attribut actuel, jamais un historique reconstitué. |
| `region_code` | M-REF | Référentiel magasin actuel | En-tête, liste magasins et détail | Attribut actuel, jamais un historique reconstitué. |
| `region_name` | M-REF | Référentiel magasin actuel | En-tête, liste magasins et détail | Attribut actuel, jamais un historique reconstitué. |
| `sales_representative_code` | M-REF | Référentiel — équipe et planification | Détail / identité | Détail replié ; personnes du référentiel, sans lien avec l’identité de connexion. |
| `sales_representative_name` | M-REF | Référentiel — équipe et planification | Table et fiche de détail | Détail replié ; personnes du référentiel, sans lien avec l’identité de connexion. |
| `promoter_code` | M-REF | Référentiel — équipe et planification | Détail / identité | Détail replié ; personnes du référentiel, sans lien avec l’identité de connexion. |
| `promoter_name` | M-REF | Référentiel — équipe et planification | Table et fiche de détail | Détail replié ; personnes du référentiel, sans lien avec l’identité de connexion. |
| `secondary_representative_code` | M-REF | Référentiel — équipe et planification | Détail / identité | Détail replié ; personnes du référentiel, sans lien avec l’identité de connexion. |
| `secondary_representative_name` | M-REF | Référentiel — équipe et planification | Table et fiche de détail | Détail replié ; personnes du référentiel, sans lien avec l’identité de connexion. |
| `sales_area_sqm` | M-REF | Référentiel magasin actuel | Table et fiche de détail | Valeur publiée conservée ; null distinct de zéro. |
| `classification` | M-REF | Référentiel magasin actuel | Table et fiche de détail | Valeur publiée conservée ; null distinct de zéro. |
| `segmentation` | M-REF | Référentiel magasin actuel | Table et fiche de détail | Valeur publiée conservée ; null distinct de zéro. |
| `distribution_model` | M-REF | Référentiel magasin actuel | Table et fiche de détail | Valeur publiée conservée ; null distinct de zéro. |
| `has_direct_sales_potential` | M-REF | Référentiel magasin actuel | Colonne qualité / badge et valeur détaillée | Qualifier les mesures ; absence, ambiguïté et zéro restent distincts. |
| `survey_validity_days` | M-REF | Référentiel — planification | Table et fiche de détail | Valeur du référentiel ; aucune périodicité mensuelle supposée. |
| `planned_sales_visits` | M-REF | Référentiel — planification | Table et fiche de détail | Valeur du référentiel ; aucune périodicité mensuelle supposée. |
| `sales_visit_minutes` | M-REF | Référentiel — planification | Table et fiche de détail | Valeur du référentiel ; aucune périodicité mensuelle supposée. |
| `planned_promoter_visits` | M-REF | Référentiel — équipe et planification | Table et fiche de détail | Détail replié ; personnes du référentiel, sans lien avec l’identité de connexion. |
| `promoter_visit_minutes` | M-REF | Référentiel — équipe et planification | Table et fiche de détail | Détail replié ; personnes du référentiel, sans lien avec l’identité de connexion. |
| `planned_total_visits` | M-REF | Référentiel — planification | Table et fiche de détail | Valeur du référentiel ; aucune périodicité mensuelle supposée. |
| `checkout_count` | M-REF | Référentiel magasin actuel | Table et fiche de détail | Valeur publiée conservée ; null distinct de zéro. |
| `annual_turnover_2025_millions` | M-REF | Référentiel — chiffres déclaratifs | Table et fiche de détail | Période et échelle millions selon le nom du champ ; séparé du CA mensuel observé, devise non déduite. |
| `annual_turnover_2024_millions` | M-REF | Référentiel — chiffres déclaratifs | Table et fiche de détail | Période et échelle millions selon le nom du champ ; séparé du CA mensuel observé, devise non déduite. |
| `annual_turnover_2023_millions` | M-REF | Référentiel — chiffres déclaratifs | Table et fiche de détail | Période et échelle millions selon le nom du champ ; séparé du CA mensuel observé, devise non déduite. |
| `october_2023_turnover_millions` | M-REF | Référentiel — chiffres déclaratifs | Table et fiche de détail | Période et échelle millions selon le nom du champ ; séparé du CA mensuel observé, devise non déduite. |
| `is_active` | M-REF | Référentiel magasin actuel | En-tête, liste magasins et détail | Attribut actuel, jamais un historique reconstitué. |
| `created_at` | M-REF | Référentiel magasin actuel | Horodatage détaillé | Date technique ; ne prouve pas la période métier ou sa couverture. |
| `updated_at` | M-REF | Référentiel magasin actuel | Horodatage détaillé | Date technique ; ne prouve pas la période métier ou sa couverture. |

### `typology_mapping_rules`

Collection : `GET /v1/data/typology_mapping_rules`. Droits : `data:read`.

| Champ | Écran | Panneau | Présentation | Règle |
| --- | --- | --- | --- | --- |
| `id` | D-REF | Règles de correspondance | Détail / identité | Conserver le code exact comme texte ; ne pas déduire un filtre API de sa présence. |
| `source_key` | D-REF | Règles de correspondance | Détail / identité | Conserver le code exact comme texte ; ne pas déduire un filtre API de sa présence. |
| `raw_retailer_name` | D-REF | Règles de correspondance | Table et fiche de détail | Valeur publiée conservée ; null distinct de zéro. |
| `raw_category_name` | D-REF | Règles de correspondance | Table et fiche de détail | Valeur publiée conservée ; null distinct de zéro. |
| `raw_category_code` | D-REF | Règles de correspondance | Détail / identité | Conserver le code exact comme texte ; ne pas déduire un filtre API de sa présence. |
| `raw_typology_value` | D-REF | Règles de correspondance | Table et fiche de détail | Valeur publiée conservée ; null distinct de zéro. |
| `mapped_retailer_name` | D-REF | Règles de correspondance | Table et fiche de détail | Valeur publiée conservée ; null distinct de zéro. |
| `mapped_category_code` | D-REF | Règles de correspondance | Détail / identité | Conserver le code exact comme texte ; ne pas déduire un filtre API de sa présence. |
| `mapped_typology_value` | D-REF | Règles de correspondance | Table et fiche de détail | Valeur publiée conservée ; null distinct de zéro. |
| `has_source_error` | D-REF | Règles de correspondance | Colonne qualité / badge et valeur détaillée | Qualifier les mesures ; absence, ambiguïté et zéro restent distincts. |

### `typology_rank_rules`

Collection : `GET /v1/data/typology_rank_rules`. Droits : `data:read`.

| Champ | Écran | Panneau | Présentation | Règle |
| --- | --- | --- | --- | --- |
| `id` | D-REF | Règles de rang | Détail / identité | Conserver le code exact comme texte ; ne pas déduire un filtre API de sa présence. |
| `retailer_name` | D-REF | Règles de rang | Table et fiche de détail | Valeur publiée conservée ; null distinct de zéro. |
| `category_name` | D-REF | Règles de rang | Table et fiche de détail | Valeur publiée conservée ; null distinct de zéro. |
| `category_code` | D-REF | Règles de rang | Détail / identité | Conserver le code exact comme texte ; ne pas déduire un filtre API de sa présence. |
| `rank` | D-REF | Règles de rang | Table et fiche de détail | Valeur publiée conservée ; null distinct de zéro. |
| `typology_value` | D-REF | Règles de rang | Table et fiche de détail | Valeur publiée conservée ; null distinct de zéro. |

### `typology_snapshots`

Collection : `GET /v1/data/typology_snapshots`. Droits : `data:read`.

| Champ | Écran | Panneau | Présentation | Règle |
| --- | --- | --- | --- | --- |
| `id` | D-OBS | Instantanés de typologie | Détail / identité | Conserver le code exact comme texte ; ne pas déduire un filtre API de sa présence. |
| `source_key` | D-OBS | Instantanés de typologie | Détail / identité | Conserver le code exact comme texte ; ne pas déduire un filtre API de sa présence. |
| `period` | D-OBS | Instantanés de typologie | Colonne mois / axe temporel | Mois calendaire, premier jour ISO ; aucune conversion de fuseau. |
| `store_id` | D-OBS | Instantanés de typologie | Détail / lien de consultation | Identifiant visible ; ouvrir la fiche magasin à la demande si le lien est résolu. |
| `store_match_status` | D-OBS | Instantanés de typologie | Colonne qualité / badge et valeur détaillée | Qualifier les mesures ; absence, ambiguïté et zéro restent distincts. |
| `store_match_method` | D-OBS | Instantanés de typologie | Colonne qualité / badge et valeur détaillée | Qualifier les mesures ; absence, ambiguïté et zéro restent distincts. |
| `retail_panel_code` | D-OBS | Instantanés de typologie | Détail / identité | Conserver le code exact comme texte ; ne pas déduire un filtre API de sa présence. |
| `source_customer_code` | D-OBS | Instantanés de typologie | Détail / identité | Conserver le code exact comme texte ; ne pas déduire un filtre API de sa présence. |
| `point_of_sale_id` | D-OBS | Instantanés de typologie | Détail / identité | Conserver le code exact comme texte ; ne pas déduire un filtre API de sa présence. |
| `region_code` | D-OBS | Instantanés de typologie | Détail / identité | Conserver le code exact comme texte ; ne pas déduire un filtre API de sa présence. |
| `sales_representative_code` | D-OBS | Instantanés de typologie | Détail / identité | Conserver le code exact comme texte ; ne pas déduire un filtre API de sa présence. |
| `retailer_name` | D-OBS | Instantanés de typologie | Table et fiche de détail | Valeur publiée conservée ; null distinct de zéro. |
| `source_info` | D-OBS | Instantanés de typologie | Table et fiche de détail | Texte source inerte dans un panneau dépliable ; aucune interprétation comme instruction. |
| `postal_code` | D-OBS | Instantanés de typologie | Détail / identité | Conserver le code exact comme texte ; ne pas déduire un filtre API de sa présence. |

## Objets imbriqués de analytics_store_month

Ces chemins représentent des projections publiées, pas des colonnes SQL supplémentaires.
current_store conserve tous les champs publiés de stores. Les trois listes de détails
omettront store_id et period dans chaque enfant : ils sont portés par la ligne parente.
[] signifie chaque élément, jamais le premier seulement. Les listes d’identifiants
à l’intérieur de ces objets se déplient intégralement. Un objet nul ou une liste vide
reste distinct d’une mesure zéro. Le même fait accessible par deux routes ne doit
jamais être additionné deux fois.

### `current_store`

| Chemin publié | Écran | Panneau | Présentation | Règle |
| --- | --- | --- | --- | --- |
| `current_store.id` | M-REF | Référentiel magasin actuel | Détail / identité | Conserver le code exact comme texte ; ne pas déduire un filtre API de sa présence. Version au refresh, distincte du référentiel vivant. |
| `current_store.source_key` | M-REF | Référentiel magasin actuel | Détail / identité | Conserver le code exact comme texte ; ne pas déduire un filtre API de sa présence. Version au refresh, distincte du référentiel vivant. |
| `current_store.external_network_code` | M-REF | Référentiel magasin actuel | Détail / identité | Conserver le code exact comme texte ; ne pas déduire un filtre API de sa présence. Version au refresh, distincte du référentiel vivant. |
| `current_store.crm_code` | M-REF | Référentiel magasin actuel | Détail / identité | Conserver le code exact comme texte ; ne pas déduire un filtre API de sa présence. Version au refresh, distincte du référentiel vivant. |
| `current_store.erp_code` | M-REF | Référentiel magasin actuel | Détail / identité | Conserver le code exact comme texte ; ne pas déduire un filtre API de sa présence. Version au refresh, distincte du référentiel vivant. |
| `current_store.legacy_store_id` | M-REF | Référentiel magasin actuel | Détail / identité | Conserver le code exact comme texte ; ne pas déduire un filtre API de sa présence. Version au refresh, distincte du référentiel vivant. |
| `current_store.retail_panel_code` | M-REF | Référentiel magasin actuel | Détail / identité | Conserver le code exact comme texte ; ne pas déduire un filtre API de sa présence. Version au refresh, distincte du référentiel vivant. |
| `current_store.data_sharing_code` | M-REF | Référentiel magasin actuel | Détail / identité | Conserver le code exact comme texte ; ne pas déduire un filtre API de sa présence. Version au refresh, distincte du référentiel vivant. |
| `current_store.name` | M-REF | Référentiel magasin actuel | En-tête, liste magasins et détail | Attribut actuel, jamais un historique reconstitué. Version au refresh, distincte du référentiel vivant. |
| `current_store.legal_name` | M-REF | Référentiel magasin actuel | Table et fiche de détail | Valeur publiée conservée ; null distinct de zéro. Version au refresh, distincte du référentiel vivant. |
| `current_store.address_line_1` | M-REF | Référentiel magasin actuel | Table et fiche de détail | Valeur publiée conservée ; null distinct de zéro. Version au refresh, distincte du référentiel vivant. |
| `current_store.address_line_2` | M-REF | Référentiel magasin actuel | Table et fiche de détail | Valeur publiée conservée ; null distinct de zéro. Version au refresh, distincte du référentiel vivant. |
| `current_store.department_code` | M-REF | Référentiel magasin actuel | Détail / identité | Conserver le code exact comme texte ; ne pas déduire un filtre API de sa présence. Version au refresh, distincte du référentiel vivant. |
| `current_store.postal_code` | M-REF | Référentiel magasin actuel | Détail / identité | Conserver le code exact comme texte ; ne pas déduire un filtre API de sa présence. Version au refresh, distincte du référentiel vivant. |
| `current_store.city` | M-REF | Référentiel magasin actuel | Table et fiche de détail | Valeur publiée conservée ; null distinct de zéro. Version au refresh, distincte du référentiel vivant. |
| `current_store.retailer_code` | M-REF | Référentiel magasin actuel | Détail / identité | Conserver le code exact comme texte ; ne pas déduire un filtre API de sa présence. Version au refresh, distincte du référentiel vivant. |
| `current_store.retailer_name` | M-REF | Référentiel magasin actuel | En-tête, liste magasins et détail | Attribut actuel, jamais un historique reconstitué. Version au refresh, distincte du référentiel vivant. |
| `current_store.store_format` | M-REF | Référentiel magasin actuel | En-tête, liste magasins et détail | Attribut actuel, jamais un historique reconstitué. Version au refresh, distincte du référentiel vivant. |
| `current_store.region_code` | M-REF | Référentiel magasin actuel | En-tête, liste magasins et détail | Attribut actuel, jamais un historique reconstitué. Version au refresh, distincte du référentiel vivant. |
| `current_store.region_name` | M-REF | Référentiel magasin actuel | En-tête, liste magasins et détail | Attribut actuel, jamais un historique reconstitué. Version au refresh, distincte du référentiel vivant. |
| `current_store.sales_representative_code` | M-REF | Référentiel — équipe et planification | Détail / identité | Détail replié ; personnes du référentiel, sans lien avec l’identité de connexion. Version au refresh, distincte du référentiel vivant. |
| `current_store.sales_representative_name` | M-REF | Référentiel — équipe et planification | Table et fiche de détail | Détail replié ; personnes du référentiel, sans lien avec l’identité de connexion. Version au refresh, distincte du référentiel vivant. |
| `current_store.promoter_code` | M-REF | Référentiel — équipe et planification | Détail / identité | Détail replié ; personnes du référentiel, sans lien avec l’identité de connexion. Version au refresh, distincte du référentiel vivant. |
| `current_store.promoter_name` | M-REF | Référentiel — équipe et planification | Table et fiche de détail | Détail replié ; personnes du référentiel, sans lien avec l’identité de connexion. Version au refresh, distincte du référentiel vivant. |
| `current_store.secondary_representative_code` | M-REF | Référentiel — équipe et planification | Détail / identité | Détail replié ; personnes du référentiel, sans lien avec l’identité de connexion. Version au refresh, distincte du référentiel vivant. |
| `current_store.secondary_representative_name` | M-REF | Référentiel — équipe et planification | Table et fiche de détail | Détail replié ; personnes du référentiel, sans lien avec l’identité de connexion. Version au refresh, distincte du référentiel vivant. |
| `current_store.sales_area_sqm` | M-REF | Référentiel magasin actuel | Table et fiche de détail | Valeur publiée conservée ; null distinct de zéro. Version au refresh, distincte du référentiel vivant. |
| `current_store.classification` | M-REF | Référentiel magasin actuel | Table et fiche de détail | Valeur publiée conservée ; null distinct de zéro. Version au refresh, distincte du référentiel vivant. |
| `current_store.segmentation` | M-REF | Référentiel magasin actuel | Table et fiche de détail | Valeur publiée conservée ; null distinct de zéro. Version au refresh, distincte du référentiel vivant. |
| `current_store.distribution_model` | M-REF | Référentiel magasin actuel | Table et fiche de détail | Valeur publiée conservée ; null distinct de zéro. Version au refresh, distincte du référentiel vivant. |
| `current_store.has_direct_sales_potential` | M-REF | Référentiel magasin actuel | Colonne qualité / badge et valeur détaillée | Qualifier les mesures ; absence, ambiguïté et zéro restent distincts. Version au refresh, distincte du référentiel vivant. |
| `current_store.survey_validity_days` | M-REF | Référentiel — planification | Table et fiche de détail | Valeur du référentiel ; aucune périodicité mensuelle supposée. Version au refresh, distincte du référentiel vivant. |
| `current_store.planned_sales_visits` | M-REF | Référentiel — planification | Table et fiche de détail | Valeur du référentiel ; aucune périodicité mensuelle supposée. Version au refresh, distincte du référentiel vivant. |
| `current_store.sales_visit_minutes` | M-REF | Référentiel — planification | Table et fiche de détail | Valeur du référentiel ; aucune périodicité mensuelle supposée. Version au refresh, distincte du référentiel vivant. |
| `current_store.planned_promoter_visits` | M-REF | Référentiel — équipe et planification | Table et fiche de détail | Détail replié ; personnes du référentiel, sans lien avec l’identité de connexion. Version au refresh, distincte du référentiel vivant. |
| `current_store.promoter_visit_minutes` | M-REF | Référentiel — équipe et planification | Table et fiche de détail | Détail replié ; personnes du référentiel, sans lien avec l’identité de connexion. Version au refresh, distincte du référentiel vivant. |
| `current_store.planned_total_visits` | M-REF | Référentiel — planification | Table et fiche de détail | Valeur du référentiel ; aucune périodicité mensuelle supposée. Version au refresh, distincte du référentiel vivant. |
| `current_store.checkout_count` | M-REF | Référentiel magasin actuel | Table et fiche de détail | Valeur publiée conservée ; null distinct de zéro. Version au refresh, distincte du référentiel vivant. |
| `current_store.annual_turnover_2025_millions` | M-REF | Référentiel — chiffres déclaratifs | Table et fiche de détail | Période et échelle millions selon le nom du champ ; séparé du CA mensuel observé, devise non déduite. Version au refresh, distincte du référentiel vivant. |
| `current_store.annual_turnover_2024_millions` | M-REF | Référentiel — chiffres déclaratifs | Table et fiche de détail | Période et échelle millions selon le nom du champ ; séparé du CA mensuel observé, devise non déduite. Version au refresh, distincte du référentiel vivant. |
| `current_store.annual_turnover_2023_millions` | M-REF | Référentiel — chiffres déclaratifs | Table et fiche de détail | Période et échelle millions selon le nom du champ ; séparé du CA mensuel observé, devise non déduite. Version au refresh, distincte du référentiel vivant. |
| `current_store.october_2023_turnover_millions` | M-REF | Référentiel — chiffres déclaratifs | Table et fiche de détail | Période et échelle millions selon le nom du champ ; séparé du CA mensuel observé, devise non déduite. Version au refresh, distincte du référentiel vivant. |
| `current_store.is_active` | M-REF | Référentiel magasin actuel | En-tête, liste magasins et détail | Attribut actuel, jamais un historique reconstitué. Version au refresh, distincte du référentiel vivant. |
| `current_store.created_at` | M-REF | Référentiel magasin actuel | Horodatage détaillé | Date technique ; ne prouve pas la période métier ou sa couverture. Version au refresh, distincte du référentiel vivant. |
| `current_store.updated_at` | M-REF | Référentiel magasin actuel | Horodatage détaillé | Date technique ; ne prouve pas la période métier ou sa couverture. Version au refresh, distincte du référentiel vivant. |

### `activity_details`

| Chemin publié | Écran | Panneau | Présentation | Règle |
| --- | --- | --- | --- | --- |
| `activity_details[].activity_type` | M-ACT | Activité mensuelle par type | Table et fiche de détail | Valeur publiée conservée ; null distinct de zéro. |
| `activity_details[].source_row_count` | M-ACT | Activité mensuelle par type | Colonne qualité / badge et valeur détaillée | Qualifier les mesures ; absence, ambiguïté et zéro restent distincts. |
| `activity_details[].ambiguous` | M-ACT | Activité mensuelle par type | Colonne qualité / badge et valeur détaillée | Qualifier les mesures ; absence, ambiguïté et zéro restent distincts. |
| `activity_details[].activity_count` | M-ACT | Activité mensuelle par type | Table, courbe au grain de la ressource et détail | Valeur publiée conservée ; null distinct de zéro. |
| `activity_details[].observation_ids` | M-ACT | Activité mensuelle par type | Liste dépliable d’identifiants | Conserver chaque élément ; lectures unitaires à la demande, sans requête automatique par élément. |

### `category_details`

| Chemin publié | Écran | Panneau | Présentation | Règle |
| --- | --- | --- | --- | --- |
| `category_details[].category_code` | M-PRE | Synthèse catégorie mensuelle | Détail / identité | Conserver le code exact comme texte ; ne pas déduire un filtre API de sa présence. |
| `category_details[].distribution_product_count` | M-PRE | Synthèse catégorie mensuelle | Colonne qualité / badge et valeur détaillée | Qualifier les mesures ; absence, ambiguïté et zéro restent distincts. |
| `category_details[].distribution_ambiguous_products` | M-PRE | Synthèse catégorie mensuelle | Colonne qualité / badge et valeur détaillée | Qualifier les mesures ; absence, ambiguïté et zéro restent distincts. |
| `category_details[].distribution_unmatched_products` | M-PRE | Synthèse catégorie mensuelle | Colonne qualité / badge et valeur détaillée | Qualifier les mesures ; absence, ambiguïté et zéro restent distincts. |
| `category_details[].inferred_absence_rows` | M-PRE | Synthèse catégorie mensuelle | Colonne qualité / badge et valeur détaillée | Qualifier les mesures ; absence, ambiguïté et zéro restent distincts. |
| `category_details[].present_products` | M-PRE | Synthèse catégorie mensuelle | Table, courbe au grain de la ressource et détail | Valeur publiée conservée ; null distinct de zéro. |
| `category_details[].observed_presence_rate` | M-PRE | Synthèse catégorie mensuelle | Table, courbe au grain de la ressource et détail | Valeur publiée conservée ; null distinct de zéro. |
| `category_details[].shelf_source_row_count` | M-PRE | Synthèse catégorie mensuelle | Colonne qualité / badge et valeur détaillée | Qualifier les mesures ; absence, ambiguïté et zéro restent distincts. |
| `category_details[].shelf_ambiguous` | M-PRE | Synthèse catégorie mensuelle | Colonne qualité / badge et valeur détaillée | Qualifier les mesures ; absence, ambiguïté et zéro restent distincts. |
| `category_details[].shelf_company_value` | M-PRE | Synthèse catégorie mensuelle | Table et fiche de détail | Valeur publiée conservée ; null distinct de zéro. |
| `category_details[].shelf_total_value` | M-PRE | Synthèse catégorie mensuelle | Table et fiche de détail | Valeur publiée conservée ; null distinct de zéro. |
| `category_details[].shelf_share` | M-PRE | Synthèse catégorie mensuelle | Table, courbe au grain de la ressource et détail | Valeur publiée conservée ; null distinct de zéro. |
| `category_details[].exact_assortment_candidate_count` | M-PRE | Synthèse catégorie mensuelle | Table et fiche de détail | Valeur publiée conservée ; null distinct de zéro. |

### `typology_details`

| Chemin publié | Écran | Panneau | Présentation | Règle |
| --- | --- | --- | --- | --- |
| `typology_details[].typology_value_id` | M-TYP | Typologies mensuelles et rapprochement | Détail / lien de consultation | Identifiant visible ; ouvrir la fiche valeur de typologie à la demande si le lien est résolu. |
| `typology_details[].snapshot_id` | M-TYP | Typologies mensuelles et rapprochement | Détail / lien de consultation | Identifiant visible ; ouvrir la fiche instantané de typologie à la demande si le lien est résolu. |
| `typology_details[].retailer_name` | M-TYP | Typologies mensuelles et rapprochement | Table et fiche de détail | Valeur publiée conservée ; null distinct de zéro. |
| `typology_details[].region_code` | M-TYP | Typologies mensuelles et rapprochement | Détail / identité | Conserver le code exact comme texte ; ne pas déduire un filtre API de sa présence. |
| `typology_details[].sales_representative_code` | M-TYP | Typologies mensuelles et rapprochement | Détail / identité | Conserver le code exact comme texte ; ne pas déduire un filtre API de sa présence. |
| `typology_details[].category_key` | M-TYP | Typologies mensuelles et rapprochement | Table et fiche de détail | Valeur publiée conservée ; null distinct de zéro. |
| `typology_details[].category_name` | M-TYP | Typologies mensuelles et rapprochement | Table et fiche de détail | Valeur publiée conservée ; null distinct de zéro. |
| `typology_details[].typology_value` | M-TYP | Typologies mensuelles et rapprochement | Table et fiche de détail | Valeur publiée conservée ; null distinct de zéro. |
| `typology_details[].rank_rule_ids` | M-TYP | Typologies mensuelles et rapprochement | Liste dépliable d’identifiants | Conserver chaque élément ; lectures unitaires à la demande, sans requête automatique par élément. |
| `typology_details[].rank_candidate_count` | M-TYP | Typologies mensuelles et rapprochement | Table et fiche de détail | Valeur publiée conservée ; null distinct de zéro. |
| `typology_details[].mapping_issue` | M-TYP | Typologies mensuelles et rapprochement | Colonne qualité / badge et valeur détaillée | Qualifier les mesures ; absence, ambiguïté et zéro restent distincts. |

## Métadonnées hors collections

Ces champs complètent la couverture métier ; ce ne sont pas des colonnes de tables.

| Réponse | Champs | Destination |
| --- | --- | --- |
| `/v1/analytics/status` | `state`, `last_completed_at`, `last_attempt_status` | Bandeau de fraîcheur et Qualité ; accessibles avec data:read |
| `/v1/resources` | `name`, `columns`, `keys`, `filters`, `path` | Description de chaque collection dans Données ; pilote les capacités autorisées |
| Page d’une collection | `items`, `next_cursor` | Lignes consultables et commande de pagination ; curseur interne, pas un KPI |
| Erreur API | `error` et header `X-Request-ID` | Message d’erreur et référence support, sans payload métier |
| `/v1/openapi.json` | Schéma technique complet | Référence d’intégration des agents ; aucun écran de données métier dédié |

## Vérification de couverture à la réception

Le contrôle initial compte 325 lignes de premier niveau et 74 chemins enfants.
Comparer les ensembles de couples (ressource, champ) avec le registre, puis les
chemins enfants avec les modèles imbriqués construits par resources.py : aucun
champ absent, ajouté implicitement ou dupliqué dans la matrice.
À chaque évolution du registre ou des modèles imbriqués, mettre à jour cette matrice
et vérifier ce même écart avant livraison. Le catalogue authentifié fait autorité
pour les droits du lecteur, sans réduire l’inventaire global versionné.

Pour chaque ligne, la recette frontend doit identifier un composant consultable et
un scénario synthétique affichant sa valeur (et ses états null/liste vide si admis).
Inclure les secondes pages, les champs rarement renseignés, les lignes sans lien
magasin/produit et les rôles avec/sans operations:read. Aucun écran ne doit se
contenter des premières colonnes de sa table. Ne pas annoncer cette couverture
comme implémentée tant que ces scénarios ne sont pas vérifiés.
