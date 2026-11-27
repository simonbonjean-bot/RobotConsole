# Améliorations des performances

Audit statique du 23 novembre 2026, complété par un profilage comparatif sur une session temporaire le 27 novembre 2026. La mesure SQL sur serveur réel reste à effectuer.

## Priorités

- [x] **1. Réduire les rafraîchissements de l’explorateur.** Les rafraîchissements d’un onglet sont sérialisés et les notifications arrivant pendant un chargement sont regroupées. Les onglets masqués attendent leur activation ou leur réaffichage. Les appels Git simultanés partagent leur requête par dépôt, sans conserver de résultat périmé. La vue distante peut actualiser Git sans reconstruire l’arbre du PC. Sources : `renderer/explorer-tab.js`, `main/fs-git.js`. Vérification : `node --test scripts/test-explorer-perf.js` (8 tests).
- [x] **2. Limiter les résultats SQL avant leur chargement complet.** Les lectures non ambiguës utilisent un portail PostgreSQL limité à 1 001 lignes, dont 1 000 affichées. Les lots de lecture gardent leur transaction ; les écritures et lots mixtes restent exécutés intégralement, sans accumuler toutes les lignes côté Node. Le total est inconnu lorsque la lecture est interrompue. Source : `main/prisma.js`. Vérification : `scripts/test-prisma-perf.js`.
- [x] **3. Réguler le flux des terminaux.** Les sockets respectent `drain` et l'hôte suspend la production lorsque le transport ou les consommateurs sont saturés. Les crédits sont rendus après traitement par xterm, pour chaque fenêtre abonnée ; un détachement, rechargement ou crash libère ses crédits. Les rejeux et reconnexions conservent l'ordre des sorties et des redimensionnements, sans ajouter deux fois l'historique à l'écran. Sources : `main/ptyhost.js`, `main/ptyclient.js`, `main/socket-writer.js`, `main/terminal-flow.js`, `renderer/terminal-tab.js`, `main.js`. Vérification : `scripts/test-terminal-perf.js`, `scripts/test-pty.js`, `scripts/test-remote-terminal.js`.
- [x] **4. Étaler la restauration des onglets.** Les outils visibles sont montés en premier. Les autres sont montés un par un pendant les périodes disponibles, en donnant la priorité aux terminaux. Leurs identifiants de session et leurs spécifications sont conservés avant montage, y compris lors d'une sauvegarde, fermeture ou duplication précoce. Sources : `renderer/app.js`, `renderer/tab-models.js`. Vérification : `scripts/test-restore-perf.js`.
- [x] **5. Accélérer la lecture des dossiers.** Au maximum 16 appels `stat` sont exécutés simultanément ; les dossiers ordinaires n'en nécessitent aucun. Les tailles des fichiers, liens symboliques et jonctions restent disponibles ; les dates inutilisées ne sont plus récupérées. Source : `main/fs-git.js`. Vérification : `scripts/test-directory-perf.js`.
- [x] **6. Paginer l’historique vocal.** Lecture asynchrone depuis la fin du JSONL, avec budget de lecture et curseurs de pagination. Les interfaces locale et distante chargent les messages anciens sur demande et signalent les erreurs. Les identifiants des anciens messages restent stables ; les écritures et suppressions sont sérialisées sans effacer le reste de l'historique. Sources : `main/speech.js`, `main.js`, `preload.js`, `renderer/app.js`, `main/remote.js`, `renderer/remote/remote.js`. Vérification : `scripts/test-speech-perf.js` et suites vocales existantes.
- [x] **7. Éviter les instantanés complets répétés des terminaux distants.** Plus de sérialisation périodique ni d'instantané supplémentaire après chaque action terminal. La connexion et la resynchronisation explicite, ou après une rupture de séquence, demandent un état du PC ; les sorties suivantes sont incrémentales. L'abonnement moderne ne copie plus en plus le rejeu PTY. Les autres outils gardent leurs aperçus périodiques. Sources : `renderer/app.js`, `renderer/terminal-tab.js`, `main/remote.js`, `renderer/remote/remote.js`. Vérification : `scripts/test-restore-perf.js`, `scripts/test-terminal-perf.js`, `scripts/test-remote-terminal.js`.
- [x] **8. Rendre la sauvegarde de l’état asynchrone.** File par fichier, regroupement des sauvegardes adjacentes et remplacement atomique. Lectures, transferts et suppressions font barrière ; la dernière sauvegarde est attendue lors du rechargement et de la fermeture. Les autres usages de `writeJson` gardent leur ordre synchrone. Sources : `main/state-store.js`, `main.js`, `preload.js`, `renderer/app.js`. Vérification : `scripts/test-state-perf.js`, dont les fermetures et transferts dans Electron.
- [ ] **9. Diagnostiquer et réduire la latence de frappe dans les longues sessions Claude Code, Codex et Copilot.** Le problème est signalé dans RobotConsole et dans le terminal Windows, même après la fin d'une réponse. La frappe redevient immédiatement fluide en quittant le CLI sans fermer l'onglet. Ce parcours réel n'est pas couvert par les seules mesures de sortie synthétique. Constats, pistes et critères de validation ci-dessous.

