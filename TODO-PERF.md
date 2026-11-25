# Améliorations des performances

Audit statique du 23 novembre 2026. Les impacts restent à mesurer sur l’application en fonctionnement.

## Priorités

- [x] **1. Réduire les rafraîchissements de l’explorateur.** Les rafraîchissements d’un onglet sont sérialisés et les notifications arrivant pendant un chargement sont regroupées. Les onglets masqués attendent leur activation ou leur réaffichage. Les appels Git simultanés partagent leur requête par dépôt, sans conserver de résultat périmé. La vue distante peut actualiser Git sans reconstruire l’arbre du PC. Sources : `renderer/explorer-tab.js`, `main/fs-git.js`. Vérification : `node --test scripts/test-explorer-perf.js` (8 tests).
- [x] **2. Limiter les résultats SQL avant leur chargement complet.** Les lectures non ambiguës utilisent un portail PostgreSQL limité à 1 001 lignes, dont 1 000 affichées. Les lots de lecture gardent leur transaction ; les écritures et lots mixtes restent exécutés intégralement, sans accumuler toutes les lignes côté Node. Le total est inconnu lorsque la lecture est interrompue. Source : `main/prisma.js`. Vérification : `scripts/test-prisma-perf.js`.
- [x] **3. Réguler le flux des terminaux.** Les sockets respectent `drain` et l'hôte suspend la production lorsque le transport ou les consommateurs sont saturés. Les crédits sont rendus après traitement par xterm, pour chaque fenêtre abonnée ; un détachement, rechargement ou crash libère ses crédits. Les rejeux et reconnexions conservent l'ordre des sorties et des redimensionnements, sans ajouter deux fois l'historique à l'écran. Sources : `main/ptyhost.js`, `main/ptyclient.js`, `main/socket-writer.js`, `main/terminal-flow.js`, `renderer/terminal-tab.js`, `main.js`. Vérification : `scripts/test-terminal-perf.js`, `scripts/test-pty.js`, `scripts/test-remote-terminal.js`.
- [x] **4. Étaler la restauration des onglets.** Les outils visibles sont montés en premier. Les autres sont montés un par un pendant les périodes disponibles, en donnant la priorité aux terminaux. Leurs identifiants de session et leurs spécifications sont conservés avant montage, y compris lors d'une sauvegarde, fermeture ou duplication précoce. Sources : `renderer/app.js`, `renderer/tab-models.js`. Vérification : `scripts/test-restore-perf.js`.
- [x] **5. Accélérer la lecture des dossiers.** Au maximum 16 appels `stat` sont exécutés simultanément ; les dossiers ordinaires n'en nécessitent aucun. Les tailles des fichiers, liens symboliques et jonctions restent disponibles ; les dates inutilisées ne sont plus récupérées. Source : `main/fs-git.js`. Vérification : `scripts/test-directory-perf.js`.
- [x] **6. Paginer l’historique vocal.** Lecture asynchrone depuis la fin du JSONL, avec budget de lecture et curseurs de pagination. Les interfaces locale et distante chargent les messages anciens sur demande et signalent les erreurs. Les identifiants des anciens messages restent stables ; les écritures et suppressions sont sérialisées sans effacer le reste de l'historique. Sources : `main/speech.js`, `main.js`, `preload.js`, `renderer/app.js`, `main/remote.js`, `renderer/remote/remote.js`. Vérification : `scripts/test-speech-perf.js` et suites vocales existantes.
- [x] **7. Éviter les instantanés complets répétés des terminaux distants.** Plus de sérialisation périodique ni d'instantané supplémentaire après chaque action terminal. La connexion et la resynchronisation explicite, ou après une rupture de séquence, demandent un état du PC ; les sorties suivantes sont incrémentales. L'abonnement moderne ne copie plus en plus le rejeu PTY. Les autres outils gardent leurs aperçus périodiques. Sources : `renderer/app.js`, `renderer/terminal-tab.js`, `main/remote.js`, `renderer/remote/remote.js`. Vérification : `scripts/test-restore-perf.js`, `scripts/test-terminal-perf.js`, `scripts/test-remote-terminal.js`.
- [x] **8. Rendre la sauvegarde de l’état asynchrone.** File par fichier, regroupement des sauvegardes adjacentes et remplacement atomique. Lectures, transferts et suppressions font barrière ; la dernière sauvegarde est attendue lors du rechargement et de la fermeture. Les autres usages de `writeJson` gardent leur ordre synchrone. Sources : `main/state-store.js`, `main.js`, `preload.js`, `renderer/app.js`. Vérification : `scripts/test-state-perf.js`, dont les fermetures et transferts dans Electron.

