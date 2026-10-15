# T24 — Analyses réseau filtrées et comparaison de magasins

Statut : **T24A commitée après relecture et approbation explicite** ;
T24B et T24C restent à faire. Ce contrat couvre les trois étapes dépendantes ;
seul le socle PostgreSQL de T24A est développé à ce stade. Les routes et écrans
T24B/C restent des exigences, sans implémentation. Aucun commit, push ou déploiement
n’est autorisé par ce document. Les limites des livraisons
existantes restent celles de [l’architecture](../architecture.md).

## Résultat attendu et périmètre

Passer du réseau global T23 à une analyse filtrée : choisir les magasins,
l’enseigne, la région, le format et le statut ; lire un total et une série mensuelle ;
comparer une fenêtre à la précédente ou à N−1 ; identifier les contributions et
ouvrir une comparaison de magasins avec le même contexte.

Les sources restent celles déjà importées. Aucune nouvelle source privée n’est
requise pour cette tranche. Les informations inconnues (devise, HT/TTC, marge,
clients, garantie de CA exhaustif) restent inconnues. Les ouvertures/fermetures et
l’historique économique des magasins ne sont pas reconstruits.
Le mode base 100 et les enrichissements visuels P1 restent hors T24.

| Étape | Livrable vérifiable seul | Message de commit proposé |
| --- | --- | --- |
| T24A — PostgreSQL | Vues complémentaires, calculs SQL paramétrés, modèles, migration et tests réels | `Add filtered network analytics foundations` |
| T24B — API | Contrats typés, routes de lecture, pagination, publication et tests de sécurité | `Expose filtered network analytics endpoints` |
| T24C — SaaS | Filtres, sélection, totaux, cohortes, classement et comparaison, avec tests navigateur | `Add filtered network and store comparisons` |

Chaque commit contient ses tests et sa documentation. T24B réutilise les calculs
SQL testés dans T24A ; T24C consomme les contrats testés dans T24B. Aucun de ces
commits ne doit dépendre de fichiers encore non commités de l’étape suivante.

## Contrat métier commun aux trois commits

### Périmètre et dimensions

- `scope=all` sélectionne tous les magasins publiés, y compris inactifs par défaut.
  `scope=selection` exige de 1 à 100 identifiants distincts. Une sélection vide est
  un état vide dans le frontend et une requête invalide dans l’API ; jamais « tous ».
- Filtres exacts combinés par ET : `retailer_name`, `region_code`, `store_format`,
  `activity_status=all|active|inactive`. Un seul choix par dimension dans T24.
  Les dimensions sont celles du référentiel **à la publication**, jamais un
  historique ni une règle d’autorisation. `all` laisse le filtre de statut ouvert.
- En sélection explicite, les filtres s’appliquent à l’intersection. Distinguer
  `requested_store_count`, `resolved_store_count`, `filtered_out_store_count` et
  `scope_store_count`. Un ID inconnu de la publication est rejeté explicitement,
  sans liste de valeurs privées dans l’erreur. Un périmètre filtré vide est valide
  avec zéro magasin, mesures nulles et couverture indéfinie.
- Le filtre de recherche `q` sert uniquement à trouver les magasins ; il ne modifie
  pas silencieusement le périmètre analytique. Les IDs sélectionnés sont conservés
  entre pages, indépendamment de la recherche en cours.

### Mois, mesures et couverture

- Dates au premier du mois, inclusives, de 1 à 120 mois. La fenêtre de référence
  contient autant de mois : immédiatement précédente ou décalée de douze mois.
  Valider les bornes calendaires avant calcul, y compris les années limites.
- La grille attendue est le produit des magasins filtrés et des mois demandés,
  même hors calendrier analytique publié. Une cellule absente reste absente ; elle
  empêche un montant complet et ne devient jamais zéro. Ne pas réduire le
  dénominateur aux seules lignes trouvées.
- Pour CA, unités, appels, visites terrain et participatives : montant complet si
  toutes les cellules ont une valeur ; montant partiel sur cellules valides ; null
  si aucune cellule valide. Couverture propre à chaque mesure. Le CA/unité exige
  les mêmes cellules complètes et une somme d’unités non nulle.
- Décimaux SQL `numeric`, sérialisés en chaînes ; les ratios restent des fractions.
  Aucun calcul métier en flottants ni somme de ratios. Les diagnostics produit non
  ambigus restent distincts des mesures complètes par magasin.
- Les observations non attribuées restent dans leur qualité dédiée. Elles ne sont
  ni distribuées entre magasins, ni assimilées à un montant de CA manquant.

