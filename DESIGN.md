# Design de la plateforme analytique

Statut : référence visuelle cible, sans composants implémentés à ce stade.
MUI, le responsive et une interface agréable et simple sont confirmés. Les valeurs
ci-dessous fixent une base commune pour l’implémentation ; elles pourront évoluer
ensemble après une revue des premiers écrans.

Le [PRD](docs/saas/prd.md) fixe les priorités ; le
[contrat produit](docs/saas/product.md) fixe les parcours ; les
[indicateurs](docs/saas/metrics.md) fixent le sens des données. Ce document centralise
leur présentation. Aucune décision visuelle ne peut masquer une couverture partielle
ou supprimer un champ de la [matrice](docs/saas/data-coverage.md).

## 1. Direction visuelle

Interface de travail claire, sobre et aérée : fond neutre, surfaces blanches,
typographie lisible, bleu pour les actions principales. La hiérarchie vient des
titres, de l’espacement et de l’alignement, avec peu d’ombres. Éviter dégradés,
illustrations décoratives, effets de verre et multiplication des cartes imbriquées.
Le thème clair constitue la première version ; aucun mode sombre à livrer en P0.

Employer Material UI et MUI X Charts Community. Garder une apparence commune aux
cartes, filtres, tableaux et graphiques grâce à un thème partagé. Les styles locaux
servent à la disposition, sans redéfinir les couleurs ou tailles communes par écran.

## 2. Valeurs du thème

Ces noms correspondent aux options du thème MUI ou, lorsqu’indiqué, à des constantes
de présentation à créer dans le frontend. Les tailles typographiques utilisent des
rem ; les équivalents pixels ci-dessous supposent une base navigateur de 16 pixels.

| Option / rôle | Valeur retenue | Usage |
| --- | --- | --- |
| `palette.mode` | `light` | Thème initial |
| `palette.primary.main` | `#1D4ED8` | Action principale, liens et focus |
| `palette.primary.dark` | `#1E40AF` | Survol d’une action principale |
| `palette.primary.light` | `#DBEAFE` | Accent pâle, jamais texte sur blanc |
| `palette.primary.contrastText` | `#FFFFFF` | Texte sur bouton primaire |
| `palette.background.default` | `#F8FAFC` | Fond de page |
| `palette.background.paper` | `#FFFFFF` | Tables, cartes, panneaux |
| `palette.text.primary` | `#0F172A` | Texte et valeurs principales |
| `palette.text.secondary` | `#475569` | Libellés, unités, aide |
| `palette.divider` | `#E2E8F0` | Séparation décorative, pas contour indispensable d’un contrôle |
| Contour de contrôle | `#64748B` | Champ ou contrôle dont la limite doit être identifiable |
| `palette.success.main` | `#166534` | État validé, avec libellé |
| `palette.warning.main` | `#92400E` | Donnée partielle ou périmée, avec libellé |
| `palette.error.main` | `#B91C1C` | Erreur ou accès refusé |
| `palette.info.main` | `#1D4ED8` | Information neutre |
| Fonds de statut (constantes) | succès `#F0FDF4`, avertissement `#FFFBEB`, erreur `#FEF2F2`, info `#EFF6FF` | Texte de la couleur de statut correspondante |
| `spacing` | `8` | Échelle 4, 8, 16, 24, 32, 48 px avec multiplicateurs 0.5, 1, 2, 3, 4, 6 |
| `shape.borderRadius` | `8` | Contrôles et surfaces ; éviter les grandes capsules hors badges |
| `typography.fontFamily` | `system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif` | Police système, sans chargement externe |
| `typography.button` | graisse 600, `textTransform: none` | Libellés en casse naturelle |

Définir explicitement les couleurs des états survol, sélection et focus à partir
de ces valeurs. Une option MUI de contraste automatique ne remplace pas la vérification
des paires réellement rendues, notamment après ajout d’opacité ou de transparence.

| Rôle typographique | Taille / interligne / graisse |
| --- | --- |
| Titre de page, élément sémantique h1 | 1.75rem / 1.25 / 600 ; 1.5rem sur petit écran |
| Titre de section, h2 | 1.25rem / 1.4 / 600 |
| Titre de bloc, h3 | 1rem / 1.5 / 600 |
| Corps et saisie | 1rem / 1.5 / 400 |
| Table et libellé secondaire | 0.875rem / 1.5 / 400 |
| Note courte | 0.75rem / 1.5 / 400 ; jamais seule pour une information critique |
| Valeur KPI | 2rem / 1.2 / 600 ; 1.75rem sur petit écran |

