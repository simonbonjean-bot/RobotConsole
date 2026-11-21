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
    templates: [],
    tabModels: [],
    zoneModels: [],
    screenModels: [],
    gpuRendering: true,
    showSplash: true,
    language: 'auto',
    robotVolume: 70,
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
          row('Taille des tabulations', select('editorTabSize', [['2', '2 espaces'], ['4', '4 espaces'], ['8', '8 espaces']], Number)),
        ),
        section('Robots',
          row('Animations', toggle('robotAnimations'), 'Clignement, bouche qui parle, antenne'),
          row('Bulles de dialogue', toggle('robotBubbles')),
          row('Volume des sons', range('robotVolume', 0, 100, 5, (v) => `${v} %`), 'Son joué quand un robot a fini (clic droit sur un robot → 🔔)'),
        ),
        section('Explorateur de fichiers',
          row('Afficher les fichiers cachés', toggle('showHidden'), 'Fichiers commençant par un point'),
          row('Ouvrir sur la vue Modifications', toggle('explorerChangesFirst'), 'Si le dossier est un dépôt Git'),
          row('Taille max. d\'aperçu', select('previewMaxKB', [[256, '256 Ko'], [1024, '1 Mo'], [4096, '4 Mo'], [16384, '16 Mo']].map(([v, l]) => [String(v), l]), Number)),
        ),
      );
      body.appendChild(favoritesSection());
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
