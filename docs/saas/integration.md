# Intégration frontend et connexion personnelle

Statut : contrat cible. Les capacités existantes ci-dessous ont été vérifiées dans
`api/app.py`, `api/query.py`, `api/resources.py`, `api/resources.json` et
`analytics.py`. Aucun endpoint supplémentaire n'est créé par ce document.

## Frontières

Le navigateur consulte l'API authentifiée ; seul le serveur API accède à PostgreSQL
avec son compte SELECT-only. L'identité reste gérée par le fournisseur OIDC.
Le frontend ne reçoit ni mot de passe de base, ni secret de client, ni droit d'import.
Les utilisateurs autorisés appartiennent à une seule organisation et peuvent
consulter tous les magasins. Les filtres de l'interface ne sont pas des ACL.

Séparer dans l'implémentation : transport API, session, calculs métier purs,
état des filtres et composants de visualisation. Les composants ne réinterprètent
pas chacun la définition du CA. Une interface typée décrit les décimaux sérialisés
en chaînes, les valeurs nulles et les réponses paginées.
Stack retenue : application React avec TypeScript strict, construite avec Vite.
Material UI fournit les composants et le thème partagé défini dans
[DESIGN.md](../../DESIGN.md) ; MUI X Charts Community
fournit les courbes et barres. Utiliser les tables Material UI avec pagination
explicite pour les détails, sans dépendance à une fonctionnalité Pro/Premium.
Les tris globaux et agrégations restent des responsabilités de l’API.

