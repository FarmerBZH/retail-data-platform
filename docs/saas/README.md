# Plateforme analytique — contrat de développement

Statut : proposition de cadrage, à valider avant implémentation. Aucun frontend,
déploiement SaaS ou nouveau mécanisme d'authentification n'est livré par ces documents.
Le contrat existant a été inspecté dans le code de l'API et son registre de ressources.
Aucune donnée privée n'a été nécessaire à ce cadrage.

## Objectif

Donner à un business analyste une lecture mensuelle fiable des ventes, de leur
évolution et du contexte commercial, du réseau jusqu'au détail d'un magasin.
Chaque résultat doit expliquer son périmètre, sa couverture et sa fraîcheur.

## Documents de référence

Commencer par le [PRD — objectifs, priorités et réception](prd.md), qui donne
le périmètre P0 de la première version et les enrichissements différables.
Les documents suivants précisent ses contrats sans répéter les arbitrages produit.

1. [Produit et parcours](product.md) : écrans, filtres, graphiques et interactions.
2. [Contrat des indicateurs](metrics.md) : grains, calculs et comparaisons.
3. [Intégration et connexion](integration.md) : capacités actuelles, écarts et sécurité.
4. [Critères de réception](acceptance.md) : scénarios vérifiables sur données synthétiques.
5. [Matrice table → champs → écran](data-coverage.md) : inventaire exhaustif des
   champs publiés, objets imbriqués, destinations et droits de consultation.
6. [Design de référence](../../DESIGN.md) : thème MUI, responsive, composants,
   graphiques et états visuels communs.

Ces documents définissent la cible ; [l'architecture](../architecture.md) décrit
uniquement l'existant. En cas de divergence avec une capacité supposée, vérifier
le code et le catalogue authentifié avant de développer. Le
[contrat mensuel](../monthly-analytics.md) reste la référence des données ; ne pas
en simplifier les ambiguïtés pour satisfaire une maquette.

## Périmètre retenu pour la proposition

Le démarrage porte sur le frontend consommant l’API existante. Les nouveaux
endpoints analytiques sont explicitement différés : leurs besoins restent décrits
comme dépendances de la cible complète, sans développement backend dans cette étape.
Commencer par la connexion, les magasins et les détails publiés ; ne pas annoncer
les agrégations réseau indisponibles comme livrées.

- Application web en français, lecture seule, usage principal sur ordinateur.
- Trois niveaux : réseau, sélection de magasins, fiche magasin.
- Historique mensuel, comparaison à la période précédente et à l'année précédente.
- Connexion personnelle obligatoire, réutilisation de l'API existante.
- Décision confirmée : analystes autorisés avec accès global à une seule organisation.
  Le terme SaaS ne constitue pas une garantie d'isolation entre entreprises.
- Pas de facturation, inscription publique, édition de données, import depuis le
  navigateur, prévision, recommandation automatique ou export dans cette version.

## Décisions ouvertes

| Décision | Position de travail | Conséquence avant livraison |
| --- | --- | --- |
| Public autorisé (confirmé) | Une seule organisation, accès à tous les magasins | Conserver l'autorisation globale existante |
| Devise, HT/TTC, périmètre des ventes | Information non disponible, confirmé lors du cadrage | Ne pas afficher EUR, HT ou TTC par déduction ; faire valider une métadonnée commerciale |
| Total réseau | CA observé qualifié, jamais CA exhaustif présumé | Appliquer les règles de couverture de `metrics.md` |
| Architecture de session web | Client navigateur avec code + PKCE proposé | Vérifier la compatibilité réelle du fournisseur et du client autorisé |
| Stack frontend et graphiques (retenue) | React, TypeScript, Vite ; composants MUI et graphiques MUI X Charts Community | MUI confirmé par le responsable produit ; versions compatibles à verrouiller à l’installation, aucune dépendance ajoutée ici |
| Volume et temps de réponse attendus | Pas de mesure ni de garantie | Mesurer avec des jeux synthétiques représentatifs et valider le contrat d'agrégation serveur |

Les extensions de l'API décrites ici sont des besoins concrets des vues demandées,
pas des endpoints disponibles. La fiche magasin peut être développée avec les
collections actuelles ; les totaux réseau à grande échelle dépendent des extensions.