## Validation automatisée et mesures restantes

`npm run test:perf` couvre les huit optimisations ; les nouveaux tests unitaires et de restauration sont également inclus dans `npm test`.

Les comparaisons ci-dessous ont été effectuées avant et après sur une session temporaire de 4 espaces et 20 onglets. Le profilage et ses limites sont détaillés dans la section suivante ; les tests fonctionnels seuls ne suffisent pas à cocher ces cases :

- [x] CPU au repos, avec des explorateurs visibles et masqués.
- [x] Temps d’ouverture d’un gros dossier et nombre de commandes Git exécutées lors d’une rafale de changements.
- [x] Mémoire et réactivité pendant une sortie de terminal intense ; absence de perte ou de doublons. Sortie synthétique dans la vraie application, sans profilage du processus hôte PTY.
- [x] Temps de restauration de session et délai avant utilisation du premier onglet.
- [ ] Mémoire consommée par une requête SQL renvoyant beaucoup de lignes. Aucun serveur PostgreSQL réel autorisé pour cette campagne ; le protocole simulé des tests ne remplace pas cette mesure.
- [x] Réactivité avec un historique vocal volumineux et lors du partage distant. Interface mobile réelle en boucle locale, sans mesure d'un réseau externe.

## Profilage comparatif : mesures du 27 novembre 2026

Commande reproductible : `npm run profile:perf -- --samples=3 --output=docs\performance-profile.json`. `--before=0ceeedc^` sélectionne par défaut le commit `5b0856c`, antérieur aux huit optimisations. L'état courant est également copié avant les mesures : les six exécutions utilisent des instantanés figés, même si le workspace est modifié en parallèle. Le rapport conserve les références Git et l'empreinte SHA-256 de cet instantané. Résultats bruts : [docs/performance-profile.json](docs/performance-profile.json).

La campagne utilise Windows 11 x64 et Electron 45.4.1, avec les mêmes dépendances pour les deux versions. Chaque application ouvre 4 espaces, 12 terminaux et 8 explorateurs ; quatre explorateurs sont ensuite affichés et quatre restent masqués. Un dépôt Git temporaire contient 2 500 fichiers et 500 dossiers. Une rafale produit 40 modifications espacées de 10 ms. L'historique contient 100 000 messages répartis entre les quatre robots, soit environ 37 Mio, auxquels s'ajoutent les quelques messages automatiques de l'application. Aucun workspace, historique ou CLI personnel n'est utilisé. Les profils, dépôts et processus temporaires sont nettoyés après chaque campagne.

Les sorties terminal sont injectées à l'entrée du client PTY, puis passent par le vrai processus principal, l'IPC et xterm. Les 8 000 lignes numérotées sont vérifiées dans leur ordre exact, sans perte ni doublon. Le partage utilise le vrai serveur HTTP/WebSocket et la vraie interface mobile, sur `127.0.0.1` avec un port éphémère ; le suffixe conservé du terminal et une sortie incrémentale unique sont également vérifiés. Les shells sont simulés ; le débit et la mémoire du processus hôte PTY ne sont donc pas profilés.

Les valeurs ci-dessous sont les médianes de trois exécutions par version, avec ordre avant/après alterné. Le CPU est mesuré pendant cinq secondes après stabilisation des chargements initiaux, sans compter les lectures encore en cours des explorateurs masqués comme du repos. Il représente la somme des processus Electron en pourcentage d'un cœur logique, et peut dépasser 100 %. La mémoire est la somme des ensembles de travail Electron, échantillonnée toutes les 50 ms : certaines pages partagées peuvent être comptées plusieurs fois et les pics très courts peuvent être manqués. La réactivité est le retard maximal d'un minuteur renderer de 10 ms, pas une latence matérielle clavier-vers-écran. Le rendu est DOM, les animations de robots restent actives et les voix sont désactivées.

