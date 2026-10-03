# Frontend SaaS — tâches d’implémentation et de validation

Statut : T01–T05 sont implémentées, validées et commitées.
T06 est **commitée après relecture technique**, avec revue Security finale en attente ;
T07 est **commitée après relecture technique, sécurité finale en attente** ;
T08 est **commitée après relecture technique, sécurité finale en attente** ; T09 est **commitée après relecture technique, sécurité finale en attente** ; T10 est **commitée après relecture technique, sécurité finale en attente** ; T11 est **commitée après relecture technique, sécurité finale en attente** ; T12 est **commitée après relecture technique, sécurité finale en attente** ; T13 est **commitée après relecture technique, sécurité finale en attente** ; T14 est **commitée après relecture technique, sécurité finale en attente** ; T15 est **commitée après relecture technique et sécurité** ; T16 est **commitée après relecture technique et sécurité** ; T17–T22 restent à faire. Voir le [guide frontend](../../frontend/README.md)
pour les scripts réels et les limites du socle.
Point de départ historique : branche `feat/saas-frontend`, API de lecture et client personnel
existants ; aucun package frontend ni pipeline frontend à ce stade.

## Contrats à lire

Lire le [PRD](prd.md), le [produit](product.md), les [indicateurs](metrics.md),
l’[intégration](integration.md), la [matrice de couverture](data-coverage.md),
la [réception](acceptance.md) et le [design](../../DESIGN.md).
Les limites implémentées sont celles de l’[architecture](../architecture.md),
du [contrat mensuel](../monthly-analytics.md), du
[guide API](../api-agent-guide.md), des [opérations API](../read-api-operations.md)
et du [contrat de sécurité API](../read-api-design.md).
Pour la connexion, lire aussi l’[authentification personnelle](../personal-authentication.md)
et l’[identité locale](../local-identity.md).

Le [registre](../../src/retail_data_platform/api/resources.json) et les
[projections imbriquées](../../src/retail_data_platform/api/resources.py) font
autorité sur les champs ; le catalogue authentifié détermine les capacités du lecteur.
La matrice recense actuellement 24 ressources, 325 champs de premier niveau et
74 chemins enfants : vérifier les ensembles, pas seulement ces nombres.

## Périmètre et règles de réalisation

La tranche autorisée réalise la connexion web, la sélection de magasins, les fiches
unitaires, l’exploration des données publiées et leur qualité sur l’API existante.
L’application est en français, en lecture seule, pour une seule organisation avec
accès global. Un filtre magasin n’est jamais une règle d’autorisation.

Les vues réseau, totaux multi-magasins, cohortes réseau, classements globaux,
recherche serveur et disponibilité des périodes restent dépendants d’un futur
périmètre backend. Les signaler indisponibles dans cette tranche ; ne pas simuler
ces fonctions en téléchargeant le réseau ou en agrégeant une première page.
La réception de cette tranche n’est ni la réception du P0 complet ni une autorisation
de mise en production. Facturation, export, écriture, inscription publique et
multi-tenant restent hors périmètre.

Appliquer les consignes locales des agents, en particulier :

- Lire état Git, diff et historique avant chaque tâche ; préserver les changements
  préexistants. Rester sur la branche courante, sans commit ni push implicite.
- Une tâche ci-dessous correspond à une proposition de commit cohérente, avec son
  code, ses tests et les ajustements documentaires nécessaires. Les messages sont
  des propositions en anglais, à l’impératif, conformes à l’historique.
- Scinder une tâche avant implémentation si elle combine plusieurs comportements
  indépendants, des prérequis importants ou un diff difficile à relire. Ne pas
  livrer d’abord le comportement puis reporter ses tests à un autre commit.
- Présenter le diff vérifié et le résultat des contrôles pour approbation explicite
  du commit. L’approbation du commit ne vaut pas approbation du push.
- Utiliser exclusivement des fixtures, identités et captures synthétiques. Ne pas
  copier de données privées, même anonymisées, dans les tests ou rapports publiables.
- Conserver tokens, données métier, sélection et caches en mémoire. Seuls state,
  nonce et vérificateur PKCE transitoires peuvent utiliser sessionStorage pendant
  la redirection, conformément au contrat d’intégration.
- Mettre à jour l’architecture seulement pour les frontières effectivement
  implémentées et vérifiées. Le fichier local de consignes reste exclu des commits.

## Stratégie de tests dès les premières fonctionnalités