### Comparaisons, cohortes et contributions

Deux lectures distinctes : périmètre filtré complet et cohorte comparable. Pour
chaque mesure, la cohorte est l’ensemble des magasins dont toutes les cellules
courantes **et** de référence sont valides. Cette cohorte est figée sur les deux
fenêtres entières, y compris pour les points de leurs séries. Exposer les comptes
inclus/exclus propres à chaque mesure ; aucune cohorte ne signifie aucune mesure,
pas zéro. CA et unités peuvent avoir des cohortes différentes ; le CA/unité sur
cohorte utilise leur intersection et annonce ce périmètre.

La comparaison du périmètre complet est indisponible si une cellule requise manque.
Sur la cohorte : différence = somme courante − somme de référence ; ratio =
différence / référence, null sur référence zéro. Une base négative conserve la
différence ; le frontend masque le pourcentage et indique « base négative ».
Une cohorte comparable ne prouve pas un assortiment ou périmètre économique constant.

Le classement T24 porte sur le CA. Le tri par montant utilise le total magasin de
la fenêtre courante ; une mesure incomplète est null. Le tri par contribution
utilise la variation absolue des magasins de la **cohorte CA figée**. Les exclus
restent consultables avec motif, sans contribution inventée. L’ordre porte sur
l’ensemble du périmètre avant pagination, avec nulls à la fin et UUID pour départager
les égalités. Un rang ordinal suit cet ordre stable ; aucun pourcentage de part
de contribution n’est calculé lorsque la variation totale est nulle.

Oracle synthétique commun : référence A=100, B=200 ; courant A=120, B=null.
Le périmètre courant affiche 120 partiel, couverture CA 1/2 ; sa variation complète
est indisponible. La cohorte CA contient A seul : courant 120, référence 100,
contribution 20, ratio 0.2, un exclu. Si B=0 mesuré, courant complet 120, référence
300, contributions A=20 et B=−200, variation −180 et ratio −0.6. Répliquer ces
résultats attendus en SQL, API et UI sans calculer l’oracle avec le code testé.

La somme des contributions de toute la cohorte doit égaler sa variation exacte.
Le serveur fournit ce contrôle global ; le navigateur ne somme pas une page pour
le reconstituer. Les exclusions exposent des motifs fermés (mois absent, mesure
manquante, ambiguïté connue), sans attribuer une cause inconnue à la donnée absente.

## T24A — Socle PostgreSQL et calculs

### Vues nécessaires et réutilisation

Conserver les quatre vues globales existantes et leurs contrats. Réutiliser
`analytics_store_month` au grain `(store_id, period)` pour les mesures ; ne pas
refaire les jointures ventes/activité/catégories qui multiplieraient les montants.

Deux vues matérialisées internes sont définies par la migration `20261015_15` :

| Vue interne | Grain et projection minimale | Justification |
| --- | --- | --- |
| `analytics_store_scope` | Un magasin : `store_id`, `name`, `city`, `retailer_name`, `region_code`, `store_format`, `is_active` | Filtres/recherche sur un référentiel cohérent avec les mesures, y compris magasins sans observation ou calendrier vide ; pas de données personnelles supplémentaires |
| `analytics_store_dataset_month` | `(store_id, period, dataset)` ; compte des lignes d’observation et, pour la distribution, compte séparé des lignes d’absence inférée | Disponibilité réellement observée par source, sans confondre calendrier dense, livraison complète et zéro mesuré |

La seconde vue expose `source_row_count`, `observed_row_count` et
`inferred_absence_row_count` ; le premier est la somme des deux autres.
Elle utilise les cinq domaines déjà publiés dans la qualité : `register`,
`activity`, `distribution`, `shelf`, `typology`. Normaliser les dates au mois,
retenir uniquement les magasins rapprochés, compter les instantanés de typologie
avant les valeurs enfants et garder les absences inférées identifiables. Une
activité ambiguë ou erronée reste une observation ; elle ne prouve pas une mesure
valide. Produits et assortiments globaux ne sont pas transformés en observations
magasin. Un mois sans ligne signifie « aucune observation publiée », jamais
« source non livrée » : les sources ne prouvent pas ce dernier état.

