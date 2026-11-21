// RobotConsole — interface : workspace, espaces (disposition en arbre), onglets, robots
(() => {
  const api = window.api;
  const { h, esc } = UI;
  const $ = (sel, root = document) => root.querySelector(sel);

  const spacesEl = $('#spaces');
  const crewEl = $('#crew');

  let ctx = { ws: null, recent: [] }; // contexte de la fenêtre (workspace)
  let shells = [];
  const spaces = [];
  let activeSpace = null;
  // Écrans (bureaux virtuels) : chacun a sa propre disposition d'espaces
  let screenSeq = 1;
  let screens = [{ id: 'sc1', name: 'Écran 1', tree: null, maximizedId: null }];
  let activeScreenId = 'sc1';
  let maximized = null;
  let uid = 0;
  let restoring = false;
  const nid = (p) => `${p}${++uid}-${Date.now().toString(36)}`;
  const kindOf = (tab) => TabKinds[tab.kind];
  const byId = (id) => spaces.find((s) => s.id === id);

  const PHRASES = [
    'Bip boup !', 'Prêt à exécuter !', 'Je surveille vos consoles.', 'Système nominal.',
    'Encore une commande ?', 'J\'adore le texte qui défile.', 'Tous mes circuits sont à vous.',
    'Batterie à 100 %.', 'Rien à signaler, capitaine.', 'Bzzzt… oups, ça chatouille.',
  ];

  const KIND_INFO = {
    browser: { icon: '🌐', label: 'Navigateur' },
    terminal: { icon: '<span class="kind-term">&gt;_</span>', label: 'Terminal' },
    explorer: { icon: '📁', label: 'Explorateur de fichiers' },
    editor: { icon: '✎', label: 'Éditeur' },
    tests: { icon: '🧪', label: 'Tests' },
    docker: { icon: '🐳', label: 'Docker' },
    services: { icon: '🛰', label: 'Services' },
    prisma: { icon: '◆', label: 'Prisma / BDD' },
    graphify: { icon: '🕸', label: 'Graphify' },
  };

  // ---------- Sauvegarde ----------
  let saveTimer = null;
  function save() {
    if (restoring) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, 300);
  }
  function saveNow() {
    if (restoring) return;
    syncScreen();
    const idx = (id) => spaces.findIndex((s) => s.id === id);
    api.saveState({
      version: 3,
      active: spaces.indexOf(activeSpace),
      activeScreen: screens.findIndex((sc) => sc.id === activeScreenId),
      screens: screens.map((sc) => ({ name: sc.name, color: sc.color || undefined, folded: sc.folded || undefined, layout: Layout.serialize(sc.tree, idx), maximized: sc.maximizedId ? idx(sc.maximizedId) : null })),
      spaces: spaces.map((sp) => ({ ...serializeSpace(sp), screen: Math.max(0, screens.findIndex((sc) => sc.id === sp.screenId)) })),
    });
  }
  function serializeSpace(sp) {
    return {
      name: sp.customName ? sp.name : null,
      seed: sp.seed,
      traits: sp.traits || undefined,
      icon: sp.icon || undefined,
      sound: sp.sound || undefined,
      remote: sp.remote && sp.remote !== 'off' ? sp.remote : undefined,
      rid: sp.rid,
      parked: sp.parked || undefined,
      activeTab: sp.tabs.indexOf(sp.activeTab),
      tabs: sp.tabs.map((t) => ({ kind: t.kind, title: t.customTitle ? t.title : null, model: t.model || undefined, icon: t.icon || undefined, ...kindOf(t).serialize(t) })),
    };
  }
  // Paquet d'espaces transférés vers une autre fenêtre
  function payloadFor(list) {
    return { version: 2, active: 0, maximized: null, layout: null, spaces: list.map((sp) => ({ ...serializeSpace(sp), parked: false })) };
  }
  window.addEventListener('beforeunload', saveNow);

  // ---------- Robots ----------
  function applyBot(space) {
    const b = space.bot;
    const accent = Themes.spaceAccent(b);
    for (const el of [space.el, space.crewEl]) {
      el.style.setProperty('--space-accent', accent);
      el.style.setProperty('--space-glow', b.glow);
    }
    space.robotEl.innerHTML = b.svg;
    space.robotEl.classList.toggle('has-tool', b.tool !== 'none');
    space.robotEl.style.setProperty('--blink-delay', `-${b.blinkDelay}s`);
    space.crewFace.innerHTML = '';
    space.crewFace.classList.toggle('has-tool', b.tool !== 'none');
    const mini = h('div', 'robot', b.svg);
    mini.style.setProperty('--blink-delay', `-${b.blinkDelay}s`);
    space.crewFace.appendChild(mini);
    space.crewRobot = mini;
    space.emptyRobot.innerHTML = Robot.generate(space.seed, { legs: true, traits: space.traits, context: { tabKind: space.activeTab?.kind } }).svg;
    space.emptyRobot.classList.toggle('has-tool', b.tool !== 'none');
    if (!space.customName) space.name = b.name;
    space.nameEl.textContent = space.name;
    // Un onglet pas encore monté (openTab active l'onglet avant mount) n'a pas encore son état interne
    for (const t of space.tabs) if (t.mounted) kindOf(t).applyTheme?.(t);
  }

  // Robot d'un espace : graine + réglages de l'atelier (+ outil « auto » selon l'onglet actif)
  function botFor(space) {
    return Robot.generate(space.seed, { traits: space.traits, context: { tabKind: space.activeTab?.kind } });
  }

  function spaceStudio(space) {
    RobotStudio.open({
      seed: space.seed, traits: space.traits, title: space.name, contextKind: space.activeTab?.kind,
      onApply: (seed, traits) => {
        space.seed = seed;
        space.traits = traits;
        space.bot = botFor(space);
        applyBot(space);
        renderCrew();
        wave(space);
        say(space, `Je suis ${space.bot.name}, flambant neuf !`);
        save();
      },
    });
  }

  function workspaceStudio() {
    RobotStudio.open({
      seed: ctx.ws.seed, traits: ctx.ws.robot?.traits, legs: true, title: ctx.ws.name, contextKind: activeSpace?.activeTab?.kind,
      onApply: async (seed, traits) => {
        ctx.ws = await api.updateWorkspace({ seed, robot: traits ? { traits } : null });
        renderWorkspace();
        wsWalk();
      },
    });
  }

  function say(space, text, ms = 2600) {
    if (!Settings.data.robotBubbles || !space?.el.isConnected || !space.el.offsetParent) return;
    if (space.bubble) space.bubble.remove();
    const anchor = space.robotEl.getBoundingClientRect();
    const b = h('div', 'bubble');
    b.textContent = text;
    b.style.left = `${Math.max(4, anchor.left + 2)}px`;
    b.style.top = `${anchor.bottom + 6}px`;
    document.body.appendChild(b);
    space.bubble = b;
    setTimeout(() => b.classList.add('fade'), ms);
    setTimeout(() => { b.remove(); if (space.bubble === b) space.bubble = null; }, ms + 350);
  }

  function talk(space) {
    space.robotEl.classList.add('talking');
    space.crewRobot?.classList.add('talking');
    space.crewFace.classList.add('busy');
    space.crewMini?.classList.add('busy');
    clearTimeout(space.talkTimer);
    space.talkTimer = setTimeout(() => {
      space.robotEl.classList.remove('talking');
      space.crewRobot?.classList.remove('talking');
      space.crewFace.classList.remove('busy');
      space.crewMini?.classList.remove('busy');
    }, 380);
    wsWalk();
    trackActivity(space);
  }

  // ---------- Son de fin d'activité ----------
  // Le robot est « actif » tant que ses onglets produisent de la sortie. Après quelques secondes de silence,
  // il joue son son. L'écho de la frappe et les sorties trop brèves (invite, complétion) sont ignorés.
  const MIN_ACTIVITY_MS = 1000;
  function trackActivity(space) {
    if (!space.sound) return;
    const now = Date.now();
    if (!space.activeSince) {
      if (now - (space.lastInput || 0) < 300) return; // simple écho de ce qu'on tape
      space.activeSince = now;
    }
    space.lastOutput = now;
    clearTimeout(space.quietTimer);
    space.quietTimer = setTimeout(() => activityEnded(space), (space.sound.delay || 5) * 1000);
  }
  function activityEnded(space) {
    const since = space.activeSince;
    space.activeSince = null;
    if (!space.sound || !since || !spaces.includes(space)) return;
    if (space.lastOutput - since < MIN_ACTIVITY_MS) return;
    playSound(space.sound.id);
    wave(space);
    if (!space.parked && space.screenId === activeScreenId) say(space, 'J\'ai fini !', 2200);
  }
  const playSound = (id) => RobotSounds.play(id, (Settings.data.robotVolume ?? 70) / 100);
  function updateSoundBadge(space) {
    space.soundEl.classList.toggle('hidden', !space.sound);
    if (space.sound) space.soundEl.title = `Son quand le robot a fini : ${RobotSounds.label(space.sound.id)} (après ${space.sound.delay} s de silence)`;
  }
  // ---------- Accès à distance : robots « ouverts » au téléphone / à la tablette ----------
  let remoteOn = false;
  function updateRemoteBadge(space) {
    const open = space.remote !== 'off';
    space.remoteEl.classList.toggle('hidden', !open);
    space.remoteEl.classList.toggle('off', open && !remoteOn);
    if (open) space.remoteEl.title = (space.remote === 'control' ? 'Ouvert à distance : contrôle' : 'Ouvert à distance : lecture seule') + (remoteOn ? '' : ' (serveur désactivé dans les réglages)');
  }
  function setRemote(space, mode) { space.remote = mode; updateRemoteBadge(space); save(); publishRemote(true); }
  let lastPublished = '';
  function publishRemote(force) {
    const robots = spaces.filter((sp) => sp.remote !== 'off').map((sp) => ({
      key: sp.rid, name: sp.name, svg: sp.bot.svg, mode: sp.remote, color: sp.bot.color || undefined,
      tabs: sp.tabs.map((t) => ({ id: t.id, kind: t.kind, title: t.title, icon: (KIND_INFO[t.kind]?.icon || '').replace(/<[^>]*>/g, ''), sessionId: t.kind === 'terminal' ? t.ptyId || undefined : undefined, exited: t.exited || undefined, active: t === sp.activeTab || undefined })),
    }));
    const json = JSON.stringify(robots);
    if (!force && json === lastPublished) return;
    lastPublished = json;
    api.remotePublish(robots);
  }
  setInterval(publishRemote, 2000);
  async function refreshRemoteState() {
    try { const i = await api.remoteInfo(); remoteOn = !!i.running || !!i.relay?.connected; } catch { remoteOn = false; }
    spaces.forEach(updateRemoteBadge);
  }
  api.onRemoteChanged(refreshRemoteState);
  refreshRemoteState();
  const findTab = (id) => { for (const sp of spaces) for (const t of sp.tabs) if (t.id === id) return t; return null; };
  const remoteTimers = new Map(); // tabId -> minuteur d'aperçu
  async function sendSnapshot(tabId) {
    const tab = findTab(tabId);
    if (!tab || tab.space.remote === 'off') return;
    let snap = null;
    try { snap = kindOf(tab).remoteSnapshot ? await kindOf(tab).remoteSnapshot(tab) : null; } catch (e) { snap = { error: String(e.message || e) }; }
    api.remoteSnapshot(tabId, trSnap(snap || { unavailable: true }));
  }
  // Langue de l'interface : traduit les libellés de l'application (jamais les contenus : noms, fichiers, sorties)
  const tr = (s) => (typeof s === 'string' && s && window.I18n?.lang !== 'fr' ? I18n.translate(s) : s);
  function trSnap(snap) {
    if (!snap || window.I18n?.lang === 'fr') return snap;
    const acts = (l) => l?.forEach((a) => { a.label = tr(a.label); a.prompt = tr(a.prompt); });
    snap.summary = tr(snap.summary); snap.textTitle = tr(snap.textTitle); snap.error = tr(snap.error);
    acts(snap.actions); acts(snap.tabs);
    for (const sec of snap.sections || []) {
      sec.title = tr(sec.title); acts(sec.actions);
      for (const it of sec.items || []) { it.badge = tr(it.badge); it.logLabel = tr(it.logLabel); acts(it.actions); }
    }
    return snap;
  }
  api.onRemoteWatch((tabId, on) => {
    clearInterval(remoteTimers.get(tabId));
    remoteTimers.delete(tabId);
    if (!on) return;
    sendSnapshot(tabId);
    remoteTimers.set(tabId, setInterval(() => sendSnapshot(tabId), 2000));
  });
  api.onRemoteAction(async (reqId, tabId, action, args) => {
    const tab = findTab(tabId);
    let result;
    const readOk = tab && tab.space.remote === 'read' && (kindOf(tab).remoteReadActions || []).includes(action);
    if (!tab || (tab.space.remote !== 'control' && !readOk)) result = { error: 'Robot en lecture seule' };
    else if (action === 'activate') { activateTab(tab, true); result = {}; }
    else if (!kindOf(tab).remoteAction) result = { error: 'Action non disponible' };
    else {
      try { result = (await kindOf(tab).remoteAction(tab, action, args || {})) || {}; } catch (e) { result = { error: String(e.message || e) }; }
    }
    if (result) { result.error = tr(result.error); result.toast = tr(result.toast); }
    api.remoteActionResult(reqId, result);
    setTimeout(() => sendSnapshot(tabId), 150);
  });

  function wave(space) {
    space.robotEl.classList.remove('hello');
    void space.robotEl.offsetWidth;
    space.robotEl.classList.add('hello');
  }

  // ---------- Workspace (badge et robot à jambes) ----------
  const wsBadge = $('#ws-badge');
  let wsWalkTimer = null;
  function wsWalk() {
    wsBadge.classList.add('walking');
    clearTimeout(wsWalkTimer);
    wsWalkTimer = setTimeout(() => wsBadge.classList.remove('walking'), 1200);
  }

  function renderWorkspace() {
    document.body.classList.toggle('secondary-window', !!ctx.winId && ctx.winId !== 'main');
    wsBadge.innerHTML = '';
    if (ctx.ws) {
      const bot = Robot.generate(ctx.ws.seed, { legs: true, traits: ctx.ws.robot?.traits, context: { tabKind: activeSpace?.activeTab?.kind } });
      ctx.wsBot = bot;
      const r = h('div', 'robot ws-bot', bot.svg);
      r.style.setProperty('--blink-delay', `-${bot.blinkDelay}s`);
      const txt = h('div', 'ws-text');
      txt.innerHTML = `<span class="ws-name"></span><span class="ws-path"></span>`;
      txt.querySelector('.ws-name').textContent = ctx.ws.name;
      txt.querySelector('.ws-path').textContent = ctx.ws.root;
      wsBadge.append(r, txt, h('span', 'ws-caret', '▾'));
      wsBadge.title = `Workspace ${ctx.ws.name}\n${ctx.ws.root}`;
      wsBadge.style.setProperty('--ws-accent', Themes.spaceAccent(bot));
      document.title = `${ctx.ws.name} — RobotConsole`;
    } else {
      wsBadge.innerHTML = '<span class="brand-dot"></span><span class="ws-name">RobotConsole</span><span class="ws-caret">▾</span>';
      wsBadge.title = 'Ouvrir un workspace…';
      wsBadge.style.removeProperty('--ws-accent');
      document.title = 'RobotConsole';
    }
  }

  function workspaceMenu() {
    const recentItems = ctx.recent.filter((r) => !ctx.ws || r.root.toLowerCase() !== ctx.ws.root.toLowerCase()).map((r) => ({
      label: r.name, hint: r.root.length > 40 ? '…' + r.root.slice(-38) : r.root, icon: '◆', action: () => api.openWorkspace(r.root),
    }));
    const items = [];
    if (ctx.ws) {
      items.push({ title: `Workspace : ${ctx.ws.name}` });
      items.push({ label: 'Renommer le workspace…', icon: '✎', action: renameWorkspace });
      items.push({ label: 'Personnaliser le robot du workspace…', icon: '🛠', action: workspaceStudio });
      items.push({ label: 'Nouveau robot pour le workspace', icon: '🎲', action: rerollWorkspace });
      items.push({ label: 'Configuration (.robot)', icon: '⚙', submenu: [
        { label: 'Modifier workspace.json', action: () => openFile(ensureSpace(), `${ctx.ws.root}\\.robot\\workspace.json`) },
        { label: 'Modifier services.json', action: () => openFile(ensureSpace(), `${ctx.ws.root}\\.robot\\services.json`) },
        { label: 'Explorer le dossier .robot', action: () => openTab(ensureSpace(), { kind: 'explorer', root: `${ctx.ws.root}\\.robot` }) },
        { label: "Ouvrir dans l'Explorateur Windows", action: () => api.revealWorkspace() },
      ] });
      items.push('-');
    }
    items.push({ label: ctx.ws ? 'Ouvrir un autre workspace…' : 'Ouvrir un dossier comme workspace…', icon: '📂', hint: 'Ctrl+O', action: pickWorkspace });
    if (recentItems.length) items.push({ label: 'Workspaces récents', icon: '🕘', submenu: recentItems });
    if (ctx.ws) items.push({ label: 'Fenêtre sans workspace', icon: '🗗', action: () => api.newWindow() });
    if (ctx.ws) { items.push('-'); items.push({ label: 'Fermer le workspace', icon: '✕', danger: true, action: () => api.closeWorkspace() }); }
    UI.menu(items, wsBadge);
  }

  async function pickWorkspace() {
    const p = await api.pickWorkspace();
    if (p) api.openWorkspace(p);
  }
  async function renameWorkspace() {
    const v = await UI.prompt('Nom du workspace', ctx.ws.name);
    if (!v) return;
    ctx.ws = await api.updateWorkspace({ name: v });
    renderWorkspace();
  }
  async function rerollWorkspace() {
    ctx.ws = await api.updateWorkspace({ seed: Robot.randomSeed() });
    renderWorkspace();
    wsWalk();
  }

  // ---------- Espaces ----------
  function createSpace(opts = {}) {
    const space = {
      id: nid('s'),
      seed: opts.seed ?? Robot.randomSeed(),
      customName: !!opts.name,
      name: opts.name || '',
      tabs: [],
      activeTab: null,
      lastShell: null,
      parked: !!opts.parked,
      traits: opts.traits || null, // réglages de l'atelier (sinon : tirage de la graine)
      icon: opts.icon || null, // icône de la zone (modèle de zone ou choix manuel)
      sound: opts.sound || null, // son joué quand le robot a fini de travailler : { id, delay }
      remote: ['read', 'control'].includes(opts.remote) ? opts.remote : 'off', // accès depuis un téléphone / une tablette
      rid: /^[a-z0-9]{6,16}$/.test(opts.rid || '') && !spaces.some((x) => x.rid === opts.rid) ? opts.rid : Math.random().toString(36).slice(2, 10), // identifiant stable (lien / QR code du robot)
      screenId: opts.screenId || activeScreenId,
    };
    space.bot = botFor(space);

    const el = h('section', 'space');
    const head = h('div', 'space-head');
    const robotEl = h('div', 'robot');
    robotEl.title = 'Changer de robot · glisser pour déplacer l\'espace';
    const iconEl = h('button', 'space-icon');
    iconEl.title = 'Icône de la zone · cliquer pour la changer';
    const nameEl = h('div', 'space-name');
    nameEl.title = 'Double-clic pour renommer · glisser pour déplacer';
    const soundEl = h('button', 'space-sound hidden', '🔔');
    soundEl.addEventListener('click', (e) => { e.stopPropagation(); showRobotPicker(space, robotEl, 'sound'); });
    const remoteEl = h('button', 'space-remote hidden', '📡');
    remoteEl.addEventListener('click', (e) => { e.stopPropagation(); showRobotPicker(space, robotEl, 'share'); });
    const tabsEl = h('div', 'tabs');
    // Barre d'onglets défilante : flèches + liste quand les onglets débordent
    const tabsWrap = h('div', 'tabs-wrap');
    const scrollL = h('button', 'tabs-scroll left', '‹');
    const scrollR = h('button', 'tabs-scroll right', '›');
    const tabsList = h('button', 'tabs-list', '⌄');
    scrollL.title = 'Onglets précédents';
    scrollR.title = 'Onglets suivants';
    tabsList.title = 'Tous les onglets';
    tabsWrap.append(scrollL, tabsEl, scrollR, tabsList);
    const addWrap = h('div', 'add-tab');
    const addBtn = h('button', 'icon-btn', '＋');
    addBtn.title = 'Nouveau terminal (Ctrl+Maj+T)';
    const addMenuBtn = h('button', 'icon-btn', '▼');
    addMenuBtn.title = 'Ajouter un onglet : terminal, explorateur, tests, Docker, services, Graphify…';
    const modelsBtn = h('button', 'icon-btn space-models-btn', '🧩');
    modelsBtn.title = 'Ouvrir un modèle d\'onglet dans cet espace';
    modelsBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const zones = TabModels.all('zone');
      UI.menu([
        { title: `Modèles d'onglet · ${space.name}` },
        ...TabModels.menuItems(space),
        zones.length && '-',
        zones.length && { label: 'Onglets d\'un modèle de zone', icon: '🗂', submenu: TabModels.zoneMenuItems(space) },
      ], modelsBtn);
    });
    addWrap.append(addBtn, addMenuBtn, modelsBtn);
    const parkBtn = h('button', 'icon-btn', '⤓');
    parkBtn.title = 'Ranger l\'espace : le robot attend en haut, les terminaux continuent';
    const maxBtn = h('button', 'icon-btn', '⤢');
    maxBtn.title = 'Agrandir / restaurer (Ctrl+Maj+M)';
    const closeBtn = h('button', 'icon-btn danger', '✕');
    closeBtn.title = "Fermer l'espace (arrête ses terminaux)";
    head.append(robotEl, iconEl, nameEl, soundEl, remoteEl, tabsWrap, addWrap, parkBtn, maxBtn, closeBtn);

    const host = h('div', 'term-host');
    const empty = h('div', 'empty');
    const emptyRobot = h('div', 'robot');
    const emptyKinds = h('div', 'empty-actions');
    const emptyModels = h('div', 'empty-models');
    empty.append(emptyRobot, h('div', '', 'Cet espace est vide'), emptyKinds, emptyModels);
    host.appendChild(empty);
    el.append(head, host);

    // Barre des robots : visage du robot + icônes des onglets ouverts
    const crewItem = h('div', 'crew-item');
    const crewFace = h('div', 'crew-bot');
    const crewIcon = h('span', 'crew-zone-icon');
    const crewTabs = h('div', 'crew-tabs');
    crewItem.append(crewFace, crewIcon, crewTabs);
    Object.assign(space, { el, head, robotEl, iconEl, crewIcon, nameEl, soundEl, remoteEl, tabsEl, tabsWrap, host, empty, emptyRobot, emptyKinds, emptyModels, crewEl: crewItem, crewFace, crewTabs });
    applyBot(space);
    applyIcon(space);
    updateSoundBadge(space);
    updateRemoteBadge(space);
    fillEmpty(space);

    // Défilement des onglets
    const scrollBy = (dx) => tabsEl.scrollBy({ left: dx, behavior: 'smooth' });
    scrollL.addEventListener('click', () => scrollBy(-tabsEl.clientWidth * 0.7));
    scrollR.addEventListener('click', () => scrollBy(tabsEl.clientWidth * 0.7));
    tabsList.addEventListener('click', () => UI.menu([{ title: `Onglets de ${space.name}` }, ...space.tabs.map((t) => ({ label: t.title, icon: tabIconText(t), checked: t === space.activeTab, action: () => activateTab(t, true) }))], tabsList));
    tabsEl.addEventListener('wheel', (e) => { if (tabsEl.scrollWidth > tabsEl.clientWidth) { tabsEl.scrollLeft += e.deltaY || e.deltaX; e.preventDefault(); } }, { passive: false });
    tabsEl.addEventListener('scroll', () => updateTabsOverflow(space));
    new ResizeObserver(() => updateTabsOverflow(space)).observe(tabsEl);
    makeTabDropZone(space);

    el.addEventListener('mousedown', () => setActiveSpace(space, false), true);
    el.addEventListener('focusin', () => setActiveSpace(space, false));
    robotEl.addEventListener('click', (e) => { e.stopPropagation(); showRobotPicker(space, robotEl); });
    nameEl.addEventListener('dblclick', () => renameSpace(space));
    iconEl.addEventListener('click', (e) => { e.stopPropagation(); chooseSpaceIcon(space, iconEl); });
    head.addEventListener('contextmenu', (e) => {
      if (e.target.closest('.tab')) return;
      e.preventDefault();
      UI.menu(spaceMenuItems(space), e.clientX, e.clientY);
    });
    addBtn.addEventListener('click', () => openTab(space));
    addMenuBtn.addEventListener('click', (e) => { e.stopPropagation(); UI.menu(kindItems(space), addMenuBtn); });
    parkBtn.addEventListener('click', () => parkSpace(space));
    maxBtn.addEventListener('click', () => toggleMaximize(space));
    closeBtn.addEventListener('click', () => {
      if (space.tabs.length && !space.confirmClose) {
        space.confirmClose = true;
        say(space, 'Cliquez encore pour fermer cet espace', 1800);
        setTimeout(() => { space.confirmClose = false; }, 2200);
        return;
      }
      closeSpace(space);
    });

    // Glisser-déposer : poignées = robot et nom
    for (const handle of [robotEl, nameEl]) makeDragSource(handle, space);
    el.addEventListener('dragover', (e) => {
      if (!Layout.dragging) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      Layout.overSpace(space.id, e);
    });
    el.addEventListener('drop', (e) => { if (Layout.dragging) { e.preventDefault(); Layout.drop(); } });

    crewFace.addEventListener('click', () => {
      hideTip();
      ensureScreen(space);
      if (space.parked) return unparkSpace(space);
      if (maximized && maximized !== space) { maximized = space; renderLayout(); }
      setActiveSpace(space, true);
      wave(space);
    });
    crewItem.addEventListener('contextmenu', (e) => { e.preventDefault(); hideTip(); UI.menu(spaceMenuItems(space), e.clientX, e.clientY); });
    crewFace.addEventListener('mouseenter', () => showTip(space));
    crewFace.addEventListener('mouseleave', hideTip);
    makeDragSource(crewItem, space);
    makeCrewDropTarget(crewItem, space);

    new ResizeObserver(() => resizeTab(space.activeTab)).observe(host);
    spaces.push(space);
    updateEmpty(space);
    return space;
  }

  // Icône de la zone : à côté du nom (en-tête) et sur le robot (barre du haut)
  function applyIcon(space) {
    const html = space.icon ? TabModels.iconHtml(space.icon) : '';
    space.iconEl.innerHTML = html;
    space.iconEl.classList.toggle('hidden', !space.icon);
    space.crewIcon.innerHTML = html;
    space.crewIcon.classList.toggle('hidden', !space.icon);
  }
  function chooseSpaceIcon(space, anchor) {
    TabModels.pickIcon(anchor || space.robotEl, (ic) => { space.icon = ic; applyIcon(space); save(); }, true);
  }

  // Ajoute un espace dans la disposition (à côté de l'espace actif)
  function placeSpace(space, nearId) {
    if (!space.parked) Layout.add(space.id, nearId ?? activeSpace?.id);
    renderLayout();
    renderCrew();
  }

  function spaceMenuItems(space) {
    return [
      { title: space.name },
      { label: 'Renommer…', icon: '✎', action: () => renameSpace(space) },
      { label: 'Changer de robot…', icon: '🤖', action: () => showRobotPicker(space, space.robotEl) },
      { label: space.icon ? 'Changer l\'icône…' : 'Ajouter une icône…', icon: space.icon ? TabModels.iconHtml(space.icon) : '🏷', action: () => chooseSpaceIcon(space, space.icon ? space.iconEl : space.nameEl) },
      { label: 'Personnaliser le robot (atelier)…', icon: '🛠', action: () => spaceStudio(space) },
      { label: space.sound ? `Son de fin : ${RobotSounds.label(space.sound.id)}` : 'Son quand le robot a fini…', icon: '🔔', action: () => showRobotPicker(space, space.robotEl, 'sound') },
      { label: 'Ajouter', icon: '＋', submenu: kindItems(space) },
      { label: space.remote === 'off' ? 'Accès à distance…' : `Accès à distance : ${space.remote === 'control' ? 'contrôle' : 'lecture seule'}`, icon: '📡', action: () => showRobotPicker(space, space.robotEl, 'share') },
      TabModels.saveMenuItem('zone', () => snapshotSpace(space)),
      { label: 'Sortir dans une nouvelle fenêtre', icon: '🗗', action: () => detachSpace(space) },
      { label: 'Déplacer vers une autre fenêtre…', icon: '⧉', action: () => { const r = space.robotEl.getBoundingClientRect(); moveToWindowMenu(space, r.left, r.bottom + 4); } },
      { label: 'Envoyer vers l\'écran', icon: '▣', submenu: [
        ...screens.map((sc, i) => ({ label: `${i + 1} · ${sc.name}`, checked: sc.id === space.screenId, disabled: sc.id === space.screenId, action: () => moveSpaceToScreen(space, sc.id) })),
        '-',
        { label: 'Nouvel écran', icon: '＋', action: () => { const sc = { id: `sc${++screenSeq}-${Date.now().toString(36)}`, name: `Écran ${screens.length + 1}`, tree: null, maximizedId: null }; screens.push(sc); moveSpaceToScreen(space, sc.id); switchScreen(sc.id); } },
      ] },
      '-',
      space.parked ? { label: 'Ressortir l\'espace', icon: '⤒', action: () => unparkSpace(space) } : { label: 'Ranger l\'espace', icon: '⤓', action: () => parkSpace(space) },
      !space.parked && { label: maximized === space ? 'Restaurer' : 'Agrandir', icon: '⤢', hint: 'Ctrl+Maj+M', action: () => toggleMaximize(space) },
      !space.parked && { label: 'Ancrer', icon: '⊞', submenu: ['left', 'right', 'top', 'bottom'].map((side) => ({ label: { left: 'Tout à gauche', right: 'Tout à droite', top: 'Tout en haut', bottom: 'Tout en bas' }[side], action: () => { Layout.dock(space.id, null, side); renderLayout(); save(); } })) },
      '-',
      { label: 'Fermer l\'espace', icon: '✕', danger: true, action: async () => { if (!space.tabs.length || await UI.confirm('Fermer l\'espace ?', `Les ${space.tabs.length} onglet(s) de « ${esc(space.name)} » seront fermés et leurs terminaux arrêtés.`, { ok: 'Fermer', danger: true })) closeSpace(space); } },
    ];
  }

  function renameSpace(space) {
    editInline(space.nameEl, (v) => {
      space.customName = !!v;
      space.name = v || space.bot.name;
      space.nameEl.textContent = space.name;
      renderCrew();
      save();
    });
  }

  async function closeSpace(space, released) {
    for (const t of [...space.tabs]) if (kindOf(t).canClose && !(await kindOf(t).canClose(t))) return;
    for (const t of [...space.tabs]) closeTab(t, true);
    space.bubble?.remove();
    const i = spaces.indexOf(space);
    spaces.splice(i, 1);
    Layout.remove(space.id);
    space.el.remove();
    space.crewEl.remove();
    if (maximized === space) maximized = null;
    if (activeSpace === space) activeSpace = null;
    if (!spaces.length) { const s = createSpace(); placeSpace(s); openTab(s); }
    if (!activeSpace) setActiveSpace(nearestVisible(i - 1), true);
    renderLayout();
    renderCrew();
    save();
  }

  // Retire un espace de cette fenêtre sans arrêter ses terminaux (il part ailleurs)
  function releaseSpace(space) {
    space.tabs.forEach((t) => { if (t.kind === 'terminal' && t.ptyId) t.attachOnly = true; });
    closeSpace(space, true);
  }
  // Sortir un espace dans une nouvelle fenêtre (à la position du pointeur si fournie)
  function detachSpace(space, at) {
    api.detachSpace(payloadFor([space]), at);
    releaseSpace(space);
  }
  async function moveToWindowMenu(space, x, y) {
    const wins = await api.listWindows();
    UI.menu([
      { title: `Déplacer « ${space.name} » vers…` },
      ...wins.map((w) => ({ label: w.title, icon: '🗗', action: () => { api.sendSpaces(w.wcId, payloadFor([space])); releaseSpace(space); } })),
      wins.length ? '-' : null,
      { label: 'Nouvelle fenêtre', icon: '＋', action: () => detachSpace(space) },
    ], x, y);
  }
  // Espaces reçus d'une autre fenêtre
  function receiveSpaces(state) {
    let last = null;
    for (const ss of state.spaces || []) {
      const sp = createSpace({ seed: ss.seed, name: ss.name, traits: ss.traits, icon: ss.icon, sound: ss.sound, remote: ss.remote, rid: ss.rid, screenId: activeScreenId });
      for (const t of ss.tabs || []) { const { title, ...spec } = t; openTab(sp, { kind: 'terminal', ...spec }, { title }); }
      const at = sp.tabs[ss.activeTab] || sp.tabs[0];
      if (at) activateTab(at, false);
      placeSpace(sp);
      last = sp;
    }
    if (last) { setActiveSpace(last, true); wave(last); setTimeout(() => say(last, 'Me voici dans cette fenêtre !', 1800), 120); }
    save();
  }

  const visibleSpaces = () => spaces.filter((s) => !s.parked && s.screenId === activeScreenId);
  function nearestVisible(i) {
    for (let k = Math.min(i, spaces.length - 1); k >= 0; k--) if (!spaces[k].parked && spaces[k].screenId === activeScreenId) return spaces[k];
    return visibleSpaces()[0] || null;
  }

  // ---------- Écrans (bureaux virtuels) ----------
  const curScreen = () => screens.find((sc) => sc.id === activeScreenId) || screens[0];
  function syncScreen() {
    const sc = curScreen();
    sc.tree = Layout.tree;
    sc.maximizedId = maximized?.id || null;
  }
  // Couleur d'un écran : choisie, sinon une couleur de la palette selon sa position
  const SCREEN_COLORS = [
    ['#4f8cff', 'Bleu'], ['#22c55e', 'Vert'], ['#f59e0b', 'Ambre'], ['#ec4899', 'Rose'], ['#a855f7', 'Violet'],
    ['#14b8a6', 'Turquoise'], ['#ef4444', 'Rouge'], ['#eab308', 'Jaune'], ['#06b6d4', 'Cyan'], ['#f97316', 'Orange'],
    ['#84cc16', 'Citron vert'], ['#94a3b8', 'Gris'],
  ];
  const screenColor = (sc, i = screens.indexOf(sc)) => sc.color || SCREEN_COLORS[Math.max(0, i) % SCREEN_COLORS.length][0];
  function applyScreenColor() { spacesEl.style.setProperty('--screen-color', screenColor(curScreen())); }
  function setScreenColor(sc, color) { sc.color = color; renderCrew(); applyScreenColor(); save(); }
  function pickScreenColor(sc, anchor) {
    UI.closeMenus();
    document.querySelectorAll('.sc-colors').forEach((x) => x.remove());
    const box = h('div', 'menu sc-colors');
    box.appendChild(h('div', 'menu-title', `Couleur de ${esc(sc.name)}`));
    const grid = h('div', 'sc-color-grid');
    for (const [c, label] of SCREEN_COLORS) {
      const b = h('button', 'sc-swatch' + (screenColor(sc) === c ? ' on' : ''));
      b.style.background = c;
      b.title = label;
      b.addEventListener('click', () => { done(); setScreenColor(sc, c); });
      grid.appendChild(b);
    }
    const custom = h('input', 'sc-custom');
    custom.type = 'color';
    custom.value = screenColor(sc);
    custom.title = 'Couleur personnalisée';
    custom.addEventListener('input', () => setScreenColor(sc, custom.value));
    grid.appendChild(custom);
    box.appendChild(grid);
    const auto = h('button', 'tb-btn small', '↺ Couleur automatique');
    auto.disabled = !sc.color;
    auto.addEventListener('click', () => { done(); setScreenColor(sc, null); });
    box.appendChild(auto);
    document.body.appendChild(box);
    const r = anchor.getBoundingClientRect ? anchor.getBoundingClientRect() : { left: anchor.x, bottom: anchor.y };
    box.style.left = `${Math.max(6, Math.min(r.left, innerWidth - box.offsetWidth - 6))}px`;
    box.style.top = `${r.bottom + 4}px`;
    const off = (e) => { if (!box.contains(e.target)) done(); };
    const done = () => { box.remove(); document.removeEventListener('mousedown', off, true); };
    setTimeout(() => document.addEventListener('mousedown', off, true), 0);
  }

  function switchScreen(id) {
    if (id === activeScreenId || !screens.some((sc) => sc.id === id)) return;
    syncScreen();
    const from = screens.findIndex((sc) => sc.id === activeScreenId);
    const to = screens.findIndex((sc) => sc.id === id);
    activeScreenId = id;
    const sc = curScreen();
    Layout.set(sc.tree ? JSON.parse(JSON.stringify(sc.tree)) : null);
    maximized = sc.maximizedId ? byId(sc.maximizedId) : null;
    activeSpace?.el.classList.remove('active');
    activeSpace = null;
    renderLayout();
    spacesEl.classList.remove('slide-left', 'slide-right');
    void spacesEl.offsetWidth;
    spacesEl.classList.add(to > from ? 'slide-left' : 'slide-right');
    const first = visibleSpaces()[0];
    if (first) setActiveSpace(first, true);
    renderCrew();
    flashScreenName(sc, to);
    save();
  }
  function flashScreenName(sc, i) {
    const f = h('div', 'screen-flash');
    f.innerHTML = `<b>${i + 1}</b><span></span>`;
    f.querySelector('span').textContent = sc.name;
    document.body.appendChild(f);
    setTimeout(() => f.classList.add('out'), 700);
    setTimeout(() => f.remove(), 1100);
  }
  function addScreen() {
    const sc = { id: `sc${++screenSeq}-${Date.now().toString(36)}`, name: `Écran ${screens.length + 1}`, tree: null, maximizedId: null };
    screens.push(sc);
    switchScreen(sc.id);
    return sc;
  }
  function ensureScreen(space) { if (space && space.screenId !== activeScreenId) switchScreen(space.screenId); }
  function moveSpaceToScreen(space, screenId) {
    if (space.screenId === screenId) return;
    if (space.screenId === activeScreenId) {
      Layout.remove(space.id);
      space.el.remove();
      if (maximized === space) maximized = null;
      if (activeSpace === space) { space.el.classList.remove('active'); activeSpace = null; }
    } else {
      // retire la feuille de l'arbre mémorisé de son ancien écran
      const old = screens.find((sc) => sc.id === space.screenId);
      if (old?.tree) { Layout.set(old.tree); Layout.remove(space.id); old.tree = Layout.tree; Layout.set(curScreen().tree); }
    }
    space.screenId = screenId;
    renderLayout();
    renderCrew();
    if (!activeSpace) setActiveSpace(visibleSpaces()[0], true);
    const sc = screens.find((x) => x.id === screenId);
    UI.toast(`« ${space.name} » envoyé sur ${sc.name}`, { ms: 1600 });
    save();
  }
  async function removeScreen(sc) {
    if (screens.length < 2) return;
    const i = screens.indexOf(sc);
    const target = screens[i === 0 ? 1 : i - 1];
    const inside = spaces.filter((sp) => sp.screenId === sc.id);
    if (inside.length && !(await UI.confirm('Supprimer l\'écran ?', `Ses ${inside.length} espace(s) iront sur <b>${esc(target.name)}</b>.`, { ok: 'Supprimer l\'écran' }))) return;
    if (sc.id === activeScreenId) switchScreen(target.id);
    for (const sp of inside) moveSpaceToScreen(sp, target.id);
    screens.splice(screens.indexOf(sc), 1);
    renderCrew();
    save();
  }
  function screenMenu(sc) {
    const i = screens.indexOf(sc);
    return [
      { title: sc.name },
      { label: 'Afficher', icon: '▣', hint: `Ctrl+Alt+${i + 1}`, disabled: sc.id === activeScreenId, action: () => switchScreen(sc.id) },
      { label: 'Renommer…', icon: '✎', action: async () => { const v = await UI.prompt('Nom de l\'écran', sc.name); if (v) { sc.name = v; renderCrew(); save(); } } },
      { label: sc.folded ? 'Déplier dans la barre' : 'Plier dans la barre', icon: sc.folded ? '▸' : '◂', action: () => toggleFoldScreen(sc) },
      { label: 'Couleur de l\'écran…', icon: `<span class="sc-dot" style="background:${screenColor(sc)}"></span>`, action: () => pickScreenColor(sc, crewEl.querySelector(`[data-screen-id="${sc.id}"]`) || crewEl) },
      { label: 'Ajouter un espace sur cet écran', icon: '＋', action: () => { switchScreen(sc.id); openKind(null, 'terminal'); } },
      { label: 'Ajouter une zone depuis un modèle', icon: '🗂', submenu: TabModels.all('zone').map((z) => ({ label: z.name, icon: z.icon || '🗂', hint: TabModels.summary('zone', z), action: () => { switchScreen(sc.id); openZoneModel(z, null); } })).concat(TabModels.all('zone').length ? [] : [{ label: 'Aucun modèle de zone', disabled: true }]) },
      TabModels.saveMenuItem('screen', () => snapshotScreen(sc)),
      { label: 'Nouvel écran depuis un modèle', icon: '▣', submenu: TabModels.screenMenuItems() },
      '-',
      { label: 'Déplacer vers la gauche', icon: '←', disabled: i === 0, action: () => { screens.splice(i, 1); screens.splice(i - 1, 0, sc); renderCrew(); save(); } },
      { label: 'Déplacer vers la droite', icon: '→', disabled: i === screens.length - 1, action: () => { screens.splice(i, 1); screens.splice(i + 1, 0, sc); renderCrew(); save(); } },
      '-',
      { label: 'Supprimer l\'écran', icon: '✕', danger: true, disabled: screens.length < 2, action: () => removeScreen(sc) },
    ];
  }

  function parkSpace(space) {
    space.parked = true;
    space.bubble?.remove();
    Layout.remove(space.id);
    space.el.remove();
    if (maximized === space) maximized = null;
    if (activeSpace === space) {
      space.el.classList.remove('active');
      activeSpace = null;
      setActiveSpace(nearestVisible(spaces.indexOf(space)), true);
    }
    renderLayout();
    renderCrew();
    save();
  }

  function unparkSpace(space, dockTo) {
    ensureScreen(space);
    space.parked = false;
    if (maximized) maximized = null;
    if (dockTo) Layout.dock(space.id, dockTo.targetId, dockTo.side);
    else Layout.add(space.id, activeSpace?.id);
    renderLayout();
    setActiveSpace(space, true);
    renderCrew();
    wave(space);
    setTimeout(() => say(space, 'Me revoilà !', 1500), 80);
    save();
  }

  function setActiveSpace(space, focus) {
    if (!space || space.parked || space.screenId !== activeScreenId) return;
    if (activeSpace !== space) {
      activeSpace?.el.classList.remove('active');
      activeSpace = space;
      space.el.classList.add('active');
      renderCrew();
      save();
    }
    if (focus && space.activeTab) kindOf(space.activeTab).focus(space.activeTab);
  }

  function toggleMaximize(space) {
    maximized = maximized === space ? null : space;
    renderLayout();
    setActiveSpace(space, true);
    save();
  }

  function toggleFoldScreen(sc) { sc.folded = !sc.folded; renderCrew(); save(); }

  let dragScreen = null;
  function renderCrew() {
    applyScreenColor();
    const keepScroll = crewEl.scrollLeft;
    crewEl.innerHTML = '';
    screens.forEach((sc, i) => {
      const g = h('div', 'screen-group' + (sc.id === activeScreenId ? ' current' : '') + (sc.folded ? ' folded' : ''));
      g.style.setProperty('--screen-color', screenColor(sc, i));
      g.dataset.screenId = sc.id;
      const lab = h('button', 'screen-label', String(i + 1));
      lab.setAttribute('aria-label', `Set de zones ${i + 1} : ${sc.name}`);
      lab.setAttribute('aria-pressed', String(sc.id === activeScreenId));
      lab.title = `${sc.name} (Ctrl+Alt+${i + 1}) · clic droit : options`;
      lab.addEventListener('click', () => switchScreen(sc.id));
      // Glisser le numéro d'un écran pour le réordonner
      lab.draggable = true;
      lab.addEventListener('dragstart', (e) => {
        dragScreen = sc;
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('application/x-rc-screen', sc.id);
        e.dataTransfer.setDragImage(g, 12, 12);
        hideTip();
        requestAnimationFrame(() => g.classList.add('screen-dragging'));
      });
      lab.addEventListener('dragend', () => {
        dragScreen = null;
        for (const el of crewEl.querySelectorAll('.screen-group')) el.classList.remove('screen-dragging', 'screen-drop-before', 'screen-drop-after');
      });
      lab.addEventListener('dblclick', async () => { const v = await UI.prompt('Nom de l\'écran', sc.name); if (v) { sc.name = v; renderCrew(); save(); } });
      g.addEventListener('contextmenu', (e) => { if (e.target.closest('.crew-item')) return; e.preventDefault(); UI.menu(screenMenu(sc), e.clientX, e.clientY); });
      g.appendChild(lab);
      const list = spaces.filter((s) => s.screenId === sc.id);
      const fold = h('button', 'screen-fold', sc.folded ? '▸' : '◂');
      fold.title = sc.folded ? `Déplier « ${sc.name} »` : `Plier « ${sc.name} » (petits carrés)`;
      fold.setAttribute('aria-label', fold.title);
      fold.setAttribute('aria-expanded', String(!sc.folded));
      fold.addEventListener('click', (e) => { e.stopPropagation(); toggleFoldScreen(sc); });
      if (sc.folded) {
        // Écran plié : un petit carré par zone, aux couleurs de son robot
        const mini = h('div', 'screen-minis');
        if (!list.length) mini.appendChild(h('span', 'screen-mini empty'));
        list.forEach((s) => {
          const q = h('button', 'screen-mini' + (s === activeSpace ? ' active' : '') + (s.parked ? ' parked' : ''));
          q.style.setProperty('--space-accent', Themes.spaceAccent(s.bot));
          q.title = s.name + (s.parked ? ' (rangé)' : '');
          q.setAttribute('aria-label', q.title);
          q.addEventListener('click', (e) => {
            e.stopPropagation();
            if (s.parked) return unparkSpace(s);
            ensureScreen(s);
            setActiveSpace(s, true);
          });
          s.crewMini = q;
          mini.appendChild(q);
        });
        g.append(mini, fold);
      }
      if (!sc.folded && !list.length) g.appendChild(h('span', 'screen-empty', 'vide'));
      if (!sc.folded) list.forEach((s) => {
        s.crewMini = null;
        for (const el of [s.crewEl, s.crewFace]) { el.classList.toggle('active', s === activeSpace); el.classList.toggle('parked', !!s.parked); }
        renderCrewTabs(s);
        g.appendChild(s.crewEl);
      });
      const addZone = h('button', 'screen-add-zone', '+');
      addZone.title = `Ajouter une zone à « ${sc.name} »`;
      addZone.setAttribute('aria-label', addZone.title);
      addZone.addEventListener('click', (e) => { e.stopPropagation(); addZoneDialog(sc); });
      if (!sc.folded) g.append(addZone, fold);
      // Réordonner les écrans : on lâche un écran avant / après un autre
      g.addEventListener('dragover', (e) => {
        if (!dragScreen) return;
        e.preventDefault();
        e.stopPropagation();
        if (dragScreen === sc) return;
        e.dataTransfer.dropEffect = 'move';
        const r = g.getBoundingClientRect();
        const after = e.clientX > r.left + r.width / 2;
        g.classList.toggle('screen-drop-after', after);
        g.classList.toggle('screen-drop-before', !after);
      });
      g.addEventListener('dragleave', (e) => { if (!g.contains(e.relatedTarget)) g.classList.remove('screen-drop-before', 'screen-drop-after'); });
      g.addEventListener('drop', (e) => {
        if (!dragScreen) return;
        e.preventDefault();
        e.stopPropagation();
        const moving = dragScreen;
        const after = g.classList.contains('screen-drop-after');
        g.classList.remove('screen-drop-before', 'screen-drop-after');
        dragScreen = null;
        if (moving === sc) return;
        screens.splice(screens.indexOf(moving), 1);
        screens.splice(screens.indexOf(sc) + (after ? 1 : 0), 0, moving);
        renderCrew();
        save();
      });
      // Lâcher un espace sur un autre écran l'y envoie
      g.addEventListener('dragover', (e) => {
        if (!dragSpace || dragSpace.screenId === sc.id || e.target.closest('.crew-item')) return;
        e.preventDefault();
        e.stopPropagation();
        g.classList.add('drop-screen');
      });
      g.addEventListener('dragleave', (e) => { if (!g.contains(e.relatedTarget)) g.classList.remove('drop-screen'); });
      g.addEventListener('drop', (e) => {
        g.classList.remove('drop-screen');
        if (!dragSpace || dragSpace.screenId === sc.id || e.target.closest('.crew-item')) return;
        e.preventDefault();
        e.stopPropagation();
        const sp = dragSpace;
        Layout.endDrag();
        moveSpaceToScreen(sp, sc.id);
      });
      crewEl.appendChild(g);
    });
    crewEl.scrollLeft = keepScroll;
    updateCrewOverflow();
    const cur = crewEl.querySelector('.screen-group.current');
    if (cur && crewEl.scrollWidth > crewEl.clientWidth) {
      const a = cur.getBoundingClientRect(), b = crewEl.getBoundingClientRect();
      if (a.left < b.left || a.right > b.right) cur.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
    }
  }

  // ---------- Défilement de la barre des robots quand les écrans débordent ----------
  function updateCrewOverflow() {
    const over = crewEl.scrollWidth > crewEl.clientWidth + 2;
    crewEl.classList.toggle('overflow', over);
    crewEl.classList.toggle('can-left', over && crewEl.scrollLeft > 2);
    crewEl.classList.toggle('can-right', over && crewEl.scrollLeft < crewEl.scrollWidth - crewEl.clientWidth - 2);
  }
  crewEl.addEventListener('scroll', updateCrewOverflow, { passive: true });
  window.addEventListener('resize', updateCrewOverflow);
  // Molette verticale = défilement horizontal
  crewEl.addEventListener('wheel', (e) => {
    if (crewEl.scrollWidth <= crewEl.clientWidth || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
    e.preventDefault();
    crewEl.scrollLeft += e.deltaY;
  }, { passive: false });
  // Défilement automatique en glissant un robot / un écran près des bords
  crewEl.addEventListener('dragover', (e) => {
    const r = crewEl.getBoundingClientRect();
    if (e.clientX < r.left + 40) crewEl.scrollLeft -= 12;
    else if (e.clientX > r.right - 40) crewEl.scrollLeft += 12;
  });

  // ---------- Petite fenêtre « Nouvelle zone » (bouton + de chaque set de la barre des robots) ----------
  const ZONE_TYPES = [
    { k: 'terminal', icon: KIND_INFO.terminal.icon, label: 'Terminal', desc: 'Shell par défaut' },
    { k: 'browser', icon: '🌐', label: 'Navigateur', desc: 'Page web, doc, appli locale' },
    { k: 'explorer', icon: '📁', label: 'Explorateur', desc: 'Fichiers, éditeur et Git' },
    { k: 'tests', icon: '🧪', label: 'Tests', desc: 'Lancer et suivre les tests' },
    { k: 'docker', icon: '🐳', label: 'Docker', desc: 'Conteneurs et compose' },
    { k: 'services', icon: '🛰', label: 'Services', desc: 'Services surveillés' },
    { k: 'prisma', icon: '◆', label: 'Prisma / BDD', desc: 'Schéma et données' },
    { k: 'graphify', icon: '🕸', label: 'Graphify', desc: 'Graphe du projet' },
  ];
  function addZoneDialog(sc) {
    UI.closeMenus();
    document.querySelector('.zone-dlg-layer')?.remove();
    const layer = h('div', 'overlay zone-dlg-layer');
    const card = h('div', 'zone-dlg');
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-modal', 'true');
    layer.appendChild(card);
    function close() { layer.remove(); document.removeEventListener('keydown', onKey, true); }
    // Crée la zone sur le set choisi (on y bascule d'abord si besoin)
    const pick = (fn) => { close(); if (sc.id !== activeScreenId) switchScreen(sc.id); fn(); };

    const head = h('div', 'zone-dlg-head');
    const ht = h('div');
    const title = h('div', 'zone-dlg-title');
    title.textContent = 'Nouvelle zone';
    const sub = h('div', 'zone-dlg-sub');
    sub.textContent = `dans « ${sc.name} » · que doit faire cette zone ?`;
    ht.append(title, sub);
    const x = h('button', 'zone-dlg-x', '✕');
    x.title = 'Fermer (Échap)';
    x.addEventListener('click', close);
    head.append(ht, x);

    const grid = h('div', 'zone-dlg-grid');
    ZONE_TYPES.forEach((t, i) => {
      const b = h('button', 'zone-type');
      b.innerHTML = `<span class="zt-icon">${t.icon}</span><span class="zt-txt"><b></b><small></small></span><kbd>${i + 1}</kbd>`;
      b.querySelector('b').textContent = t.label;
      b.querySelector('small').textContent = t.k === 'explorer' && ctx.ws ? 'Dossier du workspace' : t.desc;
      b.addEventListener('click', () => pick(() => openKind(null, t.k)));
      grid.appendChild(b);
    });

    // Modèles enregistrés (onglet, zone) : des puces cliquables
    const modelSection = (label, list, iconOf, onPick, manage) => {
      const sec = h('div', 'zone-dlg-sec');
      const hd = h('div', 'zone-dlg-sec-head');
      const t = h('span');
      t.textContent = label;
      const m = h('button', 'zone-dlg-link', 'Gérer…');
      m.addEventListener('click', () => { close(); manage(); });
      hd.append(t, m);
      sec.appendChild(hd);
      const box = h('div', 'zone-dlg-models');
      if (!list.length) box.appendChild(h('span', 'zone-dlg-none', 'Aucun pour l\'instant — clic droit sur un onglet ou une zone : « Enregistrer comme modèle ».'));
      for (const md of list) {
        const b = h('button', 'zone-model');
        b.innerHTML = `<span class="zm-ico">${TabModels.iconHtml(iconOf(md))}</span><span class="zm-name"></span>${md.fromWs ? '<span class="zm-ws">workspace</span>' : ''}`;
        b.querySelector('.zm-name').textContent = md.name;
        b.title = md.name;
        b.addEventListener('click', () => pick(() => onPick(md)));
        box.appendChild(b);
      }
      sec.appendChild(box);
      return sec;
    };
    const tabModels = TabModels.all('tab');
    const zoneModels = TabModels.all('zone');
    const models = h('div', 'zone-dlg-modelwrap');
    models.append(
      modelSection('Modèles d\'onglet', tabModels, (m) => m.icon, (m) => TabModels.open(m, null), () => TabModels.openManager(null, 'tab')),
      modelSection('Modèles de zone', zoneModels, (z) => z.icon || '🗂', (z) => openZoneModel(z, null), () => TabModels.openManager(null, 'zone')),
    );

    // Options moins courantes : menus déroulants
    const more = h('div', 'zone-dlg-more');
    const wrap = (list) => list.map((it) => (it && typeof it === 'object' && !it.title
      ? { ...it, ...(it.action ? { action: () => pick(it.action) } : {}), ...(it.submenu ? { submenu: wrap(it.submenu) } : {}) }
      : it));
    const moreBtn = (label, items) => {
      const b = h('button', 'tb-btn', label);
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        const r = b.getBoundingClientRect();
        UI.menu(wrap(items()), r.left, r.bottom + 4);
      });
      return b;
    };
    more.append(
      moreBtn('Autre shell ▾', () => shells.map((sh) => ({ label: sh.label, checked: sh.id === (Settings.data.defaultShell || shells[0]?.id), action: () => openKind(null, 'terminal', { shellId: sh.id }) }))),
      moreBtn('📂 Dossier ▾', () => [
        { label: 'Choisir un dossier…', icon: '📂', action: () => openKind(null, 'explorer-pick') },
        ...allFavorites().map((f) => ({ label: f.name || f.path, icon: '⭐', hint: f.fromWs ? 'workspace' : '', action: () => openKind(null, 'explorer', { root: f.path }) })),
      ]),
    );

    card.append(head, grid, models, more);
    layer.addEventListener('mousedown', (e) => { if (e.target === layer) close(); });
    function onKey(e) {
      if (!layer.isConnected) return;
      const menuOpen = !!document.querySelector('.menu:not(.hidden):not(.robot-picker)');
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); if (menuOpen) UI.closeMenus(); else close(); return; }
      const n = Number(e.key);
      if (!menuOpen && n >= 1 && n <= ZONE_TYPES.length && !e.ctrlKey && !e.altKey && !e.metaKey) { e.preventDefault(); e.stopPropagation(); grid.children[n - 1].click(); }
    }
    document.addEventListener('keydown', onKey, true);
    document.body.appendChild(layer);
    grid.firstChild.focus();
  }

  // ---------- Disposition ----------
  const allParked = h('div', 'all-parked hidden',
    '<div class="ap-title">Tous les robots sont rangés</div><div class="ap-sub">Cliquez sur un robot en haut pour ressortir son espace, ou glissez-le ici.</div><div class="ap-actions empty-actions"></div>');
  spacesEl.appendChild(allParked);
  for (const k of ['terminal', 'browser', 'explorer', 'tests', 'docker', 'services', 'prisma', 'graphify']) {
    const b = h('button', 'tb-btn', `${KIND_INFO[k].icon} ${KIND_INFO[k].label}`);
    b.addEventListener('click', () => openKind(null, k));
    allParked.querySelector('.ap-actions').appendChild(b);
  }

  function renderLayout() {
    // S'assure que tous les espaces visibles sont dans l'arbre
    for (const s of visibleSpaces()) if (!Layout.has(s.id)) Layout.add(s.id);
    for (const id of Layout.leaves()) if (!byId(id) || byId(id).parked || byId(id).screenId !== activeScreenId) Layout.remove(id);
    for (const s of spaces) if (s.parked || s.screenId !== activeScreenId) s.el.remove();
    Layout.render(maximized && !maximized.parked ? maximized.id : null);
    for (const s of spaces) s.el.classList.toggle('max', s === maximized);
    allParked.classList.toggle('hidden', visibleSpaces().length > 0);
    const onScreen = spaces.some((s) => s.screenId === activeScreenId);
    allParked.querySelector('.ap-title').textContent = onScreen ? 'Tous les robots de cet écran sont rangés' : `${curScreen().name} est vide`;
    allParked.querySelector('.ap-actions').classList.toggle('hidden', onScreen);
    requestAnimationFrame(() => visibleSpaces().forEach((s) => resizeTab(s.activeTab)));
  }

  Layout.init(spacesEl, {
    getSpace: byId,
    onChange: (rerender) => { if (rerender) renderLayout(); save(); },
    onDrop: (z) => {
      document.body.classList.remove('dragging-space', 'dragging-tab');
      if (!z) return;
      // Onglet lâché sur un espace : centre = dans cet espace, côté = nouvel espace ancré là
      if (z.mode === 'tab') {
        const t = dragTab;
        if (!t) return;
        const target = byId(z.targetId);
        if (z.side === 'center' && target) return moveTab(t, target);
        if (maximized) maximized = null;
        const ns = createSpace();
        Layout.dock(ns.id, z.targetId, z.side);
        renderLayout();
        renderCrew();
        moveTab(t, ns);
        return;
      }
      const s = byId(z.id);
      if (!s) return;
      if (s.parked) return unparkSpace(s, z);
      if (maximized) maximized = null;
      Layout.dock(z.id, z.targetId, z.side);
      renderLayout();
      setActiveSpace(s, true);
      save();
    },
  });

  // ---------- Glisser-déposer des espaces ----------
  let dragSpace = null;
  const spaceDragType = 'application/x-robotconsole-space';
  const outgoingSpaces = new Map();
  api.onSpaceMoved((token) => {
    const space = outgoingSpaces.get(token);
    if (space) { outgoingSpaces.delete(token); releaseSpace(space); }
  });
  document.addEventListener('dragover', (e) => {
    if (dragSpace || !e.dataTransfer.types.includes(spaceDragType)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  });
  document.addEventListener('drop', async (e) => {
    if (dragSpace || !e.dataTransfer.types.includes(spaceDragType)) return;
    e.preventDefault();
    const group = e.target.closest('.screen-group');
    const screenId = group?.dataset.screenId || activeScreenId;
    try {
      const state = await api.acceptSpaceDrag(e.dataTransfer.getData(spaceDragType));
      if (state) { switchScreen(screenId); receiveSpaces(state); }
      else UI.toast('Déplacez la zone vers une fenêtre du même projet.');
    } catch (err) { UI.toast(err.message, { kind: 'error' }); }
  });
  function makeDragSource(el, space) {
    el.draggable = true;
    el.addEventListener('dragstart', (e) => {
      if (el.isContentEditable) { e.preventDefault(); return; }
      dragSpace = space;
      const token = nid('drag');
      outgoingSpaces.set(token, space);
      e.dataTransfer.setData(spaceDragType, token);
      api.beginSpaceDrag(token, payloadFor([space]));
      hideTip();
      UI.closeMenus();
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', space.name);
      const ghost = space.crewRobot || space.robotEl;
      e.dataTransfer.setDragImage(ghost, ghost.offsetWidth / 2, ghost.offsetHeight / 2);
      setTimeout(() => {
        document.body.classList.add('dragging-space');
        Layout.beginDrag(space.id);
      }, 0);
    });
    el.addEventListener('dragend', (e) => {
      setTimeout(() => { api.endSpaceDrag(); outgoingSpaces.clear(); }, 1000);
      dragSpace = null;
      document.body.classList.remove('dragging-space');
      Layout.endDrag();
      document.querySelectorAll('.drop-before, .drop-after, .drop-park, .drop-screen').forEach((x) => x.classList.remove('drop-before', 'drop-after', 'drop-park', 'drop-screen'));
      // Lâché en dehors de la fenêtre : l'espace sort dans sa propre fenêtre
      const outside = e.screenX < window.screenX || e.screenX > window.screenX + window.outerWidth || e.screenY < window.screenY || e.screenY > window.screenY + window.outerHeight;
      if (e.dataTransfer.dropEffect === 'none' && outside && (e.screenX || e.screenY)) {
        api.dropSpace(payloadFor([space]), e.screenX, e.screenY).then((r) => { if (r) releaseSpace(space); });
      }
    });
  }

  // La barre des robots : réordonner, ou y déposer un espace pour le ranger
  function makeCrewDropTarget(el, space) {
    // Un onglet lâché sur un robot de la barre part dans cet espace
    el.addEventListener('dragover', (e) => {
      if (!dragTab) return;
      e.preventDefault();
      e.stopPropagation();
      Layout.clearZone();
      el.classList.add('drop-tab');
    });
    el.addEventListener('dragleave', () => el.classList.remove('drop-tab'));
    el.addEventListener('drop', (e) => {
      if (!dragTab) return;
      e.preventDefault();
      e.stopPropagation();
      el.classList.remove('drop-tab');
      const t = dragTab;
      Layout.endDrag();
      moveTab(t, space);
    });
    el.addEventListener('dragover', (e) => {
      if (!dragSpace || dragSpace === space) return;
      e.preventDefault();
      e.stopPropagation();
      if (dragSpace.screenId !== space.screenId) { el.classList.add('drop-screen'); return; }
      const r = el.getBoundingClientRect();
      const after = e.clientX > r.left + r.width / 2;
      el.classList.toggle('drop-after', after);
      el.classList.toggle('drop-before', !after);
    });
    el.addEventListener('dragleave', () => el.classList.remove('drop-before', 'drop-after'));
    el.addEventListener('drop', (e) => {
      if (!dragSpace || dragSpace === space) return;
      e.preventDefault();
      e.stopPropagation();
      if (dragSpace.screenId !== space.screenId) {
        Layout.endDrag(); moveSpaceToScreen(dragSpace, space.screenId); return;
      }
      const r = el.getBoundingClientRect();
      const after = e.clientX > r.left + r.width / 2;
      el.classList.remove('drop-before', 'drop-after');
      spaces.splice(spaces.indexOf(dragSpace), 1);
      spaces.splice(spaces.indexOf(space) + (after ? 1 : 0), 0, dragSpace);
      renderCrew();
      save();
    });
  }
  crewEl.addEventListener('dragover', (e) => {
    if (!dragSpace || dragSpace.parked) return;
    e.preventDefault();
    crewEl.classList.add('drop-park');
  });
  crewEl.addEventListener('dragleave', (e) => { if (!crewEl.contains(e.relatedTarget)) crewEl.classList.remove('drop-park'); });
  crewEl.addEventListener('drop', (e) => {
    crewEl.classList.remove('drop-park');
    if (!dragSpace || dragSpace.parked || e.target.closest('.crew-item')) return;
    e.preventDefault();
    parkSpace(dragSpace);
  });
  // Lâcher un robot rangé sur la zone vide
  spacesEl.addEventListener('dragover', (e) => { if (dragSpace?.parked && !visibleSpaces().length) e.preventDefault(); });
  spacesEl.addEventListener('drop', (e) => { if (dragSpace?.parked && !visibleSpaces().length) { e.preventDefault(); unparkSpace(dragSpace); } });

  // ---------- Infobulle instantanée de la barre des robots ----------
  const tip = h('div', 'tip hidden');
  document.body.appendChild(tip);
  function showTip(space) {
    if (dragSpace) return;
    const n = space.tabs.length;
    const kinds = [...new Set(space.tabs.map((t) => KIND_INFO[t.kind]?.label))].join(', ');
    tip.innerHTML = '';
    tip.appendChild(document.createTextNode(space.name));
    const sub = h('small');
    sub.textContent = (space.parked ? 'Rangé · ' : '') + `${n} onglet${n > 1 ? 's' : ''}` + (kinds ? ` · ${kinds}` : '') + (space.parked ? ' · cliquez pour le ressortir' : '');
    tip.appendChild(sub);
    tip.classList.remove('hidden');
    const r = space.crewFace.getBoundingClientRect();
    const w = tip.offsetWidth;
    tip.style.left = `${Math.max(6, Math.min(r.left + r.width / 2 - w / 2, innerWidth - w - 6))}px`;
    tip.style.top = `${r.bottom + 6}px`;
  }
  function hideTip() { tip.classList.add('hidden'); }
  function showTabTip(anchor, t) {
    if (dragSpace || dragTab) return;
    tip.innerHTML = '';
    tip.appendChild(document.createTextNode(t.title));
    const sub = h('small');
    sub.textContent = `${KIND_INFO[t.kind]?.label || t.kind}${t.model ? ` · modèle « ${t.model.name} »` : ''} · ${t.space.name}${t.space.parked ? ' (rangé)' : ''}`;
    tip.appendChild(sub);
    tip.classList.remove('hidden');
    const r = anchor.getBoundingClientRect();
    const w = tip.offsetWidth;
    tip.style.left = `${Math.max(6, Math.min(r.left + r.width / 2 - w / 2, innerWidth - w - 6))}px`;
    tip.style.top = `${r.bottom + 6}px`;
  }

  // ---------- Choix du robot ----------
  // Deux choses distinctes, présentées comme deux cases en haut du panneau :
  //   ① le robot lui-même (son apparence)   ② l'icône posée à côté de lui (ce sur quoi il travaille).
  // Cliquer une case affiche ses choix en dessous ; les robots proposés sont dessinés SANS icône
  // pour qu'on ne confonde jamais les deux.
  const robotPicker = h('div', 'menu robot-picker hidden');
  document.body.appendChild(robotPicker);
  document.addEventListener('mousedown', (e) => { if (!e.target.closest?.('.robot-picker')) robotPicker.classList.add('hidden'); });
  robotPicker.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); robotPicker.classList.add('hidden'); } });

  let toolCat = '';
  let toolQuery = '';
  let pickerPane = 'robot';
  function showRobotPicker(space, anchor, pane) {
    UI.closeMenus();
    if (pane) pickerPane = pane;
    robotPicker.innerHTML = '';

    const plainBot = (seed, traits) => Robot.generate(seed, { traits: { ...(traits || {}), tool: 'none' } });
    // Outil choisi à la main (conservé quand on change de robot)
    const keptTool = () => (space.traits && 'tool' in space.traits ? { tool: space.traits.tool } : null);
    const selectedTool = () => {
      const t = Robot.generate(space.seed, { traits: space.traits }).traits.tool;
      return t === 'auto' ? 'auto' : ToolIcons.get(t)?.id || 'none';
    };
    const toolLabel = (sel) => (sel === 'none' ? 'Aucune' : sel === 'auto' ? 'Auto' : ToolIcons.label(sel));

    // ---- En-tête : les deux cases ----
    const head = h('div', 'rp-head');
    const slotBot = h('button', 'rp-slot rp-slot-bot');
    const slotPlus = h('div', 'rp-plus', '+');
    const slotTool = h('button', 'rp-slot rp-slot-tool');
    head.append(slotBot, slotPlus, slotTool);
    const slot = (el, kicker, art, name, sub) => {
      el.innerHTML = '';
      const a = h('div', 'rp-slot-art');
      a.innerHTML = art;
      const txt = h('div', 'rp-slot-txt');
      const k = h('div', 'rp-slot-kicker'); k.append(h('span', 'rp-num', el === slotBot ? '1' : '2'), kicker); txt.append(k);
      const n = h('div', 'rp-slot-name');
      n.textContent = name;
      txt.appendChild(n);
      if (sub) { const s = h('div', 'rp-slot-sub'); s.textContent = sub; txt.appendChild(s); }
      el.append(a, txt);
    };
    const renderBotSlot = (preview) => {
      const b = preview || plainBot(space.seed, space.traits);
      slot(slotBot, 'Robot', `<div class="robot">${b.svg}</div>`, b.name, preview ? 'aperçu — cliquez pour choisir' : 'son apparence');
    };
    const renderToolSlot = (previewId) => {
      const sel = previewId || selectedTool();
      const shown = sel === 'auto' ? botFor(space).tool : sel;
      const art = shown && shown !== 'none'
        ? `<div class="rp-slot-icon">${ToolIcons.html(shown)}</div>`
        : '<div class="rp-slot-icon is-none">∅</div>';
      const sub = previewId ? 'aperçu — cliquez pour choisir'
        : sel === 'auto' ? `selon l'onglet actif${shown !== 'none' ? ` : ${ToolIcons.label(shown)}` : ''}`
        : sel === 'none' ? 'pas d\'icône à côté' : 'icône à côté du robot';
      slot(slotTool, 'Travaille sur', art, toolLabel(sel), sub);
    };
    slotBot.addEventListener('click', () => setPane('robot'));
    slotTool.addEventListener('click', () => setPane('tool'));
    // Réglages du robot : son de fin et partage (téléphone / tablette)
    const extra = h('div', 'rp-extra');
    const xSound = h('button', 'rp-xbtn');
    const xShare = h('button', 'rp-xbtn');
    extra.append(xSound, xShare);
    xSound.addEventListener('click', () => setPane('sound'));
    xShare.addEventListener('click', () => setPane('share'));
    const renderExtra = () => {
      xSound.innerHTML = '<span class="rp-x-ico">🔔</span><span class="rp-x-txt"><b>Son de fin</b><small></small></span>';
      xSound.querySelector('small').textContent = space.sound ? `${RobotSounds.label(space.sound.id)} · ${space.sound.delay || 5} s` : 'Aucun';
      xShare.innerHTML = '<span class="rp-x-ico">📡</span><span class="rp-x-txt"><b>Partage</b><small></small></span>';
      xShare.querySelector('small').textContent = { off: 'Fermé', read: 'Lecture seule', control: 'Contrôle' }[space.remote] + (space.remote !== 'off' && !remoteOn ? ' · serveur arrêté' : '');
    };

    const body = h('div', 'rp-body');
    const paneBot = h('div', 'rp-pane rp-pane-bot');
    const paneTool = h('div', 'rp-pane rp-pane-tool');
    const paneSound = h('div', 'rp-pane rp-pane-sound');
    const paneShare = h('div', 'rp-pane rp-pane-share');
    body.append(paneBot, paneTool, paneSound, paneShare);

    // ---- 🔔 Son quand le robot a fini de travailler ----
    const renderSound = () => {
      paneSound.innerHTML = '';
      paneSound.appendChild(h('div', 'rp-help', 'Son joué quand les terminaux de cet espace ont fini de travailler (après un moment de silence).'));
      const setSound = (patch) => {
        space.sound = patch ? { delay: 5, ...(space.sound || {}), ...patch } : null;
        if (!space.sound) { clearTimeout(space.quietTimer); space.activeSince = null; }
        updateSoundBadge(space);
        save();
        renderSound();
        renderExtra();
      };
      const list = h('div', 'rp-choices');
      const choice = (label, on, fn) => { const b = h('button', 'tb-btn' + (on ? ' active' : '')); b.textContent = label; b.addEventListener('click', fn); list.appendChild(b); };
      choice('∅ Aucun', !space.sound, () => setSound(null));
      for (const [id, label] of RobotSounds.LIST) choice(label, space.sound?.id === id, () => { setSound({ id }); playSound(id); });
      paneSound.appendChild(list);
      if (!space.sound) return;
      const row = h('div', 'rp-row');
      row.appendChild(h('span', 'rp-row-lbl', 'Silence avant le son'));
      for (const d of RobotSounds.DELAYS) {
        const b = h('button', 'rp-cat' + ((space.sound.delay || 5) === d ? ' on' : ''), `${d} s`);
        b.addEventListener('click', () => setSound({ delay: d }));
        row.appendChild(b);
      }
      paneSound.appendChild(row);
      const play = h('button', 'tb-btn', '▶ Écouter');
      play.addEventListener('click', () => playSound(space.sound.id));
      const f = h('div', 'rp-pane-foot');
      f.appendChild(play);
      paneSound.appendChild(f);
    };

    // ---- 📡 Partage : ouvrir le robot au téléphone / à la tablette, avec son propre QR code ----
    let shareIp = null;
    const renderShare = async () => {
      const seq = (paneShare.seq = (paneShare.seq || 0) + 1);
      paneShare.innerHTML = '';
      paneShare.appendChild(h('div', 'rp-help', 'Rendez les onglets de ce robot accessibles depuis un téléphone ou une tablette (réseau local ou VPN).'));
      const modes = h('div', 'rp-choices');
      for (const [m, label, tip] of [
        ['off', '∅ Fermé', 'Invisible à distance'],
        ['read', '👁 Lecture seule', 'Voir les terminaux et les onglets, sans rien modifier'],
        ['control', '🎮 Contrôle', 'Taper dans les terminaux et lancer des actions (tests, services, Docker…)'],
      ]) {
        const b = h('button', 'tb-btn' + (space.remote === m ? ' active' : ''), label);
        b.title = tip;
        b.addEventListener('click', () => { setRemote(space, m); renderShare(); renderExtra(); });
        modes.appendChild(b);
      }
      paneShare.appendChild(modes);
      if (space.remote === 'off') return;
      const info = await api.remoteRobotInfo(space.rid).catch(() => null);
      if (seq !== paneShare.seq) return;
      if (!info?.running) {
        const box = h('div', 'rp-share-off');
        const msg = h('div', '');
        msg.textContent = info?.error || 'Le serveur d\'accès à distance est arrêté.';
        box.appendChild(msg);
        const on = h('button', 'tb-btn primary', '▶ Activer le serveur');
        on.addEventListener('click', async () => { await api.remoteSet({ enabled: true }); await refreshRemoteState(); renderShare(); renderExtra(); });
        const set = h('button', 'tb-btn', '⚙ Réglages…');
        set.addEventListener('click', () => { robotPicker.classList.add('hidden'); Settings.open('remote'); });
        const acts = h('div', 'rp-choices');
        acts.append(on, set);
        box.appendChild(acts);
        paneShare.appendChild(box);
        return;
      }
      if (!info.urls.length) { paneShare.appendChild(h('div', 'rp-help', 'Aucune adresse réseau détectée.')); return; }
      const u = info.urls.find((x) => x.address === shareIp) || info.urls[0];
      const box = h('div', 'rp-share');
      const qr = h('div', 'rp-qr');
      qr.innerHTML = u.qr || '';
      const side = h('div', 'rp-share-side');
      const help = h('div', 'rp-help');
      help.textContent = `Scannez pour ouvrir directement « ${space.name} »${space.remote === 'control' ? ' en contrôle' : ' en lecture seule'}.`;
      side.appendChild(help);
      if (info.urls.length > 1) {
        const sel = h('select', 'set-input small');
        for (const x of info.urls) { const o = h('option'); o.value = x.address; o.textContent = `${x.address} · ${/^100\./.test(x.address) ? 'VPN' : x.name}`; sel.appendChild(o); }
        sel.value = u.address;
        sel.addEventListener('change', () => { shareIp = sel.value; renderShare(); });
        side.appendChild(sel);
      } else { const c = h('code', 'rp-addr'); c.textContent = `${u.address}:${info.port}`; side.appendChild(c); }
      const copy = h('button', 'tb-btn', '⧉ Copier le lien');
      copy.title = 'Le lien contient le jeton secret : ne le partagez pas';
      copy.addEventListener('click', () => { api.writeClipboard(u.url); UI.toast('Lien copié'); });
      side.appendChild(copy);
      box.append(qr, side);
      paneShare.appendChild(box);
    };

    const foot = h('div', 'rp-foot');
    const studio = h('button', 'tb-btn', '🛠 Atelier…');
    studio.title = 'Personnaliser chaque trait du robot (tête, yeux, couleurs…)';
    studio.addEventListener('click', () => { robotPicker.classList.add('hidden'); spaceStudio(space); });
    const park = h('button', 'tb-btn', '⤓ Ranger l\'espace');
    park.addEventListener('click', () => { robotPicker.classList.add('hidden'); parkSpace(space); });
    const done = h('button', 'tb-btn primary', 'Terminé');
    done.addEventListener('click', () => robotPicker.classList.add('hidden'));
    foot.append(studio, park, h('span', 'rp-spacer'), done);

    robotPicker.append(head, extra, body, foot);

    const setPane = (p) => {
      pickerPane = p;
      slotBot.classList.toggle('on', p === 'robot');
      slotTool.classList.toggle('on', p === 'tool');
      xSound.classList.toggle('on', p === 'sound');
      xShare.classList.toggle('on', p === 'share');
      paneBot.classList.toggle('hidden', p !== 'robot');
      paneTool.classList.toggle('hidden', p !== 'tool');
      paneSound.classList.toggle('hidden', p !== 'sound');
      paneShare.classList.toggle('hidden', p !== 'share');
      if (p === 'sound') renderSound();
      if (p === 'share') renderShare();
      if (p === 'tool') setTimeout(() => search.focus(), 0);
    };

    // ---- ① Robots (dessinés sans icône) ----
    const botHelp = h('div', 'rp-help', 'Choisissez l\'apparence du robot. L\'icône à côté (②) est conservée.');
    const grid = h('div', 'rp-grid');
    const more = h('button', 'tb-btn', '🎲 Autres robots');
    more.addEventListener('click', () => fillBots());
    const botFoot = h('div', 'rp-pane-foot');
    botFoot.appendChild(more);
    paneBot.append(botHelp, grid, botFoot);
    const fillBots = () => {
      grid.innerHTML = '';
      const choices = [{ seed: space.seed, traits: space.traits, current: true },
        ...Array.from({ length: 11 }, () => ({ seed: Robot.randomSeed(), traits: null, current: false }))];
      for (const c of choices) {
        const bot = plainBot(c.seed, c.traits);
        const cell = h('button', 'rp-cell' + (c.current ? ' current' : ''));
        cell.innerHTML = `<div class="robot">${bot.svg}</div>`;
        const name = h('span', 'rp-name');
        name.textContent = c.current ? `${bot.name} (actuel)` : bot.name;
        cell.appendChild(name);
        cell.addEventListener('mouseenter', () => renderBotSlot(bot));
        cell.addEventListener('mouseleave', () => renderBotSlot());
        cell.addEventListener('click', () => {
          if (c.current) { wave(space); return; }
          space.seed = c.seed;
          space.traits = keptTool();
          space.bot = botFor(space);
          applyBot(space);
          renderCrew();
          wave(space);
          say(space, `Salut, je suis ${bot.name} !`);
          save();
          fillBots();
          renderBotSlot();
          renderToolSlot();
        });
        grid.appendChild(cell);
      }
    };

    // ---- ② Icône à côté du robot ----
    const setTool = (id) => {
      const base = Robot.traitsFor(space.seed).tool;
      const tr = { ...(space.traits || {}) };
      if (id === base || (ToolIcons.get(base) && ToolIcons.get(base).id === id)) delete tr.tool; else tr.tool = id;
      space.traits = Object.keys(tr).length ? tr : null;
      space.bot = botFor(space);
      applyBot(space);
      renderCrew();
      save();
      renderToolSlot();
      renderQuick();
      for (const b of toolGrid.querySelectorAll('.rp-tool')) b.classList.toggle('on', b.dataset.id === selectedTool());
    };
    const toolHelp = h('div', 'rp-help', 'L\'icône affichée à côté du robot : la techno ou le sujet sur lequel travaille cet espace.');
    const quick = h('div', 'rp-tool-quick');
    const renderQuick = () => {
      const sel = selectedTool();
      quick.innerHTML = '';
      for (const [id, lbl, tip] of [
        ['none', '∅ Aucune', 'Pas d\'icône à côté du robot'],
        ['auto', '✨ Auto', 'Change selon le type d\'onglet actif (terminal, tests, Docker…)'],
        ['random', '🎲 Au hasard', 'Une icône au hasard dans la catégorie affichée'],
      ]) {
        const b = h('button', 'tb-btn' + (sel === id ? ' active' : ''), lbl);
        b.title = tip;
        b.addEventListener('click', () => {
          if (id !== 'random') return setTool(id);
          const list = ToolIcons.search(toolQuery, toolCat);
          if (list.length) setTool(list[Math.floor(Math.random() * list.length)].id);
        });
        quick.appendChild(b);
      }
    };
    const search = h('input', 'set-input rp-tool-search');
    search.placeholder = `Rechercher parmi ${ToolIcons.all.length} icônes (react, docker, claude…)`;
    search.value = toolQuery;
    search.addEventListener('keydown', (e) => { if (e.key !== 'Escape') e.stopPropagation(); });
    search.addEventListener('input', () => { toolQuery = search.value; renderToolGrid(); });
    const cats = h('div', 'rp-tool-cats');
    const renderCats = () => {
      cats.innerHTML = '';
      for (const c of [{ id: '', label: 'Tout', count: ToolIcons.all.length }, ...ToolIcons.cats]) {
        const b = h('button', 'rp-cat' + (toolCat === c.id ? ' on' : ''));
        b.textContent = c.label;
        b.title = `${c.count} icônes`;
        b.addEventListener('click', () => { toolCat = c.id; renderCats(); renderToolGrid(); });
        cats.appendChild(b);
      }
    };
    const toolGrid = h('div', 'rp-tool-grid');
    toolGrid.addEventListener('mouseleave', () => renderToolSlot());
    const renderToolGrid = () => {
      const sel = selectedTool();
      const list = ToolIcons.search(toolQuery, toolCat);
      toolGrid.innerHTML = '';
      toolGrid.scrollTop = 0;
      if (!list.length) { toolGrid.appendChild(h('div', 'rp-tool-empty', 'Aucune icône ne correspond.')); return; }
      const frag = document.createDocumentFragment();
      for (const it of list) {
        const b = h('button', 'rp-tool' + (it.id === sel ? ' on' : ''));
        b.dataset.id = it.id;
        b.title = it.label;
        b.innerHTML = ToolIcons.html(it.id);
        b.addEventListener('mouseenter', () => renderToolSlot(it.id));
        b.addEventListener('click', () => setTool(it.id));
        frag.appendChild(b);
      }
      toolGrid.appendChild(frag);
    };
    paneTool.append(toolHelp, quick, search, cats, toolGrid);

    renderBotSlot();
    renderToolSlot();
    renderExtra();
    fillBots();
    renderQuick();
    renderCats();
    renderToolGrid();
    setPane(pickerPane);

    robotPicker.classList.remove('hidden');
    const r = anchor.getBoundingClientRect();
    robotPicker.style.left = `${Math.max(6, Math.min(r.left, innerWidth - robotPicker.offsetWidth - 8))}px`;
    robotPicker.style.top = `${Math.max(6, Math.min(r.bottom + 6, innerHeight - robotPicker.offsetHeight - 8))}px`;
  }

  // ---------- Onglets ----------
  function shellLabel(id) { return shells.find((s) => s.id === id)?.label || 'Console'; }
  function defaultShell(space) { return space.lastShell || Settings.data.defaultShell || shells[0]?.id; }

  function openTab(space, spec = {}, opts = {}) {
    if (typeof spec === 'string') spec = { kind: 'terminal', shellId: spec };
    spec = { kind: 'terminal', ...spec };
    if (spec.kind === 'terminal') {
      spec.shellId = spec.shellId || defaultShell(space);
      space.lastShell = spec.shellId;
    }
    const kind = TabKinds[spec.kind];
    if (!kind) return null;
    const tab = {
      id: nid('t'), kind: spec.kind, space,
      title: opts.title || kind.defaultTitle(spec),
      customTitle: !!opts.title,
      born: Date.now(),
      model: spec.model && typeof spec.model === 'object' ? spec.model : null, // modèle d'onglet d'origine : { id, icon, name }
      icon: spec.icon || null, // icône choisie à la main (prioritaire)
    };

    const tabEl = h('div', 'tab tab-' + spec.kind + (tab.model ? ' from-model' : ''));
    const icon = h('span', 'tab-icon', tabIconHtml(tab));
    if (tab.model) icon.title = `Modèle : ${tab.model.name}`;
    const dot = h('span', 'dot');
    const title = h('span', 'title');
    title.textContent = tab.title;
    const close = h('button', 'close', '✕');
    close.title = "Fermer l'onglet (Ctrl+Maj+W)";
    tabEl.append(icon, title, dot, close);
    tabEl.addEventListener('mousedown', (e) => { if (e.button === 0) activateTab(tab, true); });
    tabEl.addEventListener('auxclick', (e) => { if (e.button === 1) closeTab(tab); });
    tabEl.addEventListener('contextmenu', (e) => { e.preventDefault(); UI.menu(tabMenuItems(tab, icon), e.clientX, e.clientY); });
    close.addEventListener('mousedown', (e) => e.stopPropagation());
    close.addEventListener('click', () => closeTab(tab));
    title.addEventListener('dblclick', () => renameTab(tab));
    makeTabDraggable(tab, tabEl);
    space.tabsEl.appendChild(tabEl);

    const pane = h('div', 'tab-pane');
    space.host.appendChild(pane);
    Object.assign(tab, { el: tabEl, titleEl: title, pane, spec });

    space.tabs.push(tab);
    updateEmpty(space);
    activateTab(tab, !restoring && space === activeSpace);
    kind.mount(tab, spec);
    tab.mounted = true;
    renderCrewTabs(space);
    save();
    return tab;
  }

  // ---------- Icônes d'onglet (type ou modèle) ----------
  const KIND_TEXT = { terminal: '>_', explorer: '📁', editor: '✎', tests: '🧪', docker: '🐳', services: '🛰', prisma: '◆', graphify: '🕸' };
  function tabIconText(tab) { return tab.icon || tab.model?.icon || KIND_TEXT[tab.kind] || '•'; }
  function tabIconHtml(tab) {
    if (tab.icon) return TabModels.iconHtml(tab.icon);
    if (tab.model?.icon) return TabModels.iconHtml(tab.model.icon);
    return TabKinds[tab.kind]?.icon || '';
  }

  // Icônes des onglets dans la barre des robots, à droite de chaque robot
  const crewLastClick = { tab: null, at: 0 };
  function renderCrewTabs(space) {
    const box = space.crewTabs;
    if (!box) return;
    box.innerHTML = '';
    const MAX = 6;
    space.tabs.slice(0, MAX).forEach((t) => {
      const chip = h('button', 'crew-tab' + (t === space.activeTab ? ' active' : '') + (t.el.classList.contains('unread') ? ' unread' : '') + (t.el.dataset.badge ? ' failing' : ''), tabIconHtml(t));
      chip.addEventListener('click', (e) => {
        e.stopPropagation();
        hideTip();
        // Double-clic (la puce est redessinée entre les deux clics) : ferme l'onglet
        const now = Date.now();
        if (crewLastClick.tab === t && now - crewLastClick.at < 400) { crewLastClick.tab = null; closeTab(t); return; }
        crewLastClick.tab = t; crewLastClick.at = now;
        revealTab(t);
      });
      chip.addEventListener('dblclick', (e) => e.stopPropagation());
      chip.addEventListener('contextmenu', (e) => { e.preventDefault(); e.stopPropagation(); hideTip(); UI.menu(tabMenuItems(t, chip), e.clientX, e.clientY); });
      chip.addEventListener('mouseenter', () => showTabTip(chip, t));
      chip.addEventListener('mouseleave', hideTip);
      box.appendChild(chip);
    });
    if (space.tabs.length > MAX) {
      const more = h('button', 'crew-tab more', `+${space.tabs.length - MAX}`);
      more.addEventListener('click', (e) => { e.stopPropagation(); UI.menu(space.tabs.slice(MAX).map((t) => ({ label: t.title, icon: tabIconText(t), action: () => revealTab(t) })), more); });
      box.appendChild(more);
    }
  }

  // Affiche un onglet depuis la barre des robots : son écran, puis sa zone (ressortie, agrandie si besoin), puis l'onglet
  function revealTab(t) {
    const space = t.space;
    const moved = space.screenId !== activeScreenId || space.parked || activeSpace !== space;
    ensureScreen(space); // change d'écran AVANT de toucher à l'agrandissement (mémorisé par écran)
    if (space.parked) unparkSpace(space);
    if (maximized && maximized !== space) { maximized = space; renderLayout(); }
    setActiveSpace(space, false);
    activateTab(t, true);
    if (moved) wave(space);
  }

  // ---------- Défilement de la barre d'onglets ----------
  function updateTabsOverflow(space) {
    const el = space.tabsEl;
    const over = el.scrollWidth > el.clientWidth + 2;
    space.tabsWrap.classList.toggle('overflow', over);
    space.tabsWrap.classList.toggle('can-left', over && el.scrollLeft > 2);
    space.tabsWrap.classList.toggle('can-right', over && el.scrollLeft + el.clientWidth < el.scrollWidth - 2);
  }

  // ---------- Glisser-déposer des onglets ----------
  let dragTab = null;
  function makeTabDraggable(tab, el) {
    el.draggable = true;
    el.addEventListener('dragstart', (e) => {
      if (tab.titleEl.isContentEditable) { e.preventDefault(); return; }
      dragTab = tab;
      hideTip();
      UI.closeMenus();
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', tab.title);
      el.classList.add('dragging');
      setTimeout(() => {
        document.body.classList.add('dragging-tab');
        Layout.beginDrag(tab.space.id, { mode: 'tab', label: tab.title, icon: tabIconHtml(tab) });
      }, 0);
    });
    el.addEventListener('dragend', () => {
      el.classList.remove('dragging');
      dragTab = null;
      document.body.classList.remove('dragging-tab');
      Layout.endDrag();
      clearTabDropMarks();
    });
  }
  function clearTabDropMarks() {
    document.querySelectorAll('.tab.drop-left, .tab.drop-right, .tabs.drop-end, .crew-item.drop-tab').forEach((x) => x.classList.remove('drop-left', 'drop-right', 'drop-end', 'drop-tab'));
  }
  // Index d'insertion selon la position du pointeur dans la barre d'onglets
  function tabInsertIndex(space, x) {
    const tabs = space.tabs.filter((t) => t !== dragTab);
    for (let i = 0; i < tabs.length; i++) {
      const r = tabs[i].el.getBoundingClientRect();
      if (x < r.left + r.width / 2) return { index: i, el: tabs[i].el, side: 'left' };
    }
    return { index: tabs.length, el: tabs[tabs.length - 1]?.el, side: 'right' };
  }
  function makeTabDropZone(space) {
    const bar = space.tabsWrap;
    bar.addEventListener('dragover', (e) => {
      if (!dragTab) return;
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = 'move';
      Layout.clearZone();
      clearTabDropMarks();
      const pos = tabInsertIndex(space, e.clientX);
      if (pos.el) pos.el.classList.add(pos.side === 'left' ? 'drop-left' : 'drop-right');
      else space.tabsEl.classList.add('drop-end');
      // Défile automatiquement près des bords
      const r = space.tabsEl.getBoundingClientRect();
      if (e.clientX < r.left + 30) space.tabsEl.scrollLeft -= 12;
      if (e.clientX > r.right - 30) space.tabsEl.scrollLeft += 12;
    });
    bar.addEventListener('drop', (e) => {
      if (!dragTab) return;
      e.preventDefault();
      e.stopPropagation();
      const pos = tabInsertIndex(space, e.clientX);
      const t = dragTab;
      clearTabDropMarks();
      Layout.endDrag();
      moveTab(t, space, pos.index);
    });
  }

  function fillEmpty(space) {
    space.emptyKinds.innerHTML = '';
    for (const k of ['terminal', 'browser', 'explorer', 'tests', 'docker', 'services', 'prisma', 'graphify']) {
      const b = h('button', 'tb-btn', `${KIND_INFO[k].icon} ${KIND_INFO[k].label}`);
      b.addEventListener('click', () => openKind(space, k));
      space.emptyKinds.appendChild(b);
    }
    space.emptyModels.innerHTML = '';
    const models = TabModels.all();
    if (models.length) space.emptyModels.appendChild(h('div', 'em-title', 'Modèles d\'onglet'));
    const row = h('div', 'empty-actions');
    for (const m of models.slice(0, 10)) {
      const b = h('button', 'tb-btn model-btn', `${TabModels.iconHtml(m.icon)} <span>${esc(m.name)}</span>`);
      b.title = `${TabModels.KINDS[m.kind || 'terminal'].label}${m.dir ? ' · ' + m.dir : ''}${m.commands ? '\n' + m.commands : ''}`;
      b.addEventListener('click', () => TabModels.open(m, space));
      row.appendChild(b);
    }
    const manage = h('button', 'tb-btn ghost-btn', models.length ? '🧩 Gérer…' : '🧩 Créer un modèle d\'onglet…');
    manage.addEventListener('click', () => TabModels.openManager());
    row.appendChild(manage);
    space.emptyModels.appendChild(row);
    const zones = TabModels.all('zone');
    if (zones.length) {
      space.emptyModels.appendChild(h('div', 'em-title', 'Modèles de zone'));
      const zr = h('div', 'empty-actions');
      for (const z of zones.slice(0, 10)) {
        const b = h('button', 'tb-btn model-btn', `${TabModels.iconHtml(z.icon || '🗂')} <span>${esc(z.name)}</span>`);
        b.title = `${TabModels.summary('zone', z)}\n${(z.tabs || []).map((t) => '· ' + (t.name || TabModels.KINDS[t.kind || 'terminal'].label)).join('\n')}`;
        b.addEventListener('click', () => openZoneModel(z, space));
        zr.appendChild(b);
      }
      space.emptyModels.appendChild(zr);
    }
  }

  function renameTab(tab) {
    editInline(tab.titleEl, (v) => {
      tab.customTitle = !!v;
      tab.title = v || tab.autoTitle || kindOf(tab).defaultTitle(tab.spec || {});
      tab.titleEl.textContent = tab.title;
      save();
    });
  }

  // Change l'icône (emoji) d'un onglet ; « aucune » revient à l'icône par défaut (type ou modèle)
  function changeTabIcon(tab, anchor) {
    const a = anchor?.isConnected ? anchor : tab.el.querySelector('.tab-icon') || tab.el;
    TabModels.pickIcon(a, (ic) => {
      tab.icon = ic || null;
      const el = tab.el.querySelector('.tab-icon');
      if (el) el.innerHTML = tabIconHtml(tab);
      renderCrewTabs(tab.space);
      save();
    }, true);
  }

  function tabMenuItems(tab, anchor) {
    const others = spaces.filter((s) => s !== tab.space);
    return [
      { title: tab.title },
      { label: 'Renommer…', icon: '✎', action: () => renameTab(tab) },
      { label: 'Changer l\'icône…', icon: tabIconHtml(tab), action: () => changeTabIcon(tab, anchor) },
      ...(tab.icon ? [{ label: 'Icône par défaut', icon: '↺', action: () => { tab.icon = null; const el = tab.el.querySelector('.tab-icon'); if (el) el.innerHTML = tabIconHtml(tab); renderCrewTabs(tab.space); save(); } }] : []),
      { label: 'Dupliquer', icon: '⧉', disabled: !['terminal', 'explorer', 'tests', 'docker', 'services', 'prisma', 'graphify'].includes(tab.kind), action: () => openTab(tab.space, { kind: tab.kind, ...kindOf(tab).serialize(tab), sessionId: undefined }) },
      { label: 'Déplacer vers', icon: '↦', submenu: [
        ...others.map((s) => ({ label: s.name + (s.parked ? ' (rangé)' : ''), action: () => moveTab(tab, s) })),
        others.length ? '-' : null,
        { label: 'Nouvel espace', icon: '＋', action: () => { const s = createSpace(); placeSpace(s, tab.space.id); moveTab(tab, s); } },
      ] },
      '-',
      tab.kind === 'editor' ? { label: 'Enregistrer comme modèle d\'onglet', icon: '🧩', disabled: true } : TabModels.saveMenuItem('tab', () => TabModels.tabToModel(tab)),
      '-',
      { label: 'Fermer', icon: '✕', hint: 'Ctrl+Maj+W', action: () => closeTab(tab) },
      { label: 'Fermer les autres onglets', disabled: tab.space.tabs.length < 2, action: () => tab.space.tabs.filter((t) => t !== tab).forEach((t) => closeTab(t)) },
    ];
  }

  // Déplace un onglet (et son contenu vivant) vers un espace, à une position donnée
  function moveTab(tab, target, index) {
    const from = tab.space;
    const i = from.tabs.indexOf(tab);
    if (from === target) {
      // Réordonne dans le même espace
      if (index == null) return;
      from.tabs.splice(i, 1);
      from.tabs.splice(Math.min(index, from.tabs.length), 0, tab);
      from.tabs.forEach((t) => from.tabsEl.appendChild(t.el));
      renderCrewTabs(from);
      save();
      return;
    }
    from.tabs.splice(i, 1);
    if (from.activeTab === tab) {
      from.activeTab = null;
      const next = from.tabs[Math.min(i, from.tabs.length - 1)];
      if (next) activateTab(next, false);
    }
    updateEmpty(from);
    renderCrewTabs(from);
    tab.space = target;
    const at = index == null ? target.tabs.length : Math.min(index, target.tabs.length);
    target.tabs.splice(at, 0, tab);
    target.tabs.forEach((t) => target.tabsEl.appendChild(t.el));
    target.host.appendChild(tab.pane);
    kindOf(tab).applyTheme?.(tab);
    updateEmpty(target);
    if (target.parked) unparkSpace(target);
    activateTab(tab, true);
    say(target, `Bienvenue, ${tab.title} !`, 1500);
    save();
  }

  async function openExplorer(space, root) {
    if (!root) root = ctx.ws?.root || await api.pickFolder();
    if (root) return openTab(space, { kind: 'explorer', root });
  }

  // Ouvre un fichier dans un onglet éditeur (réutilise l'onglet s'il est déjà ouvert)
  function openFile(space, file, line) {
    for (const s of spaces) {
      const t = s.tabs.find((x) => x.kind === 'editor' && x.file?.toLowerCase() === file.toLowerCase());
      if (t) {
        if (s.parked) unparkSpace(s);
        activateTab(t, true);
        if (line) setTimeout(() => TabKinds.editor.reveal(t, line), 50);
        return t;
      }
    }
    return openTab(space || ensureSpace(), { kind: 'editor', file, line });
  }

  function ensureSpace() {
    if (activeSpace) return activeSpace;
    const s = createSpace();
    placeSpace(s);
    return s;
  }

  function setAutoTitle(tab, short, full) {
    tab.autoTitle = short;
    if (!tab.customTitle) { tab.title = short; tab.titleEl.textContent = short; }
    tab.el.title = full || short;
  }

  function markUnread(tab) {
    if (tab.space.activeTab !== tab && Date.now() - tab.born > 2000 && !tab.el.classList.contains('unread')) { tab.el.classList.add('unread'); renderCrewTabs(tab.space); }
  }

  function activateTab(tab, focus) {
    const space = tab.space;
    if (focus && !restoring && space.screenId !== activeScreenId) switchScreen(space.screenId);
    for (const t of space.tabs) {
      const on = t === tab;
      t.el.classList.toggle('active', on);
      t.pane.classList.toggle('active', on);
    }
    space.activeTab = tab;
    tab.el.classList.remove('unread');
    tab.el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    renderCrewTabs(space);
    updateTabsOverflow(space);
    if (space.bot?.traits?.tool === 'auto') {
      const nb = botFor(space);
      if (nb.tool !== space.bot.tool) { space.bot = nb; applyBot(space); }
    }
    requestAnimationFrame(() => {
      if (!tab.space.tabs.includes(tab)) return;
      kindOf(tab).activate(tab);
      if (focus) { setActiveSpace(tab.space, false); kindOf(tab).focus(tab); }
    });
    save();
  }

  async function closeTab(tab, silent) {
    if (!silent && kindOf(tab).canClose && !(await kindOf(tab).canClose(tab))) return;
    const space = tab.space;
    kindOf(tab).dispose(tab);
    tab.el.remove();
    tab.pane.remove();
    const i = space.tabs.indexOf(tab);
    if (i < 0) return;
    space.tabs.splice(i, 1);
    renderCrewTabs(space);
    if (silent) { updateEmpty(space); return; }
    if (space.activeTab === tab) {
      space.activeTab = null;
      const next = space.tabs[Math.min(i, space.tabs.length - 1)];
      if (next) activateTab(next, true);
    }
    updateEmpty(space);
    if (!space.tabs.length) say(space, 'Plus rien à faire… je m\'ennuie !');
    save();
  }

  function resizeTab(tab) { if (tab) kindOf(tab).resize(tab); }
  function updateEmpty(space) { space.empty.classList.toggle('hidden', space.tabs.length > 0); }

  // ---------- Types d'onglets / d'espaces ----------
  function allFavorites() {
    const favs = [...(Settings.data.explorerFavorites || [])];
    for (const f of ctx.ws?.favorites || []) favs.push({ ...f, fromWs: true });
    return favs;
  }

  // Racine du projet pour les tests / Docker / services : le workspace, sinon un dossier choisi
  async function projectRoot() {
    if (ctx.ws) return ctx.ws.root;
    const p = await api.pickFolder();
    return p;
  }

  // Ouvre un type dans un espace (ou dans un nouvel espace si space est null)
  // Complète une spécification d'onglet (dossier demandé si besoin). memo : réutilise le dossier choisi
  async function resolveSpec(spec, memo = {}) {
    spec = { ...spec };
    const ask = async (fn) => { if (!('root' in memo)) memo.root = await fn(); return memo.root; };
    if (spec.kind === 'explorer' && !spec.root) { spec.root = ctx.ws?.root || await ask(() => api.pickFolder()); if (!spec.root) return null; }
    if (spec.kind === 'explorer-pick') { spec = { kind: 'explorer', root: await api.pickFolder(ctx.ws?.root) }; if (!spec.root) return null; }
    if (['tests', 'docker', 'services', 'prisma', 'graphify'].includes(spec.kind) && !spec.root) { spec.root = await ask(projectRoot); if (!spec.root) return null; }
    return spec;
  }

  async function openKind(space, kind, extra = {}) {
    const spec = await resolveSpec({ kind, ...extra });
    if (!spec) return;
    let s = space;
    if (!s) {
      if (maximized) maximized = null;
      s = createSpace();
      placeSpace(s);
    }
    const { title, ...rest } = spec;
    const tab = openTab(s, rest, { title });
    setActiveSpace(s, true);
    if (!space) setTimeout(() => say(s, rest.model ? `${rest.model.name} : c'est parti !` : `Bonjour, je suis ${s.bot.name} !`), 150);
    return tab;
  }

  // ---------- Modèles de zone et d'écran ----------
  const tabTitle = (tm) => (tm.autoTitle || !tm.name ? undefined : tm.name);
  async function resolveZone(zm, memo) {
    const out = [];
    for (const tm of zm.tabs || []) { const spec = await resolveSpec(TabModels.specFor(tm), memo); if (spec) out.push({ spec, title: tabTitle(tm) }); }
    return out;
  }
  function fillSpace(sp, zm, specs, focus) {
    const opened = specs.map(({ spec, title }) => openTab(sp, spec, { title })).filter(Boolean);
    const at = opened[zm.activeTab] || opened[0];
    if (at) activateTab(at, focus);
    return opened;
  }
  // Ouvre un modèle de zone : nouvel espace, ou ajoute ses onglets à « space »
  async function openZoneModel(zm, space) {
    const specs = await resolveZone(zm, {});
    let s = space;
    if (!s) {
      if (maximized) maximized = null;
      s = createSpace({ name: zm.name || undefined, seed: zm.seed, traits: zm.traits, icon: zm.icon });
      placeSpace(s);
    }
    fillSpace(s, zm, specs, true);
    setActiveSpace(s, true);
    renderCrew();
    if (!space) { wave(s); setTimeout(() => say(s, `${zm.name || s.name} : c'est parti !`), 150); }
    save();
    return s;
  }
  // Ouvre un modèle d'écran : nouvel écran avec ses zones et sa disposition
  async function openScreenModel(sm) {
    const memo = {};
    const resolved = [];
    for (const z of sm.zones || []) resolved.push({ z, specs: await resolveZone(z, memo) });
    const sc = { id: `sc${++screenSeq}-${Date.now().toString(36)}`, name: sm.name || `Écran ${screens.length + 1}`, color: sm.color || null, tree: null, maximizedId: null };
    screens.push(sc);
    switchScreen(sc.id);
    maximized = null;
    const made = resolved.map(({ z, specs }) => {
      const sp = createSpace({ name: z.name || undefined, seed: z.seed, traits: z.traits, icon: z.icon, screenId: sc.id });
      fillSpace(sp, z, specs, false);
      return sp;
    });
    Layout.set(Layout.deserialize(sm.layout, (i) => made[i]?.id));
    renderLayout();
    renderCrew();
    if (made[0]) { setActiveSpace(made[0], true); wave(made[0]); }
    save();
    return sc;
  }
  // Instantanés de l'état actuel (pour créer un modèle)
  function snapshotSpace(sp) {
    const tabs = sp.tabs.filter((t) => t.kind !== 'editor');
    return { name: sp.name, seed: sp.seed, traits: sp.traits || undefined, icon: sp.icon || undefined, activeTab: Math.max(0, tabs.indexOf(sp.activeTab)), tabs: tabs.map(TabModels.tabToModel) };
  }
  function snapshotScreen(sc) {
    syncScreen();
    const list = spaces.filter((sp) => sp.screenId === sc.id && !sp.parked);
    return { name: sc.name, color: sc.color || undefined, zones: list.map(snapshotSpace), layout: Layout.serialize(sc.tree, (id) => list.findIndex((s) => s.id === id)) };
  }

  function kindItems(space) {
    const favs = allFavorites();
    const hint = (k) => (space ? '' : k);
    const models = TabModels.all();
    const zoneCount = TabModels.all('zone').length;
    return [
      { title: space ? `Ajouter à ${space.name}` : 'Nouvel espace' },
      { label: 'Navigateur', icon: '🌐', action: () => openKind(space, 'browser') },
      { label: 'Terminal', icon: KIND_INFO.terminal.icon, hint: space ? 'Ctrl+Maj+T' : 'Ctrl+Maj+N', action: () => openKind(space, 'terminal') },
      { label: 'Terminal (choisir le shell)', icon: '', submenu: shells.map((sh) => ({ label: sh.label, checked: sh.id === (Settings.data.defaultShell || shells[0]?.id), action: () => openKind(space, 'terminal', { shellId: sh.id }) })) },
      { label: 'Depuis un modèle d\'onglet', icon: '🧩', hint: models.length ? String(models.length) : '', submenu: TabModels.menuItems(space) },
      { label: space ? 'Onglets d\'un modèle de zone' : 'Depuis un modèle de zone', icon: '🗂', hint: zoneCount ? String(zoneCount) : '', submenu: TabModels.zoneMenuItems(space) },
      '-',
      { label: 'Explorateur de fichiers', icon: '📁', hint: ctx.ws ? 'workspace' : hint('Ctrl+Maj+E'), action: () => openKind(space, 'explorer') },
      { label: 'Explorateur — choisir un dossier…', icon: '📂', action: () => openKind(space, 'explorer-pick') },
      { label: 'Explorateur favori', icon: '⭐', submenu: [
        ...favs.map((f) => ({ label: f.name || f.path, hint: f.fromWs ? 'workspace' : '', action: () => openKind(space, 'explorer', { root: f.path }) })),
        favs.length ? '-' : { label: 'Aucun favori', disabled: true },
        { label: 'Gérer les favoris…', icon: '⚙', action: () => Settings.open('favorites') },
      ] },
      '-',
      { label: 'Tests', icon: '🧪', hint: ctx.ws ? 'workspace' : 'dossier…', action: () => openKind(space, 'tests') },
      { label: 'Docker', icon: '🐳', hint: ctx.ws ? 'workspace' : 'dossier…', action: () => openKind(space, 'docker') },
      { label: 'Services', icon: '🛰', hint: ctx.ws ? 'workspace' : 'dossier…', action: () => openKind(space, 'services') },
      { label: 'Prisma / BDD', icon: '◆', hint: ctx.ws ? 'workspace' : 'dossier…', action: () => openKind(space, 'prisma') },
      { label: 'Graphify', icon: '🕸', hint: ctx.ws ? 'workspace' : 'dossier…', action: () => openKind(space, 'graphify') },
    ];
  }

  // ---------- Édition en ligne ----------
  function editInline(el, commit) {
    const old = el.textContent;
    el.contentEditable = 'true';
    el.focus();
    document.getSelection().selectAllChildren(el);
    const done = (ok) => {
      el.contentEditable = 'false';
      el.removeEventListener('keydown', onKey);
      el.removeEventListener('blur', onBlur);
      const v = el.textContent.trim();
      if (ok) commit(v); else el.textContent = old;
    };
    const onKey = (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') { e.preventDefault(); done(true); }
      if (e.key === 'Escape') { e.preventDefault(); done(false); }
    };
    const onBlur = () => done(true);
    el.addEventListener('keydown', onKey);
    el.addEventListener('blur', onBlur);
  }

  // ---------- Dispositions suggérées ----------
  function showLayoutPicker(anchor) {
    const ids = Layout.leaves();
    const box = h('div', 'menu layout-picker');
    box.appendChild(h('div', 'menu-title', 'Dispositions suggérées'));
    const grid = h('div', 'lp-grid');
    for (const p of Layout.presets(ids)) {
      const card = h('button', 'lp-card');
      card.appendChild(Layout.thumbnail(p.tree));
      card.appendChild(h('span', 'lp-name', esc(p.name)));
      card.addEventListener('click', () => {
        box.remove();
        maximized = null;
        Layout.set(JSON.parse(JSON.stringify(p.tree)));
        renderLayout();
        save();
      });
      grid.appendChild(card);
    }
    if (!ids.length) grid.appendChild(h('div', 'tpl-empty', 'Aucun espace visible.'));
    box.appendChild(grid);
    const foot = h('div', 'rp-foot');
    const eq = h('button', 'tb-btn', '⇔ Équilibrer les tailles');
    eq.addEventListener('click', () => { box.remove(); Layout.equalize(); renderLayout(); save(); });
    const tip2 = h('span', 'lp-tip', 'Astuce : glissez un robot sur un espace pour l\'ancrer où vous voulez.');
    foot.append(eq, tip2);
    box.appendChild(foot);
    document.body.appendChild(box);
    const r = anchor.getBoundingClientRect();
    box.style.left = `${Math.max(6, Math.min(r.left, innerWidth - box.offsetWidth - 8))}px`;
    box.style.top = `${r.bottom + 6}px`;
    const close = (e) => { if (!box.contains(e.target)) { box.remove(); document.removeEventListener('mousedown', close, true); } };
    setTimeout(() => document.addEventListener('mousedown', close, true), 0);
  }

  // ---------- Actions et raccourcis ----------
  function newSpace() { openKind(null, 'terminal'); }

  function cycleTab(dir) {
    const s = activeSpace;
    if (!s || s.tabs.length < 2) return;
    const i = s.tabs.indexOf(s.activeTab);
    activateTab(s.tabs[(i + dir + s.tabs.length) % s.tabs.length], true);
  }

  function focusSpaceAt(i) {
    const s = spaces[(i + spaces.length) % spaces.length];
    if (!s) return;
    if (s.parked) return unparkSpace(s);
    if (maximized) { maximized = s; renderLayout(); }
    setActiveSpace(s, true);
    wave(s);
  }

  window.addEventListener('keydown', (e) => {
    const cs = e.ctrlKey && e.shiftKey && !e.altKey;
    let handled = true;
    const tab = activeSpace?.activeTab;
    if (e.key === 'Escape' && Settings.isOpen) Settings.close();
    else if (e.key === 'Escape' && !$('#help').classList.contains('hidden')) $('#help').classList.add('hidden');
    else if (e.ctrlKey && !e.shiftKey && !e.altKey && e.key === ',') Settings.open();
    else if (e.ctrlKey && !e.shiftKey && !e.altKey && e.code === 'KeyO') pickWorkspace();
    else if (cs && e.code === 'KeyN') newSpace();
    else if (cs && e.code === 'KeyT') activeSpace ? openTab(activeSpace) : newSpace();
    else if (cs && e.code === 'KeyE') openKind(activeSpace, 'explorer');
    else if (cs && e.code === 'KeyW') tab && closeTab(tab);
    else if (cs && e.code === 'KeyM') activeSpace && toggleMaximize(activeSpace);
    else if (cs && e.code === 'KeyL') showLayoutPicker($('#btn-layout'));
    else if (e.ctrlKey && !e.altKey && e.key === 'Tab') cycleTab(e.shiftKey ? -1 : 1);
    else if (e.ctrlKey && e.altKey && !e.shiftKey && /^Digit[1-9]$/.test(e.code)) { const sc = screens[+e.code.slice(5) - 1]; if (sc) switchScreen(sc.id); }
    else if (e.ctrlKey && e.altKey && !e.shiftKey && (e.code === 'ArrowRight' || e.code === 'ArrowLeft')) { const i = screens.findIndex((sc) => sc.id === activeScreenId); const sc = screens[(i + (e.code === 'ArrowRight' ? 1 : -1) + screens.length) % screens.length]; switchScreen(sc.id); }
    else if (e.altKey && !e.ctrlKey && /^Digit[1-9]$/.test(e.code)) focusSpaceAt(+e.code.slice(5) - 1);
    else if (e.altKey && !e.ctrlKey && e.code === 'ArrowLeft') focusSpaceAt(spaces.indexOf(activeSpace) - 1);
    else if (e.altKey && !e.ctrlKey && e.code === 'ArrowRight') focusSpaceAt(spaces.indexOf(activeSpace) + 1);
    else handled = false;
    if (handled) { e.preventDefault(); e.stopPropagation(); }
  }, true);

  $('#btn-new-space').addEventListener('click', (e) => { e.stopPropagation(); UI.menu(kindItems(null), $('#btn-new-space')); });
  $('#btn-layout').addEventListener('click', (e) => { e.stopPropagation(); showLayoutPicker($('#btn-layout')); });
  $('#btn-models').addEventListener('click', () => TabModels.openManager());
  const newScreenMenu = () => [{ label: 'Nouvel écran vide', icon: '＋', action: addScreen }, '-', ...TabModels.screenMenuItems()];
  $('#btn-new-screen').addEventListener('click', (e) => {
    if (!TabModels.all('screen').length) return addScreen();
    e.stopPropagation();
    UI.menu(newScreenMenu(), $('#btn-new-screen'));
  });
  $('#btn-new-screen').addEventListener('contextmenu', (e) => { e.preventDefault(); UI.menu(newScreenMenu(), e.clientX, e.clientY); });
  api.onReceiveSpaces((state) => receiveSpaces(state));
  // Fermeture d'une fenêtre secondaire : ses espaces retournent dans la fenêtre principale
  api.onCloseRequest(async () => {
    if (!spaces.some((sp) => sp.tabs.length)) return api.closeWindowNow(null);
    const choice = await closeChoice();
    if (choice === 'return') {
      spaces.forEach((sp) => sp.tabs.forEach((t) => { if (t.kind === 'terminal' && t.ptyId) t.attachOnly = true; }));
      api.closeWindowNow(payloadFor(spaces));
    } else if (choice === 'kill') {
      for (const sp of [...spaces]) for (const t of [...sp.tabs]) closeTab(t, true);
      api.closeWindowNow(null);
    }
  });
  function closeChoice() {
    return new Promise((resolve) => {
      const ov = h('div', 'overlay dlg-overlay');
      const card = h('div', 'dlg');
      card.innerHTML = `<h3>Fermer cette fenêtre ?</h3><p class="dlg-msg">Elle contient ${spaces.length} espace(s). Que faire de leurs onglets ?</p>`;
      const row = h('div', 'dlg-actions close-choice');
      const b = (label, cls, v) => { const x = h('button', 'tb-btn ' + cls, label); x.addEventListener('click', () => { ov.remove(); resolve(v); }); row.appendChild(x); return x; };
      b('Annuler', '', null);
      b('Fermer et arrêter les terminaux', 'danger-btn', 'kill');
      b('↩ Renvoyer dans la fenêtre principale', 'primary', 'return').focus();
      card.appendChild(row);
      ov.appendChild(card);
      document.body.appendChild(ov);
    });
  }
  // Déposer un onglet sur « ＋ Espace » : il part dans un nouvel espace
  $('#btn-new-space').addEventListener('dragover', (e) => { if (dragTab) { e.preventDefault(); $('#btn-new-space').classList.add('drop-hot'); } });
  $('#btn-new-space').addEventListener('dragleave', () => $('#btn-new-space').classList.remove('drop-hot'));
  $('#btn-new-space').addEventListener('drop', (e) => {
    $('#btn-new-space').classList.remove('drop-hot');
    if (!dragTab) return;
    e.preventDefault();
    const t = dragTab;
    Layout.endDrag();
    const s = createSpace();
    placeSpace(s, t.space.id);
    moveTab(t, s);
  });
  $('#btn-settings').addEventListener('click', () => Settings.open());
  $('#btn-help').addEventListener('click', () => $('#help').classList.remove('hidden'));
  $('#help-close').addEventListener('click', () => $('#help').classList.add('hidden'));
  $('#help').addEventListener('mousedown', (e) => { if (e.target.id === 'help') $('#help').classList.add('hidden'); });
  wsBadge.addEventListener('click', workspaceMenu);

  // ---------- Paramètres ----------
  function applyRobotSettings() {
    document.body.classList.toggle('no-robot-anim', !Settings.data.robotAnimations);
  }
  Settings.onChange((changed) => {
    if (changed.includes('theme')) {
      Themes.apply(Settings.data.theme);
      spaces.forEach(applyBot);
      renderCrew();
      renderWorkspace();
      Editor.applyTheme();
    }
    if (changed.includes('robotAnimations')) applyRobotSettings();
    if (changed.includes('language')) I18n.setLang(Settings.data.language);
    if (changed.includes('tabModels') || changed.includes('zoneModels')) spaces.forEach(fillEmpty);
    if (changed.some((k) => k.startsWith('editor') || k === 'fontFamily' || k === 'fontSize')) Editor.applySettings();
    for (const s of spaces) for (const t of s.tabs) kindOf(t).applySettings?.(t, changed);
  });

  // API partagée avec les modules d'onglets
  window.CAI = {
    h, say, talk, save, openTab, openExplorer, openFile, openKind, setAutoTitle, markUnread, shellLabel, spaces,
    activateTab, closeTab, moveTab, openZoneModel, openScreenModel, snapshotSpace, snapshotScreen,
    get currentScreen() { return curScreen(); },
    refreshCrew: () => spaces.forEach(renderCrewTabs),
    setWorkspace: (ws) => { if (ws) { ctx.ws = ws; renderWorkspace(); spaces.forEach(fillEmpty); } },
    get activeSpace() { return activeSpace; },
    get shells() { return shells; },
    get ws() { return ctx.ws; },
    get scope() { return 'term:' + (ctx.ws?.root?.toLowerCase() || 'global'); },
  };

  // ---------- Démarrage ----------
  // Écran de chargement (#boot, dans index.html) : visible dès le premier rendu, retiré une fois l'état restauré.
  const bootEl = document.getElementById('boot');
  const bootStep = (txt) => { const el = document.getElementById('boot-step'); if (el) el.textContent = txt; };
  const nextPaint = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
  let bootDone = false;
  function hideBoot() {
    if (bootDone || !bootEl) return;
    bootDone = true;
    bootEl.classList.add('done');
    setTimeout(() => bootEl.remove(), 300);
  }
  setTimeout(hideBoot, 20000); // filet de sécurité

  (async () => {
    ctx = await api.context();
    document.getElementById('boot-title').textContent = `Ouverture de ${ctx.ws?.name || 'RobotConsole'}…`;
    try { document.getElementById('boot-bot').innerHTML = Robot.generate(ctx.ws?.seed || Robot.randomSeed(), { legs: true }).svg; } catch {}
    bootStep('Chargement des paramètres');
    await Settings.load();
    I18n.setLang(Settings.data.language);
    Themes.apply(Settings.data.theme);
    applyRobotSettings();
    renderWorkspace();
    bootStep('Recherche des consoles');
    shells = await api.listShells();
    Settings.setShells(shells);
    bootStep("Lecture de l'état enregistré");
    const state = await api.loadState();
    let screensReady = false;

    if (state?.spaces?.length) {
      const nTabs = state.spaces.reduce((n, s) => n + (s.tabs?.length || 0), 0);
      bootStep(`Restauration de ${state.spaces.length} espace${state.spaces.length > 1 ? 's' : ''} · ${nTabs} onglet${nTabs > 1 ? 's' : ''}`);
      await nextPaint();
      restoring = true;
      for (const ss of state.spaces) {
        if (state.version === 3 && !screensReady) {
          screens = (state.screens?.length ? state.screens : [{ name: 'Écran 1' }]).map((sc, i) => ({ id: `sc${++screenSeq}`, name: sc.name || `Écran ${i + 1}`, color: sc.color || null, folded: !!sc.folded, tree: null, maximizedId: null }));
          activeScreenId = (screens[state.activeScreen] || screens[0]).id;
          screensReady = true;
        }
        const s = createSpace({ seed: ss.seed, name: ss.name, parked: ss.parked, traits: ss.traits, icon: ss.icon, sound: ss.sound, remote: ss.remote, rid: ss.rid, screenId: (screens[ss.screen || 0] || screens[0]).id });
        for (const t of ss.tabs || []) {
          const { title, ...spec } = t;
          try { openTab(s, { kind: 'terminal', ...spec }, { title }); } catch (err) { console.error('[boot] onglet non restauré', t.kind, err); }
        }
        const at = s.tabs[ss.activeTab] || s.tabs[0];
        if (at) activateTab(at, false);
      }
      if (state.version === 3) {
        state.screens?.forEach((sc, i) => {
          if (!screens[i]) return;
          screens[i].tree = Layout.deserialize(sc.layout, (k) => spaces[k]?.id);
          screens[i].maximizedId = sc.maximized != null ? spaces[sc.maximized]?.id || null : null;
        });
        Layout.set(curScreen().tree);
      } else if (state.version === 2 && state.layout) Layout.fromJSON(state.layout, (i) => spaces[i]?.id);
      else {
        const ids = visibleSpaces().map((s) => s.id);
        const grid = Layout.presets(ids).find((p) => p.id === (state.layout === 'rows' ? 'rows' : state.layout === 'cols' ? 'cols' : 'grid')) || Layout.presets(ids)[0];
        if (grid) Layout.set(grid.tree);
      }
      if (state.version === 3) maximized = curScreen().maximizedId ? byId(curScreen().maximizedId) : null;
      else if (state.maximized != null && spaces[state.maximized] && !spaces[state.maximized].parked) maximized = spaces[state.maximized];
      restoring = false;
      renderLayout();
      renderCrew();
      // Arrête les terminaux orphelins de cette fenêtre (onglets qui n'existent plus)
      api.gcPty(CAI.scope, spaces.flatMap((s) => s.tabs.map((t) => t.ptyId).filter(Boolean)));
      const want = spaces[state.active];
      setActiveSpace(want && !want.parked ? want : nearestVisible(spaces.length - 1), true);
      // Espaces renvoyés par une fenêtre secondaire fermée pendant que celle-ci était fermée
      for (const p of state.pendingSpaces || []) receiveSpaces(p);
    } else {
      const s = createSpace();
      placeSpace(s);
      openTab(s);
      if (ctx.ws) { openTab(s, { kind: 'explorer', root: ctx.ws.root }); activateTab(s.tabs[0], false); }
      setActiveSpace(s, true);
      setTimeout(() => say(s, ctx.ws ? `Bienvenue dans ${ctx.ws.name} !` : `Bonjour, je suis ${s.bot.name} !`), 300);
      save();
    }
  })().catch((err) => {
    console.error('[boot]', err);
    // Filet : affiche ce qui a pu être restauré plutôt qu'une fenêtre vide
    restoring = false;
    try { renderLayout(); renderCrew(); if (!activeSpace) setActiveSpace(nearestVisible(spaces.length - 1), true); } catch (e) { console.error('[boot] rendu', e); }
  }).finally(() => requestAnimationFrame(hideBoot));
})();