Outillage proposé à installer progressivement : Vitest pour les fonctions et
contrats, React Testing Library pour les interactions de composants, Playwright
pour les parcours navigateur, et axe avec Playwright pour les contrôles automatisés
d’accessibilité. Vérifier les versions et compatibilités lors de l’installation,
verrouiller les dépendances et conserver une seule chaîne par niveau de test.
Références : [Vitest](https://vitest.dev/guide/),
[Testing Library](https://testing-library.com/docs/react-testing-library/intro/),
[Playwright et accessibilité](https://playwright.dev/docs/accessibility-testing).

| Niveau | Preuve attendue | Quand |
| --- | --- | --- |
| Statique | Format, lint, TypeScript strict et build de production | Chaque changement frontend |
| Unitaire | Calculs exacts, dates, filtres, erreurs et transitions de session | Avec la fonction concernée |
| Composant / transport | Interactions utilisateur et réponses API synthétiques contrôlées | Avec chaque écran ou contrat |
| E2E simulé | Application construite, navigateur réel, réseau synthétique déterministe | Chaque fonctionnalité visible |
| Intégration réelle | Navigateur + fournisseur OIDC + API + PostgreSQL de test isolé | Connexion, jalons et recette finale |
| Accessibilité / visuel | axe, clavier, focus, responsive et contrôle visuel humain | Dès le shell, puis chaque écran |
| Sécurité | Tests négatifs et revue Codex Security du diff | Chaque changement applicatif avant commit |

T01 fournit les scripts de format, lint, typage, tests et build dans le guide
frontend et les consignes locales. T02 ajoute le harnais navigateur et la CI.
Ne pas recopier des commandes hypothétiques dans un compte rendu.
Les changements Python conservent format, lint, mypy et pytest du projet ; les
changements de persistance exigent PostgreSQL réel. Toute migration future exige
modèle aligné, upgrade à neuf, downgrade/upgrade et `alembic check`.

Les tests doivent vérifier des résultats attendus indépendants de l’implémentation,
pas seulement des snapshots ou l’absence d’exception. Les simulations doivent
échouer sur une requête inattendue ; aucun mock ou contournement de session ne doit
entrer dans le bundle de production. Aucun secours par données de démonstration
lorsque l’API réelle échoue.

Ne pas sauvegarder de session authentifiée avec `storageState`. Désactiver les
traces réseau/vidéos susceptibles de contenir des credentials sur les parcours OIDC,
même synthétiques ; produire des assertions sans valeur sensible. Les captures
d’interface doivent être synthétiques et sans token. Les rapports générés, caches,
bundles et configurations privées restent ignorés ; seuls les baselines synthétiques
explicitement revus peuvent être versionnés.

## Revue avec Codex Security

Utiliser le plugin **Codex Security**, workflow `security-diff-scan`, sur le diff
exact de la tâche avant demande de commit. Charger le skill installé au moment
de la revue et suivre son préflight, son modèle de menaces, sa validation et sa
finalisation. Le présent plan n’est pas un scan et n’atteste aucune sécurité.

1. Figer le périmètre revu : base Git, fichiers nouveaux inclus, modifications et
   suppressions. Revoir le patch local sans créer un commit pour les besoins du scan.
2. Conserver l’identifiant du scan et son contexte ; poursuivre le même scan en cas
   de reprise. Signaler les fichiers exclus et toute couverture incomplète.
3. Vérifier en priorité les frontières touchées : OIDC et destinations réseau,
   nettoyage de session, exposition des données, rendu de texte non fiable,
   accès OPS, dépendances et configuration du build.
4. Fournir le rapport, les constats validés, les tests de non-régression associés
   et les limites. Les rapports bruts restent hors des fichiers publiés ; toute
   synthèse publique doit être relue pour éviter chemins locaux et données privées.
5. Corriger les vulnérabilités confirmées avant acceptation de la tâche, puis
   vérifier la correction et le diff final. Une exception doit être explicitement
   arbitrée ; aucun risque élevé/critique non résolu n’est accepté pour la livraison.
6. Si l’outil est indisponible ou le scan incomplet, noter « sécurité non vérifiée ».
   Les tests automatisés peuvent continuer, mais ils ne remplacent pas cette revue.

Effectuer aussi un scan cumulatif depuis la base de cette tranche aux jalons J1
et J3, pour les interactions entre fonctionnalités. Aucun audit automatique ne
prouve l’absence de vulnérabilités ; la validation réelle OIDC et les contrôles
de l’environnement restent nécessaires. Une modification exclusivement documentaire
demande liens, cohérence et absence de divulgation, pas un faux audit applicatif.

## Tâches ordonnées

T01–T05 sont **validées**, T06 est **commitée, sécurité finale en attente**,
T07 est **commitée, sécurité finale en attente**, T08 est **commitée après relecture technique, sécurité finale en attente**,
T09 est **commitée après relecture technique, sécurité finale en attente**, T10 est **commitée après relecture technique, sécurité finale en attente**, T11 est **commitée après relecture technique, sécurité finale en attente**, T12 est **commitée après relecture technique, sécurité finale en attente**, T13 est **commitée après relecture technique, sécurité finale en attente**, T14 est **commitée après relecture technique, sécurité finale en attente**, T15 est **commitée après relecture technique et sécurité**, T16 est **commitée après relecture technique et sécurité**, T17–T22 sont **à faire**. Réaliser la suivante dont les dépendances sont
satisfaites ; les tâches bloquées par l’identité réelle ne doivent pas empêcher
les développements testables sur un environnement synthétique. Ne pas déclarer
la connexion ou J1 reçus avant leur vérification réelle.

### T01 — Socle React, thème et contrôles statiques

- Statut : **validée**, commit autorisé après relecture. Format, lint, typage, 21 tests et build
  vérifiés ; contrôle navigateur local aux trois largeurs et au clavier effectué.
  Revue Codex Security du diff terminée sans vulnérabilité identifiée ; rapport
  conservé hors du dépôt. Authentification, CI et recette de production non couvertes.
- Dépendances : aucune.
- Livrer : package frontend isolé, React/TypeScript strict/Vite, composants MUI,
  thème conforme à DESIGN, page de connexion sans données, états chargement/erreur.
  Installer uniquement les dépendances nécessaires ; vérifier licences et lockfile.
- Valider : lint, typage, build, un test de comportement du shell ; configuration
  absente ou invalide expliquée sans secret. Rien de privé dans le bundle.
- Terminé quand : lancement reproductible, scripts réels documentés, artefacts
  ignorés, aucune régression Python induite.
- Commit proposé : `Add frontend shell and shared theme`.

### T02 — Harnais navigateur et automatisation des contrôles

- Statut : **validée après relecture technique**.
  Installation verrouillée, format, lint, typage, 21 tests
  unitaires et 6 scénarios Chromium/axe vérifiés à 360/768/1440 px. Une requête
  synthétique interdite a fait échouer la commande de CI ; son retrait a rétabli
  tous les contrôles. Revue Codex Security du diff terminée sans vulnérabilité
  identifiée, rapport conservé hors du dépôt. Job GitHub défini, exécution distante
  non encore observée. Contrôles relancés avec succès après relecture, sans
  modification du code revu.
- Dépendances : T01.
- Livrer : Playwright, fixtures synthétiques, interception réseau stricte, axe,
  exécution automatisée des scripts existants dans la CI du dépôt. Configurer
  l’installation verrouillée et le build testé, sans secret ni déploiement.
- Valider : démarrage propre, erreur volontaire détectée par le pipeline, écran
  à 360/768/1440 px, ouverture/fermeture au clavier avec focus restauré.
- Terminé quand : tests exécutables localement et job CI défini ; distinguer
  exécution locale vérifiée et exécution distante non encore observée sans push.
- Commit proposé : `Automate frontend quality checks`.

### T03 — Connexion OIDC et retour PKCE

- Statut : **validée après relecture technique**. Parcours OIDC et tests synthétiques implémentés ;
  formatage, lint, typage, build, 64 tests unitaires/composants et 30 scénarios
  Chromium passent. Revue Codex Security du diff terminée sans vulnérabilité
  relevée. Compatibilité réelle du fournisseur, du client autorisé par l’API et
  de CORS réservée à T07 ; cycle de session et transport API relèvent de T04 et T05.
  Commit T03 créé après validation ; aucun push de ce commit.
- Dépendances : T01–T02.
- Livrer : bibliothèque OIDC maintenue, configuration publique validée, bouton
  Se connecter, code + PKCE S256, contrôle state/issuer et nonce si ID token utilisé.
  Nettoyer l’URL du callback et les éléments de redirection au retour ou expiration.
  Refuser refresh token, renouvellement silencieux et retour vers une URL arbitraire.
- Valider : succès simulé, state faux/absent/rejoué, issuer incorrect, nonce incorrect,
  échange refusé, retour expiré, refresh token inattendu ; aucun token persistant.
- Terminé quand : le callback échoue fermé ; `prompt=login`, `max_age=0` et scopes
  requis sont testés ; l’ID token n’est jamais envoyé comme bearer à l’API.
- Commit proposé : `Add browser PKCE sign-in`.

### T04 — Cycle de session et effacement des données

- Statut : **validée après relecture technique**. Session observable, garde des composants, expiration,
  déconnexion, annulation et protection des générations implémentées. Format, lint,
  typage, build, 86 tests unitaires/composants et 39 scénarios Chromium passent.
  Revue Codex Security du diff terminée sans vulnérabilité relevée ; rapport conservé
  hors du dépôt. Aucun cache ni transport métier n’existe
  encore ; leur raccordement à la session relève de T05/T06. La suppression du
  contenu protégé et des états locaux est testée avec des composants synthétiques.
  Contrôles relancés avec succès après relecture ; aucune correction applicative
  nécessaire et aucune modification du code couvert par la revue de sécurité.
- Dépendances : T03.
- Livrer : session en mémoire, garde des écrans, expiration effective, déconnexion,
  annulation et effacement des caches ; identifiant de génération de session ou
  protection équivalente contre les retours tardifs.
- Valider : reload, expiration pendant une requête, déconnexion, utilisateur suivant,
  retour arrière navigateur et reprise d’un onglet suspendu ; aucun ancien contenu.
- Terminé quand : pas de reconnexion automatique ni de renouvellement ; toutes les
  données disparaissent à la fin de session, même si le réseau répond ensuite.
- Commit proposé : `Clear data when browser sessions end`.

### T05 — Transport API et validation des réponses

- Statut : **validée après relecture technique**. Aucun défaut bloquant relevé ;
  aucun changement du code applicatif nécessaire pendant la relecture.
  Client GET à routes fixes, origine validée,
  réponses JSON bornées et projections runtime, valeurs exactes/null préservées,
  erreurs génériques et 401 lié à la génération de session. Aucun écran métier
  ni chargement automatique n’est introduit. Format, lint, typage, 145 tests
  unitaires/composants, build et 39 scénarios Chromium de régression passent,
  avec une nouvelle exécution complète après relecture.
  Revue Codex Security du diff finalisée sans constat ; rapport conservé hors du
  dépôt. Le transport est testé avec des réponses synthétiques ; la connexion
  navigateur/API réelle reste à vérifier en T07. Commit autorisé après relecture ;
  aucun push demandé.
- Dépendances : T04.
- Livrer : client de lecture typé, origine API configurée, chemins autorisés,
  validation runtime des enveloppes/champs utilisés, dates et décimaux en chaînes.
  Refuser destinations ou redirections non autorisées ; erreurs sans payload privé.
- Valider : réponse malformée, null, décimaux exacts, tentative de destination externe,
  401 purgeant la session, 403 sans boucle, 422 sans retry et panne réseau explicite.
- Terminé quand : aucun accès DB côté navigateur, aucun bearer en URL/log, et les
  composants n’implémentent pas chacun leur propre transport.
- Commit proposé : `Add validated read API transport`.

### T06 — Pagination, concurrence et reprise bornée

- Statut : **commitée après relecture technique et accord explicite**. File de lectures partagée, cache uniquement
  en mémoire, déduplication, annulation, retries bornés et collections partielles
  explicites. Rejet sans valeur du scheduler corrigé avec test de régression.
  Format, lint, typage, 185 tests unitaires/composants, build et 39 scénarios
  Chromium passent. La revue Codex Security précédente n'a relevé aucun candidat
  plausible ; rapport local conservé hors dépôt. Elle précède cette dernière
  correction : **sécurité non vérifiée sur le diff final**, plugin indisponible
  dans cette session. Ne pas assimiler les tests à une nouvelle revue Security.
  Le service reste à raccorder
  aux écrans métier ; recette locale fournisseur/API/CORS réalisée par T07,
  déploiement réel encore non vérifié.
  Aucun push de T06 effectué.
- Dépendances : T05.
- Livrer : pagination par curseur opaque, annulation/déduplication, cache de session,
  deux lectures simultanées au maximum, trois tentatives au maximum sur 429/503.
  Gérer 413 en réduisant limit jusqu’à 1 ; définir et tester un plafond total d’essais.
- Valider : deux pages, changement de limit, filtres conservés, curseur invalide,
  curseur répété, 413 persistant, Retry-After lisible ou masqué par CORS, réponses
  désordonnées et arrêt des retries après logout. Pas de boucle de pagination.
- Terminé quand : limites de travail explicites, résultat incomplet identifié, pas
  de chargement exhaustif automatique du réseau. Respect du budget API partagé,
  sans prétendre connaître les requêtes des autres clients.
- Commit proposé : `Bound paginated reads and retries`.

### T07 — Connexion réelle au fournisseur et à l’API

- Statut : **commitée après relecture technique, sécurité finale en attente**. Smoke local Chromium/Keycloak/API/PostgreSQL
  réel sur realm et schéma jetables ; comptes et magasins entièrement synthétiques.
  Connexion web, échange CORS, deux pages API, refus de scope/origine/callback,
  refus de jetons signés mauvais client/audience/expirés et contrat CLI passent.
  Format/lint/typage et build passent ; 185 tests frontend, 39 scénarios Chromium,
  138 tests Python (27 ignorés faute de prérequis), puis 9 tests PostgreSQL/loopback
  explicitement activés passent. Le smoke fournisseur réel est opt-in et a été exécuté.
  Le client existant et la configuration API ne sont pas modifiés ; aucun
  élargissement de la liste des clients autorisés. Nettoyage exécuté après la recette.
  Relecture : groupes de processus nettoyés après timeout ou sortie du parent,
  poursuite du nettoyage après un échec d’arrêt (3 tests de régression), et refus
  CORS HTTP 400 sans origine autorisée vérifié en complément du blocage navigateur.
  Recette reproductible dans le [guide local](../local-identity.md#browser-and-api-integration-smoke).
  Fournisseur déployé, coffre natif et écrans métier restent non vérifiés.
  **Sécurité non vérifiée par Codex Security**, plugin indisponible dans cette session.
  Commit autorisé après relecture ; aucun push de T07 effectué.
- Dépendances : T03–T06 ; configuration OIDC de test et PostgreSQL isolé disponibles.
- Livrer : smoke test navigateur reproductible avec utilisateurs synthétiques et
  nettoyage. Valider le client autorisé unique, redirects exacts, origines API et
  échange de code depuis le navigateur. Préserver le contrat CLI.
- Valider : connexion réelle et lecture API, refus sans data:read, mauvais client,
  audience/expiration, origine non autorisée, callback non enregistré ; vérification
  serveur des claims RS256, at+jwt, azp et auth_time selon le contrat existant.
- Terminé quand : résultats réels établis et non-régression CLI vérifiée. Si une
  évolution du contrôle des clients côté API est nécessaire, la proposer séparément
  pour autorisation ; ne pas élargir silencieusement la liste des clients acceptés.
- Commit proposé : `Verify browser sign-in against the identity provider`.

### T08 — Liste des magasins et sélection en mémoire

- Statut : **commitée après relecture technique, sécurité finale en attente**. Table MUI, pagination explicite (25 lignes
  demandées initialement), sélection entre pages, tri de la page et ouverture d’un
  résumé relu par ID. Retour conservant page/tri/sélection et restaurant le focus.
  États vide, magasin disparu et erreur avec reprise manuelle ; doublons et curseurs
  répétés refusés. Sélection et résultats retirés avec la session, aucun stockage
  persistant ni identifiant métier dans l’URL de navigation. Aucune agrégation réseau.
  Correction du contexte d’appel du `fetch` natif révélée par les scénarios navigateur.
  Format/lint/typage/build, 196 tests unitaires et 48 scénarios Chromium passent,
  avec axe et absence de débordement à 360/768/1440 px. La recette locale réelle
  vérifie également ouverture/retour/sélection/déconnexion sur fixtures jetables.
  Le référentiel complet, les périodes, les analyses et la navigation commune
  restent les tâches suivantes ; le zoom navigateur à 200 % reste à recetter.
  **Sécurité non vérifiée par Codex Security**, plugin indisponible dans cette session.
  Relecture : curseurs vides refusés, retour à la page précédente maintenu pendant
  un chargement ou une erreur, et repli du focus si la ligne de retour a disparu.
  Trois tests de régression supplémentaires passent. Commit autorisé après relecture ;
  aucun push de T08 effectué.
- Dépendances : T05–T06 ; T07 nécessaire à la recette réelle, pas aux mocks.
- Livrer : table MUI paginée depuis stores, sélection explicite, ouverture d’un
  magasin et retour conservant le contexte ; attributs marqués actuels.
  Pas de recherche texte ni de filtre enseigne/région/statut non pris en charge.
- Valider : sélection à travers deux pages, sélection vide, ID inexistant, magasin
  inactif, libellé long, reprise après erreur. Tri local nommé « Trier cette page ».
- Terminé quand : compteur de sélection exact, aucun total réseau affiché et les
  actions réseau/comparaison indisponibles expliquées sans lancer de requêtes.
- Commit proposé : `Add paginated store selection`.

### T09 — Fiche magasin et contexte de période

- Statut : **commitée après relecture technique, sécurité finale en attente**. En-tête avec attributs actuels,
  référentiel complet validé champ par champ et dépliable sur l’onglet actif,
  annulation des lectures devenues inutiles et reprise manuelle des erreurs.
  Période initialement vide, brouillon distinct des mois appliqués, conservée avec
  l’onglet en mémoire lors des retours liste/détail. Limite frontend : 120 mois
  inclusifs, entre 0001-01 et 9999-12, calculés sans conversion de fuseau.
  Aucune disponibilité présumée et aucune lecture mensuelle avant les tâches suivantes.
  Les autres onglets d’analyse restent explicitement indisponibles.
  Format/lint/typage/build et tests automatisés vérifiés : 227 tests unitaires,
  51 scénarios Chromium, axe et absence de débordement à 360/768/1440 px.
  La recette locale d’identité tentée pour T09 a échoué sans diagnostic exploitable ;
  sa réussite antérieure ne valide pas cette évolution. La vérification de l’état
  des services Docker locaux expire également pendant la relecture.
  Exécution CI non observée.
  Relecture : panneau d’onglet accessible au clavier ; refus éprouvé des réponses
  sans magasin, avec un autre ID ou avec un curseur inattendu.
  **Revue Codex Security en attente**, plugin indisponible dans cette session.
- Dépendances : T08.
- Livrer : en-tête, référentiel complet dépliable, onglets, mois inclusifs explicites,
  validation des bornes et limites de période documentées. Séparer filtres saisis et
  appliqués ; conserver contexte en mémoire, sans identifiant métier dans l’URL.
- Valider : intervalle inversé, changement d’année/fuseau, période sans observation,
  Apply, aller-retour liste/détail ; seuls les besoins de l’onglet actif sont lus.
- Terminé quand : aucune ancienne valeur sous un nouveau contexte et aucune
  disponibilité de mois inventée ; les 12 derniers mois ne sont pas présumés connus.
- Commit proposé : `Add store detail and month selection`.

### T10 — Valeurs exactes et fraîcheur

- Statut : **commitée après relecture technique, sécurité finale en attente**. Calculs décimaux en BigInt,
  affichage français des montants/comptages et des mois, identifiants inchangés.
  Division avec arrondi décimal à mi-distance éloigné de zéro, six décimales par
  défaut et précision explicite de 0 à 18 ; null et dénominateur nul indisponibles.
  Calculs bornés : entrées/sorties de 1024 caractères, exposant/échelle jusqu’à 512.
  Bandeau de publication depuis analytics/status, vérification manuelle sans lancer
  de refresh, états current/stale/uninitialized distincts de la couverture.
  Dernière publication connue conservée et qualifiée si une vérification échoue ;
  dernier refresh échoué annoncé séparément. Horodatages en UTC explicite.
  Invalidation et relecture éprouvées lors d’un changement de publication sur deux
  pages. Les analyses mensuelles et graphiques restent T11 et suivantes.
  Format/lint/typage/build, 262 tests unitaires et 63 scénarios Chromium passent,
  avec axe et absence de débordement à 360/768/1440 px.
  Relecture : statuts current/stale sans date de publication refusés ; une ancienne
  réussite reste compatible avec un état uninitialized, sans annoncer sa disponibilité.
  Arrondis positifs/négatifs, précision entière et division de haute précision éprouvés.
  Aucun changement backend ni nouvelle dépendance. Recette d’identité réelle et
  exécution CI non revalidées pour cette tâche. Codex Security reste indisponible.
- Dépendances : T05–T06 et T09.
- Livrer : fonctions pures de décimaux, mois, ratios et affichage français nécessaires
  à la fiche unitaire ; bandeau basé sur analytics/status, couverture distincte.
- Valider : 0.1 + 0.2, null/0/négatif, ratio 0.12, dénominateur nul, précision élevée,
  current/stale/uninitialized, échec de refresh gardant la publication antérieure.
  Changement de fraîcheur avant/après plusieurs pages : invalidation et rechargement.
- Terminé quand : aucune conversion binaire pour les calculs métier, aucune devise
  ou HT/TTC inventé et aucune garantie de snapshot entre pages.
- Commit proposé : `Preserve exact values and publication freshness`.

### T11 — Synthèse mensuelle d’un magasin

- Statut : **commitée après relecture technique ; sécurité finale en attente**. Lecture analytics_store_month
  filtrée par magasin et période appliquée, seulement sur Synthèse. Initialisation
  vérifiée avant lecture ; contrôle de publication autour des pages, annulation
  sur départ et reprise explicite. Maximum cinq pages / 120 lignes ; aucune carte
  ou faux mois absent si le résultat est incomplet ou la publication a changé.
  Grille calendaire, null/zéro/négatifs distincts, sommes exactes et couverture
  propre au CA, aux unités et à chaque activité. Rapport CA/unités seulement avec
  les mêmes mois complets et base non nulle ; diagnostics rapportés séparés.
  Premier graphique MUI X Charts Community (MIT), sans interpolation des trous
  ni animation, coordonnées seules approximatives ; table accessible et valeurs
  exactes, y compris diagnostics d’ambiguïté. Autres onglets et détails imbriqués
  restent les tâches suivantes. Aucun nouvel endpoint ni calcul réseau.
  Validation locale : `npm run check` réussi, **290 tests unitaires et
  69 scénarios Chromium** sur 360/768/1440 px ; axe, clavier et réduction
  de mouvement contrôlés sur fixtures entièrement synthétiques.
  Relecture : validation des bornes décimales et calculs avant affichage, erreur
  locale avec reprise si le résultat dépasse les bornes ; ambiguïté inconnue
  jamais assimilée à zéro. Accès refusé explicite, sans reprise automatique.
  Graphique à segments droits, couleur du thème, série partielle et couverture
  indiquées, taille mobile et grille KPI alignées sur DESIGN.md.
  Recette d’identité réelle et CI non revalidées ; Codex Security indisponible.
- Dépendances : T09–T10.
- Livrer : analytics_store_month, KPI qualifiés, premier graphique MUI X Charts
  Community et tableau accessible ; grille des mois avec trous explicites.
- Valider : mois absent, zéro, données ambiguës, somme partielle, pagination inachevée,
  négatifs, absence de multiplication par catégories/produits ; graphique et table
  concordants, valeurs exactes dans les libellés et détails.
- Terminé quand : aucun KPI définitif si extraction bornée incomplète ; coordonnées
  seules converties pour le tracé ; réduction de mouvement et clavier vérifiés.
- Commit proposé : `Show store monthly sales with coverage`.

### T12 — Comparaisons calendaires du magasin

- Statut : **commitée après relecture technique ; sécurité finale en attente**. Comparaisons du CA d’un
  magasin à la demande, depuis analytics_store_month_changes pour M-1/N-1 et
  le courant ; fenêtre de référence depuis analytics_store_month (k mois
  précédents ou décalage de douze mois). Aucun ratio publié sommé ou moyenné.
  Dates, couvertures et univers observé explicités ; fenêtres complètes requises.
  Différences exactes, divisions à six décimales ; base nulle/manquante indisponible,
  base négative qualifiée avec différence absolue et pourcentage non interprété.
  Deux collections bornées chacune à cinq pages / 120 lignes ; initialisation
  et fraîcheur contrôlées autour du lot, aucun résultat si lecture incomplète ou
  publication changée. Annulation et effacement sur changement de référence,
  magasin, période appliquée ou onglet ; aucun appel lors de l’édition des mois.
  Références hors calendrier prises en charge sans requête invalide. Tableau
  exact accessible, défilement local, aucune comparaison réseau ajoutée.
  Relecture : montants des mois communs et références M-1/N-1 déjà lus comparés
  exactement, y compris fenêtres chevauchantes. Contradictions rejetées avec
  erreur locale et reprise ; décimaux équivalents acceptés, null distinct de zéro.
  Validation locale : `npm run check` réussi, **321 tests unitaires et
  75 scénarios Chromium** sur 360/768/1440 px ; axe, clavier, absence de
  débordement et effacement des données à la déconnexion vérifiés.
  Recette d’identité réelle et CI non revalidées ; Codex Security indisponible.
- Dépendances : T11.
- Livrer : lecture analytics_store_month_changes pour M-1/N-1 ; comparaisons de
  fenêtres uniquement depuis les montants complets du magasin, jamais une moyenne
  des pourcentages ; montrer les périodes et les limites de couverture.
- Valider : mois intermédiaire absent, k mois précédents, décalage de 12 mois,
  référence zéro/null/négative, fenêtre incomplète et variation absolue exacte.
- Terminé quand : aucune comparaison multi-magasins ajoutée ; base négative signalée,
  pas de flèche positive interprétée automatiquement comme une amélioration.
- Commit proposé : `Add calendar comparisons for store sales`.

### T13 — Explorateur de collections et détails complets

- Statut : **commitée après relecture technique, sécurité finale en attente**. Navigation Données,
  catalogue métier autorisé, référentiels/observations/analyses mensuelles, filtres
  appliqués depuis les seules capacités du catalogue et pages manuelles de 25 lignes.
  Fiche relue à clé complète, y compris toutes les composantes et les deux bornes
  exactes du mois. Doublons intra-page, curseurs incohérents, clés et filtres visibles
  contradictoires rejetés ; aucune agrégation réseau ou lecture automatique par ID.
  Fraîcheur avant/après, analyses non initialisées indisponibles, erreurs locales,
  annulation et effacement au changement de collection/fiche/navigation/session.
  Détail récursif partagé avec le référentiel magasin : libellés français et noms
  techniques, décimaux exacts, null/zéro/texte vide/listes vides distincts, HTML inerte.
  Collections du magasin à la demande ; filtre store_id uniquement si autorisé,
  référentiels globaux explicitement qualifiés. Code explorateur chargé à la demande.
  [Manifeste de couverture](frontend-coverage.md) : 325 champs et 74 chemins enfants
  associés au composant et à leur test synthétique. Les deux routes opérationnelles
  sont exclues de cet explorateur ; leur écran habilité reste T20.
  Relecture : sélection, page/tri, magasin ouvert et mois brouillon/appliqués
  conservés lors du passage par Données ; écrans métier démontés et lectures annulées.
  Filtre du magasin fixe, reprise depuis la première page sur curseur refusé, focus
  restauré par identité plutôt que par position et mois non calendaires rejetés.
  Grandes listes conservées intégralement et paginées localement par 50 éléments,
  sans appels supplémentaires ; suppression des plafonds arbitraires de liste/texte.
  Les lectures restent bornées à 2 MB par le transport ; limites varchar et valeurs
  exactes validées. Les pages/fiches ne constituent pas un instantané garanti.
  Types, nullabilité, longueurs, clés et filtres des 24 ressources publiques
  confrontés aux modèles API. Qualification de charge restante en T21 ;
  le build signale encore un chunk applicatif supérieur à 500 kB malgré le chargement
  différé de l’explorateur. Workers Vitest bornés à deux après une expiration de
  fixture courte sous forte concurrence ; aucune limite de session produit modifiée.
  Validation finale : `npm run check` réussi, **364 tests unitaires et 84 scénarios
  Chromium** sur 360/768/1440 px ; clavier, axe, zoom, stockage vide et
  effacement après déconnexion vérifiés. Liens locaux, cohérence et divulgation contrôlés.
  Codex Security indisponible ; recette d’identité réelle et CI non revalidées.
- Dépendances : T06, T08 et T10.
- Livrer : Données → référentiels/observations/analyses, catalogue selon droits,
  liste paginée et fiche de ligne à clé complète, rendu récursif des objets/listes
  autorisés avec libellés français. Réutiliser ce détail pour les liens magasin.
- Valider : clés composites, deuxième page, listes vides/multiples, texte HTML inerte,
  produit sans vente, observation non rapprochée, règle inutilisée ; aucun appel
  automatique par élément des listes d’observation_ids.
- Terminé quand : tous les champs d’une ligne sont consultables ; filtres limités
  au catalogue et aucun champ DB non publié exposé. Le manifeste de couverture
  commencé ici associe ressource/champ/chemin à un composant et un test.
- Commit proposé : `Add published data explorer`.

### T14 — Ventes et produits du magasin

- Statut : **commitée après relecture technique, sécurité finale en attente**.
  Onglet actif chargé à la demande, catalogue validé avant la lecture magasin/mois.
  Collection bornée à cinq pages et 500 cellules ; lecture incomplète sans tableau
  ni graphique, reprise manuelle ou consultation native dans Données.
  Tableau exact paginé localement par 25 cellules ; barres sur un mois explicite
  et un sous-ensemble nommé de 20 cellules, courbe du GTIN source sélectionné
  avec calendrier complet et trous distincts de zéro. Retours négatifs conservés,
  GTIN non rapprochés distincts, volumes au grain cellule uniquement.
  Détail complet partagé, produit actuel et observations ouvertes individuellement
  selon le catalogue, sans appels automatiques par ID. Identités et grain des
  preuves vérifiés ; sources vivantes pouvant changer/disparaître, sans promesse
  de preuve historique immuable. Fraîcheur avant/après, refus locaux et annulations.
  Aucun filtre catégorie, total magasin ou total de volumes hétérogènes ajouté.
  Relecture : lien produit explicitement daté à la publication ; lien nul distinct
  de lignes non rapprochées ou contradictoires. Barres partielles qualifiées,
  restauration du focus par identité ou vers le tableau après pagination.
  Identifiants d’observation uniques, compteurs de sources/mesures et attribution
  produit contrôlés selon le grain publié. Limite de réponse explicitement signalée.
  `npm run check` réussi : **395 tests unitaires et 90 scénarios Chromium**
  à 360/768/1440 px. Clavier, axe, zoom 200 %, stockage vide et déconnexion
  vérifiés sur données synthétiques ; liens, cohérence et divulgation contrôlés.
  Codex Security indisponible ; recette d’identité réelle et CI non revalidées.
  L’avertissement de chunk applicatif supérieur à 500 kB reste suivi en T21.
- Dépendances : T11 et T13.
- Livrer : analytics_register_product_month, tableau par GTIN source/mois, barres
  sur périmètre explicite, courbe d’un produit sélectionné et preuves à la demande.
- Valider : plusieurs GTIN avec product_id null restant distincts, ambiguïtés,
  retours, volumes non comparables, produit disparu du référentiel vivant.
- Terminé quand : aucune catégorie filtrable inventée pour les ventes, aucune
  somme des volumes hétérogènes ni confusion entre observation et total magasin.
- Commit proposé : `Add store product sales details`.

### T15 — Présence et linéaire par catégorie

- Statut : **commitée après relecture technique et sécurité**.
  Synthèse magasin/mois et deux courbes séparées par catégorie, calendrier complet,
  valeurs exactes et dénominateurs publiés. Codes inconnus conservés sans libellé
  inventé ; absences inférées, clés non rapprochées et ambiguïtés explicites.
  Linéaire sans unité physique présumée, sans plafonnement à 100 %, sans somme
  entre catégories ni moyenne de ratios. Dénominateur nul distinct de zéro déclaré.
  Collections de présence et linéaire ouvertes à la demande avec filtre catégorie ;
  lecture complète bornée à cinq pages et 500 cellules, pagination locale par 25,
  champs et identifiants source consultables sans appels automatiques par ID.
  Catalogue, grain, fraîcheur avant/après, refus locaux et annulation vérifiés
  par tests synthétiques. `npm run check` réussi : **440 tests unitaires et
  96 scénarios Chromium** à 360/768/1440 px, avec clavier, axe, zoom 200 %,
  stockage vide et déconnexion. Un délai de pagination de l’explorateur existant
  a échoué lors du premier passage ; deux répétitions ciblées puis la nouvelle
  suite complète passent sans modification. Recette réelle et CI hébergée
  non revalidées ; avertissement de chunk supérieur à 500 kB suivi en T21.
  Relecture : rejet exact des taux de présence hors de 0–1, valeurs de linéaire
  négatives, comptes d’absences fractionnaires, clés produit incohérentes et
  présences positives avec absence inférée. Régressions ajoutées pour ces
  invariants, la pagination locale avec retour de focus et le filtre catégorie vide.
  Nouvelle suite complète réussie après corrections.
  Revue Codex Security du diff T15 finalisée après corrections, sans vulnérabilité
  signalée sur les douze fichiers modifiés ;
  les tâches précédentes et la configuration déployée restent hors de ce scan.
- Dépendances : T11 et T13.
- Livrer : analytics_store_category_month, analytics_distribution_product_month et
  analytics_shelf_category_month, courbes séparées et dénominateurs consultables.
- Valider : absence inférée, produit ambigu, catégorie inconnue, ratio supérieur à
  100 %, dénominateur nul, unités inconnues et catégories non comparables.
- Terminé quand : aucun plafonnement ou moyenne de ratios, aucune assimilation de
  présence à la distribution réseau ou à la conformité d’assortiment.
- Commit proposé : `Add store presence and shelf share views`.

### T16 — Activité commerciale par type

- Statut : **commitée après relecture technique et sécurité**.
  Onglet chargé à la demande, trois séries séparées appels/terrain/participatif
  et grille mensuelle exacte. Type absent, zéro et ambiguïté restent distincts.
  Collection magasin/mois complète, bornée à cinq pages/360 cellules, catalogue
  et fraîcheur avant/après vérifiés. Contexte CA lu indépendamment, même calendrier,
  cinq pages/120 mois, sans jointure, addition intertypes, score causal ou ROI.
  Planification du référentiel actuel séparée de l’activité observée.
  Tous les champs et identifiants restent consultables ; preuves vivantes lues
  une par une à la demande, avec contrôle ID/magasin/mois/type/attribution et
  valeur à source unique. Preuve absente ou changée indisponible sans retirer la
  cellule publiée. Listes paginées localement par 50, focus rendu à la fermeture.
  Erreurs et reprises locales, annulation au changement de période/onglet/session.
  Relecture : une publication non initialisée bloque désormais la preuve vivante
  avant sa requête, évitant une qualification de fraîcheur incorrecte. Sept tests
  supplémentaires couvrent cet état, le changement de fraîcheur, les réponses
  multiples/avec curseur, la preuve tardive annulée et le focus après pagination.
  `npm run check` réussi : **479 tests unitaires et 105 scénarios Chromium**,
  dont neuf nouveaux scénarios T16 à 360/768/1440 px (clavier, axe, zoom 200 %,
  stockage vide, déconnexion et réponse tardive). Build sans avertissement de
  chunk supérieur à 500 kB dans cette exécution ; qualification T21 toujours requise.
  Revue Codex Security du diff applicatif T16 finalisée sans vulnérabilité signalée
  sur les douze fichiers revus. Le présent suivi est actualisé après le scan ;
  déploiement réel, CI hébergée et tâches précédentes hors de cette revue.
- Dépendances : T11 et T13.
- Livrer : analytics_activity_month et observations liées, trois séries distinctes
  appels/terrain/participatif, tableau et alignement temporel avec les ventes.
- Valider : type absent, zéro déclaré, ambiguïté, plusieurs preuves, période modifiée
  pendant une lecture et panne limitée à ce bloc.
- Terminé quand : aucune addition intertypes, aucun score causal ou retour sur
  investissement ; champs de planification séparés de l’activité observée.
- Commit proposé : `Add store activity by source type`.

### T17 — Typologies et assortiments

- Dépendances : T13 et T09.
- Livrer : analytics_typology_month, analytics_assortment_candidates et
  analytics_retailer_assortment_month ; tables mensuelles, règles/snapshots liés,
  candidats exacts distincts du contexte enseigne. Matrice thermique avancée différée.
- Valider : mois sans valeur, snapshots contradictoires, mapping ambigu, plusieurs
  règles candidates, assortiment sans candidat et listes imbriquées multiples.
- Terminé quand : aucun report de valeur entre mois, aucune conformité déduite d’une
  absence, et nombre de lignes distinct d’un nombre de produits obligatoires.
- Commit proposé : `Add typology and assortment inspection`.

### T18 — Qualité d’attribution et audits autorisés

- Dépendances : T07, T10 et T13.
- Livrer : analytics_monthly_link_quality avec périmètre réseau explicite ;
  import_runs et analytics_refresh_runs réservés à operations:read.
- Valider : rôles ordinaires/OPS, zéro requête OPS sans droit, accès direct refusé
  par l’API, changement d’utilisateur, freshness stale et refresh en échec.
- Terminé quand : aucun filtre store_id sur la qualité réseau, aucun CA perdu
  déduit des nombres de lignes, aucun nom de fichier/hash/erreur privée révélé.
- Commit proposé : `Add data quality and restricted audit views`.

### T19 — Réconciliation exhaustive des champs et parcours

- Dépendances : T12–T18.
- Livrer : contrôle automatisé registre ↔ projections ↔ manifeste frontend ↔ matrice,
  complétant les tests existants de chaque fonctionnalité.
- Valider : chaque champ/chemin rendu avec valeur synthétique attendue, null, liste
  vide ou plusieurs éléments selon son type ; contrôle négatif d’un champ omis.
  Vérifier aussi les destinations métier spécialisées, pas uniquement l’explorateur.
- Terminé quand : aucun écart non expliqué sur les ensembles publiés ; couverture
  OPS testée avec les deux rôles et secours Données disponible pour chaque ressource.
- Commit proposé : `Verify complete published field coverage`.

### T20 — Qualification responsive et accessibilité des parcours

- Dépendances : T19 ; les contrôles de base existent depuis T02.
- Livrer : compléter les tests transversaux et corriger les écarts observés, sans
  refonte générale. Références visuelles synthétiques limitées aux états importants.
- Valider : 360/768/1440 px, zoom réel 200 %, clavier seul, focus des dialogues,
  réduction du mouvement, contrastes rendus, libellés longs, graphiques et tables.
- Terminé quand : pas de débordement horizontal de page, tous les champs et actions
  accessibles ; résultats axe complétés par une recette humaine du clavier/zoom
  et un contrôle des annonces avec lecteur d’écran. Aucun score automatique ne vaut certification.
- Commit proposé : `Verify accessible responsive user journeys`.

### T21 — Sécurité du build et contrôles navigateur transversaux

- Dépendances : T19–T20.
- Livrer : tests du build de production, configuration CSP compatible avec les
  styles MUI, assets maîtrisés et destinations connect-src explicites dans un
  environnement de recette défini. Vérifier dépendances et configuration publique.
- Valider : libellés HTML/URL malveillants inertes, absence de secret dans assets,
  stockage/cache/logs sans tokens ni données métier, callback nettoyé, pas de
  service worker métier, session interrompue pendant retry et refus des origines.
- Terminé quand : scan Codex Security cumulatif final terminé et constats traités ;
  les headers réels du serveur de recette sont inspectés. Si aucun environnement
  n’est défini, marquer cette partie bloquée ; ne pas inventer d’hébergeur ni déployer.
- Commit proposé : `Verify browser security boundaries`.

### T22 — Recette intégrée et limites de livraison

- Dépendances : T07 et T19–T21.
- Livrer : parcours E2E réels sur données synthétiques couvrant connexion → liste →
  fiche → preuves → qualité → logout, et synthèse générique des résultats vérifiés.
  Mettre à jour README et architecture uniquement sur les capacités effectivement reçues.
- Valider : profils synthétiques reproductibles, réseau lent, erreurs partielles,
  pagination, mémoire/requêtes/volume de réponse et temps de chargement p95.
  Annoncer machine, profil, nombre de répétitions et limites des mesures.
- Terminé quand : budgets de qualification explicitement convenus et comparés aux
  mesures, tests complets et scans disponibles. Distinguer réception fonctionnelle,
  validation de charge et préparation production ; aucun seuil arbitraire ne vaut accord.
- Commit proposé : `Document verified frontend delivery boundaries`.

## Jalons testables

| Jalon | Tâches | Démonstration attendue |
| --- | --- | --- |
| J0 — Socle contrôlé | T01–T02 | Shell responsive, build et tests reproductibles |
| J1 — Première tranche utilisable | T03–T11 | Connexion réelle, magasin, période, graphique/table, fraîcheur, logout ; revue Security cumulative |
| J2 — Investigation complète | T12–T19 | Comparaisons unitaires, onglets, preuves, explorateur exhaustif et audits selon droits |
| J3 — Tranche qualifiée | T20–T22 | Recette intégrée, accessibilité, mesures et sécurité ; limites de production explicites |

Chaque jalon inclut les tests des tâches précédentes. Une tâche avec seulement
des mocks validés reste signalée comme telle ; les tests ignorés ne comptent pas
comme réussis. Le frontend peut progresser pendant un blocage OIDC, mais J1 et
les validations réelles en dépendant restent ouverts.

## Traçabilité de la réception

| Contrat / risque | Tâches et preuves principales |
| --- | --- |
| Connexion, expiration, confidentialité | T03–T07, T21 ; tests négatifs, smoke réel et Security |
| Pagination, limites, concurrence, données périmées | T05–T06, T10 ; transport et E2E |
| Exactitude, null/zéro, ambiguïtés, mois et ratios | T10–T12, T14–T17 ; oracles synthétiques |
| Couverture de tous les champs et lignes isolées | T13–T19 ; registre, manifeste et rendu réel |
| Droits OPS et qualité réseau | T18 ; absence d’appel et refus serveur |
| Responsive, clavier, graphiques accessibles | T02 puis chaque écran, T20 ; auto + humain |
| Performance et livraison | T22 ; mesures sur profils déclarés et budgets convenus |
| Réseau, classement, cohortes et comparaison multi-magasins | Différés ; cas correspondants d’acceptance.md non reçus dans cette tranche |

## Reprise par un agent

Choisir une seule tâche pour commencer. Dans son compte rendu, fournir son ID,
le périmètre réalisé, les fichiers modifiés, les commandes réellement exécutées,
les résultats et contrôles non effectués, le scan Security applicable, les limites
restantes et le message de commit proposé. Mettre à jour le statut seulement à
partir de ces preuves ; conserver les résultats sensibles hors des fichiers publics.

États utiles : **à faire**, **en cours**, **bloqué** (cause précise), **à relire**
(tests faits, commit non approuvé), **validé**, **commité** (après accord explicite).
Ne pas confondre code implémenté, fonctionnalité vérifiée et commit approuvé.

Les dépendances backend différées doivent faire l’objet d’un futur arbitrage dédié.
Le présent fichier n’autorise ni leur implémentation, ni un changement de modèle
d’accès, ni un push ou déploiement automatique.
