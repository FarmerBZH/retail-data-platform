# Critères de réception du frontend

Statut : scénarios à implémenter avec le produit. Ce fichier n'est pas un rapport
de tests exécutés. Toutes les données et identités de test doivent être synthétiques,
y compris les maquettes, captures, réponses API et jeux de charge.

## Calculs métier

| Cas | Résultat attendu |
| --- | --- |
| Deux magasins entièrement couverts | Total exact, couverture 2/2, somme des contributions égale à la variation |
| Exemple A/B de `metrics.md` | 120 partiel avec B absent ; 120 complet sur l'univers observé avec B=0 ; comparaisons différentes |
| Un mois absent entre deux mois renseignés | Trou dans la courbe ; M-1 reste le mois calendaire absent |
| Référence zéro, nulle ou négative | Pas d'infini ; pourcentage masqué sur base zéro/nulle et traitement explicite de la base négative |
| Ambiguïté d'un produit | Mesure invalidée selon le contrat existant ; diagnostic partiel séparé |
| Plusieurs produits/catégories dans un magasin | Aucune multiplication du CA magasin lors des jointures |
| Réseau avec des couvertures différentes entre périodes | Cohorte constante explicitée, magasins exclus comptés, variation réseau complète indisponible |
| Cohorte vide ou sélection vide | Indisponible/état vide ; jamais un zéro ou une requête sur tous les magasins |
| Décimaux 0.1 et 0.2 | Somme affichée 0,3, aucune dérive binaire dans les calculs métier |
| Ratio 0.12, null, part de linéaire supérieure à 1 | 12 %, indisponible, valeur supérieure à 100 % conservée et signalée |
| Retours et unités nulles | Négatifs conservés ; aucune division par zéro ni assimilation d'un null à zéro |
| Produits non rapprochés | Clés sources distinctes conservées ; pas de regroupement sous un unique produit nul |
| Catégorie inconnue ou période hors disponibilité | Absence explicite, aucun mapping ou zéro inventé |

## Parcours fonctionnels

1. Après connexion autorisée, ouvrir le réseau et lire période, couverture et fraîcheur.
2. Changer de période, sélectionner plusieurs magasins et retrouver exactement ce
   périmètre dans la comparaison, la fiche et au retour.
3. Basculer entre total sélectionné et comparaison sans modifier les filtres.
4. Ouvrir chaque onglet de la fiche ; vérifier son grain, son état vide et son accès
   aux seuls champs autorisés, y compris les observations justificatives à la demande.
5. Modifier la sélection pendant une lecture lente : aucun ancien résultat ne remplace
   la nouvelle sélection, aucune page incomplète n'est présentée comme total définitif.
6. Sélectionner plus de six magasins : les graphiques sont paginés, le total et le
   tableau conservent toute la sélection.
7. Utiliser clavier seul puis petit écran ; consulter le tableau alternatif d'un
   graphique et distinguer les séries sans dépendre de la couleur.
8. Vérifier les dispositions à 360, 768 et 1440 pixels et le zoom à 200 % : aucune
   action inaccessible, aucun débordement horizontal de page, graphiques lisibles
   et tables défilant dans leur propre conteneur. Tous les champs restent consultables.

## API et cohérence

- [Matrice de couverture](data-coverage.md) : vérifier chaque couple ressource/champ
  contre le registre API, et chaque chemin enfant contre les modèles imbriqués.
  Aucun champ publié oublié ; aucun champ non publié ajouté par déduction.
- Pour chaque ligne de la matrice, associer un composant visible ou dépliable à un
  scénario synthétique affichant la valeur exacte. Vérifier également null, listes
  vides et éléments multiples lorsque ces états sont admis.
- L'explorateur Données permet d'atteindre produits sans ventes, assortiments sans
  candidats, règles sans utilisation et observations sans magasin résolu, y compris
  en seconde page. Les détails ne perdent aucun champ au profit d'un résumé.
- Les champs OPS sont consultables avec `operations:read`, inaccessibles et non
  demandés sans ce droit ; les autres collections restent consultables.

- Au moins deux pages de résultats et changement de `limit` : lignes exactes, pas
  de doublon introduit, filtres conservés jusqu'au dernier curseur.
- Filtre inconnu, ID inexistant, curseur invalide, 413 persistant à une ligne,
  429, 503 et interruption réseau : état explicite, nombre de reprises borné.
- Fraîcheur `current`, `stale`, `uninitialized`, puis échec d'un refresh conservant
  l'ancienne publication : message conforme, aucun rafraîchissement déclenché par le web.
- Changement de publication pendant plusieurs lectures : aucune prétention de
  snapshot cohérent ; invalider/recharger selon le contrat serveur retenu.
- Classement réseau : tri de l'ensemble filtré, et non des seules lignes d'une page.
- Endpoint agrégé futur : tests PostgreSQL vérifiant totaux, couverture, cohortes,
  bornes et cohérence transactionnelle avec les règles de `metrics.md`.

## Session et confidentialité

- Retour OIDC valide, `state` erroné/rejoué, émetteur erroné, échange refusé,
  ID token utilisé à tort, refresh token inattendu : les échecs ferment la session.
- Jeton expiré, mauvaise audience, mauvais client, scope manquant : aucune donnée
  affichée après refus ; 403 ne déclenche pas une boucle de connexion.
- Rechargement, déconnexion et changement d'utilisateur : cache métier effacé ;
  aucun jeton dans URL, stockage persistant, logs, captures ou traces de test.
- L'expiration pendant une requête interdit l'affichage tardif de son résultat.
- Origine non autorisée et callback non enregistré : refus dans l'environnement cible.
- Libellé contenant du HTML ou une instruction : texte inerte, aucune exécution.
- Un lecteur ordinaire utilise le produit sans `operations:read` ; aucun appel
  automatique aux collections d'audit protégées.
- Smoke test avec fournisseur OIDC réel et utilisateur synthétique avant recette
  de la connexion ; les mocks seuls ne valident pas les claims et la configuration.

## Vérification de livraison

La recette visuelle applique [DESIGN.md](../../DESIGN.md) : thème partagé, contraste
des états rendus, focus, réduction du mouvement, libellés longs et données partielles.

La recette exige les parcours navigateur, l'accessibilité des graphiques, les tests
des calculs et les contrats de transport/session. Mesurer temps de chargement,
nombre de requêtes, taille des réponses et mémoire sur un volume synthétique annoncé.
Fixer avec le responsable produit les budgets acceptables avant de qualifier la
vue réseau pour la production ; aucun objectif de latence n'a encore été mesuré.

Toute évolution Python conserve les contrôles de formatage, lint, typage et tests
du projet. Une évolution de persistence exige des tests PostgreSQL ; une évolution
de schéma exige migration réversible et modèle aligné. Ne déclarer une frontière
dans `docs/architecture.md` qu'après son implémentation et sa vérification.
