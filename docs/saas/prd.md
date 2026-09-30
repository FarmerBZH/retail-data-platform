# PRD — Plateforme d’analyse commerciale

Statut : proposition de référence pour la première version, à valider avant
implémentation. Les décisions confirmées sont distinguées des priorités proposées.
Ce document définit le résultat produit attendu ; il ne décrit pas une application
déjà livrée et ne remplace pas les contrats détaillés.

Décision de démarrage : différer les nouveaux endpoints analytiques et réaliser
le frontend sur les capacités existantes. Le P0 ci-dessous reste la cible complète ;
la première tranche (connexion, magasins, détails) ne constitue pas sa réception.
Les vues nécessitant de nouvelles agrégations restent dépendantes d’une reprise
ultérieure de ce périmètre backend.

## 1. Problème et résultat attendu

Les données sont disponibles dans une API de lecture, mais leur exploitation exige
encore de connaître les ressources, les relations et les limites des indicateurs.
Un business analyste doit pouvoir examiner une évolution commerciale sans reconstruire
ces relations ni confondre une baisse réelle avec une absence de données.

La plateforme doit permettre de répondre à trois questions : **que se passe-t-il
sur le réseau, quels magasins contribuent à cette évolution, et quelles données
permettent de l’expliquer ?** L’analyse privilégie l’évolution mensuelle et garde
la couverture, les ambiguïtés et la fraîcheur visibles jusqu’au détail.

## 2. Utilisateurs et décisions confirmées

Utilisateur principal : business analyste d’une seule organisation, autorisé à
consulter tous les magasins. Un utilisateur disposant du droit opérationnel
supplémentaire peut également consulter les audits d’import et de publication.
Il n’y a ni séparation par entreprise cliente ni restriction par magasin.

Décisions confirmées : application en lecture seule utilisant l’API existante,
connexion personnelle obligatoire, vues réseau/sélection/fiche magasin et accès
aux données publiées. La devise et la qualification HT/TTC ne sont pas connues.
L’interface doit les signaler comme non confirmées, sans inventer un symbole monétaire.

Usage proposé : revue mensuelle du réseau, investigation ponctuelle d’une variation
et comparaison d’un groupe de magasins. Interface française, priorité à l’ordinateur,
consultation possible sur petit écran.

Direction visuelle confirmée : composants **MUI**, interface responsive, agréable
et simple. Stack retenue pour la réaliser : React, TypeScript et Vite, avec MUI X
Charts Community pour les graphiques. Le thème et les règles responsive sont
précisés dans [DESIGN.md](../../DESIGN.md).

## 3. Parcours prioritaire

1. **Se connecter** chez le fournisseur d’identité ; entrer dans une session autorisée.
2. **Lire le réseau** sur une période mensuelle : CA observé, unités, évolution,
   couverture et fraîcheur. Repérer une variation sans lui attribuer de cause.
3. **Identifier les contributions** : consulter le classement des magasins et
   distinguer ceux qui sont comparables de ceux dont les données manquent.
4. **Sélectionner et comparer** plusieurs magasins, avec les mêmes dates et définitions
   que la vue réseau ; passer du total sélectionné aux séries individuelles.
5. **Examiner un magasin** : ventes produit, présence, linéaire, activité, typologies
   et assortiments. Ouvrir les observations détaillées pour étayer une hypothèse.
6. **Revenir à la synthèse** en conservant le contexte de période et de sélection.

Un second parcours, **Données → collection → fiche**, permet de consulter toute
donnée autorisée, y compris les produits sans ventes et observations non rapprochées.
Il complète le parcours d’analyse sans imposer un graphique pour chaque champ.

## 4. Périmètre et priorités de la première version

P0 désigne une condition de réception de la première version. P1 désigne un
enrichissement différable ; son absence ne doit supprimer aucun champ consultable.
Ce classement est proposé pour arbitrage produit.

| Priorité | Capacité | Résultat attendu |
| --- | --- | --- |
| P0 | Connexion et session | Accès personnel, expiration et déconnexion effectives, erreurs compréhensibles |
| P0 | Période et sélection | Mois explicites, un/plusieurs/tous les magasins, filtres actuels enseigne/région/format/statut |
| P0 | Vue réseau | KPI qualifiés, courbe mensuelle, comparaison précédente et N-1, classement et contributions |
| P0 | Comparaison magasins | Total sélectionné, séries individuelles et tableau, contexte conservé |
| P0 | Fiche magasin | Tous les onglets du contrat produit ; courbes de ventes, présence/linéaire par catégorie et activités distinctes |
| P0 | Couverture exhaustive | Tous les champs publiés consultables selon la matrice, listes et objets inclus ; audits selon les droits |
| P0 | Qualité et accessibilité | Null/zéro/ambiguïté distincts, fraîcheur, erreurs partielles, clavier et alternative tabulaire aux graphiques |
| P1 | Comparaison indexée | Base 100 avec base commune valide, en complément des montants |
| P1 | Exploration visuelle avancée | Matrice thermique interactive des typologies et graphiques additionnels de contexte ; tables mensuelles présentes dès P0 |

