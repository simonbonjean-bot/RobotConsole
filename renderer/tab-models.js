// RobotConsole — modèles : onglet, zone (espace), écran (set de zones)
//   Modèle d'onglet : type (terminal, explorateur, tests, Docker, services…), icône, nom, dossier, shell, commandes.
//   Modèle de zone  : un espace avec son nom, son robot et sa liste d'onglets.
//   Modèle d'écran  : un set de zones avec leur disposition (découpes et tailles).
// Stockage : réglages (« tabModels », « zoneModels », « screenModels ») pour les modèles généraux,
//            .robot/workspace.json (mêmes clés) pour ceux du workspace.
(function () {
  const { h, esc } = UI;
  const KINDS = {
    browser: { label: 'Navigateur', icon: '🌐' },
    terminal: { label: 'Terminal', icon: '>_' },
    explorer: { label: 'Explorateur', icon: '📁' },
    tests: { label: 'Tests', icon: '🧪' },
    docker: { label: 'Docker', icon: '🐳' },
    services: { label: 'Services', icon: '🛰' },
    prisma: { label: 'Prisma / BDD', icon: '◆' },
    graphify: { label: 'Graphify', icon: '🕸' },
  };
  const TYPES = {
    tab: { key: 'tabModels', label: 'Onglets', one: 'modèle d\'onglet', icon: '🚀' },
    zone: { key: 'zoneModels', label: 'Zones', one: 'modèle de zone', icon: '🗂' },
    screen: { key: 'screenModels', label: 'Écrans', one: 'modèle d\'écran', icon: '▣' },
  };
  const ICONS = ['>_', '🚀', '⚡', '🔥', '🧪', '🐳', '🛰', '📁', '🗂', '▣', '🧱', '⚙', '🔧', '🛠', '🧩', '📦', '🌐', '🗄', '🐘', '🍃', '🐍', '☕', '🦀', '🐹', '💎', '📜', '🔍', '📊', '🧹', '🧠', '🤖', '🎯', '🔒', '📝', '🎨', '📱', '🖥', '☁', '🧾', '🏗'];
  const uid = () => `tm-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const kindOf = (m) => KINDS[m.kind || 'terminal'] || KINDS.terminal;
  const clean = ({ fromWs, builtin, ...rest }) => rest;
  const newTab = () => ({ id: uid(), name: '', autoTitle: true, icon: '>_', kind: 'terminal', shellId: '', dir: '', commands: '' });

  // Anciens « modèles d'espace » (plusieurs onglets) -> un modèle par onglet
  function fromLegacy(templates) {
    const out = [];
    for (const t of templates || []) {
      const tabs = t.tabs?.length ? t.tabs : [{ kind: 'terminal' }];
      tabs.forEach((tab, i) => {
        const kind = tab.kind || 'terminal';
        out.push({
          id: uid() + i, name: tabs.length > 1 ? `${t.name || 'Modèle'} · ${tab.title || KINDS[kind]?.label || kind}` : (t.name || 'Modèle'),
          icon: KINDS[kind]?.icon || '>_', kind, shellId: tab.shellId || '', dir: tab.cwd || tab.root || '', commands: tab.commands || '',
        });
      });
    }
    return out;
  }

  // ---------- Stockage ----------
  const generalList = (type) => Settings.data[TYPES[type].key] || [];
  const projectList = (type) => CAI.ws?.[TYPES[type].key] || [];
  const listOf = (type, fromWs) => (fromWs ? projectList(type) : generalList(type));
  async function saveList(type, fromWs, list) {
    const key = TYPES[type].key;
    if (fromWs) CAI.setWorkspace(await window.api.updateWorkspace({ [key]: list.map(clean) }));
    else Settings.set({ [key]: list.map(clean) });
  }
  const addTo = (type, fromWs, m) => saveList(type, fromWs, [...listOf(type, fromWs), clean(m)]);

  function wsModels(type = 'tab') {
    const ws = CAI.ws;
    if (!ws) return [];
    return [...(ws[TYPES[type].key] || []), ...(type === 'tab' ? fromLegacy(ws.templates) : [])].map((m) => ({ ...m, fromWs: true }));
  }
  const presets = (type) => (window.ModelPresets?.[type] || []).map((m) => ({ ...JSON.parse(JSON.stringify(m)), builtin: true }));
  const presetVisible = (id) => !(Settings.data.hiddenPresetIds || []).includes(id);
  function all(type = 'tab') { return [...wsModels(type), ...generalList(type), ...presets(type).filter((m) => presetVisible(m.id))].filter((m) => type !== 'tab' || m.kind !== 'subscriptions'); }
  const find = (id, type = 'tab') => all(type).find((m) => m.id === id) || presets(type).find((m) => m.id === id);

  function iconHtml(icon) {
    if (!icon || icon === '>_') return '<span class="kind-term">&gt;_</span>';
    if (icon.startsWith('tool:') && ToolIcons.get(icon.slice(5))) return `<span class="tm-ico tm-tool">${ToolIcons.html(icon.slice(5))}</span>`;
    return `<span class="tm-ico">${esc(icon)}</span>`;
  }

  // Spécification d'onglet construite depuis un modèle d'onglet
  function specFor(m) {
    if (m.kind === 'browser') return { kind: 'browser', url: m.url || 'about:blank', model: { id: m.id, icon: m.icon || '🌐', name: m.name } };
    const root = CAI.ws?.root;
    const abs = (p) => (p && root && !/^[a-z]:|^[\\/]/i.test(p) ? Platform.joinPath(root, p) : p);
    const dir = abs(m.dir) || root || undefined;
    const base = m.kind === 'terminal' || !m.kind
      ? { kind: 'terminal', shellId: m.shellId || undefined, cwd: dir, commands: m.commands || '' }
      : { kind: m.kind, root: dir };
    return { ...base, model: { id: m.id, icon: m.icon || kindOf(m).icon, name: m.name } };
  }

  function open(m, space) {
    const spec = specFor(m);
    return CAI.openKind(space || null, spec.kind, { ...spec, title: m.name });
  }

  // Modèle d'onglet (non enregistré) décrivant un onglet ouvert
  function tabToModel(tab) {
    const s = CAI.serializeTab ? CAI.serializeTab(tab) : TabKinds[tab.kind].serialize(tab);
    const m = {
      id: uid(), name: tab.title, autoTitle: !tab.customTitle, icon: tab.icon || tab.model?.icon || KINDS[tab.kind]?.icon || '>_', kind: tab.kind,
      url: s.url,
      shellId: s.shellId || '', dir: s.cwd || s.root || '', commands: (s.commands || []).join ? (s.commands || []).join('\n') : (s.commands || ''),
    };
    const root = CAI.ws?.root;
    if (root && m.dir && Platform.withinPath(m.dir, root)) m.dir = m.dir.slice(root.replace(/[\\/]+$/, '').length).replace(/^[\\/]/, '');
    return m;
  }

  // Enregistre un modèle tiré de l'état actuel (onglet, espace ou écran) puis ouvre la fenêtre de gestion
  async function saveFrom(type, data, fromWs) {
    const m = { id: uid(), icon: TYPES[type].icon, ...data };
    if (type === 'tab') delete m.autoTitle;
    try { await addTo(type, fromWs, m); } catch (e) { UI.toast(e.message, { kind: 'error' }); return; }
    UI.toast(`${TYPES[type].one[0].toUpperCase()}${TYPES[type].one.slice(1)} « ${m.name} » enregistré${fromWs ? ' dans le workspace' : ''}`, { ms: 2000 });
    openManager(m.id, type);
  }
  // Élément de menu « Enregistrer comme modèle … » (général ou propre au workspace)
  function saveMenuItem(type, getData) {
    const label = `Enregistrer comme ${TYPES[type].one}`;
    if (!CAI.ws) return { label: `${label}…`, icon: '🧩', action: () => saveFrom(type, getData(), false) };
    return { label, icon: '🧩', submenu: [
      { label: 'Modèle général (tous les projets)', icon: '🌍', action: () => saveFrom(type, getData(), false) },
      { label: `Modèle du workspace ${CAI.ws.name}`, icon: '◆', hint: '.robot', action: () => saveFrom(type, getData(), true) },
    ] };
  }
  function fromTab(tab) { saveFrom('tab', tabToModel(tab), false); }

  // ---------- Disposition des modèles d'écran ----------
  // Retire la zone n° i de la disposition (et renumérote les suivantes)
  function dropLeaf(n, i) {
    if (!n) return null;
    if (n.t === 'leaf') return n.i === i ? null : { t: 'leaf', i: n.i > i ? n.i - 1 : n.i };
    const kids = [], sizes = [];
    n.children.forEach((c, j) => { const r = dropLeaf(c, i); if (r) { kids.push(r); sizes.push(n.sizes?.[j] ?? 1); } });
    if (!kids.length) return null;
    if (kids.length === 1) return kids[0];
    return { ...n, children: kids, sizes };
  }
  // Arbre d'index : { t: 'leaf', i } | { t: 'split', dir: 'row'|'col', children, sizes }
  const lsplit = (dir, children, sizes) => ({ t: 'split', dir, children, sizes: sizes || children.map(() => 1) });
  const lleaf = (i) => ({ t: 'leaf', i });
  // Retire les nœuds vides, fusionne les découpes de même sens, normalise les tailles
  function lnorm(n) {
    if (!n) return null;
    if (n.t === 'leaf') return n;
    const kids = [], sizes = [];
    n.children.forEach((c, j) => {
      const nc = lnorm(c);
      if (!nc) return;
      const s = n.sizes?.[j] ?? 1;
      if (nc.t === 'split' && nc.dir === n.dir) {
        const tot = nc.sizes.reduce((a, b) => a + b, 0) || 1;
        nc.children.forEach((cc, q) => { kids.push(cc); sizes.push((s * nc.sizes[q]) / tot); });
      } else { kids.push(nc); sizes.push(s); }
    });
    if (!kids.length) return null;
    if (kids.length === 1) return kids[0];
    const tot = sizes.reduce((a, b) => a + b, 0) || 1;
    return lsplit(n.dir, kids, sizes.map((s) => (s / tot) * kids.length));
  }
  // Disposition complète : chaque zone exactement une fois (les zones absentes sont ajoutées à droite)
  function fullLayout(layout, count) {
    const seen = new Set();
    const prune = (n) => {
      if (!n) return null;
      if (n.t === 'leaf') { if (n.i < 0 || n.i >= count || seen.has(n.i)) return null; seen.add(n.i); return lleaf(n.i); }
      return { t: 'split', dir: n.dir, sizes: [...(n.sizes || n.children.map(() => 1))], children: n.children.map(prune) };
    };
    let root = lnorm(prune(layout));
    const missing = [];
    for (let i = 0; i < count; i++) if (!seen.has(i)) missing.push(lleaf(i));
    if (missing.length) root = lnorm(lsplit('row', [...(root ? [root] : []), ...missing]));
    return root;
  }
  const withoutLeaf = (n, i) => (!n ? null : n.t === 'leaf' ? (n.i === i ? null : n) : { ...n, children: n.children.map((c) => withoutLeaf(c, i)) });
  const SIDES = { left: ['row', 0], right: ['row', 1], top: ['col', 0], bottom: ['col', 1] };
  // Place la zone i sur le côté « side » de la zone target (elle prend la moitié de sa place)
  function dockLeaf(tree, i, target, side) {
    const [dir, after] = SIDES[side];
    const put = (n) => {
      if (n.t === 'leaf') return n.i === target ? lsplit(dir, after ? [n, lleaf(i)] : [lleaf(i), n]) : n;
      return { ...n, children: n.children.map(put) };
    };
    const rest = lnorm(withoutLeaf(tree, i));
    return rest ? lnorm(put(rest)) : lleaf(i);
  }
  const swapLeaves = (n, a, b) => (n.t === 'leaf' ? lleaf(n.i === a ? b : n.i === b ? a : n.i) : { ...n, children: n.children.map((c) => swapLeaves(c, a, b)) });
  function presetLayout(kind, count) {
    if (!count) return null;
    const ids = [...Array(count).keys()];
    if (kind !== 'grid') return lnorm(lsplit(kind, ids.map(lleaf)));
    const cols = Math.ceil(Math.sqrt(count));
    const rows = [];
    for (let k = 0; k < count; k += cols) rows.push(lsplit('row', ids.slice(k, k + cols).map(lleaf)));
    return lnorm(lsplit('col', rows));
  }
  const roundSizes = (n) => (!n || n.t === 'leaf' ? n : { ...n, sizes: n.sizes.map((s) => +s.toFixed(4)), children: n.children.map(roundSizes) });

  // Éditeur de disposition d'un modèle d'écran
  // ops : { add(target, side), remove(i) }
  function layoutEditor(m, update, ops) {
    const zones = m.zones || [];
    const wrap = h('div', 'tm-lay-wrap');
    const box = h('div', 'tm-lay');
    let tree = fullLayout(m.layout, zones.length);
    const commit = (t, rerender = true) => { tree = t; update({ layout: roundSizes(t) }, rerender); };
    let dragFrom = null;
    const GUT = 6;

    const clearDrop = () => box.querySelectorAll('[data-drop]').forEach((x) => delete x.dataset.drop);
    const leafEl = (i) => {
      const z = zones[i] || {};
      const d = h('div', 'tm-lay-leaf');
      d.draggable = true;
      d.title = 'Glisser sur le bord d\'une autre zone pour l\'y ancrer, au centre pour les échanger';
      d.innerHTML = `<span class="tm-lay-name">${z.icon ? `${iconHtml(z.icon)} ` : ''}${esc(z.name || `Zone ${i + 1}`)}</span><span class="muted tm-lay-sub">${esc(summary('zone', z))}</span>`;
      const tools = h('div', 'tm-lay-tools');
      const tool = (txt, title, fn, cls = '') => {
        const b = h('button', `icon-btn ${cls}`, txt);
        b.title = title;
        b.draggable = false;
        b.addEventListener('mousedown', (e) => e.stopPropagation());
        b.addEventListener('click', (e) => { e.stopPropagation(); fn(); });
        tools.appendChild(b);
      };
      tool('⇢', 'Diviser : nouvelle zone à droite', () => ops.add(i, 'right'));
      tool('⇣', 'Diviser : nouvelle zone en dessous', () => ops.add(i, 'bottom'));
      tool('✕', 'Retirer cette zone de l\'écran', () => ops.remove(i), 'danger');
      d.appendChild(tools);
      const sideAt = (e) => {
        const r = d.getBoundingClientRect();
        const x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
        if (x > 0.3 && x < 0.7 && y > 0.3 && y < 0.7) return 'center';
        const dist = { left: x, right: 1 - x, top: y, bottom: 1 - y };
        return Object.keys(dist).reduce((a, b) => (dist[b] < dist[a] ? b : a));
      };
      d.addEventListener('dragstart', (e) => { dragFrom = i; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(i)); d.classList.add('dragging'); });
      d.addEventListener('dragend', () => { dragFrom = null; d.classList.remove('dragging'); clearDrop(); });
      d.addEventListener('dragover', (e) => {
        if (dragFrom == null || dragFrom === i) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        d.dataset.drop = sideAt(e);
      });
      d.addEventListener('dragleave', (e) => { if (!d.contains(e.relatedTarget)) delete d.dataset.drop; });
      d.addEventListener('drop', (e) => {
        if (dragFrom == null || dragFrom === i) return;
        e.preventDefault();
        const side = sideAt(e), from = dragFrom;
        dragFrom = null;
        clearDrop();
        commit(side === 'center' ? swapLeaves(tree, from, i) : dockLeaf(tree, from, i, side));
      });
      return d;
    };
    // Séparateur entre children[j-1] et children[j] : glisser = redimensionner, double-clic = tailles égales
    const gutterEl = (n, j, parentEl) => {
      const g = h('div', `tm-lay-gutter ${n.dir}`);
      g.title = 'Glisser pour redimensionner · double-clic : tailles égales';
      g.addEventListener('mousedown', (e) => {
        e.preventDefault();
        const horiz = n.dir === 'row';
        const prev = g.previousElementSibling, next = g.nextElementSibling;
        const r = parentEl.getBoundingClientRect();
        const tot = n.sizes.reduce((a, b) => a + b, 0);
        const unit = Math.max(1, (horiz ? r.width : r.height) - (n.children.length - 1) * GUT) / tot;
        const start = horiz ? e.clientX : e.clientY;
        const a0 = n.sizes[j - 1], pair = a0 + n.sizes[j], min = pair * 0.1;
        g.classList.add('active');
        document.body.style.cursor = horiz ? 'col-resize' : 'row-resize';
        const mv = (ev) => {
          const a = Math.max(min, Math.min(pair - min, a0 + ((horiz ? ev.clientX : ev.clientY) - start) / unit));
          n.sizes[j - 1] = a;
          n.sizes[j] = pair - a;
          prev.style.flex = `${a} 1 0`;
          next.style.flex = `${pair - a} 1 0`;
        };
        const up = () => {
          window.removeEventListener('mousemove', mv);
          window.removeEventListener('mouseup', up);
          g.classList.remove('active');
          document.body.style.cursor = '';
          commit(tree, false);
        };
        window.addEventListener('mousemove', mv);
        window.addEventListener('mouseup', up);
      });
      g.addEventListener('dblclick', () => { n.sizes = n.sizes.map(() => 1); commit(tree); });
      return g;
    };
    const build = (n) => {
      if (n.t === 'leaf') return leafEl(n.i);
      const d = h('div', `tm-lay-split ${n.dir}`);
      n.children.forEach((c, j) => {
        if (j) d.appendChild(gutterEl(n, j, d));
        const e = build(c);
        e.style.flex = `${n.sizes[j]} 1 0`;
        d.appendChild(e);
      });
      return d;
    };
    box.appendChild(tree ? build(tree) : h('div', 'tm-lay-leaf empty muted', 'Écran vide : ajoutez une zone'));
    wrap.appendChild(box);

    if (zones.length > 1) {
      const bar = h('div', 'tm-row tm-lay-bar');
      bar.appendChild(h('span', 'muted tm-lay-help', 'Glissez une zone sur le bord d\'une autre pour l\'y ancrer, au centre pour les échanger · tirez les séparateurs pour redimensionner'));
      const preset = (txt, title, kind) => {
        const b = h('button', 'tb-btn small', txt);
        b.title = title;
        b.addEventListener('click', () => commit(presetLayout(kind, zones.length)));
        bar.appendChild(b);
      };
      preset('▥ En ligne', 'Toutes les zones côte à côte', 'row');
      preset('☰ En colonne', 'Toutes les zones les unes sous les autres', 'col');
      preset('▦ Grille', 'Zones réparties en grille', 'grid');
      wrap.appendChild(bar);
    }
    return wrap;
  }

  // ---------- Fenêtre de gestion ----------
  let overlay = null;
  let projectOnly = false;
  let presetOnly = true;
  let curType = 'tab';
  const expanded = new Set(); // zones dépliées dans les modèles d'écran

  const HELP = {
    tab: 'Un modèle d\'onglet prépare un onglet prêt à l\'emploi : un terminal qui lance <code>npm run dev</code> dans <code>apps/api</code>, un explorateur sur un dossier, les tests ou Docker du workspace… Ouvrez-le depuis <b>＋ Espace</b>, le menu <b>▼</b> d\'un espace, un espace vide, ou d\'un clic droit sur un onglet (« Enregistrer comme modèle d\'onglet »).',
    zone: 'Un modèle de zone recrée un espace complet : son nom, son robot et tous ses onglets. Créez-le d\'un clic droit sur l\'en-tête d\'un espace (« Enregistrer comme modèle de zone »), puis ouvrez-le depuis <b>＋ Espace</b> ou ajoutez ses onglets à un espace existant via son menu <b>▼</b>.',
    screen: 'Un modèle d\'écran recrée un set de zones complet, avec sa disposition. Créez-le d\'un clic droit sur le numéro d\'un écran (« Enregistrer comme modèle d\'écran »), puis ouvrez-le avec le <b>＋</b> à droite des robots. Vous pouvez aussi partir d\'un écran vide : ajoutez des zones (<b>＋ Zone</b>), choisissez le robot de chacune (clic sur son visage : atelier) et dépliez-les (▸) pour configurer leurs onglets.',
  };

  function closeManager() { overlay?.remove(); overlay = null; }

  function openManager(focusId, type) {
    if (type && TYPES[type]) curType = type;
    if (!CAI.ws) projectOnly = false;
    if (focusId) {
      presetOnly = !!find(focusId, curType)?.builtin;
      projectOnly = wsModels(curType).some((m) => m.id === focusId);
    }
    overlay?.remove();
    overlay = h('div', 'overlay tm-overlay');
    const card = h('div', 'settings-card tm-card');
    const head = h('div', 'settings-head', '<h2>🧩 Modèles</h2>');
    const add = h('button', 'tb-btn primary', '＋ Nouveau');
    const close = h('button', 'icon-btn', '✕');
    head.append(add, close);
    const body = h('div', 'settings-body');
    const help = h('p', 'set-help');
    const list = h('div', 'tm-list');

    const types = h('div', 'tm-row tm-seg');
    const typeBtns = Object.entries(TYPES).map(([k, t]) => {
      const b = h('button', 'tb-btn', `${iconHtml(t.icon)} ${t.label}`);
      b.addEventListener('click', () => { curType = k; refresh(); });
      types.appendChild(b);
      return [k, b];
    });
    const scopes = h('div', 'tm-row tm-seg');
    const builtin = h('button', 'tb-btn', '⚡ Presets');
    const general = h('button', 'tb-btn', '🌍 Généraux');
    const project = h('button', 'tb-btn', '◆ Workspace');
    project.disabled = !CAI.ws;
    project.title = CAI.ws ? `Enregistrés dans ${Platform.joinPath(CAI.ws.name, '.robot', 'workspace.json')}` : 'Ouvrez un workspace';
    general.title = 'Disponibles dans tous les projets';
    builtin.addEventListener('click', () => { presetOnly = true; refresh(); });
    general.addEventListener('click', () => { presetOnly = false; projectOnly = false; refresh(); });
    project.addEventListener('click', () => { presetOnly = false; projectOnly = true; refresh(); });
    scopes.append(builtin, general, project);
    const bar = h('div', 'tm-row tm-bar');
    bar.append(types, h('span', 'tm-sep'), scopes);

    const refresh = (focus) => {
      for (const [k, b] of typeBtns) { b.classList.toggle('primary', k === curType); b.setAttribute('aria-pressed', String(k === curType)); }
      builtin.classList.toggle('primary', presetOnly);
      general.classList.toggle('primary', !presetOnly && !projectOnly);
      project.classList.toggle('primary', !presetOnly && projectOnly);
      builtin.setAttribute('aria-pressed', String(presetOnly));
      general.setAttribute('aria-pressed', String(!presetOnly && !projectOnly));
      project.setAttribute('aria-pressed', String(!presetOnly && projectOnly));
      help.innerHTML = HELP[curType];
      add.textContent = `＋ Nouveau ${TYPES[curType].one}`;
      render(list, focus);
    };

    body.append(help, bar, list);
    card.append(head, body);
    overlay.appendChild(card);
    document.body.appendChild(overlay);
    close.addEventListener('click', closeManager);
    overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) closeManager(); });
    card.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Escape') closeManager(); });

    add.addEventListener('click', async (e) => {
      e.stopPropagation();
      const create = async (m) => {
        try { await addTo(curType, projectOnly, m); } catch (err) { UI.toast(err.message, { kind: 'error' }); return; }
        presetOnly = false;
        refresh(m.id);
      };
      if (curType === 'tab') return create({ id: uid(), name: 'Nouveau modèle', icon: '🚀', kind: 'terminal', shellId: '', dir: '', commands: '' });
      const sp = CAI.activeSpace;
      const sc = CAI.currentScreen;
      const items = curType === 'zone'
        ? [
          { label: 'Zone vide (un terminal)', icon: '＋', action: () => create({ id: uid(), name: 'Nouvelle zone', icon: '🗂', seed: Robot.randomSeed(), tabs: [newTab()] }) },
          { label: sp ? `Copie de l'espace « ${sp.name} »` : 'Copie de l\'espace actif', icon: '⧉', disabled: !sp, action: () => create({ id: uid(), icon: '🗂', ...CAI.snapshotSpace(sp) }) },
        ]
        : [
          { label: 'Écran vide', icon: '＋', action: () => (() => { const id = uid(); expanded.add(`${id}:0`); return create({ id, name: 'Nouvel écran', icon: '▣', zones: [{ name: 'Zone 1', seed: Robot.randomSeed(), tabs: [newTab()] }], layout: null }); })() },
          { label: `Copie de l'écran « ${sc.name} »`, icon: '⧉', action: () => create({ id: uid(), icon: '▣', ...CAI.snapshotScreen(sc) }) },
        ];
      UI.menu(items, add);
    });
    refresh(focusId);
  }

  function render(list, focusId) {
    list.innerHTML = '';
    const type = curType;
    const models = presetOnly ? presets(type) : projectOnly ? wsModels(type) : generalList(type);
    list.appendChild(h('p', 'set-help', presetOnly
      ? 'Presets intégrés : ouvrez-les directement ou copiez-les pour les personnaliser. Les clients CLI doivent être installés et configurés ; aucune installation automatique. Choisissez un shell compatible avec le client (WSL si nécessaire).'
      : projectOnly ? `Modèles propres au workspace ${esc(CAI.ws.name)} (.robot/workspace.json, versionnable).` : 'Disponibles dans tous les projets.'));
    if (presetOnly) list.appendChild(h('p', 'set-help', 'Décochez « Afficher » pour masquer un preset dans les menus et suggestions. Il reste disponible ici pour le réactiver, sans modifier les onglets déjà ouverts ni les modèles qui l’utilisent.'));
    if (!models.length) list.appendChild(h('div', 'tool-empty', 'Aucun modèle dans cette catégorie.'));
    models.forEach((m) => list.appendChild(m.builtin ? presetCard(m, type) : type === 'tab' && m.fromWs && !projectList('tab').some((x) => x.id === m.id) ? readonlyCard(m) : card(list, type, m)));
    if (focusId) {
      const el = list.querySelector(`[data-id="${focusId}"]`);
      if (el) { el.scrollIntoView({ block: 'center' }); el.querySelector('.tm-name')?.select(); el.classList.add('flash'); }
    }
  }

  function presetCard(m, type) {
    const c = h('div', 'tm-item ro');
    c.dataset.id = m.id;
    const row = h('div', 'tm-row', `<span class="tm-big">${iconHtml(m.icon)}</span><b>${esc(m.name)}</b><span class="muted">${esc(type === 'tab' ? kindOf(m).label : summary(type, m))}</span>`);
    const visibility = h('label', 'tm-row');
    const check = h('input');
    check.type = 'checkbox';
    check.checked = presetVisible(m.id);
    check.addEventListener('change', () => {
      const hidden = (Settings.data.hiddenPresetIds || []).filter((id) => id !== m.id);
      if (!check.checked) hidden.push(m.id);
      try {
        Settings.set({ hiddenPresetIds: hidden });
        UI.closeMenus();
      } catch (err) {
        check.checked = presetVisible(m.id);
        UI.toast(err.message, { kind: 'error' });
      }
    });
    visibility.append(check, h('span', '', 'Afficher'));
    const openB = h('button', 'tb-btn small primary', '▶ Ouvrir');
    openB.title = type === 'screen' ? 'Ouvrir dans un nouvel écran' : 'Ouvrir dans un nouvel espace (Maj : dans l\'espace actif)';
    openB.addEventListener('click', (e) => {
      closeManager();
      if (type === 'tab') open(m, e.shiftKey ? CAI.activeSpace : null);
      else if (type === 'zone') CAI.openZoneModel(m, e.shiftKey ? CAI.activeSpace : null);
      else CAI.openScreenModel(m);
    });
    const copyB = h('button', 'tb-btn small', '⧉ Personnaliser');
    copyB.addEventListener('click', async () => {
      const copy = JSON.parse(JSON.stringify(clean(m)));
      copy.id = uid();
      for (const z of copy.zones || []) {
        z.id = uid();
        for (const t of z.tabs || []) t.id = uid();
      }
      for (const t of copy.tabs || []) t.id = uid();
      try {
        await addTo(type, projectOnly, copy);
        openManager(copy.id, type);
      } catch (err) { UI.toast(err.message, { kind: 'error' }); }
    });
    row.append(visibility, openB, copyB);
    c.appendChild(row);
    if (type === 'tab' && m.commands) c.appendChild(h('pre', 'set-help', esc(m.commands)));
    if (type === 'zone') c.appendChild(h('div', 'tm-chips', (m.tabs || []).map((t) => `<span class="tm-chip">${iconHtml(t.icon)} ${esc(t.name)}</span>`).join('')));
    if (type === 'screen') c.appendChild(h('div', 'tm-chips', (m.zones || []).map((z) => `<span class="tm-chip">${iconHtml(z.icon)} ${esc(z.name)}</span>`).join('')));
    return c;
  }

  function readonlyCard(m) {
    const c = h('div', 'tm-item ro');
    c.innerHTML = `<div class="tm-row"><span class="tm-big">${iconHtml(m.icon)}</span><b>${esc(m.name)}</b><span class="muted">${esc(kindOf(m).label)}${m.dir ? ' · ' + esc(m.dir) : ''}</span></div>`;
    const b = h('button', 'tb-btn small', '▶ Ouvrir');
    b.addEventListener('click', () => { closeManager(); open(m); });
    c.querySelector('.tm-row').appendChild(b);
    return c;
  }

  // Grille de choix d'icône sous « anchor ». allowNone : propose « aucune icône » (onPick(null))
  // Sélecteur complet (recherche, catégories, récents) ; ICONS sert de « Suggestions »
  function pickIcon(anchor, onPick, allowNone) {
    EmojiPicker.open(anchor, { onPick, allowNone, suggestions: ICONS, render: iconHtml, tools: true });
  }

  function iconButton(icon, onPick, allowNone) {
    const btn = h('button', 'tm-icon-btn', icon || !allowNone ? iconHtml(icon) : '<span class="tm-icon-none">∅</span>');
    btn.title = allowNone ? 'Icône de la zone (affichée à côté de son nom)' : 'Changer l\'icône';
    btn.addEventListener('click', () => pickIcon(btn, onPick, allowNone));
    return btn;
  }

  // Robot d'une zone : aperçu (clic = atelier), nouveau tirage, ou robot au hasard à chaque ouverture
  // get() : la zone à jour · upd(patch, rerender)
  function robotControl(get, upd) {
    const z = get();
    const wrap = h('div', 'tm-robot');
    const face = h('button', 'tm-robot-face');
    if (z.seed != null) {
      const bot = Robot.generate(z.seed, { traits: z.traits });
      const r = h('div', 'robot', bot.svg);
      r.style.setProperty('--blink-delay', `-${bot.blinkDelay}s`);
      face.appendChild(r);
      face.style.setProperty('--space-accent', Themes.spaceAccent(bot));
      face.title = `Robot : ${bot.name}\nCliquer pour le personnaliser (atelier)`;
    } else {
      face.innerHTML = '<span class="tm-robot-rand">🎲</span>';
      face.title = 'Robot tiré au hasard à chaque ouverture\nCliquer pour en choisir un (atelier)';
    }
    face.addEventListener('click', () => {
      const cur = get();
      RobotStudio.open({
        seed: cur.seed ?? Robot.randomSeed(), traits: cur.traits, title: cur.name || 'Zone',
        contextKind: cur.tabs?.[cur.activeTab || 0]?.kind,
        onApply: (seed, traits) => upd({ seed, traits: traits || undefined }, true),
      });
    });
    const menu = h('button', 'icon-btn tm-robot-more', '▾');
    menu.title = 'Options du robot';
    menu.addEventListener('click', (e) => {
      e.stopPropagation();
      const cur = get();
      UI.menu([
        { title: 'Robot de la zone' },
        { label: 'Personnaliser (atelier)…', icon: '🛠', action: () => face.click() },
        // Nouvelle allure, même outil (jamais une icône tirée au hasard)
        { label: 'Nouveau robot', icon: '🎲', action: () => upd({ seed: Robot.randomSeed(), traits: { tool: cur.seed != null ? Robot.generate(cur.seed, { traits: cur.traits }).traits.tool : 'none' } }, true) },
        { label: 'Prendre le robot de l\'espace actif', icon: '🤖', disabled: !CAI.activeSpace, action: () => upd({ seed: CAI.activeSpace.seed, traits: CAI.activeSpace.traits || undefined }, true) },
        '-',
        { label: 'Au hasard à chaque ouverture', icon: '✕', checked: cur.seed == null, disabled: cur.seed == null, action: () => upd({ seed: undefined, traits: undefined }, true) },
      ], menu);
    });
    wrap.append(face, menu);
    return wrap;
  }

  const summary = (type, m) => {
    if (type === 'zone') { const n = (m.tabs || []).length; return `${n} onglet${n > 1 ? 's' : ''}`; }
    const z = (m.zones || []).length;
    const t = (m.zones || []).reduce((a, x) => a + (x.tabs || []).length, 0);
    return `${z} zone${z > 1 ? 's' : ''} · ${t} onglet${t > 1 ? 's' : ''}`;
  };

  // Carte d'un modèle (onglet, zone ou écran)
  function card(list, type, m) {
    const c = h('div', 'tm-item');
    c.dataset.id = m.id;
    // Mise à jour optimiste : m est modifié tout de suite, puis la liste entière est enregistrée
    const update = async (patch, rerender) => {
      Object.assign(m, patch);
      const next = listOf(type, m.fromWs).map((x) => (x.id === m.id ? clean(m) : x));
      if (rerender) { const nc = card(list, type, m); c.replaceWith(nc); }
      else c.querySelector(':scope > .tm-row .tm-count')?.replaceChildren(summary(type, m));
      try { await saveList(type, m.fromWs, next); } catch (e) { UI.toast(e.message, { kind: 'error' }); }
    };
    const row1 = h('div', 'tm-row');
    let fields = null;
    if (type === 'tab') {
      fields = tabFields(m, update, false);
      row1.append(fields.iconBtn, fields.name, fields.kind);
    } else {
      const name = h('input', 'set-input tm-name');
      name.value = m.name || '';
      name.placeholder = type === 'zone' ? 'Nom de la zone' : 'Nom de l\'écran';
      name.addEventListener('input', () => update({ name: name.value }));
      row1.append(type === 'zone' ? iconButton(m.icon, (ic) => update({ icon: ic || undefined }, true), true) : iconButton(m.icon || TYPES[type].icon, (ic) => update({ icon: ic }, true)));
      if (type === 'zone') row1.appendChild(robotControl(() => m, update));
      row1.append(name, h('span', 'muted tm-count', esc(summary(type, m))));
    }
    const openB = h('button', 'tb-btn small primary', '▶ Ouvrir');
    openB.title = type === 'screen' ? 'Ouvrir dans un nouvel écran' : 'Ouvrir dans un nouvel espace (Maj : dans l\'espace actif)';
    const openIt = (inActive) => {
      closeManager();
      if (type === 'tab') open(m, inActive ? CAI.activeSpace : null);
      else if (type === 'zone') CAI.openZoneModel(m, inActive ? CAI.activeSpace : null);
      else CAI.openScreenModel(m);
    };
    openB.addEventListener('click', (e) => openIt(e.shiftKey && type !== 'screen'));
    const more = h('button', 'icon-btn', '⋯');
    more.addEventListener('click', (e) => {
      e.stopPropagation();
      const other = !m.fromWs;
      const otherName = other ? `le workspace ${CAI.ws?.name || ''}` : 'les modèles généraux';
      UI.menu([
        type === 'tab' && { label: 'Ouvrir dans l\'espace actif', icon: '▶', action: () => openIt(true) },
        type === 'zone' && { label: 'Ajouter ses onglets à l\'espace actif', icon: '▶', disabled: !CAI.activeSpace, action: () => openIt(true) },
        { label: 'Dupliquer', icon: '⧉', action: async () => {
          const copy = { ...JSON.parse(JSON.stringify(clean(m))), id: uid(), name: `${m.name} (copie)` };
          try { await addTo(type, m.fromWs, copy); render(list, copy.id); } catch (err) { UI.toast(err.message, { kind: 'error' }); }
        } },
        CAI.ws && { label: `Copier dans ${otherName}`, icon: '📤', action: async () => {
          try { await addTo(type, other, { ...clean(m), id: uid() }); UI.toast(`Copié dans ${otherName}`); } catch (err) { UI.toast(err.message, { kind: 'error' }); }
        } },
        CAI.ws && { label: `Déplacer vers ${otherName}`, icon: '↦', action: async () => {
          try {
            await addTo(type, other, clean(m));
            await saveList(type, m.fromWs, listOf(type, m.fromWs).filter((x) => x.id !== m.id));
            UI.toast(`Déplacé vers ${otherName}`);
            render(list);
          } catch (err) { UI.toast(err.message, { kind: 'error' }); }
        } },
        '-',
        { label: 'Supprimer', icon: '🗑', danger: true, action: async () => {
          try { await saveList(type, m.fromWs, listOf(type, m.fromWs).filter((x) => x.id !== m.id)); render(list); } catch (err) { UI.toast(err.message, { kind: 'error' }); }
        } },
      ], more);
    });
    row1.append(openB, more);
    c.appendChild(row1);

    if (type === 'tab') { c.appendChild(fields.row2); if (fields.cmds) c.appendChild(fields.cmds); }
    else if (type === 'zone') c.appendChild(zoneBody(() => m, update));
    else c.appendChild(screenBody(m, update));
    return c;
  }

  // Champs d'un modèle d'onglet. upd(patch, rerender). inZone : le titre peut rester automatique
  function tabFields(t, upd, inZone) {
    const kindName = t.kind || 'terminal';
    const iconBtn = iconButton(t.icon, (ic) => upd({ icon: ic }, true));
    const name = h('input', 'set-input tm-name');
    name.value = inZone && t.autoTitle ? '' : t.name || '';
    name.placeholder = inZone ? 'Titre (vide = automatique)' : 'Nom de l\'onglet';
    name.addEventListener('input', () => upd(inZone ? { name: name.value, autoTitle: !name.value } : { name: name.value }));
    const kind = h('select', 'set-input small');
    kind.innerHTML = Object.entries(KINDS).map(([k, v]) => `<option value="${k}">${esc(v.icon)} ${v.label}</option>`).join('');
    kind.value = kindName;
    kind.addEventListener('change', () => upd({ kind: kind.value, icon: t.icon === kindOf(t).icon ? KINDS[kind.value].icon : t.icon }, true));

    const row2 = h('div', 'tm-row');
    const dir = h('input', 'set-input');
    dir.value = kindName === 'browser' ? t.url || '' : t.dir || '';
    dir.placeholder = kindName === 'terminal' ? 'Dossier de départ (relatif au workspace, facultatif)' : 'Dossier (vide = racine du workspace)';
    if (kindName === 'browser') dir.placeholder = 'Adresse web (HTTP ou HTTPS)';
    dir.addEventListener('input', () => upd(kindName === 'browser' ? { url: dir.value } : { dir: dir.value }));
    row2.appendChild(dir);
    if (kindName !== 'browser') {
      const pick = h('button', 'icon-btn', '📂');
      pick.title = 'Choisir un dossier';
      pick.addEventListener('click', async () => {
        const p = await window.api.pickFolder(dir.value || CAI.ws?.root);
        if (!p) return;
        const root = CAI.ws?.root;
        const v = root && Platform.withinPath(p, root) ? p.slice(root.replace(/[\\/]+$/, '').length).replace(/^[\\/]/, '') : p;
        dir.value = v;
        upd({ dir: v });
      });
      row2.appendChild(pick);
    }
    let cmds = null;
    if (kindName === 'terminal') {
      const sh = h('select', 'set-input small');
      sh.innerHTML = '<option value="">Shell par défaut</option>' + CAI.shells.map((s) => `<option value="${s.id}">${esc(s.label)}</option>`).join('');
      sh.value = t.shellId || '';
      sh.addEventListener('change', () => upd({ shellId: sh.value }));
      row2.appendChild(sh);
      cmds = h('textarea', 'set-input tpl-cmds');
      cmds.value = t.commands || '';
      cmds.rows = Math.max(2, Math.min(6, (t.commands || '').split('\n').length + 1));
      cmds.placeholder = 'Commandes lancées au démarrage, une par ligne\nex. : pnpm install\n         pnpm --filter @mj/api dev';
      cmds.spellcheck = false;
      cmds.addEventListener('input', () => upd({ commands: cmds.value }));
    }
    return { iconBtn, name, kind, row2, cmds };
  }

  // Onglets d'une zone. get() : la zone à jour · upd(patch, rerender) : modifie la zone
  function zoneBody(get, upd) {
    const wrap = h('div', 'tm-sub-list');
    const tabs = () => get().tabs || [];
    tabs().forEach((t, i) => {
      const sub = h('div', 'tm-sub');
      const updT = (patch, rr) => upd({ tabs: tabs().map((x, j) => (j === i ? { ...x, ...patch } : x)) }, rr);
      const f = tabFields(t, updT, true);
      const move = (d) => { const a = [...tabs()]; [a[i], a[i + d]] = [a[i + d], a[i]]; upd({ tabs: a }, true); };
      const up = h('button', 'icon-btn', '↑');
      up.title = 'Monter';
      up.disabled = i === 0;
      up.addEventListener('click', () => move(-1));
      const down = h('button', 'icon-btn', '↓');
      down.title = 'Descendre';
      down.disabled = i === tabs().length - 1;
      down.addEventListener('click', () => move(1));
      const del = h('button', 'icon-btn danger', '✕');
      del.title = 'Retirer cet onglet';
      del.addEventListener('click', () => upd({ tabs: tabs().filter((_, j) => j !== i) }, true));
      const row = h('div', 'tm-row');
      row.append(f.iconBtn, f.name, f.kind, up, down, del);
      sub.append(row, f.row2);
      if (f.cmds) sub.appendChild(f.cmds);
      wrap.appendChild(sub);
    });
    if (!tabs().length) wrap.appendChild(h('div', 'muted tm-none', 'Aucun onglet : la zone s\'ouvrira vide.'));
    const actions = h('div', 'tm-row');
    const addT = h('button', 'tb-btn small', '＋ Onglet');
    addT.addEventListener('click', () => upd({ tabs: [...tabs(), newTab()] }, true));
    actions.appendChild(addT);
    const models = all('tab');
    if (models.length) {
      const addM = h('button', 'tb-btn small', '🧩 Depuis un modèle d\'onglet');
      addM.addEventListener('click', (e) => {
        e.stopPropagation();
        UI.menu(models.map((m) => ({ label: m.name, icon: iconHtml(m.icon), hint: kindOf(m).label, action: () => upd({ tabs: [...tabs(), { ...clean(m), id: uid(), autoTitle: false }] }, true) })), addM);
      });
      actions.appendChild(addM);
    }
    wrap.appendChild(actions);
    return wrap;
  }

  // Zones d'un modèle d'écran + aperçu de la disposition
  function screenBody(m, update) {
    const wrap = h('div', 'tm-sub-list');
    const zones = () => m.zones || [];
    const clearExpanded = () => { for (const x of [...expanded]) if (x.startsWith(`${m.id}:`)) expanded.delete(x); };
    const removeZone = (k) => {
      clearExpanded();
      update({ zones: zones().filter((_, j) => j !== k), layout: dropLeaf(fullLayout(m.layout, zones().length), k) }, true);
    };
    // Ajoute une zone ; target/side : à côté d'une zone existante (sinon à droite de l'écran)
    const addZone = (zone, target, side) => {
      const n = zones().length;
      expanded.add(`${m.id}:${n}`);
      const full = fullLayout(m.layout, n);
      update({ zones: [...zones(), zone], layout: target != null && full ? roundSizes(dockLeaf(full, n, target, side)) : m.layout }, true);
    };
    const blankZone = () => ({ name: `Zone ${zones().length + 1}`, seed: Robot.randomSeed(), tabs: [newTab()] });
    wrap.appendChild(layoutEditor(m, update, { add: (target, side) => addZone(blankZone(), target, side), remove: removeZone }));
    zones().forEach((z, k) => {
      const key = `${m.id}:${k}`;
      const sub = h('div', 'tm-sub tm-zone');
      const updZ = (patch, rr) => update({ zones: zones().map((x, j) => (j === k ? { ...x, ...patch } : x)) }, rr);
      const row = h('div', 'tm-row');
      const fold = h('button', 'icon-btn', expanded.has(key) ? '▾' : '▸');
      fold.title = 'Afficher / masquer les onglets';
      const name = h('input', 'set-input tm-zname');
      name.value = z.name || '';
      name.placeholder = 'Nom de la zone';
      name.addEventListener('input', () => updZ({ name: name.value }));
      const tabsSum = h('span', 'tm-chips');
      tabsSum.innerHTML = (z.tabs || []).map((t) => `<span class="tm-chip">${iconHtml(t.icon)} ${esc(t.autoTitle ? kindOf(t).label : t.name || kindOf(t).label)}</span>`).join('') || '<span class="muted">vide</span>';
      const del = h('button', 'icon-btn danger', '✕');
      del.title = 'Retirer cette zone de l\'écran';
      del.addEventListener('click', () => removeZone(k));
      row.append(fold, iconButton(z.icon, (ic) => updZ({ icon: ic || undefined }, true), true), robotControl(() => zones()[k], updZ), name, tabsSum, del);
      sub.appendChild(row);
      let body = null;
      const show = () => { body = zoneBody(() => zones()[k], updZ); sub.appendChild(body); };
      if (expanded.has(key)) show();
      fold.addEventListener('click', () => {
        if (expanded.has(key)) { expanded.delete(key); body?.remove(); body = null; fold.textContent = '▸'; }
        else { expanded.add(key); show(); fold.textContent = '▾'; }
      });
      wrap.appendChild(sub);
    });
    const actions = h('div', 'tm-row');
    const addZ = h('button', 'tb-btn small', '＋ Zone');
    addZ.title = 'Ajoutée à droite à l\'ouverture';
    addZ.addEventListener('click', () => addZone(blankZone()));
    actions.appendChild(addZ);
    const zm = all('zone');
    if (zm.length) {
      const addM = h('button', 'tb-btn small', '🗂 Depuis un modèle de zone');
      addM.addEventListener('click', (e) => {
        e.stopPropagation();
        UI.menu(zm.map((z) => ({ label: z.name, icon: iconHtml(z.icon || '🗂'), hint: summary('zone', z), action: () => {
          const { id, fromWs, builtin, ...rest } = z;
          addZone(JSON.parse(JSON.stringify(rest)));
        } })), addM);
      });
      actions.appendChild(addM);
    }
    wrap.appendChild(actions);
    return wrap;
  }

  // ---------- Éléments de menu « ouvrir un modèle » ----------
  function menuItems(space) {
    const models = all('tab');
    return [
      ...models.map((m) => ({ label: m.name, icon: iconHtml(m.icon), hint: `${kindOf(m).label}${m.builtin ? ' · preset' : m.fromWs ? ' · workspace' : ''}`, action: () => open(m, space) })),
      models.length ? '-' : { label: 'Aucun modèle pour l\'instant', disabled: true },
      { label: 'Gérer les modèles…', icon: '🧩', action: () => openManager(null, 'tab') },
    ];
  }
  function zoneMenuItems(space) {
    const models = all('zone');
    return [
      ...models.map((z) => ({ label: z.name, icon: iconHtml(z.icon || '🗂'), hint: `${summary('zone', z)}${z.builtin ? ' · preset' : z.fromWs ? ' · workspace' : ''}`, action: () => CAI.openZoneModel(z, space) })),
      models.length ? '-' : { label: 'Aucun modèle de zone', disabled: true },
      { label: 'Gérer les modèles de zone…', icon: '🧩', action: () => openManager(null, 'zone') },
    ];
  }
  function screenMenuItems() {
    const models = all('screen');
    return [
      ...models.map((s) => ({ label: s.name, icon: iconHtml(s.icon || '▣'), hint: `${summary('screen', s)}${s.builtin ? ' · preset' : s.fromWs ? ' · workspace' : ''}`, action: () => CAI.openScreenModel(s) })),
      models.length ? '-' : { label: 'Aucun modèle d\'écran', disabled: true },
      { label: 'Gérer les modèles d\'écran…', icon: '🧩', action: () => openManager(null, 'screen') },
    ];
  }

  window.TabModels = {
    KINDS, TYPES, all, find, open, specFor, tabToModel, fromTab, fromLegacy, openManager, iconHtml,
    menuItems, zoneMenuItems, screenMenuItems, saveMenuItem, summary, pickIcon,
  };
})();