Cette base correspond à l’[intégration Vite proposée par MUI](https://mui.com/material-ui/getting-started/example-projects/).
La [version Community de MUI X](https://mui.com/x/introduction/licensing/) est
sous licence MIT ; vérifier que chaque graphique retenu appartient à cette édition.
Verrouiller les versions compatibles au démarrage de l’implémentation. Vérifier
la connexion et un graphique avec son tableau accessible dans une première tranche.
Le choix de stack n’ajoute ni dépendance ni code applicatif à ce stade documentaire.

## Carte des lectures actuelles

| Besoin | Lecture existante | Limite |
| --- | --- | --- |
| Découverte des champs et filtres | `GET /v1/resources`, `GET /v1/openapi.json` | Authentification obligatoire |
| Fraîcheur | `GET /v1/analytics/status` | `state`, `last_completed_at`, `last_attempt_status` ; pas de plages de mois disponibles |
| Référentiel | `GET /v1/data/stores` | Pagination par clé, pas de recherche textuelle ni filtres enseigne/région/actif |
| Synthèse magasin | `GET /v1/data/analytics_store_month` | Un seul `store_id`, période bornée possible |
| Comparaisons mensuelles magasin | `GET /v1/data/analytics_store_month_changes` | M-1 et N-1, pas de total réseau |
| Détails | Collections analytiques listées dans `metrics.md` | Charger uniquement l'onglet actif et les filtres réellement proposés au catalogue |
| Observations justificatives | Collections sources, filtre `id` | Pas de filtre tableau d'IDs ; accès à la demande, pas de milliers de requêtes automatiques |
| Qualité d'attribution | `GET /v1/data/analytics_monthly_link_quality` | Réseau, dataset/mois/statut ; aucun `store_id` |

Ne pas présumer qu'un champ publié est filtrable. Par exemple, `category_code`
n'est pas un filtre universel et les ventes produit n'ont pas de filtre catégorie.
Les assortiments sources et les produits sont des référentiels globaux ; leur
lien magasin passe par les vues analytiques.

## Transport et états de chargement

- Collections : `{ "items": [...], "next_cursor": null }`. Suivre `after` jusqu'à
  null en gardant les mêmes filtres, sans fabriquer ou modifier un curseur.
- Limite par page : 200 lignes ; réponse : 2 MB. Sur 413, réduire la taille de page
  jusqu'à 1 ; si l'erreur persiste, afficher une limite serveur sans boucle infinie.
- Dates : premier jour du mois, ISO 8601, sans conversion de fuseau horaire.
  Décimaux : préserver l'exactitude dans les calculs, convertir uniquement les
  coordonnées destinées au tracé ; les étiquettes utilisent les valeurs exactes.
- File de requêtes bornée : proposer deux lectures simultanées maximum et trois
  tentatives maximum sur les erreurs transitoires ; respecter le budget existant
  de 120 requêtes/minute/sujet, partagé avec les autres clients.
- Annuler les lectures obsolètes lors d'un changement de filtre. Une réponse tardive
  ne peut pas remplacer l'état de la nouvelle sélection. Dédupliquer les lectures
  identiques et conserver le cache uniquement en mémoire, dans la session courante.
- Aucun total définitif calculé sur une première page. Si une extraction de détail
  atteint une limite de travail, annoncer le résultat incomplet et masquer ses KPI.
- Les détails ne sont pas figés entre pages. Lire la fraîcheur avant/après détecte
  certains changements, mais ne garantit pas un snapshot ; si elle change, invalider
  le lot et proposer de recharger. Ne pas relier des IDs sources vivants à une vue
  périmée en prétendant fournir une preuve historique immuable.

| Statut | Comportement |
| --- | --- |
| 401 | Effacer session/cache, arrêter les requêtes, proposer une nouvelle connexion |
| 403 | Expliquer l'accès refusé, sans boucle de reconnexion |
| 413 | Diminuer `limit`, puis erreur explicite si une ligne ne tient pas |
| 422 | Signaler la requête invalide ; ne pas réessayer automatiquement |
| 429 / 503 | Attente bornée, `Retry-After` si accessible, puis action Réessayer |
| Réseau / 5xx inattendu | Erreur explicite, reprise manuelle ; pas de données de démonstration de secours |

Les erreurs utilisent `{ "error": "stable_code" }`. Le support peut montrer
`X-Request-ID`, sans copier une réponse métier ni un jeton. L'API expose actuellement
ce header via CORS, mais pas `Retry-After` : une lecture navigateur cross-origin de
ce dernier nécessite une extension de `expose_headers`, sinon utiliser le délai borné.

`state=stale` autorise la consultation avec avertissement ; `uninitialized` bloque
les KPI et explique l'absence de publication ; `current` ne signifie pas couverture
commerciale exhaustive. Afficher séparément l'échec éventuel du dernier refresh.

## Besoins API avant une vue réseau exploitable à grande échelle

Statut : différé par décision produit. Cette section conserve les dépendances de
la cible complète ; elle n’autorise pas leur implémentation pendant la première
tranche frontend, qui utilise uniquement les endpoints existants.

Les noms et chemins de ces futures routes sont à définir lors du contrat OpenAPI.
Il est interdit de coder le frontend comme si ces routes existaient déjà.

| Capacité à ajouter | Entrée cible | Sortie et invariants attendus |
| --- | --- | --- |
| Disponibilité | Périmètre de magasins validé | Bornes et mois observés par dataset, absence distinguée de zéro ; pas de présomption de mois complet |
| Recherche magasins | Texte borné, dimensions actuelles, pagination | Sélection et recherche serveur, ordre stable ; IDs inconnus signalés pour une sélection explicite |
| Synthèse et série | Mois inclusifs, sélection explicite ou tous, dimensions, comparaison | Totaux, numérateurs/dénominateurs de couverture, cohorte et exclus selon `metrics.md` |
| Classement et contributions | Même périmètre, indicateur/tri autorisés | Tri global stable, pagination, contributions cohérentes avec les totaux |

Une réponse agrégée doit porter son périmètre résolu, ses périodes, son grain,
sa fraîcheur et une version de publication. Les calculs d'une réponse doivent
partager un snapshot de lecture. Plusieurs réponses doivent soit être liées à une
version garantie par le serveur, soit être déclarées non atomiques et rechargées
si leurs versions divergent. Un horodatage seul ne fige pas les pages actuelles.

Conserver la validation serveur des filtres, les budgets de sélection/période/réponse,
les calculs exacts, les droits existants et les erreurs sans valeurs privées.
Les tailles maximales de sélection et période doivent être documentées et éprouvées
sur jeux synthétiques avant livraison. Ne pas télécharger l'ensemble du réseau
dans le navigateur pour contourner ces besoins. Un prototype limité peut utiliser
des lectures unitaires bornées, mais ne revendique pas la capacité réseau cible.

## Connexion web proposée

Le client CLI existant utilise un coffre natif et une redirection loopback : il ne
constitue pas une session web réutilisable. L'utilisateur clique **Se connecter**,
s'authentifie chez le fournisseur, puis revient au callback de l'application.
Ne pas proposer un formulaire de mot de passe propre au frontend ni un collage
manuel de jeton comme parcours utilisateur final.

Pour le client navigateur proposé : Authorization Code avec PKCE S256, `state`
aléatoire et contrôle de l'émetteur du retour ; bibliothèque OIDC maintenue à valider.
Si un ID token est utilisé pour l'identité affichée, valider aussi son nonce et ses
claims via cette bibliothèque ; ne jamais l'utiliser comme jeton d'accès API.
Le callback et l'origine sont configurés exactement, sans wildcard ni URL de retour
fournie librement par le navigateur. Nettoyer le code d'autorisation de l'URL après
échange, et ne pas journaliser l'URL du callback.

Le fournisseur et l'API doivent respecter le contrat existant : `prompt=login`,
`max_age=0`, `data:read`, jeton RS256 `at+jwt`, audience dédiée, `azp` autorisé,
`auth_time` signé, émission au plus 60 secondes après authentification et durée
maximale de 24 heures. Aucun refresh token, renouvellement silencieux ou compte
technique ; rejeter une réponse contenant un refresh token.

L'API accepte actuellement **un** `API_CLIENT_ID`. Décider explicitement soit de
configurer le client autorisé pour le web en conservant les redirects nécessaires,
soit de faire évoluer la liste des clients autorisés avec tests de non-régression
du CLI. Créer un nouveau client web sans adapter ce contrôle provoquerait un refus.
La configuration du fournisseur doit aussi permettre l'échange de code depuis
l'origine web ; CORS côté API seul ne suffit pas.

Jeton d'accès uniquement en mémoire ; aucun localStorage, sessionStorage, cookie
de jeton ou cache de service worker. Les seuls éléments transitoires pouvant être
conservés en sessionStorage pendant la redirection sont `state`, nonce et vérificateur
PKCE, supprimés au retour ou à expiration. Un rechargement nécessite une connexion.
La déconnexion annule les requêtes et efface toutes les données en mémoire ; elle
ne prétend pas révoquer un JWT déjà copié. L'expiration réelle peut être plus courte
que 24 heures et ramène à la connexion sans afficher les anciennes données.

Prévoir TLS, politique CSP restrictive et assets maîtrisés, pas de HTML arbitraire
provenant des libellés, pas de télémétrie contenant valeurs métier ou identifiants.
Ne pas utiliser les personnes présentes dans le référentiel comme identité du lecteur.
Le détail du déploiement et la compatibilité fournisseur sont à vérifier dans
l'environnement retenu ; ils ne sont pas garantis par le cadrage.
