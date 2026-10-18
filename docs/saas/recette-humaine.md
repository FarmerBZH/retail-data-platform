# Première campagne de recette utilisateur

Ce scénario vérifie les parcours effectivement disponibles sur cinq magasins,
depuis leur sélection jusqu'aux données détaillées. Il complète les
[critères de réception](acceptance.md) et le
[parcours des analyses filtrées](filtered-analysis.md). Sa préparation ne vaut
pas exécution ni réception du produit.

## Périmètre et traces

L'utilisateur manipule l'interface ; l'accompagnateur consigne les observations
après chaque étape. Les résultats attendus sont définis avant de valider une étape.
Les codes opérationnels, noms, villes, identifiants, dates de publication et
résultats réels restent dans un compte rendu privé hors du dépôt. Les exemples
et futurs tests versionnés doivent être entièrement synthétiques.

« Toutes les données » désigne les champs publiés autorisés du catalogue, avec
leurs objets et listes imbriqués, consultables à la demande. Cela ne prouve ni
la complétude des sources ni l'exhaustivité économique du chiffre d'affaires.
Les fichiers d'origine et les audits réservés aux opérations sont exclus du
parcours ordinaire. La [matrice des données](data-coverage.md) permet de vérifier
les collections et champs attendus.

## Préparation — H00

Consigner dans le compte rendu privé :

- Date, opérateur, version Git et modifications locales éventuelles ; navigateur,
  système, largeur d'écran et rôle utilisé, sans identifiant de connexion ni secret.
- Disponibilité de l'interface, de l'API et du fournisseur d'identité. Une réponse
  du contrôle de vie ne suffit pas à prouver l'accès aux données : vérifier aussi
  la connexion personnelle, le catalogue autorisé et le statut de publication.
- Correspondance de chacun des cinq codes SAP avec une seule fiche : `erp_code`,
  identifiant applicatif, nom, ville et présence dans le périmètre publié.
  Une correspondance absente ou ambiguë bloque le magasin concerné.
- État de fraîcheur, dernière publication et bornes par magasin et domaine.
  Les lectures préparatoires de la base sont en lecture seule ; elles ne remplacent
  pas la vérification des droits et du rendu dans l'interface.

La recherche actuelle d'Analyses filtrées accepte le nom ou la ville. Utiliser
les correspondances préparées pour sélectionner les magasins ; contrôler ensuite
leur code dans la fiche. Si les libellés ne permettent pas une sélection sûre,
consigner un blocage plutôt que sélectionner une fiche au hasard.

Prendre la première et la dernière période publiées sur l'ensemble des cinq
magasins et des domaines observés. Conserver les bornes propres à chaque source :
une période globale ne garantit pas leur disponibilité commune. S'il n'existe
aucune observation, arrêter l'analyse et documenter l'absence.

L'interface accepte au maximum 120 mois inclusifs. Si nécessaire, découper
l'historique en fenêtres consécutives de 120 mois au plus, sans trou ni doublon,
et répéter H02 à H04 pour chacune. Désactiver les filtres de dimensions et utiliser
la référence annuelle pour une recette reproductible. Une référence hors des
données disponibles doit rester indisponible, sans zéro inventé.

## Scénario guidé

| Étape | Manipulation | Résultat attendu |
| --- | --- | --- |
| H01 — Sélection | Se connecter, ouvrir **Analyses filtrées**, choisir **Sélection explicite**, rechercher et cocher les cinq magasins, y compris entre plusieurs recherches/pages. | Exactement cinq magasins distincts sélectionnés ; aucun filtre supplémentaire ; aucune bascule implicite sur tout le réseau. |
| H02 — Ensemble | Saisir la fenêtre historique et la référence annuelle, puis **Appliquer l'analyse**. Lire synthèse, évolution, classement, contributions, comparaison et disponibilité. | Cinq magasins demandés, reconnus et retenus ; les cinq séries sont consultables. Les totaux concernent tout le périmètre appliqué. Dates, publication, cohortes, inclus/exclus et couverture sont explicites. |
| H02b — Cohortes | Comparer le résultat général et le mode cohorte comparable, puis consulter les tableaux exacts et détails repliés. | Chaque mesure annonce sa propre couverture. Les exclusions ou références absentes sont expliquées ; les pourcentages à base nulle/zéro et les bases négatives ne produisent pas de croissance trompeuse. |
| H03 — Fiche | Depuis le classement ou une série, ouvrir chaque magasin et confirmer son code SAP dans **Données détaillées**, référentiel déplié. Parcourir les six onglets ci-dessous. | La fiche correspond au magasin attendu ; la période est transmise. Les données et leurs grains sont lisibles ; les manques, erreurs et limites sont visibles. |
| H04 — Couverture | Compléter la grille pour chaque magasin et domaine, en parcourant les pages et les détails autorisés nécessaires. | Chaque domaine reçoit un statut et une justification. Une première page ou une collection tronquée ne permet pas de déclarer l'exhaustivité. |
| H05 — Retour | Revenir avec le bouton de l'application ; répéter avec le retour navigateur. Vérifier le clavier et le focus. | Sélection, période, référence et contexte appliqué sont conservés ; le focus revient au déclencheur. Aucun autre magasin ne remplace la sélection. |
| H06 — Session | Se déconnecter, puis utiliser le retour navigateur. | Données protégées, sélection et résultats disparaissent ; aucune ancienne fiche ne reste consultable sans nouvelle connexion. |

