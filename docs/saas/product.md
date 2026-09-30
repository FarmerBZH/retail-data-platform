# Produit, navigation et visualisations

Statut : cible proposée. Voir les [indicateurs](metrics.md) et
les [conditions d'intégration](integration.md).

## Questions métier

- Comment évoluent les ventes observées et leur couverture au fil des mois ?
- Quels magasins contribuent à une hausse ou à une baisse sur un périmètre comparable ?
- Cette variation accompagne-t-elle une évolution des unités, du mix produit,
  de la présence observée ou de la part de linéaire ?
- Quelle activité commerciale a été enregistrée sur la même période ?
- Une rupture de tendance vient-elle de données absentes ou ambiguës ?

Une association entre visites et ventes ne prouve pas l'effet des visites.
La plateforme aide à explorer et documenter une hypothèse, sans attribuer de causalité.

## Structure commune

Navigation : **Vue réseau**, **Magasins**, **Données**, **Qualité des données**. La comparaison
s'ouvre depuis la sélection de magasins ; la fiche depuis une ligne ou un graphique.
Un bandeau persistant rappelle période, sélection, comparaison et fraîcheur.

La période sélectionne des mois entiers, bornes incluses. Proposer les 12 derniers
mois disponibles par défaut une fois leur disponibilité connue ; sinon demander
une période explicite. Le mois le plus récent n'est pas présumé complet.
Raccourcis : 3, 6, 12 mois et année civile ; toujours montrer les dates retenues.
Pour une fenêtre de k mois, « période précédente » signifie les k mois immédiatement
antérieurs ; « année précédente » décale les deux bornes de 12 mois.

Filtres cibles : magasins, enseigne, région, format, statut actif/inactif/tous.
Le défaut réseau est **tous**, y compris inactifs, pour ne pas effacer leurs ventes
historiques. Les dimensions du référentiel sont explicitement marquées **actuelles**.
Leurs filtres sélectionnent une cohorte de magasins, sans reconstituer leur ancienne
enseigne ou région. Les typologies historiques restent dans leur onglet dédié.
Un filtre produit/catégorie est local aux onglets compatibles ; il ne doit pas
modifier silencieusement les KPI calculés au grain magasin.

Une sélection vide est un état vide, jamais une bascule implicite sur tous les
magasins. « Tous les magasins » est un choix explicite distinct d'une liste d'IDs.
Conserver période et sélection lors du passage au détail et au retour.
Garder ces préférences en mémoire pour cette version ; aucune donnée métier dans
une URL partageable, un stockage persistant ou une télémétrie.

## Vue réseau

Ordre de lecture :

1. KPI : CA observé, unités vendues, ratio CA/unité, couverture magasins-mois.
   Chaque carte fournit période, unité, statut de complétude et comparaison valide.
2. Courbe mensuelle de CA ; comparaison N-1 en pointillé et couverture dans un
   graphique aligné séparé. Les trous restent visibles, sans interpolation.
3. Barres divergentes des contributions par magasin sur cohorte comparable,
   puis classement tabulaire accessible de l'ensemble des résultats.
4. Tableau des magasins : CA, variation absolue et relative, unités, couverture,
   ambiguïtés ; clic vers la fiche, cases de sélection pour comparer.

Un tri ou un classement réseau doit porter sur tous les résultats filtrés côté
serveur. Trier une page locale n'est permis qu'avec le libellé « Trier cette page ».
Ne pas présenter les observations non attribuées comme un magasin fictif.

## Sélection et comparaison

Deux modes : **Total de la sélection** et **Comparer les magasins**.
Le premier conserve les mêmes définitions que le réseau. Le second utilise des
petits graphiques alignés à la même échelle, jusqu'à six magasins visibles à la fois ;
au-delà, paginer les graphiques sans réduire le périmètre du total sélectionné.
Le tableau conserve la sélection complète et permet une comparaison précise.

Une vue indexée base 100 est facultative : base = premier mois commun choisi,
valeur strictement positive pour chaque série ; afficher le mois de base et retirer
explicitement toute série sans base valide. Elle complète les montants absolus.
Ne pas utiliser un radar ou une double échelle pour comparer les performances.

## Fiche magasin

En-tête : nom, enseigne, région, format, statut et mention « référentiel actuel ».
Les identifiants opérationnels et personnes du référentiel restent dans un panneau
de détail replié, pas dans les cartes de performance.

| Onglet | Contenu | Visualisation |
| --- | --- | --- |
| Synthèse | CA, unités, couverture, évolution mensuelle et comparaison | Courbe, cartes, tableau mensuel |
| Ventes et produits | CA/quantités par GTIN, produits non rapprochés, ambiguïtés, détail des observations | Barres horizontales, tableau, courbe d'un produit sélectionné |
| Présence et linéaire | Présence observée, absences inférées, part de linéaire par catégorie | Courbes séparées par catégorie, table des dénominateurs |
| Activité | Appels, visites terrain, visites participatives | Trois séries distinctes alignées sur les ventes, sans score causal |
| Typologies et assortiments | Valeurs mensuelles, correspondances, candidats exacts et contexte enseigne | Matrice mois/catégorie, listes distinctes et statuts de rapprochement |
| Données détaillées | Référentiel, observations sources publiées, preuves et qualité | Tables paginées, fiche d'une observation |

« Toutes les données » signifie les champs autorisés par le catalogue de l'API,
consultables à la demande. Aucun fichier d'origine, secret ou champ non publié ne
doit être recherché pour compléter l'interface. Les audits opérationnels ne font
pas partie du parcours ordinaire d'un analyste.

Les tableaux de détails précisent leur grain et les unités. Les candidatures
d'assortiment ne sont pas une liste obligatoire de produits. Une catégorie de
présence ne fournit pas automatiquement une catégorie comparable pour les ventes.

## Explorateur Données

La [matrice de couverture](data-coverage.md) affecte chaque champ publié à un écran.
L'entrée **Données** complète les fiches magasins avec trois ensembles : référentiels,
observations et analyses mensuelles. Chaque collection dispose d'une liste paginée
et d'une fiche affichant tous ses champs autorisés, y compris les objets et listes
imbriqués. Les champs techniques peuvent rester dans un panneau replié.

Cet explorateur rend consultables les produits sans ventes, assortiments sans
candidature magasin, règles inutilisées et observations non rapprochées. Les liens
depuis les fiches magasins ouvrent la même fiche de donnée dans leur contexte.
Une ligne sans relation résolue reste dans sa collection globale. Seuls les filtres
disponibles dans le catalogue sont proposés ; une recherche globale supplémentaire
doit être prise en charge par l'API avant d'être annoncée dans l'interface.

Les audits d'import et de publication sont accessibles dans **Qualité des données →
Opérations**, uniquement avec `operations:read`. Ils ne sont pas chargés pour un
lecteur ordinaire. La matrice décrit cette couverture cible, pas une interface livrée.

## Qualité et états d'interface

Afficher fraîcheur analytique, mois disponibles, couverture des mesures,
ambiguïtés et attribution au réseau. La qualité d'attribution réseau n'est pas
filtrable par magasin dans le contrat actuel : son périmètre reste explicite.

Chaque bloc distingue chargement, résultat, absence d'observation, zéro mesuré,
ambiguïté, chargement incomplet et erreur. Une donnée périmée peut être consultée
avec avertissement ; une vue non initialisée n'affiche aucun KPI fictif.
Si seule une section échoue, les autres restent utilisables avec leur statut.

## Référence visuelle

[DESIGN.md](../../DESIGN.md) centralise le thème MUI, la typographie, les dispositions
responsive, les composants, les graphiques et les états communs. Appliquer ces règles
à chaque écran ; les parcours et la sémantique des filtres restent définis ici.
