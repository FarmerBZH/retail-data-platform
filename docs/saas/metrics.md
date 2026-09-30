# Contrat des indicateurs métier

Statut : règles proposées pour l'interface, fondées sur le
[contrat analytique existant](../monthly-analytics.md).

## Périmètre et absence de données

S = ensemble explicite de magasins sélectionnés ; P = mois sélectionnés.
Le grain principal est `(store_id, period)`. La grille attendue est S × P, y compris
les mois sans observation. Elle ne prouve pas qu'un magasin existait ou était ouvert.
Une date hors couverture ne doit jamais devenir un zéro.

Un CA de magasin non nul indique une mesure complète dans son **univers produit
observé**, pas le chiffre d'affaires exhaustif de ce magasin. Ne pas mélanger ce
CA mensuel avec les champs annuels de chiffre d'affaires du référentiel `stores`.
Les ventes n'exposent pas de devise ni de qualification HT/TTC : afficher « unité
monétaire à confirmer » jusqu'à validation ; interdire l'agrégation de devises
différentes sans contrat de conversion explicite.

## Indicateurs principaux

| Indicateur | Source / calcul | Condition d'affichage |
| --- | --- | --- |
| CA observé complet sur la sélection | Somme de `analytics_store_month.revenue` sur S × P | Toutes les cellules attendues ont une valeur non nulle ; univers observé uniquement |
| CA observé partiel | Somme des `revenue` non nuls | S'il manque une cellule : badge « partiel », compte couvert/attendu ; aucune cellule valide → indisponible |
| Ventes non ambiguës rapportées | Somme de `unambiguous_reported_revenue` | Diagnostic distinct, toujours partiel ; ne remplace jamais discrètement le CA |
| Unités vendues | Même règle que le CA avec `units` | Compte de cellules valides propre aux unités ; ce ne sont pas des volumes physiques |
| CA par unité | Somme CA / somme unités | Même ensemble de cellules complètes pour les deux mesures, dénominateur non nul ; sinon indisponible dans la synthèse |
| Couverture CA | Nombre de cellules `revenue != null` / nombre de cellules S × P | Afficher numérateur et dénominateur ; sélection vide → indisponible |
| Magasins avec ventes observées | Nombre distinct de magasins avec au moins un `has_register` vrai dans P | Ni nombre de magasins ouverts, ni mesure de complétude |
| Activité | Sommes séparées de `calls`, `field_visits`, `crowdsourced_visits` | Null ≠ zéro ; qualifier la couverture pour chaque type, sans addition intertypes |

La courbe calcule ces règles pour chaque mois ; la carte pour toute la période.
Une série partielle est visuellement identifiée. Les ratios existants sont des
fractions : `0.12` s'affiche `12 %`. Une moyenne de ratios de magasins est interdite.
Les décimaux sont calculés exactement ; l'arrondi appartient à l'affichage final.
Un résultat nul reste distinct de zéro, les retours et montants négatifs sont conservés.

## Comparaisons temporelles

Pour un magasin, `analytics_store_month_changes` fournit M-1 et N-1 calendaires.
Pour une fenêtre ou un réseau, recalculer depuis les montants de chaque période ;
ne jamais sommer ou moyenner les pourcentages de cette vue.

Proposer deux lectures clairement nommées :

- **Périmètre sélectionné** : comparaison uniquement si toutes les cellules
  nécessaires des deux périodes sont valides. Sinon variation indisponible.
- **Cohorte comparable** : intersection des magasins ayant des valeurs valides
  pour tous les mois des deux fenêtres. Utiliser exactement cette cohorte pour les
  deux totaux, annoncer le nombre inclus/exclu et conserver les totaux réseau à part.

Pour une courbe de comparaison sur plusieurs mois, figer la cohorte pour toute la
fenêtre affichée. Le périmètre produit peut encore varier : « comparable » ne
signifie pas assortiment constant ni croissance à périmètre économique constant.

Variation absolue = total courant − total de référence. Variation relative =
variation absolue / total de référence. Base nulle ou manquante → indisponible.
Base négative → privilégier la variation absolue et indiquer « base négative » ;
ne pas afficher une flèche verte basée uniquement sur le signe du pourcentage.
Une cohorte vide produit un résultat indisponible, pas 0 %.

Contribution d'un magasin = CA courant − CA de référence sur cette même cohorte.
La somme des contributions doit égaler la variation absolue de la cohorte.
Les magasins exclus apparaissent dans un groupe « non comparables » sans contribution
inventée. Les barres positives et négatives gardent une origine zéro commune.

## Indicateurs de contexte

| Domaine | Source principale | Interprétation et limite |
| --- | --- | --- |
| Ventes produit | `analytics_register_product_month` | Grain magasin/mois/GTIN source ; conserver les produits non rapprochés ; ne pas regrouper tous les `product_id=null` en un produit |
| Présence | `analytics_store_category_month` et `analytics_distribution_product_month` | Taux de présence sur les clés produit observées, avec absences inférées et compte des ambiguïtés ; ni distribution réseau ni conformité d'assortiment |
| Linéaire | `analytics_shelf_category_month` | Ratio `company_value / total_value`, dénominateur nul → indisponible ; pas de moyenne des ratios ni plafonnement à 100 % |
| Typologies | `analytics_typology_month` | Valeur du mois observé ; pas de propagation vers un mois absent ; conflits et règles de rapprochement visibles |
| Assortiments | `analytics_assortment_candidates`, `analytics_retailer_assortment_month` | Candidats exacts séparés du contexte enseigne ; nombre de lignes, pas nombre présumé de produits distincts obligatoires |
| Attribution réseau | `analytics_monthly_link_quality` | Nombre d'observations par dataset/mois/statut ; ne mesure pas le montant de CA perdu |

Les parts de linéaire restent par magasin/catégorie/mois tant que la comparabilité
des unités n'est pas établie. Une agrégation future exige des mesures compatibles
et une somme des numérateurs divisée par la somme des dénominateurs du même périmètre.
Pas de total de volumes entre produits d'unités inconnues. Pas de marge, panier
moyen, nombre de clients ou retour sur investissement : ces données manquent.

Ne jamais joindre les lignes de ventes, activité et catégorie avant agrégation.
Une table détaillée peut expliquer un total, sans multiplier les montants du grain
magasin/mois. La source `products` apporte des attributs **actuels**, pas historiques.

## Exemple exclusivement synthétique

Deux magasins fictifs : référence A=100, B=200 ; courant A=120, B=null.
CA courant observé partiel=120, couverture=1/2 ; aucune variation réseau complète.
Cohorte comparable={A}, variation=20, soit 20 %, un magasin exclu.
Si B vaut zéro mesuré au lieu de null, CA courant=120, couverture=2/2 et variation
réseau=(120−300)/300=−60 %. Ces deux situations ne doivent jamais se ressembler.
