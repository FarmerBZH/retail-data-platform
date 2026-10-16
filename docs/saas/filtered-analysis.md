# Analyses filtrées du SaaS

T24C ajoute l’entrée **Analyses filtrées**, distincte des synthèses globales T23
conservées dans **Vue réseau**. Elle utilise les sept routes du
[contrat API T24B](../filtered-analysis-api.md), sans modifier le catalogue natif,
les sources, les droits d’accès ou les calculs PostgreSQL.
Les résultats de vérification et les limites de réception sont suivis dans
[les tâches](tasks.md#t24c--réaliser-les-parcours-saas).

## Parcours implémenté

La découverte demande une publication et ses bornes observées. Elle ne charge
aucune synthèse avant une application explicite. On peut renseigner deux mois
ou choisir les douze derniers mois observés, bornés par la disponibilité publiée.
La fenêtre courante et sa référence sont visibles dans les résultats.

Les brouillons regroupent période, référence précédente ou annuelle, enseigne,
région, format, statut et mode tous/sélection. Chaque dimension propose des
options recherchées et paginées côté serveur ; les valeurs absentes et le texte
vide restent distincts. Les options ne sont pas déduites d’une page de magasins.
La recherche par nom/ville trouve des magasins sans modifier le périmètre appliqué.
Elle conserve les cases sélectionnées entre les pages et recherches. Les choix
restent en mémoire, avec retrait individuel et plafond de 100 identifiants.

**Tous les magasins filtrés** est un choix explicite, distinct de
**Sélection explicite**. Une sélection vide ne déclenche aucune lecture analytique
sur tous les magasins. Les filtres intersectent une sélection ; les résultats
montrent identifiants demandés/reconnus, magasins retenus et écartés.
**Appliquer l’analyse** valide le contexte entier et retire l’ancienne instance
de résultats pendant la lecture, même lors d’une réapplication identique.
Changer un brouillon laisse l’ancien contexte appliqué clairement identifié.

- **Synthèse filtrée** : cinq mesures avec montant complet ou partiel nommé,
  couverture magasin-mois, référence et variation. Le choix cohorte comparable
  applique les cohortes figées propres à chaque mesure et annonce inclus/exclus.
  Le ratio CA/unité utilise son intersection ; la somme des contributions est
  fournie globalement par le serveur, jamais reconstruite avec une page.
- **Évolution** : courbes CA courante et de référence alignées, référence en
  pointillé, trous sans interpolation, couverture mensuelle et tableau exact des
  cinq mesures. Les conversions numériques servent uniquement au tracé.
- **Classement** : tri serveur sur le CA ou la contribution, sens explicite,
  rang global et pages de vingt magasins. Barres des contributions de la page à
  origine zéro, tableau exact avec partiels, couverture et motifs d’exclusion.
  Le total de la cohorte reste indépendant de la page et aucun pourcentage de
  contribution n’est inventé.
- **Comparer les magasins** : six séries par page, échelle absolue commune aux
  magasins visibles, courante et référence, noms et couleurs stables associés
  aux identifiants. Les tableaux conservent les valeurs exactes et le contexte
  rappelle le nombre total de magasins retenus. Paginer ne réduit pas ce total.
- **Disponibilité** : cinq domaines, bornes rapportées et comptes mensuels
  sources/rapportés/inférés séparés. Une absence de ligne n’est ni un zéro mesuré
  ni une preuve de non-livraison. La disponibilité ne prouve pas une mesure valide.

Les détails dépliables conservent les projections typées complètes, notamment
périmètre, fenêtres, compteurs, métadonnées et valeurs exactes non abrégées.
Les bases négatives sont nommées et leur pourcentage masqué ; bases nulles/zéro,
cohortes et périmètres vides restent indisponibles, sans infini ou zéro inventé.
Les libellés, y compris HTML apparent, sont rendus comme texte React.

La fiche s’ouvre explicitement depuis un classement ou une série. Les brouillons,
le périmètre appliqué, la page et la sélection restent en mémoire au retour.
Le bouton et le retour navigateur restaurent l’analyse et le focus du déclencheur.
L’historique contient seulement un marqueur booléen de navigation, aucun identifiant,
filtre, résultat ou jeton. La fiche existante relit le référentiel actuel et les
collections unitaires T23 : elle indique qu’elle ne partage pas la garantie de
publication des nouvelles réponses analytiques. La période est transmise à la fiche.

## Cohérence et sécurité du navigateur

Le transport utilise des chemins fixes et des décodeurs dédiés à tous les objets
T24B. Il refuse les champs supplémentaires/manquants, types incompatibles,
périmètres/publications/fenêtres incohérents, doublons et calendriers tronqués.
Il conserve décimaux et ratios en chaînes, dates mensuelles et compteurs entiers.
Les paramètres sont bornés avant le réseau ; listes d’IDs et clés de cache sont
normalisées. Aucun curseur ne fournit de chemin, SQL ou droit supplémentaire.

Les appels réutilisent la session personnelle en mémoire, les plafonds de réponse,
la file bornée, les deux lectures simultanées, les destinations configurées et les
protections du transport existant : bearer, cookies omis, redirections rejetées,
no-store et no-referrer. La découverte sans publication n’est pas mise en cache.
Les lectures liées et pages portent l’UUID reçu ; les entrées de cache épinglées
incluent endpoint, paramètres et publication. Elles ont les plafonds mémoire/temps
existants. Les relectures des blocs forcent une vérification serveur.

Un `409` efface le cache et annule les lectures partagées, retire tous les blocs
analytiques dépendants et demande **Relire le contexte**. Il ne provoque ni boucle
ni changement silencieux de publication. Les filtres doivent être réappliqués après
la découverte explicite de la nouvelle publication. Les réponses tardives d’un
ancien contexte sont ignorées. Les erreurs d’un bloc restent locales, sauf ce
conflit commun de publication. 403, 413/414, 429, 503, réponse invalide et absence
initiale de publication ont des messages bornés sans payload serveur.

La fin de session annule les lectures et purge les caches ; la frontière de session
remonte le workspace à chaque génération. Sélections et résultats sont alors retirés.
Aucun jeton ou résultat métier n’est écrit dans les URL de navigation, le stockage
navigateur, les logs ou la télémétrie. L’exception OIDC transitoire existante reste
celle du [contrat d’intégration](integration.md).

## Vérification et limites

Les tests utilisent exclusivement des fixtures synthétiques placées dans
`frontend/test/`, sans import dans le code applicatif. Le test de projections compare
les objets décodés aux modèles de sérialisation Python de T24B. Les scénarios
vérifient l’oracle A/B, la sélection vide/sept magasins, le tri et la seconde page,
les erreurs locales, les contextes en vol, le `409`, la déconnexion et les détails.
Les parcours Chromium contrôlent clavier, retour navigateur, focus, axe et absence
de débordement aux trois largeurs du projet, sans trace, vidéo, capture ou état
stocké de session. Les profils navigateur restent sept magasins ou vingt-cinq pour
le classement ; ce ne sont ni un volume cible ni une qualification de charge.

Le runner local de recette utilise une vraie identité OIDC, le vrai échange PKCE,
l’API avec son rôle SQL restreint et un schéma PostgreSQL jetable. Il publie les
seules ventes synthétiques A=100/B=200 puis A=120/B absent, vérifie cohorte,
contribution, classement, retour fiche et comparaison, puis supprime ses ressources.
Il n’altère pas le client autorisé d’un realm existant et ne crée pas de comptes
humains. Les ports/certificats et la commande restent ceux du guide frontend.

La vérification locale finale réussit : format, lint, typage et build frontend,
646 tests unitaires/contrat et 183 scénarios Chromium aux trois largeurs. Le format
Ruff, le lint et mypy strict passent ; la baseline Python réussit 264 tests avec
PostgreSQL réel. Un callback OIDC opt-in est ignoré dans cette baseline ; la recette
OIDC/API/PostgreSQL réelle décrite ci-dessus passe séparément et nettoie ses
ressources. Aucun test PostgreSQL n’est ignoré.

Le scan de sécurité du diff T24C est terminé et scellé, avec les 29 fichiers
modifiés comptabilisés et aucune vulnérabilité retenue. La relecture cumulative
de T24A–C couvre les 51 fichiers du changement et leurs interactions entre
publication SQL, API et navigateur, sans problème identifié. Elle reste distincte
d’un scan cumulatif scellé : l’outil refuse une base historique combinée au patch
local et impose HEAD comme base des changements non commités. Aucun artefact
canonique manuel ni changement Git ne contourne cette limite. La relecture
technique actualise la documentation et le workflow CI : les changements des
modèles/routes analytiques déclenchent les contrôles frontend sur push et pull
request. Le plafond du job passe à 30 minutes, la suite Chromium locale ayant
dépassé l’ancien plafond de 15 minutes. La validation du YAML et des chemins est
locale ; elle ne prouve pas l’exécution hébergée. Le code applicatif et les tests
couverts restent inchangés.

La recette humaine du zoom natif et du lecteur d’écran, la CI hébergée, les headers
et logs de l’environnement déployé, les budgets produit et la charge concurrente
restent distincts des contrôles locaux. Devise, HT/TTC, exhaustivité du CA et
constance économique de l’assortiment restent non prouvés. La livraison de T24 ne
constitue pas à elle seule une réception intégrale du P0 ou de la production.