Les totaux sur fenêtre, cohortes, séries et classements sont des **requêtes SQL
paramétrées**, pas des vues matérialisées pour chaque sélection. Le module
`database/network_analysis.py` fournit `Scope`, `Window`, `RankKey` et
`AnalysisReader`, réutilisables par T24B sur les vues publiées. Aucune fonction SQL privilégiée, SQL arbitraire ou
extension n’est requise. Un ajout de vue/index supplémentaire doit répondre à une
requête mesurée, avec sa projection, son grain et son test.

### Travaux et fichiers concernés

- Nouvelle révision Alembic après `20260930_14`, SQL versionné sous
  `migrations/sql/`, mappings alignés dans `database/analytics.py`. Ne pas modifier
  les anciennes migrations. Contraintes de grain par index uniques ; indexes de
  filtre/tri justifiés par plans sur données synthétiques.
- Intégrer les nouvelles vues à l’ordre de `analytics.py`, au refresh atomique,
  à `ANALYZE`, à la détection d’initialisation/fraîcheur et à l’audit existant.
  Le référentiel et les observations changent dans la même publication que les
  mesures ; échec ⇒ rollback complet et ancienne publication conservée.
- Tester le module SQL sans FastAPI : grille attendue, filtres, agrégations,
  fenêtres, cohortes figées, classement global et pagination. Fixer les résultats
  attendus indépendamment des requêtes, à partir de petites fixtures synthétiques.
- Les vues restent internes à ce commit : aucun ajout à `/v1/resources` ni nouveau
  grant au lecteur HTTP. Le registre existant et le frontend T23 restent valides.
  Mettre à jour le contrat backend et l’architecture seulement après vérification.

### Interface SQL de T24A

`AnalysisReader` reçoit une connexion existante et un `Scope`. La `Window` et
le mode de comparaison servent aux calculs ; recherche, dimensions et bornes
restent utilisables avant le choix d’une période. Un calcul sans fenêtre échoue
avec `analysis_window_required`. Il valide les IDs de la publication avant les filtres,
conserve les comptes du périmètre et produit les lectures SQL de synthèse, série,
classement, recherche, dimensions et disponibilité. Les erreurs de validation
sont des codes génériques sans valeurs. Les résultats restent des objets Python
avec `Decimal` ; les schémas HTTP et leur sérialisation appartiennent à T24B.

Le lecteur ne crée ni transaction ni connexion. Le futur service T24B doit
l’instancier et effectuer ses lectures dans une même transaction read-only
repeatable-read ; la précondition de publication entre requêtes n’est pas fournie
par T24A. Les lectures de tests de calculs utilisent une transaction synthétique.
Les tests de cycle de publication utilisent de vraies connexions concurrentes.

Les pages de recherche, dimensions et classement prennent une ligne d’anticipation
(`limit + 1`) ; l’adaptateur HTTP T24B doit la retirer et construire le curseur lié
au contexte. `RankKey` contient valeur exacte éventuellement nulle et UUID. Les
rangs sont calculés avant filtrage du curseur. Les séries individuelles chargent
au plus six magasins sans ligne d’anticipation métier ; T24B peut vérifier la
page suivante via la recherche bornée, sans charger leurs séries.

Disponibilité mensuelle : lignes éparses, au plus cinq domaines × 120 mois ;
les bornes ne considèrent que les observations rapportées, pas les absences
inférées seules. Un domaine absent reste indisponible. `dimension_missing_count`
complète les pages d’options non nulles. Le moteur ne génère pas de valeurs zéro
pour les mois sans ligne. Une série sur périmètre vide est vide.

### Réception du commit 1

Migration à neuf, downgrade/upgrade depuis la nouvelle révision et `alembic check`
sur PostgreSQL isolé réel. Tests de refresh initial, refresh échoué, publication
concurrente, modification du référentiel sans refresh, magasin sans données et
calendrier vide. Vérifier l’absence de changement des résultats des vues globales.

Oracles : 0.1 + 0.2 = 0.3 ; absent ≠ zéro ; retour négatif ; activité couverte sans
ventes ; fenêtre hors disponibilité ; sélection vide ; catégories multiples sans
multiplication du CA ; cohorte différente selon la mesure ; références zéro et
négative ; somme des contributions exacte ; égalités de tri et deux pages.
Baseline Python complète, revue de sécurité du diff et absence de données privées.
Un PostgreSQL indisponible laisse la réception T24A ouverte : les tests ignorés ne
sont pas une preuve de calcul ou de migration.

### Vérifications locales de T24A