| Mesure | Avant | Après |
| --- | --- | --- |
| CPU au repos, huit explorateurs masqués | 94,59 % d'un cœur | 98,34 % d'un cœur |
| CPU au repos, quatre explorateurs visibles et quatre masqués | 121,50 % d'un cœur | 127,12 % d'un cœur |
| Lecture du gros dossier via IPC, hors reconstruction DOM | 665,94 ms | 297,81 ms |
| Premier affichage des quatre explorateurs | 1 368,85 ms | 4 846,87 ms |
| Commandes `git status` pendant la rafale | 8 | 1 |
| Explorateurs masqués recalculés pendant la rafale | 4 | 0 |
| Premier terminal restauré utilisable, depuis le début du script Electron | 3 832,91 ms | 9 108,24 ms |
| Première frappe synthétique confirmée par le client PTY simulé | 3 954,36 ms | 9 110,88 ms |
| Traitement des 8 000 lignes terminal | 3 229,21 ms | 848,46 ms |
| Retard maximal du minuteur pendant la sortie terminal | 2 799,50 ms | 322,90 ms |
| Pic mémoire Electron échantillonné pendant la sortie terminal | 1 332,50 Mio | 1 086,11 Mio |
| Cinq lectures de l'historique via IPC | 3 930,54 ms | 186,53 ms |
| Pic de tas JavaScript du processus principal pendant ces lectures | 410,40 Mio | 12,68 Mio |
| Messages retournés par une lecture initiale | environ 25 000 | 100 |
| Chargement mobile de l'historique et du terminal, puis sortie incrémentale | 2 620,23 ms | 1 718,86 ms |
| Retard maximal du minuteur mobile pendant ce chargement | 697,60 ms | 436,00 ms |
| Pic mémoire Electron échantillonné pendant ce chargement mobile | 2 123,53 Mio | 1 304,80 Mio |

**Résultats mitigés, pas une validation de gain sur tous les parcours.** Le regroupement Git, la lecture des dossiers, l'historique paginé et le traitement de la sortie terminal montrent des gains sur cette charge. Le CPU réellement au repos ne baisse pas dans cette campagne. Le premier affichage des explorateurs est plus lent : l'ancienne version avait déjà chargé leurs arbres pendant qu'ils étaient masqués, alors que la nouvelle attend leur affichage. La restauration n'est pas améliorée dans ces résultats ; les plages se chevauchent fortement (avant : 2 248,91–5 889,70 ms ; après : 2 574,59–14 011,17 ms). La machine est partagée et la version courante inclut aussi les autres changements du workspace : ces mesures ne permettent pas d'attribuer ce ralentissement aux seules optimisations de restauration. Un profilage dédié de ce démarrage reste nécessaire avant une correction ciblée.

Les assertions du profilage ont réussi sur les six exécutions. Les tests de performance unitaires, de restauration, du vrai PTY et du miroir mobile ont également été exécutés. Le fixture de `scripts/test-restore-perf.js` fournit maintenant le bouton de prompt attendu par l'interface courante.

## Limites de l’audit

L’audit initial portait sur les parcours principaux et ne constituait pas une revue exhaustive du dépôt. Les huit points sont implémentés et couverts par des tests ciblés. Les tests SQL exercent la vraie classe `pg.Query` avec un protocole simulé, sans serveur PostgreSQL réel. Les suppressions vocales parcourent encore le fichier complet, mais de façon asynchrone et sans le charger entièrement en mémoire. L'hôte PTY conserve son historique de reconnexion borné existant ; cela ne constitue pas un archivage illimité des sorties produites sans fenêtre. Le profilage comparatif d'une session temporaire est documenté ci-dessus ; une session réelle avec ses CLI, son serveur SQL et son réseau distant n'a pas été profilée.

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