## Validation automatisée et mesures restantes

`npm run test:perf` couvre les huit optimisations ; les nouveaux tests unitaires et de restauration sont également inclus dans `npm test`.

Les comparaisons de profilage ci-dessous restent à effectuer avant et après, avec une session représentative comportant plusieurs espaces et environ 20 onglets. Elles ne sont pas remplacées par les tests fonctionnels :

- [ ] CPU au repos, avec des explorateurs visibles et masqués.
- [ ] Temps d’ouverture d’un gros dossier et nombre de commandes Git exécutées lors d’une rafale de changements.
- [ ] Mémoire et réactivité pendant une sortie de terminal intense ; absence de perte ou de doublons.
- [ ] Temps de restauration de session et délai avant utilisation du premier onglet.
- [ ] Mémoire consommée par une requête SQL renvoyant beaucoup de lignes.
- [ ] Réactivité avec un historique vocal volumineux et lors du partage distant.

## Limites de l’audit

L’audit initial portait sur les parcours principaux et ne constituait pas une revue exhaustive du dépôt. Les huit points sont implémentés et couverts par des tests ciblés. Les tests SQL exercent la vraie classe `pg.Query` avec un protocole simulé, sans serveur PostgreSQL réel. Les suppressions vocales parcourent encore le fichier complet, mais de façon asynchrone et sans le charger entièrement en mémoire. L'hôte PTY conserve son historique de reconnexion borné existant ; cela ne constitue pas un archivage illimité des sorties produites sans fenêtre. Le profilage comparatif d'une session complète reste à faire ; les premières mesures synthétiques du terminal sont détaillées ci-dessous.

## Longues conversations : mesures du 25 novembre 2026

`npm run test:perf:terminal -- --large` ouvre une fenêtre Electron temporaire et utilise le vrai xterm et le module d'onglet local, avec 100, 8 000 et 50 000 lignes. Trois sorties sont comparées : édition d'une ligne, redessin de l'écran et redessin de toute la conversation. `--gpu` active WebGL ; `--compare-history` compare aussi la conservation de l'historique avec le code de `HEAD` (tant que celui-ci contient l'ancienne implémentation).

La mesure clavier programme une frappe synthétique pendant le traitement de la sortie, puis mesure le délai jusqu'au gestionnaire d'entrée. Ce n'est pas une mesure matérielle clavier→PTY→CLI→écran. Le temps `parse` couvre toute la sortie ; `settled` ajoute deux trames d'animation et ne mesure pas le seul curseur. Les redessins de conversation ont cinq échantillons, les autres vingt : ces résultats sont indicatifs, sans seuil temporel bloquant sur une machine partagée.

| Scénario | Avant | Après |
| --- | --- | --- |
| Clavier pendant un redessin complet de 8 000 lignes, rendu DOM, P95 | 123,5 ms | 20,4 ms |
| Clavier pendant un redessin complet de 50 000 lignes, rendu DOM, P95 | 373,4 ms | 24,6 ms |
| Conservation de 2 000 sorties avec un historique déjà rempli de 400 Ko, comparaison dans le même processus | 232,2 ms | 3,7 ms |

Avec WebGL, après correction, le délai clavier P95 pendant les redessins complets est de 21,5 ms à 8 000 lignes et 21,2 ms à 50 000 lignes. L'édition d'une ligne ou le redessin du seul écran ne se dégrade pas fortement avec la longueur de l'historique dans ces scénarios.

Deux corrections : l'historique PTY conserve des morceaux et n'assemble son texte qu'au rattachement ; le rendu local et le rejeu découpent les grosses sorties en écritures de 16 Ko pour laisser xterm céder le thread entre les morceaux. Les crédits et la séquence ne sont validés qu'après le dernier morceau. Le débit total n'est pas nécessairement amélioré : le redessin DOM complet de 50 000 lignes a pris jusqu'à 875 ms après découpage, contre 373 ms avant, mais la saisie n'attend plus sa fin.

Les tests vérifient aussi le contenu exact de la queue d'historique, les redimensionnements, les instantanés et les séquences ANSI et caractères Unicode coupés entre deux morceaux. Ces mesures ne lancent pas Codex ou Claude, n'accèdent à aucune conversation existante et excluent les animations des robots et le partage distant. Elles reproduisent un blocage possible lors d'une grosse sortie unique ; elles ne prouvent pas que la session signalée produit ce même profil. Une vérification sur la conversation réelle et le profilage global restent nécessaires.