Format, lint, mypy et 218 tests Python réussis sur PostgreSQL 18 isolé, avec les
migrations à neuf et cycles de downgrade/upgrade et `alembic check`. Aucun test
PostgreSQL ignoré ; un callback OIDC opt-in reste désactivé. Les deux tests de
réconciliation du contrat frontend passent : 28 ressources publiques inchangées.
La revue de sécurité finale s’est terminée sans vulnérabilité retenue, y compris
sur le découplage des lectures de découverte et de la fenêtre. La relecture
technique est terminée et le propriétaire a explicitement approuvé le commit.
Ces résultats ne valident ni les futurs endpoints ni la recette SaaS T24B/C.

## T24B — API analytique de lecture

### Routes proposées à figer dans OpenAPI

Préfixe proposé `/v1/analytics/analysis` pour séparer ces réponses métier des
collections natives `/v1/data/*` et préserver `/v1/analytics/status`.
Ces noms sont une proposition de contrat, pas des routes déjà disponibles.

| Route GET sous ce préfixe | Réponse attendue |
| --- | --- |
| `/stores` | Recherche `q` (nom/ville), filtres de dimensions, pagination par magasin ; référentiel publié et statut, sans téléchargement de tout le réseau |
| `/dimensions` | Valeurs distinctes paginées d’une dimension autorisée, recherche bornée et indication de valeurs manquantes ; options de filtres indépendantes d’une première page de magasins |
| `/availability` | Bornes observées par domaine sur le périmètre ; avec fenêtre explicite, au plus 120 mois de comptes et d’absence d’observation, absences inférées séparées |
| `/summary` | Totaux courants/référence, mesures complètes/partielles, couverture, cohortes, exclusions et somme globale des contributions |
| `/series` | Au plus 120 mois courants, références alignées et dates de référence explicites ; cohorte figée par mesure, couverture à chaque point |
| `/ranking` | CA/variation par magasin sur l’ensemble filtré, rang stable, motif d’exclusion et curseur ; tri autorisé `revenue` ou `revenue_change`, ascendant/descendant |
| `/store-series` | Séries individuelles paginées par magasin, au plus six magasins par page ; le total sélectionné ne dépend jamais de cette page |

Les options de dimensions proviennent du même référentiel publié, sans données personnelles
supplémentaires ni identifiants sources. Préserver les valeurs manquantes comme telles ; le filtre
sur une dimension dans T24 sélectionne une valeur exacte non nulle. Une recherche
vide retourne la page stable habituelle ; aucun filtre implicite d’activité.

### Entrées, limites et projections

Schémas dédiés avec champs supplémentaires interdits. `scope`, fenêtres et filtres
communs suivent le contrat métier ci-dessus. Seule la liste `store_ids` accepte
une répétition de paramètre (maximum 100, sans doublon) ; tout scalaire dupliqué est
rejeté. `scope=all` avec IDs, ID invalide/inconnu, intervalle inversé, comparaison
inconnue, tri inconnu et filtre non pris en charge donnent une erreur explicite.

Conserver les limites d’URL, réponse (2 MB), délai SQL, pool et budget par sujet.
Bornes initiales : `q` de 1 à 128 caractères lorsqu’il est fourni ; filtres exacts
aux longueurs des colonnes ; page 1–200 (défaut 50) ; curseur au plus 8192 caractères ;
120 mois courants et au plus 120 de référence ; six magasins par page de séries.
La limite de 100 IDs reste subordonnée au plafond d’URL existant : ne jamais la
contourner par un corps GET ou une nouvelle méthode d’écriture.

Définir avant de coder les handlers les modèles requête/réponse et erreurs
stables : montants/ratios en chaînes, dates mensuelles, compteurs entiers, clés
explicites pour valeurs et couverture. Répondre avec `publication_id`, fraîcheur,
périmètre normalisé, fenêtres et mode de comparaison effectifs. Les pages utilisent
`items` et `next_cursor` ; les totaux agrégés sont identifiés séparément et ne
proviennent jamais d’un `count` ou d’une somme sur les lignes de la page.
Ne pas publier automatiquement toutes les colonnes des nouvelles vues.

Projection minimale à figer avec les modèles T24B :

| Objet | Champs requis |
| --- | --- |
| Contexte | `publication_id`, fraîcheur publique, scope, filtres normalisés, comptes de magasins, bornes courantes/référence, mode de comparaison |
| Mesure | valeur complète, valeur partielle, cellules couvertes/attendues ; null explicite, jamais champ omis à sa place |
| Comparaison | valeurs courante/référence, différence, ratio, qualification de base, magasins inclus/exclus et couverture ; périmètre complet et cohorte séparés |
| Point mensuel | mois courant, mois de référence effectif, valeurs et couverture ; cohorte identique pour tous les points de la fenêtre |
| Ligne de classement | ID magasin, libellé/dimensions publiés utiles, rang ordinal, CA courant/référence, couverture, contribution et motif d’exclusion |
| Disponibilité | domaine, premières/dernières observations, comptes observés par mois demandé et absences inférées séparées ; aucune preuve de livraison déclarée |