Nombres alignés à droite dans les tables avec chiffres tabulaires. Ne pas réduire
la police pour faire tenir une longue valeur ; adapter la largeur ou revenir à la ligne.
Garder les niveaux de titres HTML logiques, indépendamment de leur taille visuelle.

## 3. Structure et responsive

Définir `breakpoints.values` : xs=0, sm=600, md=900, lg=1200, xl=1536 pixels.
La largeur disponible reste déterminante : aucun composant ne doit imposer une
largeur minimale qui fait déborder la page.

| Zone | Moins de 600 px | De 600 à 1199 px | À partir de 1200 px |
| --- | --- | --- | --- |
| Navigation | Tiroir temporaire, bouton nommé « Ouvrir le menu » | Tiroir temporaire | Navigation latérale de 240 px |
| Marges du contenu | 16 px | 24 px | 32 px |
| KPI | Une colonne | Deux colonnes si lisibles | Jusqu’à quatre colonnes |
| Filtres | Panneau dépliable, résumé actif visible | Retour à la ligne | Ligne de filtres avec retour si nécessaire |
| Graphiques | Une colonne | Une colonne, deux pour petits graphiques si lisibles | Principal large, comparaisons en grille |

Contenu centré avec largeur maximale de 1600 px hors navigation. Espacer les sections
de 32 px, les blocs de 24 px et leur contenu interne de 16 à 24 px. Une barre haute
d’environ 64 px accueille le contexte général et la session ; sa hauteur peut grandir
avec le contenu. L’ordre commun est titre, contexte/fraîcheur, filtres, KPI, graphique
principal, détail tabulaire. Les filtres sélectionnés restent identifiables même repliés.

Un en-tête fixé ne doit pas masquer le focus ou les résultats au zoom. Sur petit
écran, limiter les zones fixes et laisser le document défiler naturellement.
Les onglets magasin peuvent défiler horizontalement dans leur propre zone ; les
tables disposent d’un conteneur de défilement et d’une fiche de ligne lisible.
Le défilement horizontal de la page entière est interdit.

## 4. Composants et interactions

| Élément | Règle commune |
| --- | --- |
| Navigation | Vue réseau, Magasins, Données, Qualité ; élément actif avec fond bleu pâle et texte explicite |
| Filtres | Libellés persistants, contrôles MUI ; sélectionner des mois, pas des jours arbitraires ; action Appliquer pour les changements coûteux |
| Sélection magasins | Recherche si prise en charge, cases à cocher et compteur ; « Tous » explicite, jamais implicite si sélection vide |
| Carte KPI | Titre, valeur, unité, période/comparaison et couverture ; pas de carte cliquable sans indication |
| Bouton | Une action principale par bloc ; actions secondaires outlined/text ; hauteur interactive minimale de 44 px |
| Surface | Paper/Card sans ombre, contour décoratif ; ombres réservées aux menus et dialogues superposés |
| Table | En-têtes explicites, unités, pagination, ordre stable ; libellés longs consultables en entier, aucune ellipse sans accès au texte complet |
| Détail | Panneau ou page nommée ; champs techniques et listes dépliables, y compris tous les éléments imbriqués |
| Badge | Texte et icône éventuelle, jamais seulement une pastille colorée |
| Aide | Tooltip pour complément court ; définition importante aussi accessible par bouton ou texte, pas uniquement au survol |

Appliquer valide ensemble les filtres en cours d’édition ; le contexte des résultats
reste celui des filtres appliqués. Pendant le chargement d’un nouveau périmètre,
ne jamais montrer des anciennes valeurs sous le nouveau titre comme si elles étaient
à jour. Les interactions locales sans lecture serveur peuvent être immédiates.

Formater en français : dates mensuelles lisibles, séparateurs numériques français,
valeurs exactes consultables si une carte est abrégée. Afficher « Indisponible » pour
une valeur manquante et `0` pour un zéro mesuré. Devise et HT/TTC restent indiqués
comme non confirmés selon le contrat métier. Un identifiant reste du texte exact.

## 5. Graphiques

MUI X Charts Community partage la police et les couleurs du thème. Hauteur cible
du tracé : 320 px, 240 px sur petit écran ; réserver en plus la place du titre,
des axes, de la légende et de la couverture. La largeur suit son conteneur.
Les dimensions restent adaptables aux libellés et au zoom.