Si la publication change, consigner l'événement et relire explicitement le
contexte avant de reprendre. Ne pas comparer comme simultanées des valeurs
provenant de publications différentes : les fiches natives ne partagent pas
la garantie de publication des réponses d'Analyses filtrées.

## Contrôles par magasin — H03 et H04

Répéter ces contrôles pour chacun des cinq magasins et chaque fenêtre historique.

| Domaine / onglet | Contrôles attendus |
| --- | --- |
| Référentiel / Données détaillées | Code SAP exact, identité, nom/ville, attributs actuels et champs autorisés du panneau replié. Le référentiel actuel ne décrit pas nécessairement l'historique. |
| Synthèse | CA observé, unités, mois disponibles/manquants, couverture, graphique et tableau exact ; comparaisons M−1/N−1 et bases indisponibles expliquées. Aucune devise ni qualification HT/TTC déduite. |
| Ventes et produits | Produits, quantités, montants, rapprochements et ambiguïtés ; détails et pages suivantes. Distinguer produit sans donnée et zéro mesuré. |
| Présence et linéaire | Présence observée/absence inférée, catégories, parts et dénominateurs ; ne pas assimiler les catégories à celles des ventes sans preuve. |
| Activité | Appels, visites terrain et participatives séparés ; observations, périodes et valeurs détaillées. Ne pas attribuer une causalité à leur alignement avec les ventes. |
| Typologies et assortiments | Valeurs mensuelles, correspondances, candidats et ambiguïtés. Une candidature ne constitue pas une obligation d'assortiment. |
| Collections détaillées | Collections autorisées liées au magasin, toutes les pages nécessaires, fiches et enfants imbriqués. Compléter via **Données** selon les filtres du catalogue. Les observations sans relation résolue ne peuvent pas être attribuées arbitrairement au magasin. |

Noter les bornes et lacunes par source plutôt que conclure « toutes les données »
à partir d'un écran rempli. Si une limite de collection empêche l'inspection,
réduire explicitement la fenêtre quand c'est possible ; sinon consigner la limite
et laisser l'exhaustivité non vérifiée. Ne pas contourner les plafonds par un
téléchargement du réseau entier.

## Grille et anomalies

Copier les grilles suivantes dans le compte rendu privé. Ne jamais remplir ce
document public avec les résultats réels.

| Magasin | Référentiel | Synthèse / comparaisons | Ventes / produits | Présence / linéaire | Activité | Typologies / assortiments | Collections détaillées |
| --- | --- | --- | --- | --- | --- | --- | --- |
| M1 | Non vérifié | Non vérifié | Non vérifié | Non vérifié | Non vérifié | Non vérifié | Non vérifié |
| M2 | Non vérifié | Non vérifié | Non vérifié | Non vérifié | Non vérifié | Non vérifié | Non vérifié |
| M3 | Non vérifié | Non vérifié | Non vérifié | Non vérifié | Non vérifié | Non vérifié | Non vérifié |
| M4 | Non vérifié | Non vérifié | Non vérifié | Non vérifié | Non vérifié | Non vérifié | Non vérifié |
| M5 | Non vérifié | Non vérifié | Non vérifié | Non vérifié | Non vérifié | Non vérifié | Non vérifié |

Statuts : **conforme** (contrôle effectué et résultat attendu constaté),
**anomalie** (écart constaté), **bloqué** (contrôle impossible, motif décrit),
**non vérifié** (pas encore exécuté). Une donnée vide n'est conforme que si son
absence est expliquée ; une hypothèse ne vaut pas vérification.

Pour chaque cellule, noter fenêtre testée, bornes observées, lacunes, pagination,
preuves textuelles utiles et référence d'anomalie. Ne conserver ni jeton, mot de
passe, trace réseau, état de session, ni capture contenant des données réelles.

| Anomalie | Étape / magasin / domaine | Type | Reproduction et contexte | Attendu | Observé | Impact / suivi |
| --- | --- | --- | --- | --- | --- | --- |
| À renseigner dans le compte rendu privé | — | Donnée manquante, limite d'interface ou dysfonctionnement | — | — | — | — |

## Critères de clôture

- H01 à H06 ont un résultat consigné ; chaque cellule possède un statut justifié.
- Tous les magasins et domaines ont été examinés sur tout l'historique, ou les
  parties impossibles à examiner sont identifiées comme bloquées.
- Chaque absence et chaque limite sont expliquées ou associées à une anomalie
  ouverte. Tout contrôle non exécuté reste non vérifié.
- Distinguer **campagne terminée** et **recette acceptée** : la clôture du compte
  rendu ne résout pas les anomalies et ne certifie pas la production.

Les améliorations découvertes, notamment la sélection directe par codes SAP,
feront l'objet de changements distincts avec tests synthétiques et contrôles du
projet. Ce scénario ne modifie ni API, ni schéma, ni comportement applicatif.