Ces objets analytiques ont leur propre matrice de champs vers les composants ;
ils ne sont pas ajoutés comme des colonnes fictives au registre des collections.
Mettre à jour la matrice de couverture et les tests correspondants dans T24B/C,
y compris les nouvelles métadonnées et les états nuls.

### Cohérence de publication et curseurs

- Utiliser l’UUID du dernier refresh réussi comme `publication_id`, jamais les
  hashes, noms de fichiers ou IDs des imports sources. Lire l’ID, les dimensions,
  les mesures et la fraîcheur dans une **même transaction read-only repeatable-read**.
  Le helper actuel ouvre seulement une transaction read-only : cette garantie est
  donc à implémenter et tester, pas à présumer.
- La première réponse initialise l’ID côté client. Les lectures suivantes d’un
  contexte et les pages demandent cet ID. Une publication différente produit
  `409 publication_changed`, aucune donnée d’un autre contexte. Publication non
  initialisée : `503 analytics_uninitialized` ; ancienne publication : résultats
  autorisés, fraîcheur et échec de refresh éventuel visibles.
- Aucun historique de snapshots ni cache serveur de résultats n’est ajouté.
  L’ID est une précondition de lecture et non un accès à une ancienne publication.
  Il ne remplace jamais l’authentification. Le serveur ne fabrique pas de nouveau
  snapshot pour un client et ne déclenche pas de refresh via HTTP.
- Curseur lié à l’endpoint, l’ID, tous les filtres normalisés, fenêtres, mode,
  tri/direction et dernière clé typée (y compris nulls). Contexte différent : rejet.
  Aucun SQL issu du curseur ; toutes les valeurs sont validées et liées comme
  paramètres. Ne pas présenter un curseur opaque comme secret ou droit d’accès.

### Sécurité et réception du commit 2

Réutiliser l’identité personnelle, `data:read` et l’accès global à une organisation.
Aucun nouveau scope et aucune lecture OPS côté utilisateur. Si le serveur utilise
l’ID du refresh, il n’expose que cet ID et la fraîcheur publique, pas l’audit complet.
Étendre explicitement le manifeste interne des colonnes SQL autorisées pour ces
requêtes, `grant_sql` et la validation de démarrage, sans inscrire arbitrairement
ces vues dans le catalogue des collections. Ajouter les droits minimaux requis ;
le service ne les applique pas et reste sans droit d’écriture ni ownership.

Tests API et PostgreSQL réels : claims/scopes invalides, rôle SQL insuffisant ou
surprivilégié, SQL lié sur recherches/filtres/curseurs hostiles, texte rendu comme
texte, erreurs sans valeurs, `no-store`, URL trop longue, réponse 413, 429/503,
annulation/délais et budget de requêtes. Recherche `%`/`_` traitée comme texte de
recherche, sans wildcard utilisateur implicite ; tri seulement sur liste fixe.
Vérifier publication changée entre pages et refresh pendant une réponse composée.
Le référentiel vivant peut évoluer sans modifier le périmètre publié.

La séparation des droits SQL doit rester compatible avec le lecteur existant.
Un ancien client frontend doit accepter le catalogue natif inchangé et continuer
à utiliser les routes T23. Les routes analytiques ont leurs schémas et leur
découverte dans l’OpenAPI authentifié ; les listes fixes frontend sont étendues
seulement en T24C. Documenter erreurs, grants, compatibilité et mise en service.
Baseline Python complète et revue de sécurité du diff avant réception.

## T24C — Frontend SaaS

- Étendre le transport fixe existant pour les routes T24B, décodeurs stricts,
  pagination, cache en mémoire et annulation ; intégrer `publication_id` aux clés
  de contexte/cache. Sur 409, retirer les blocs dépendants et proposer une relecture
  du contexte entier. Aucune boucle automatique ou mélange silencieux de versions.
- Unifier période, référence, filtres et sélection dans le workspace. Brouillons
  et filtres appliqués distincts ; Appliquer remplace le contexte et masque les
  anciennes valeurs pendant lecture. Conserver le contexte au passage classement →
  magasin → retour, puis l’effacer à expiration/déconnexion/changement d’utilisateur.