Palette des séries (constantes distinctes des statuts) : `#1D4ED8`, `#0F766E`,
`#7E22CE`, `#B45309`, `#BE185D`, `#475569`. Affecter de façon stable couleur et
marqueur à un magasin pendant la session ; conserver cette association lors d’un
tri. Couleur, motif et nom se complètent. Ne pas prétendre différencier un réseau
entier avec six couleurs : suivre la limite de séries et la pagination du produit.

- Courbes mensuelles pour l’évolution, barres horizontales pour les contributions,
  petits graphiques alignés pour les comparaisons. Pas de 3D, radar ou double axe.
- Mois courant en trait continu, référence en pointillé avec légende ; trous pour
  les valeurs absentes, sans interpolation ni lissage inventant une trajectoire.
- Axe zéro pour les barres, origine commune pour les contributions divergentes.
  Même échelle pour les comparaisons absolues ; les valeurs négatives restent visibles.
- Couverture dans un panneau aligné distinct. Une série partielle porte une mention
  textuelle et un marqueur ; elle ne doit pas ressembler à une mesure complète.
- Infobulle : magasin/série, mois, valeur, unité et couverture. Légende et graduations
  espacées sur mobile sans supprimer de points ; table alternative toujours disponible.
- Une variation positive n’est pas automatiquement « bonne ». Réserver vert/rouge
  à une signification métier établie ; sinon employer texte signé et teinte neutre.

## 6. États communs

| État | Présentation et action |
| --- | --- |
| Chargement initial | Skeleton à la place du bloc, texte accessible « Chargement », aucun faux KPI |
| Changement de filtre | Indicateur de chargement dans le bloc ; annuler les réponses obsolètes |
| Aucune observation | Message contextualisé, période visible, action Modifier les filtres |
| Zéro mesuré | Valeur zéro affichée normalement, avec sa couverture |
| Ambiguïté / résultat partiel | Badge d’avertissement et explication près de la mesure, lien vers le détail |
| Données périmées | Bandeau avec date de dernière publication ; consultation possible sans faire croire à une nouvelle publication |
| Analyses non initialisées | Message d’indisponibilité, aucun graphique ou total fictif |
| Erreur d’un bloc | Alert locale, message compréhensible et Réessayer si pertinent ; les autres blocs restent utilisables |
| Accès refusé | Message explicite, aucune boucle de connexion automatique |
| Session expirée | Effacer les données, écran de reconnexion ; ne pas conserver le tableau en arrière-plan |

Les notifications temporaires complètent les états persistants sans les remplacer.
Les détails d’erreur n’affichent ni payload métier ni jeton ; seul l’identifiant de
requête peut aider le support, conformément au contrat d’intégration.

## 7. Accessibilité et réception visuelle

Objectifs de conception : contraste de texte d’au moins 4.5:1, de 3:1 pour les
éléments graphiques et contours indispensables. Les séparateurs décoratifs peuvent
être plus discrets. Vérifier chaque état rendu ; les valeurs du thème seules ne
constituent pas une certification d’accessibilité.

Focus visible : contour de 2 px bleu primaire avec décalage de 2 px ; sur fond foncé,
ajouter une séparation blanche pour conserver sa visibilité. Cibles interactives
de 44 × 44 px minimum, libellés accessibles et navigation clavier complète.
À la fermeture d’un tiroir ou dialogue, rendre le focus au déclencheur ; annoncer
les erreurs et changements de chargement sans multiplier les annonces de KPI.
Respecter la réduction de mouvement : supprimer animations de tracé, pulsations
et transitions décoratives lorsque la préférence est active.

Recette minimale : 360, 768 et 1440 px, zoom navigateur à 200 %, clavier seul,
libellés longs, valeurs négatives, listes vides, données partielles et erreurs.
Vérifier l’absence de débordement de page, la lisibilité des axes et l’accès au texte
complet des tableaux. Utiliser uniquement des exemples et captures synthétiques.
Les premiers écrans permettront de vérifier ces règles en conditions réelles ;
aucune recette d’interface n’a encore eu lieu.

## Références MUI

Traduire les valeurs en options du [thème MUI](https://mui.com/material-ui/customization/theming/),
avec les [couleurs](https://mui.com/material-ui/customization/palette/),
[espacements](https://mui.com/material-ui/customization/spacing/) et
[breakpoints](https://mui.com/material-ui/customization/breakpoints/) partagés.
Les valeurs et comportements ci-dessus sont des choix du projet, pas une copie
du thème du site de documentation MUI.
