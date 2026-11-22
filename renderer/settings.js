// RobotConsole — paramètres (stockés dans settings.json) et panneau de réglages
(function () {
  const DEFAULTS = {
    settingsVersion: 3,
    theme: 'minuit',
    fontFamily: '"Cascadia Mono", "Cascadia Code", Consolas, monospace',
    fontSize: 13,
    lineHeight: 1.15,
    defaultShell: '',
    cursorStyle: 'bar',
    cursorBlink: true,
    scrollback: 8000,
    rightClick: 'menu',
    confirmMultilinePaste: true,
    robotAnimations: true,
    robotBubbles: true,
    showHidden: false,
    previewMaxKB: 1024,
    explorerChangesFirst: false,
    explorerFavorites: [],
    editorMinimap: true,
    editorWordWrap: false,
    editorTabSize: 2,
    editorInsertSpaces: true,
    editorLineNumbers: 'on',
    editorWhitespace: 'selection',
    editorIndentGuides: true,
    editorStickyScroll: true,
    editorRuler: 0,
    editorLineHighlight: true,
    editorZoom: 0,
    editorTrimOnSave: false,
    editorFinalNewline: false,
    templates: [],
    tabModels: [],
    zoneModels: [],
    screenModels: [],
    gpuRendering: true,
    showSplash: true,
    language: 'auto',
    robotVolume: 70,
    toolAnim: 'tap', // animation de l'icône « Travaille sur » pendant l'activité de la zone
    robotBodyInZone: true, // corps du robot qui dépasse de l'en-tête sur l'onglet courant
    crewStyle: 'classic', // style de la barre des robots : classic, compact, dock, labels, flat
  };

  const FONTS = [
    ['"Cascadia Mono", "Cascadia Code", Consolas, monospace', 'Cascadia Mono'],
    ['"Cascadia Code", Consolas, monospace', 'Cascadia Code (ligatures)'],
    ['Consolas, monospace', 'Consolas'],
    ['"Lucida Console", monospace', 'Lucida Console'],
    ['"Courier New", monospace', 'Courier New'],
  ];

  let data = { ...DEFAULTS };
  const listeners = [];
  let shells = [];
  let saveTimer = null;

  async function load() {
    const saved = await window.api.loadSettings();
    data = { ...DEFAULTS, ...(saved || {}) };
    // Version 2 : le clic droit du terminal ouvre désormais un menu
    if (saved && (saved.settingsVersion || 1) < 2) {
      if (saved.rightClick === 'smart') data.rightClick = 'menu';
      data.settingsVersion = 2;
    }
    // Version 3 : les « modèles d'espace » deviennent des « modèles d'onglet »
    if ((data.settingsVersion || 1) < 3) {
      if (!saved?.tabModels?.length && data.templates?.length) data.tabModels = window.TabModels ? TabModels.fromLegacy(data.templates) : [];
      data.settingsVersion = 3;
      window.api.saveSettings(data);
    }
    return data;
  }

  function set(patch) {
    const changed = Object.keys(patch).filter((k) => data[k] !== patch[k]);
    if (!changed.length) return;
    Object.assign(data, patch);
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => window.api.saveSettings(data), 250);
    for (const cb of listeners) cb(changed, data);
  }

  // ---------- Panneau ----------
  const el = (tag, cls, html) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  };

  let overlay = null;

  function row(label, control, hint) {
    const r = el('label', 'set-row');
    const l = el('div', 'set-label');
    l.textContent = label;
    if (hint) l.appendChild(el('small', '', hint));
    r.append(l, control);
    return r;
  }

  function select(key, options, parse = (v) => v) {
    const s = el('select', 'set-input');
    for (const [v, label] of options) {
      const o = el('option');
      o.value = v; o.textContent = label;
      s.appendChild(o);
    }
    s.value = String(data[key]);
    s.addEventListener('change', () => set({ [key]: parse(s.value) }));
    return s;
  }

  function toggle(key) {
    const wrap = el('span', 'switch');
    const c = el('input');
    c.type = 'checkbox';
    c.checked = !!data[key];
    c.addEventListener('change', () => set({ [key]: c.checked }));
    wrap.append(c, el('span', 'knob'));
    return wrap;
  }

  function range(key, min, max, step, fmt = (v) => v) {
    const w = el('div', 'set-range');
    const r = el('input');
    r.type = 'range'; r.min = min; r.max = max; r.step = step; r.value = data[key];
    const out = el('span', 'set-range-val');
    out.textContent = fmt(data[key]);
    r.addEventListener('input', () => { out.textContent = fmt(+r.value); set({ [key]: +r.value }); });
    w.append(r, out);
    return w;
  }

  function themeCards() {
    const grid = el('div', 'theme-grid');
    for (const t of Themes.list) {
      const card = el('button', 'theme-card' + (t.id === data.theme ? ' active' : ''));
      const sw = [t.term.red, t.term.green, t.term.yellow, t.term.blue, t.term.magenta, t.term.cyan]
        .map((c) => `<i style="background:${c}"></i>`).join('');
      card.innerHTML = `
        <div class="theme-prev" style="background:${t.ui.bg};border-color:${t.ui.border}">
          <div class="tp-bar" style="background:${t.ui.panel2};border-color:${t.ui.border}"><span style="background:${t.ui.accent}"></span></div>
          <div class="tp-body" style="background:${t.ui.panel};color:${t.term.foreground}">
            <code><b style="color:${t.term.green}">PS</b> ~&gt; <span style="color:${t.syn.fn}">git</span> status</code>
            <div class="tp-sw">${sw}</div>
          </div>
        </div>
        <div class="theme-name">${t.name}</div>`;
      card.addEventListener('click', () => {
        set({ theme: t.id });
        grid.querySelectorAll('.theme-card').forEach((c) => c.classList.toggle('active', c === card));
      });
      grid.appendChild(card);
    }
    return grid;
  }

  // Style de la barre des robots : cartes avec une petite maquette de chaque style
  const CREW_STYLES = [
    ['classic', 'Classique', 'Robots et icônes des onglets dans des cadres'],
    ['compact', 'Compacte', 'Barre fine, petits robots : plus de place pour les zones'],
    ['dock', 'Dock', 'Grands robots seuls, nombre d\'onglets en badge'],
    ['labels', 'Étiquettes', 'Robot, nom de l\'espace et onglets en dessous'],
    ['flat', 'Épurée', 'Sans cadres, le robot actif est souligné'],
  ];
  function crewStyleCards() {
    const grid = el('div', 'crew-style-grid');
    const bot = (c) => `<i class="cs-bot" style="--c:${c}"></i>`;
    const tabs = (n) => '<i class="cs-tab"></i>'.repeat(n);
    for (const [id, name, hint] of CREW_STYLES) {
      const card = el('button', 'crew-style-card' + ((data.crewStyle || 'classic') === id ? ' active' : ''));
      card.title = hint;
      card.innerHTML = `<div class="cs-prev cs-${id}">
          <span class="cs-item on">${bot('#58a6ff')}<b class="cs-name">Boka</b><span class="cs-tabs">${tabs(3)}</span><em class="cs-count">3</em></span>
          <span class="cs-item">${bot('#e5539b')}<b class="cs-name">Zaproo</b><span class="cs-tabs">${tabs(2)}</span><em class="cs-count">2</em></span>
        </div>
        <div class="theme-name">${name}</div><small class="cs-hint">${hint}</small>`;
      card.addEventListener('click', () => {
        set({ crewStyle: id });
        grid.querySelectorAll('.crew-style-card').forEach((c) => c.classList.toggle('active', c === card));
      });
      grid.appendChild(card);
    }
    return grid;
  }

  // Animation de l'icône « Travaille sur » : une carte par animation, avec un aperçu qui joue en boucle
  const TOOL_ANIMS = [['tap', 'Coups de marteau'], ['bounce', 'Rebond'], ['shake', 'Vibration'], ['pulse', 'Pulsation'], ['swing', 'Balancier'], ['none', 'Aucune']];
  function toolAnimBlock() {
    const wrap = el('div', 'set-row set-row-block');
    const lab = el('div', 'set-label');
    lab.textContent = "Animation de l'icône « Travaille sur »";
    lab.appendChild(el('small', '', "Seulement quand la zone a de l'activité ; immobile au repos"));
    const grid = el('div', 'tool-anim-grid');
    let svg = '';
    try { svg = window.Robot ? Robot.generate(2024, { traits: { tool: 'lu:square-terminal', accessory: 'none' } }).svg : ''; } catch {}
    for (const [id, name] of TOOL_ANIMS) {
      const card = el('button', 'tool-anim-card tool-anim-demo' + ((data.toolAnim || 'tap') === id ? ' active' : ''));
      card.dataset.toolAnim = id;
      card.innerHTML = `<div class="robot">${svg}</div><div class="theme-name">${name}</div>`;
      card.addEventListener('click', () => {
        set({ toolAnim: id });
        grid.querySelectorAll('.tool-anim-card').forEach((c) => c.classList.toggle('active', c === card));
      });
      grid.appendChild(card);
    }
    wrap.append(lab, grid);
    return wrap;
  }

  // Dossiers favoris de l'explorateur (menu « ＋ Espace › Explorateur favori »)
  function favoritesSection() {
    const sec = el('section', 'set-section');
    sec.id = 'set-favorites';
    sec.appendChild(el('h3', '', 'Dossiers favoris de l\'explorateur'));
    sec.appendChild(el('p', 'set-help', 'Accessibles depuis « ＋ Espace » ou le menu ▼ d\'un espace → <b>Explorateur favori</b>. Un workspace peut aussi déclarer ses favoris dans <code>.robot/workspace.json</code>.'));
    const list = el('div', 'fav-list');
    sec.appendChild(list);
    const render = () => {
      list.innerHTML = '';
      const favs = data.explorerFavorites || [];
      favs.forEach((f, i) => {
        const r = el('div', 'fav-row');
        const name = el('input', 'set-input');
        name.value = f.name || '';
        name.placeholder = 'Nom';
        const p = el('input', 'set-input');
        p.value = f.path || '';
        p.placeholder = 'C:\\chemin\\du\\dossier';
        const pick = el('button', 'icon-btn', '📂');
        const rm = el('button', 'icon-btn danger', '✕');
        const commit = () => { const next = favs.map((x, j) => (j === i ? { name: name.value, path: p.value } : x)); set({ explorerFavorites: next }); };
        name.addEventListener('input', commit);
        p.addEventListener('input', commit);
        pick.addEventListener('click', async () => { const v = await window.api.pickFolder(p.value || undefined); if (v) { p.value = v; if (!name.value) name.value = v.split(/[\\/]/).pop(); commit(); } });
        rm.addEventListener('click', () => { set({ explorerFavorites: favs.filter((_, j) => j !== i) }); render(); });
        r.append(name, p, pick, rm);
        list.appendChild(r);
      });
      const add = el('button', 'tb-btn', '＋ Ajouter un dossier');
      add.addEventListener('click', async () => {
        const v = await window.api.pickFolder();
        if (!v) return;
        set({ explorerFavorites: [...(data.explorerFavorites || []), { name: v.split(/[\\/]/).pop(), path: v }] });
        render();
      });
      list.appendChild(add);
    };
    render();
    return sec;
  }

  // Accès à distance : serveur local pour piloter les robots « ouverts » depuis un téléphone / une tablette
  function remoteSection() {
    const sec = el('section', 'set-section');
    sec.id = 'set-remote';
    sec.appendChild(el('h3', '', 'Accès à distance (téléphone, tablette)'));
    sec.appendChild(el('p', 'set-help', 'Ouvre une page web pour voir les onglets des robots <b>ouverts</b> (clic sur un robot → 📡 Partage) depuis un autre appareil. À utiliser sur le <b>réseau local</b> ou via un VPN (Tailscale, ZeroTier) : n\'exposez pas ce port sur Internet. Le lien contient un jeton secret : ne le partagez pas.'));
    const body = el('div', 'remote-set');
    sec.appendChild(body);
    const render = (info) => {
      body.innerHTML = '';
      const sw = el('span', 'switch');
      const c = el('input');
      c.type = 'checkbox';
      c.checked = !!info.enabled;
      sw.append(c, el('span', 'knob'));
      c.addEventListener('change', async () => render(await window.api.remoteSet({ enabled: c.checked })));
      body.appendChild(row('Activer le serveur', sw, info.running ? `En écoute sur le port ${info.port} · ${info.clients} appareil(s) connecté(s)` : info.error || 'Arrêté'));
      const port = el('input', 'set-input small');
      port.type = 'number'; port.min = 1024; port.max = 65535; port.value = info.port || 7777;
      port.addEventListener('change', async () => render(await window.api.remoteSet({ port: +port.value })));
      body.appendChild(row('Port', port));
      if (!info.running) return;
      if (!info.urls.length) { body.appendChild(el('p', 'set-help', 'Aucune adresse réseau détectée.')); return; }
      const box = el('div', 'remote-box');
      const qr = el('div', 'remote-qr');
      const list = el('div', 'remote-urls');
      const show = (u) => {
        qr.innerHTML = info.qrs?.[u.address] || '';
        list.querySelectorAll('.remote-url').forEach((x) => x.classList.toggle('active', x.dataset.ip === u.address));
      };
      for (const u of info.urls) {
        const r = el('div', 'remote-url');
        r.dataset.ip = u.address;
        const label = el('button', 'remote-ip');
        label.innerHTML = `<b></b><small></small>`;
        label.querySelector('b').textContent = `${u.address}:${info.port}`;
        label.querySelector('small').textContent = /^100\./.test(u.address) ? `${u.name} · VPN (Tailscale ?)` : u.name;
        label.addEventListener('click', () => show(u));
        const copy = el('button', 'icon-btn', '⧉');
        copy.title = 'Copier le lien (avec le jeton)';
        copy.addEventListener('click', () => { window.api.writeClipboard(u.url); UI.toast('Lien copié'); });
        r.append(label, copy);
        list.appendChild(r);
      }
      const regen = el('button', 'tb-btn', '↻ Régénérer le jeton');
      regen.title = 'Les appareils connectés devront rescanner le QR code';
      regen.addEventListener('click', async () => render({ ...(await window.api.remoteRegen()), enabled: true }));
      list.appendChild(regen);
      box.append(qr, list);
      body.appendChild(box);
      body.appendChild(el('p', 'set-help', 'Scannez le QR code avec le téléphone (même Wi-Fi ou même VPN). Si la page ne s\'ouvre pas, autorisez RobotConsole dans le pare-feu Windows (réseaux privés).'));
      show(info.urls[0]);
    };
    window.api.remoteInfo().then(render).catch(() => {});
    return sec;
  }

  // Relais auto-hébergé : accès depuis n'importe quel réseau, avec un compte, chiffré de bout en bout
  function relaySection() {
    const sec = el('section', 'set-section');
    sec.id = 'set-relay';
    sec.appendChild(el('h3', '', 'Relais (accès depuis internet)'));
    sec.appendChild(el('p', 'set-help', 'Un relais <b>robotconsole-relay</b> hébergé sur un serveur (VPS) permet d\'atteindre vos robots ouverts depuis n\'importe quel réseau, sans VPN ni port à ouvrir. Le PC et les téléphones se connectent avec le même compte ; tout est chiffré de bout en bout et chaque nouveau téléphone doit être approuvé ici.'));
    const body = el('div', 'remote-set');
    sec.appendChild(body);
    const fmt = (t) => (t ? new Date(t).toLocaleString() : '—');
    const render = (st, busy) => {
      body.innerHTML = '';
      if (!st.linked) {
        const url = el('input', 'set-input');
        url.placeholder = 'https://relay.mondomaine.fr';
        url.value = st.url || '';
        url.addEventListener('keydown', (e) => e.stopPropagation());
        const go = el('button', 'tb-btn primary', busy ? 'En attente du navigateur…' : 'Se connecter…');
        go.disabled = !!busy;
        go.addEventListener('click', async () => {
          if (!url.value.trim()) return url.focus();
          render({ ...st, url: url.value }, true);
          const r = await window.api.relayLogin(url.value);
          if (r.error) UI.toast(r.error, { kind: 'error', ms: 6000 });
          render(r);
        });
        const r = el('div', 'relay-login');
        r.append(url, go);
        body.appendChild(row('Adresse du relais', r, 'Le navigateur s\'ouvre pour vous connecter à votre compte et autoriser ce PC'));
        if (st.error) { const e = el('p', 'set-help relay-err'); e.textContent = st.error; body.appendChild(e); }
        return;
      }
      const sw = el('span', 'switch');
      const c = el('input');
      c.type = 'checkbox';
      c.checked = st.enabled;
      sw.append(c, el('span', 'knob'));
      c.addEventListener('change', async () => render(await window.api.relayEnable(c.checked)));
      const state = st.connected ? `Connecté à ${st.url}` : st.enabled ? (st.error || 'Connexion…') : 'Désactivé';
      body.appendChild(row('Utiliser le relais', sw, state));
      const who = el('div', 'relay-who');
      who.innerHTML = '<span></span>';
      who.firstChild.textContent = `${st.user?.email || ''} · ce PC : ${st.deviceName || ''}`;
      const out = el('button', 'tb-btn', 'Se déconnecter');
      out.title = 'Délie ce PC du compte (les téléphones ne le verront plus)';
      out.addEventListener('click', async () => { if (await UI.confirm('Se déconnecter du relais ?', 'Ce PC sera délié de votre compte. Il faudra se reconnecter pour l\'utiliser à nouveau.', { ok: 'Se déconnecter', danger: true })) render(await window.api.relayLogout()); });
      who.appendChild(out);
      body.appendChild(row('Compte', who));
      const list = el('div', 'relay-phones');
      if (!st.phones.length) list.appendChild(el('p', 'set-help', 'Aucun téléphone appairé. Ouvrez l\'adresse du relais sur le téléphone, connectez-vous et choisissez ce PC : une demande d\'approbation apparaîtra ici.'));
      for (const p of st.phones) {
        const r = el('div', 'relay-phone');
        const n = el('span', '');
        n.textContent = `${p.online ? '🟢 ' : ''}${p.name}`;
        const d = el('small', '');
        d.textContent = `appairé le ${fmt(p.added)} · vu ${fmt(p.seen)}`;
        const rm = el('button', 'icon-btn danger', '✕');
        rm.title = 'Oublier cet appareil (il devra être approuvé à nouveau)';
        rm.addEventListener('click', async () => render(await window.api.relayForgetPhone(p.id)));
        r.append(n, d, rm);
        list.appendChild(r);
      }
      body.appendChild(el('div', 'set-label', 'Téléphones et tablettes appairés'));
      body.appendChild(list);
    };
    const refresh = () => window.api.relayStatus().then((s) => { if (sec.isConnected || !sec.parentNode) render(s); }).catch(() => {});
    refresh();
    window.api.onRemoteChanged(() => { if (sec.isConnected && !sec.querySelector('.relay-login button[disabled]')) refresh(); });
    return sec;
  }

  function section(title, ...rows) {
    const s = el('section', 'set-section');
    s.appendChild(el('h3', '', title));
    rows.forEach((r) => s.appendChild(r));
    return s;
  }

  function build() {
    overlay = el('div', 'overlay settings-overlay');
    const card = el('div', 'settings-card');
    const head = el('div', 'settings-head', '<h2>Paramètres</h2>');
    const reset = el('button', 'tb-btn', 'Réinitialiser');
    const close = el('button', 'icon-btn', '✕');
    close.title = 'Fermer (Échap)';
    head.append(reset, close);

    const body = el('div', 'settings-body');
    const fill = () => {
      body.innerHTML = '';
      body.append(
        section('Apparence',
          row('Langue', select('language', I18n.LANGS), 'Langue de l\'interface'),
          themeCards(),
          row('Police du terminal', select('fontFamily', FONTS)),
          row('Taille du texte', range('fontSize', 9, 24, 1, (v) => `${v} px`)),
          row('Interligne', range('lineHeight', 1, 1.6, 0.05, (v) => v.toFixed(2))),
          row('Écran de démarrage', toggle('showSplash'), 'Au lancement : choisir un workspace, en créer un ou reprendre la session'),
        ),
        section('Terminal',
          row('Shell par défaut', select('defaultShell', [['', 'Automatique (premier détecté)'], ...shells.map((s) => [s.id, s.label])])),
          row('Style du curseur', select('cursorStyle', [['bar', 'Barre'], ['block', 'Bloc'], ['underline', 'Souligné']])),
          row('Curseur clignotant', toggle('cursorBlink')),
          row('Historique', select('scrollback', [[1000, '1 000 lignes'], [5000, '5 000 lignes'], [8000, '8 000 lignes'], [20000, '20 000 lignes'], [50000, '50 000 lignes']].map(([v, l]) => [String(v), l]), Number), 'Lignes conservées pour le défilement'),
          row('Clic droit', select('rightClick', [['menu', 'Menu contextuel (copier, coller, rechercher…)'], ['smart', 'Copier la sélection, sinon coller'], ['none', 'Ne rien faire']])),
          row('Confirmer le collage de plusieurs lignes', toggle('confirmMultilinePaste'), 'Évite d\'exécuter un bloc collé par erreur'),
          row('Rendu GPU (WebGL)', toggle('gpuRendering'), 'Le texte des terminaux est dessiné par la carte graphique : bien plus fluide'),
        ),
        section('Éditeur de code',
          row('Mini-carte', toggle('editorMinimap')),
          row('Retour à la ligne automatique', toggle('editorWordWrap')),
          row('Numéros de ligne', select('editorLineNumbers', [['on', 'Normaux'], ['relative', 'Relatifs'], ['off', 'Masqués']])),
          row('Caractères invisibles', select('editorWhitespace', [['none', 'Jamais'], ['selection', 'Dans la sélection'], ['all', 'Toujours']])),
          row('Règle verticale', select('editorRuler', [['0', 'Aucune'], ['80', '80 colonnes'], ['100', '100 colonnes'], ['120', '120 colonnes']], Number)),
          row("Guides d'indentation", toggle('editorIndentGuides')),
          row('En-têtes collants', toggle('editorStickyScroll'), "Garde visible la fonction ou le bloc en cours en haut de l'éditeur"),
          row('Surligner la ligne courante', toggle('editorLineHighlight')),
          row('Indenter avec', select('editorInsertSpaces', [['true', 'Des espaces'], ['false', 'Des tabulations']], (v) => v === 'true'), "Pour les nouveaux fichiers : l'indentation d'un fichier existant est détectée"),
          row('Taille des tabulations', select('editorTabSize', [['2', '2'], ['4', '4'], ['8', '8']], Number)),
          row("Supprimer les espaces de fin à l'enregistrement", toggle('editorTrimOnSave')),
          row("Saut de ligne final à l'enregistrement", toggle('editorFinalNewline')),
        ),
        section('Barre des robots', crewStyleCards()),
        section('Robots',
          row('Animations', toggle('robotAnimations'), 'Clignement, bouche qui parle, antenne'),
          row('Bulles de dialogue', toggle('robotBubbles')),
          toolAnimBlock(),
          row('Corps du robot dans la zone', toggle('robotBodyInZone'), "Le robot de l'en-tête dépasse un peu sur l'onglet courant"),
          row('Volume des sons', range('robotVolume', 0, 100, 5, (v) => `${v} %`), 'Son joué quand un robot a fini (clic droit sur un robot → 🔔)'),
        ),
        section('Explorateur de fichiers',
          row('Afficher les fichiers cachés', toggle('showHidden'), 'Fichiers commençant par un point'),
          row('Ouvrir sur la vue Modifications', toggle('explorerChangesFirst'), 'Si le dossier est un dépôt Git'),
          row('Taille max. d\'aperçu', select('previewMaxKB', [[256, '256 Ko'], [1024, '1 Mo'], [4096, '4 Mo'], [16384, '16 Mo']].map(([v, l]) => [String(v), l]), Number)),
        ),
      );
      body.appendChild(favoritesSection());
      body.appendChild(remoteSection());
      body.appendChild(relaySection());
      // Les modèles d'onglet ont leur propre fenêtre (bouton 🧩 Modèles) : simple raccourci ici
      const tm = el('section', 'set-section');
      tm.id = 'set-templates';
      tm.appendChild(el('h3', '', 'Modèles'));
      const cnt = (k) => (data[k] || []).length;
      tm.appendChild(el('p', 'set-help', `Modèles généraux : ${cnt('tabModels')} d'onglet, ${cnt('zoneModels')} de zone, ${cnt('screenModels')} d'écran. Un modèle d'onglet prépare un terminal, un explorateur, des tests… ; un modèle de zone recrée un espace et tous ses onglets ; un modèle d'écran recrée un set de zones avec sa disposition.`));
      const open = el('button', 'tb-btn primary', '🧩 Gérer les modèles…');
      open.addEventListener('click', () => { closePanel(); window.TabModels?.openManager(); });
      tm.appendChild(open);
      body.appendChild(tm);
    };
    fill();
    // Réinitialiser ne touche pas aux modèles d'espace
    reset.addEventListener('click', () => { const { templates, tabModels, zoneModels, screenModels, explorerFavorites, settingsVersion, ...rest } = DEFAULTS; set({ ...rest }); fill(); });
    close.addEventListener('click', closePanel);
    overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) closePanel(); });
    card.append(head, body);
    overlay.appendChild(card);
    document.body.appendChild(overlay);
  }

  function openPanel(sectionId) {
    if (!overlay) build();
    if (sectionId) {
      const target = overlay.querySelector(`#set-${sectionId}`);
      if (target) requestAnimationFrame(() => target.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    }
  }
  function closePanel() {
    overlay?.remove();
    overlay = null;
  }

  window.Settings = {
    DEFAULTS,
    load,
    set,
    get data() { return data; },
    get isOpen() { return !!overlay; },
    onChange: (cb) => listeners.push(cb),
    setShells: (s) => { shells = s; },
    open: openPanel,
    close: closePanel,
  };
})();