Le minimum P0 couvre donc toutes les données autorisées, avec une profondeur
visuelle adaptée aux analyses prioritaires. La [matrice](data-coverage.md) fixe
les destinations de consultation ; les enrichissements P1 n’en reportent pas la couverture.

Hors périmètre : saisie ou correction des données, imports depuis le navigateur,
export, facturation, inscription publique, gestion de plusieurs entreprises,
prévisions, alertes automatiques et recommandations causales. Aucun objectif de
marge, panier moyen ou retour sur investissement sans les sources correspondantes.

## 5. Règles produit non négociables

« CA observé » couvre l’univers produit renseigné, sans garantir le CA exhaustif
d’un magasin. Tout résultat partiel annonce son périmètre et sa couverture.
Un zéro mesuré, une valeur absente et une ambiguïté ne sont jamais interchangeables.

Les comparaisons suivent les mois calendaires. Une comparaison sur cohorte conserve
les mêmes magasins dans les deux périodes et annonce les exclus. Les pourcentages
ne sont pas moyennés pour fabriquer une croissance réseau. Le référentiel actuel
n’est pas présenté comme l’historique des attributs magasin.

Une première page de données ne produit pas un total réseau. Les agrégations
et classements globaux doivent être calculés sur tout le périmètre filtré.
Les détails et leurs preuves restent soumis aux limites de fraîcheur des sources.
Les règles complètes se trouvent dans le [contrat des indicateurs](metrics.md).

## 6. Critères de réussite et réception

| Dimension | Critère proposé | Preuve attendue |
| --- | --- | --- |
| Utilité | Un analyste réalise le parcours prioritaire sans SQL ni aide d’un développeur | Recette guidée par des questions métier sur un jeu synthétique ; réponses attendues définies à l’avance |
| Compréhension | L’analyste distingue baisse, zéro mesuré, absence et comparaison partielle | Quatre cas de recette sans confusion sur la conclusion |
| Exactitude | Totaux, variations et contributions correspondent aux résultats de référence | Scénarios synthétiques du contrat des indicateurs, sans écart de calcul |
| Exhaustivité | 100 % des champs autorisés ont une présentation consultable | Matrice réconciliée avec le registre et les modèles imbriqués, puis vérification des composants |
| Sécurité | Aucun accès sans session valide, aucun résidu affiché après expiration/déconnexion | Tests navigateur et connexion réelle avec identité synthétique ; audit réservé au rôle habilité |
| Accessibilité | Parcours réalisable au clavier et données des graphiques lisibles en tableau | Vérification manuelle des écrans P0 et des états d’erreur |
| Performance | Chargement et interactions respectent un budget explicite sur le volume cible | Mesures de latence p95, requêtes et mémoire sur un profil synthétique représentatif |

Les seuils de performance, le volume cible et le nombre d’utilisateurs simultanés
restent à fixer avant qualification de production ; aucune rapidité n’est réputée
acquise. La recette peut être conduite manuellement, sans outil de suivi des sessions
ni collecte de données privées. Les [critères détaillés](acceptance.md) précisent
les cas techniques, y compris pagination, erreurs et changement de publication.

## 7. Dépendances, risques et décisions ouvertes

| Sujet | État et incidence sur la première version |
| --- | --- |
| API réseau | Agrégations, recherche magasins, disponibilité des périodes et classement global à développer ; bloquent la réception des vues réseau P0 |
| Cohérence des publications | Contrat de version/fraîcheur à définir pour les futures réponses agrégées ; ne pas promettre un snapshot entre pages actuelles |
| Connexion web | Adapter et vérifier le client OIDC autorisé, les redirections et origines ; le client CLI ne constitue pas une session navigateur |
| Devise et HT/TTC | Inconnus ; consultation possible avec libellé explicite, présentation financière qualifiée suspendue à confirmation métier |
| Stack et graphiques | React + TypeScript + Vite, MUI et MUI X Charts Community retenus ; versions et compatibilité à vérifier à l’installation |
| Hébergement et charge | Environnement, capacité et budgets à décider avant mise en production ; aucune ouverture publique implicite |

La fiche magasin et l’explorateur peuvent avancer avec les collections existantes.
La connexion doit être vérifiée tôt et le contrat des agrégations défini avant de
brancher les vues réseau. Un prototype incomplet reste identifié comme tel et ne
constitue pas la livraison P0. Il n’y a pas d’échéance de livraison engagée ici.

## 8. Références et arbitrage

Le présent PRD fixe les priorités et critères produit ; [product.md](product.md)
décrit les interactions, [metrics.md](metrics.md) les calculs,
[integration.md](integration.md) les frontières techniques,
[data-coverage.md](data-coverage.md) l’exhaustivité et
[acceptance.md](acceptance.md) la réception.
En cas de conflit, conserver la sémantique et la sécurité du contrat existant,
puis expliciter l’arbitrage produit ; ne pas contourner une limite par une hypothèse
silencieuse. [L’architecture](../architecture.md) continue de décrire uniquement
les capacités implémentées et vérifiées.