Les tests vérifient aussi le contenu exact de la queue d'historique, les redimensionnements, les instantanés et les séquences ANSI et caractères Unicode coupés entre deux morceaux. Ces mesures ne lancent pas Codex ou Claude, n'accèdent à aucune conversation existante et excluent les animations des robots et le partage distant. Elles reproduisent un blocage possible lors d'une grosse sortie unique ; elles ne prouvent pas que la session signalée produit ce même profil. Le profilage global temporaire du 27 novembre complète ces mesures, sans remplacer une vérification sur la conversation réelle.

## Latence de frappe dans les CLI : investigation ouverte du 27 novembre 2026

**Symptômes rapportés.** Les trois CLI (Claude Code, Codex et Copilot) deviennent très lents pendant de longues conversations ; les touches apparaissent avec retard, même au repos après une réponse. Le problème existe aussi dans le terminal Windows. Quitter normalement le CLI dans le même onglet rend immédiatement la frappe fluide. Cela oriente l'investigation vers le fonctionnement du CLI ou son interaction avec le terminal pendant la session, sans prouver un défaut précis ni exclure le trajet PTY/ConPTY.

Une nouvelle exécution de `npm run test:perf:terminal -- --gpu`, avec 20 000 lignes synthétiques, donne environ 2 ms de délai clavier P95 pendant l'édition d'une ligne, contre environ 200 ms pour traiter un redessin complet et attendre deux trames. Ce test ne lance pas les CLI et ne mesure pas le délai de leur réponse à la frappe : il ne reproduit donc pas le problème réel. Le relevé ponctuel de ressources ne montre pas de saturation mémoire (environ 15 Gio disponibles sur 32 Gio). Des processus Node/Electron/Copilot sont actifs, mais la machine partagée ne permet pas d'attribuer leur charge à la session lente.

### Pistes de diagnostic et de solution

- [ ] **Mesurer le parcours réel clavier → PTY → CLI → écran.** Comparer une conversation courte et une longue, au repos et pendant une réponse, puis le shell après sortie du CLI. Relever les versions, la taille du terminal, la latence P50/P95, le CPU par processus, la mémoire et le volume de sortie par frappe. Utiliser une conversation temporaire reproductible ; aucun contenu personnel ne doit être enregistré sans autorisation.
- [ ] **Identifier un recalcul ou redessin coûteux côté CLI.** Vérifier si chaque touche déclenche la mise en page de toute la conversation, un gros flux ANSI ou un blocage de sa boucle d'événements. Si confirmé, rechercher une correction dans le CLI concerné : rendu limité à la zone visible, cache de mise en page, mises à jour incrémentales ou réduction des rafraîchissements au repos. RobotConsole ne peut pas corriger directement le moteur d'un CLI externe.
- [ ] **Comparer les versions et options des CLI.** Sur des sessions temporaires, vérifier si une mise à jour corrige le problème et comparer les options de rendu disponibles et documentées. Ne pas changer les installations ou réglages existants sans accord, ni supposer qu'une même option existe dans les trois outils.
- [ ] **Isoler le terminal et le transport Windows.** À charge comparable, comparer RobotConsole et Windows Terminal, rendu WebGL et DOM, ainsi que le coût du passage ConPTY/PTY. Vérifier les files de sortie, les crédits et les délais d'entrée avant de modifier le découpage ou la régulation. Ne pas supprimer arbitrairement des sorties ANSI : cela peut corrompre l'écran ou perdre des messages.
- [ ] **Évaluer la réduction du contexte actif.** Comparer une longue session avec une nouvelle session contenant un résumé, ou une fonction de compactage documentée du CLI. Distinguer le contexte envoyé au modèle de l'historique rendu à l'écran : réduire l'un ne garantit pas d'accélérer l'autre. Préserver la conversation originale et ne pas compacter automatiquement.
- [ ] **Valider le contournement par l'éditeur de prompt de RobotConsole.** L'action « Rédiger un prompt… » permet déjà de saisir hors du CLI puis d'envoyer avec Ctrl+Entrée. Vérifier sa réactivité pendant une session réellement lente et la bonne réception du texte. Ce contournement évite le traitement de chaque touche par le CLI, mais ne corrige pas sa lenteur après l'envoi.

**Critère de clôture.** Reproduire le ralentissement dans au moins un CLI réel, localiser le coût dominant, puis démontrer une réduction de la latence de frappe sur le même scénario court/long, sans perte de sortie ni altération de la conversation. Une mesure synthétique rapide ou le seul contournement par l'éditeur ne suffit pas à cocher la priorité 9.