- Ajouter recherche serveur, options de filtres paginées et sélection persistante
  entre pages en mémoire ; compteur et choix « tous » explicites, limite 100
  annoncée. Une recherche/facette chargée n’est jamais un total ni le réseau entier.
- Vue réseau filtrée : KPI de fenêtre, couverture par mesure, courbes courante et
  référence alignées, panneau de couverture et alternative tabulaire exacte.
  Basculer périmètre complet/cohorte comparable, afficher inclus/exclus et limites.
  Garder les synthèses annuelle/globale T23 utilisables et distinctes : leurs
  totaux ne deviennent pas filtrés par une dimension qu’elles n’acceptent pas.
- Classement : pagination et tri serveur, contributions sur cohorte CA, exclus
  identifiables et clic vers fiche. Barres avec zéro commun, sans couleur qui
  affirme une amélioration métier ni somme locale d’une page en guise de total.
- Comparaison : total sur toute la sélection, séries individuelles et tableau,
  jusqu’à six magasins visibles ; pagination des séries sans modifier le total,
  échelles absolues communes et couleurs stables dans la session. Ne pas télécharger
  toutes les pages du réseau pour dessiner une comparaison.
- Conserver Material UI, MUI X Charts Community et les tokens de DESIGN. Valeurs
  exactes, null/zéro, base négative, erreur locale, fraîcheur, absence d’observation,
  graphique vide, 403 et publication non initialisée ont chacun un état lisible.
  HTML et libellés sources restent du texte ; aucun token ni résultat métier en
  URL de navigation, logs, télémétrie ou stockage navigateur.

### Réception du commit 3

`npm run check` complet, tests unitaires des décodeurs/états et composants, E2E
synthétiques avec requêtes inattendues interdites, axe et clavier aux largeurs
360/768/1440. Vérifier focus, mouvement réduit, défilement des tables, sept magasins,
seconde page, changement de filtre pendant lecture, 409, refus, publication ancienne,
reconnexion et retour navigateur. Recette humaine du zoom natif 200 % et lecteur
d’écran distincte des tests automatisés.

Les exemples A/B du contrat des indicateurs doivent avoir les mêmes résultats en
PostgreSQL, API et UI. Ajouter une recette intégrée OIDC/API/PostgreSQL avec identité
synthétique sur l’environnement défini, sans changer implicitement le client autorisé.
Les mocks seuls ne valident pas cette intégration. Exécuter la revue de sécurité du
diff et une revue cumulative de T24A–C pour les interactions entre couches.

## Déploiement, performance et fin de tâche

Ordre de mise en service : migration compatible avec l’ancienne API → refresh
réussi → grants minimaux relus et appliqués par l’administrateur → API T24B →
frontend T24C. Garder une possibilité de revenir au client/API précédents ; pour
un downgrade de schéma, retirer d’abord les consommateurs T24 et révoquer les
grants obsolètes avant de supprimer les vues. Pas de migration/refresh au démarrage
HTTP et pas de déploiement implicite pendant le développement.

Profil synthétique initial de T24A à étendre et réutiliser en T24B/C :
300 magasins × 24 mois de ventes (7 200 observations), trois enseignes, quatre
régions, actifs/inactifs, fenêtres courante et référence de deux mois. Le test
mesure les plans de synthèse complète, synthèse filtrée sur 25 magasins et
classement ; les sorties restent une synthèse, deux points ou une page bornée.
Ces mesures ponctuelles ne constituent ni un p95 ni un volume cible validé.

Pour la qualification :
petit oracle exact, puis volume représentatif annoncé, magasins/mois, densité,
ambiguïtés, filtres sélectifs/non sélectifs et classements. Mesurer plans SQL,
latences p95, lignes/bytes, requêtes HTTP et mémoire navigateur avec et sans
pagination. Un timeout SQL ou un plafond de réponse n’est pas un budget de
performance produit. Les seuils de production et la charge concurrente restent
à valider avant réception de production ; ne pas recycler les petits budgets T22.

Terminé quand les trois commits sont relus, leurs tests requis sont exécutés,
les contrats et matrices reflètent uniquement les champs réellement publiés,
les exclusions/cohortes/contributions concordent et les limites restantes sont
annoncées. Mettre à jour `docs/architecture.md` à chaque frontière effectivement
implémentée et vérifiée ; ne pas y recopier ce projet comme une capacité livrée.
Les preuves de tests, revues de sécurité et recettes réelles restent distinguées.
