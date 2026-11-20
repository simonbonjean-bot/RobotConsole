// RobotConsole — onglet « Tests » : catégories (unitaires, règles métier, intégration, end-to-end…),
// suites par paquet, arbre des tests, exécution, échecs, sortie, mode surveillance
(function () {
  const api = window.api;
  const { h, esc } = UI;
  const byWatch = new Map();
  const byRun = new Map();
  let runSeq = 0;
  let CATS = null;

  const ICON = { passed: '✓', failed: '✗', skipped: '○', running: '◌', idle: '·' };
  const LABEL = { passed: 'Réussi', failed: 'Échec', skipped: 'Ignoré', running: 'En cours', idle: 'Pas encore lancé' };
  const KIND_ICON = { 'suite-root': '📦', file: '🗎', suite: '◇', test: '' };

  const TestsTab = {
    icon: '<span class="kind-tests">🧪</span>',
    defaultTitle() { return 'Tests'; },

    mount(tab, spec) {
      const t = tab.t = {
        root: spec.root, tree: [], results: {}, status: new Map(), expanded: new Set(spec.expanded || []),
        selected: null, filter: '', show: spec.show || 'all', watch: !!spec.watch, running: null, info: null, lastRun: null,
        outH: spec.outH || 180, outOpen: spec.outOpen ?? false,
      };
      tab.pane.classList.add('tests-pane', 'tool-pane');

      const bar = h('div', 'tool-bar');
      t.fwEl = h('span', 'tool-badge', '…');
      t.sumEl = h('div', 'tt-summary');
      const btn = (html, title, fn, cls = 'icon-btn') => { const b = h('button', cls, html); b.title = title; b.addEventListener('click', fn); return b; };
      t.runAll = btn('▶ Tout lancer', 'Lancer toutes les suites', () => run(tab, { all: true }), 'tb-btn small primary');
      t.runFailed = btn('↻ Échecs', 'Relancer les tests en échec', () => runFailed(tab), 'tb-btn small');
      t.stopBtn = btn('■ Arrêter', 'Arrêter l\'exécution', () => t.running && api.testsStop(t.running), 'tb-btn small danger-btn hidden');
      t.detectBtn = btn('🔍 Détecter', 'Détecter les tests du workspace et générer .robot/tests.json', () => detect(tab), 'tb-btn small');
      t.watchBtn = btn('👁', 'Mode surveillance : relance automatiquement à chaque modification', () => setWatch(tab, !t.watch), 'icon-btn toggle');
      const search = h('input', 'set-input tool-search');
      search.placeholder = 'Filtrer…';
      search.addEventListener('input', () => { t.filter = search.value.toLowerCase(); renderTree(tab); });
      search.addEventListener('keydown', (e) => e.stopPropagation());
      const show = h('select', 'set-input small');
      show.innerHTML = '<option value="all">Tous</option><option value="failed">Échecs</option><option value="passed">Réussis</option><option value="skipped">Ignorés</option>';
      show.value = t.show;
      show.addEventListener('change', () => { t.show = show.value; renderTree(tab); CAI.save(); });
      bar.append(t.fwEl, t.sumEl, h('div', 'tb-spacer'), search, show, t.runAll, t.runFailed, t.stopBtn, t.detectBtn, t.watchBtn,
        btn('⟳', 'Recharger la liste des tests', () => discover(tab)),
        btn('⋯', 'Plus', (e) => UI.menu(moreMenu(tab), e.currentTarget)));
      t.banner = h('div', 'tt-banner hidden');
      t.progress = h('div', 'tool-progress hidden', '<i></i>');

      const main = h('div', 'tool-main');
      t.treeEl = h('div', 'tt-tree');
      t.treeEl.tabIndex = 0;
      t.detail = h('div', 'tt-detail');
      const split = h('div', 'ex-split');
      main.append(t.treeEl, split, t.detail);
      split.addEventListener('mousedown', (e) => dragWidth(e, t.treeEl, tab));

      const outWrap = h('div', 'tt-out' + (t.outOpen ? ' open' : ''));
      const outHead = h('div', 'tt-out-head', '<span>Sortie</span>');
      const outToggle = h('button', 'icon-btn', t.outOpen ? '▾' : '▴');
      const outClear = h('button', 'icon-btn', '⌫');
      outClear.title = 'Effacer';
      outHead.append(h('div', 'tb-spacer'), outClear, outToggle);
      const outBody = h('div', 'tt-out-body');
      outBody.style.height = `${t.outH}px`;
      outWrap.append(outHead, outBody);
      t.outWrap = outWrap;
      t.toggleOut = (force) => {
        t.outOpen = force ?? !t.outOpen;
        outWrap.classList.toggle('open', t.outOpen);
        outToggle.textContent = t.outOpen ? '▾' : '▴';
        requestAnimationFrame(() => fitOut(tab));
        CAI.save();
      };
      outHead.addEventListener('dblclick', () => t.toggleOut());
      outToggle.addEventListener('click', () => t.toggleOut());
      outClear.addEventListener('click', () => t.term.clear());
      tab.pane.append(bar, t.banner, t.progress, main, outWrap);

      t.term = new Terminal({ fontFamily: Settings.data.fontFamily, fontSize: Math.max(10, Settings.data.fontSize - 1), disableStdin: true, scrollback: 30000, theme: Themes.terminal(tab.space.bot) });
      t.fit = new FitAddon.FitAddon();
      t.term.loadAddon(t.fit);
      t.term.open(outBody);
      new ResizeObserver(() => fitOut(tab)).observe(outBody);

      t.treeEl.addEventListener('keydown', (e) => treeKey(tab, e));
      api.watch(tab.id, t.root);
      byWatch.set(tab.id, tab);
      setWatch(tab, t.watch, true);
      discover(tab);
    },

    activate(tab) { fitOut(tab); },
    focus(tab) { tab.t.treeEl.focus(); },
    resize(tab) { fitOut(tab); },
    dispose(tab) {
      const t = tab.t;
      if (t.running) api.testsStop(t.running);
      api.unwatch(tab.id);
      byWatch.delete(tab.id);
      t.term.dispose();
    },
    serialize(tab) {
      const t = tab.t;
      return { root: t.root, watch: t.watch || undefined, show: t.show, outOpen: t.outOpen, expanded: [...t.expanded].slice(0, 300) };
    },
    applyTheme(tab) { tab.t.term.options.theme = Themes.terminal(tab.space.bot); },
  };

  function fitOut(tab) { if (tab.t.outWrap.classList.contains('open') && tab.pane.offsetParent) { try { tab.t.fit.fit(); } catch {} } }

  function dragWidth(e, el, tab) {
    e.preventDefault();
    const x0 = e.clientX, w0 = el.offsetWidth;
    const move = (ev) => { el.style.width = `${Math.max(220, Math.min(w0 + ev.clientX - x0, tab.pane.offsetWidth - 240))}px`; };
    const up = () => { removeEventListener('mousemove', move); removeEventListener('mouseup', up); };
    addEventListener('mousemove', move);
    addEventListener('mouseup', up);
  }

  // ---------- Découverte / détection ----------
  async function discover(tab) {
    const t = tab.t;
    if (!CATS) CATS = await api.testsCategories();
    t.treeEl.innerHTML = '<div class="tool-empty"><div class="spinner"></div>Recherche des tests…</div>';
    let res;
    try { res = await api.testsDiscover(t.root); } catch (e) { res = { tree: [], suites: [], error: e.message }; }
    t.info = res;
    t.tree = res.tree || [];
    t.fwEl.textContent = res.frameworks?.length ? res.frameworks.join(' · ') : 'Aucun framework';
    t.fwEl.classList.toggle('muted', !res.frameworks?.length);
    if (t.expanded.size === 0) t.tree.forEach((c) => { t.expanded.add(c.id); c.children.forEach((s) => t.expanded.add(s.id)); });
    indexTree(tab);
    applyResults(tab);
    renderBanner(tab);
    renderTree(tab);
    renderDetail(tab);
    const n = count(t.tree);
    if (!res.suites?.length) CAI.say(tab.space, 'Je ne trouve pas de tests ici…');
    else if (!t.greeted) { t.greeted = true; CAI.say(tab.space, `${n} tests dans ${res.suites.length} suite${res.suites.length > 1 ? 's' : ''} !`, 2200); }
  }

  async function detect(tab) {
    const t = tab.t;
    if (t.info?.configured && !(await UI.confirm('Redétecter les tests ?', 'Le fichier <code>.robot/tests.json</code> sera régénéré. Les noms et arguments que vous avez ajustés sur les suites existantes sont conservés.', { ok: 'Détecter' }))) return;
    t.detectBtn.disabled = true;
    CAI.say(tab.space, 'J\'inspecte le workspace…', 1500);
    try {
      const cfg = await api.testsGenerate(t.root);
      const byCat = {};
      for (const s of cfg.suites) byCat[s.category] = (byCat[s.category] || 0) + 1;
      UI.toast(`tests.json généré : ${cfg.suites.length} suite(s) — ${Object.entries(byCat).map(([c, n]) => `${CATS[c]?.name || c} ${n}`).join(', ')}`, { ms: 5000 });
      t.expanded.clear();
      await discover(tab);
    } catch (e) { UI.toast(e.message, { kind: 'error' }); }
    t.detectBtn.disabled = false;
  }

  function renderBanner(tab) {
    const t = tab.t;
    const i = t.info || {};
    let html = '';
    if (i.legacy) html = '⚠ <b>Ancienne configuration</b> : une seule commande, la liste des tests n\'est connue qu\'après exécution.';
    else if (i.generated && i.suites?.length) html = 'ℹ Suites détectées automatiquement (non enregistrées).';
    t.banner.classList.toggle('hidden', !html);
    if (!html) return;
    t.banner.innerHTML = `<span>${html}</span>`;
    const b = h('button', 'tb-btn small primary', i.legacy ? '🔍 Détecter les tests du workspace' : '💾 Enregistrer dans .robot/tests.json');
    b.addEventListener('click', () => detect(tab));
    t.banner.appendChild(b);
  }

  function count(nodes) { return nodes.reduce((a, n) => a + (n.kind === 'test' ? 1 : count(n.children || [])), 0); }

  function indexTree(tab) {
    const t = tab.t;
    t.index = new Map();
    const walk = (n, parent) => { n.parent = parent; t.index.set(n.id, n); (n.children || []).forEach((c) => walk(c, n)); };
    t.tree.forEach((n) => walk(n, null));
  }

  function resultFor(t, n) {
    const r = t.results;
    if (r[n.id]) return r[n.id];
    if (n.kind === 'suite-root') return r[`suite:${n.suiteId}`];
    if (n.kind !== 'test') return null;
    const pre = `${n.suiteId}::junit:`;
    if (n.nodeid) {
      const parts = n.nodeid.split('::');
      const mod = parts[0].replace(/\.py$/, '').replace(/[\\/]/g, '.');
      const k = `${pre}${[mod, ...parts.slice(1, -1)].join('.')}::${parts[parts.length - 1]}`;
      if (r[k]) return r[k];
    }
    const same = (f) => f && n.file && f.toLowerCase() === n.file.toLowerCase();
    let byName = null;
    for (const [k, v] of Object.entries(r)) {
      if (!k.startsWith(pre) || v.name !== n.name) continue;
      if (same(v.file)) return v;
      byName = byName || v;
    }
    return byName;
  }

  // Résultats sans nœud (tests dynamiques, ancienne config) : rangés dans leur suite
  function applyResults(tab) {
    const t = tab.t;
    const used = new Set();
    const visit = (n) => {
      if (n.kind === 'test' || n.kind === 'suite-root') { const r = resultFor(t, n); if (r) { used.add(r); t.status.set(n.id, r.status); } }
      (n.children || []).forEach(visit);
    };
    t.tree.forEach(visit);
    for (const [key, r] of Object.entries(t.results)) {
      if (used.has(r) || key.startsWith('suite:')) continue;
      const sid = key.split('::')[0];
      const suiteNode = t.index.get(`suite:${sid}`);
      if (!suiteNode) continue;
      const rest = key.slice(sid.length + 2);
      const fileKey = rest.startsWith('junit:') ? (r.classname || 'Autres') : rest.split('::')[0];
      const fid = `${sid}::${fileKey}`;
      let fileNode = suiteNode.children.find((n) => n.id === fid);
      if (!fileNode) { fileNode = { id: fid, name: fileKey, kind: 'file', children: [], file: r.file, suiteId: sid }; suiteNode.children.push(fileNode); }
      if (!fileNode.children.find((c) => c.id === key)) fileNode.children.push({ id: key, name: r.path?.join(' › ') || r.name || key, kind: 'test', file: r.file, line: r.line, suiteId: sid, dynamic: true });
      t.status.set(key, r.status);
    }
    indexTree(tab);
  }

  function nodeStatus(t, n) {
    if (n.kind === 'test') return t.status.get(n.id) || 'idle';
    const own = n.kind === 'suite-root' ? t.status.get(n.id) : null;
    const kids = (n.children || []).map((c) => nodeStatus(t, c));
    if (kids.includes('running') || own === 'running') return 'running';
    if (kids.includes('failed') || own === 'failed') return 'failed';
    if (kids.length && kids.every((k) => k === 'skipped')) return 'skipped';
    if (kids.some((k) => k === 'passed') && kids.every((k) => k === 'passed' || k === 'skipped')) return 'passed';
    return 'idle';
  }

  function counts(t, nodes = t.tree) {
    const c = { passed: 0, failed: 0, skipped: 0, idle: 0, running: 0 };
    const walk = (n) => { if (n.kind === 'test') c[t.status.get(n.id) || 'idle']++; (n.children || []).forEach(walk); };
    nodes.forEach(walk);
    return c;
  }

  // ---------- Arbre ----------
  function matches(t, n) {
    const st = nodeStatus(t, n);
    if (t.show !== 'all' && st !== t.show && !(n.kind !== 'test' && n.children?.some((c) => matches(t, c)))) return false;
    if (!t.filter) return true;
    if (n.name.toLowerCase().includes(t.filter)) return true;
    return (n.children || []).some((c) => matches(t, c));
  }

  function renderTree(tab) {
    const t = tab.t;
    const c = counts(t);
    const total = c.passed + c.failed + c.skipped + c.idle + c.running;
    t.sumEl.innerHTML = `<span class="g-A">✓ ${c.passed}</span><span class="g-D">✗ ${c.failed}</span><span class="muted">○ ${c.skipped}</span><span class="muted">/ ${total}</span>` +
      (t.lastRun ? `<span class="muted">· ${UI.fmtDuration(t.lastRun.duration)}</span>` : '');
    t.runFailed.disabled = !c.failed || !!t.running;
    t.runAll.disabled = !!t.running || !t.info?.suites?.length;
    const scroll = t.treeEl.scrollTop;
    t.treeEl.innerHTML = '';
    t.rows = [];
    if (!t.info?.suites?.length) {
      const box = h('div', 'tool-empty');
      box.innerHTML = `<div class="robot">${tab.space.bot.svg}</div><b>Aucun test détecté</b>
        <div>Pris en charge : Vitest, Jest, Playwright, node:test, pytest, Go, Cargo (y compris les monorepos pnpm / npm / yarn).</div>${t.info?.error ? `<pre>${esc(t.info.error)}</pre>` : ''}`;
      const b = h('button', 'tb-btn primary', '🔍 Détecter les tests du workspace');
      b.addEventListener('click', () => detect(tab));
      box.appendChild(b);
      t.treeEl.appendChild(box);
      return;
    }
    const frag = document.createDocumentFragment();
    const add = (n, depth) => {
      if (!matches(t, n)) return;
      const st = nodeStatus(t, n);
      const open = t.expanded.has(n.id) || !!t.filter;
      const r = h('div', `tt-row tt-${n.kind} st-${st}` + (t.selected === n.id ? ' selected' : ''));
      r.style.paddingLeft = `${6 + depth * 14}px`;
      const res = n.kind === 'test' ? resultFor(t, n) : null;
      const cc = n.children ? counts(t, [n]) : null;
      const icon = n.kind === 'category' ? n.icon : KIND_ICON[n.kind] || '';
      const extra = n.kind === 'suite-root'
        ? `<span class="tt-fw">${esc(n.fwLabel)}</span>${n.cwd ? `<span class="tt-cwd">${esc(n.cwd)}</span>` : ''}${n.requires ? '<span class="tt-req" title="' + esc(n.requires) + '">⚠</span>' : ''}`
        : '';
      r.innerHTML = `<span class="chev${n.children ? (open ? ' open' : '') : ' none'}">${n.children ? '›' : ''}</span>` +
        `<span class="tt-st">${ICON[st]}</span><span class="tt-kind">${icon}</span>` +
        `<span class="tt-name">${esc(n.name)}</span>${extra}` +
        (res?.duration ? `<span class="tt-dur">${UI.fmtDuration(res.duration)}</span>` : cc ? `<span class="tt-dur">${cc.failed ? `<b class="g-D">${cc.failed}✗</b> ` : ''}${count([n])}</span>` : '') +
        `<span class="tt-actions"><button class="icon-btn" data-a="run" title="Lancer">▶</button>${n.file ? '<button class="icon-btn" data-a="open" title="Ouvrir le fichier">✎</button>' : ''}</span>`;
      r.addEventListener('click', (e) => {
        const a = e.target.closest('[data-a]')?.dataset.a;
        if (a === 'run') return run(tab, scopeFor(n));
        if (a === 'open') return CAI.openFile(tab.space, n.file, n.line);
        if (n.children && (e.target.closest('.chev') || t.selected === n.id)) { if (t.expanded.has(n.id)) t.expanded.delete(n.id); else t.expanded.add(n.id); }
        t.selected = n.id;
        renderTree(tab);
        renderDetail(tab);
      });
      r.addEventListener('dblclick', () => { if (n.file) CAI.openFile(tab.space, n.file, n.line); });
      r.addEventListener('contextmenu', (e) => { e.preventDefault(); t.selected = n.id; renderTree(tab); renderDetail(tab); UI.menu(nodeMenu(tab, n), e.clientX, e.clientY); });
      frag.appendChild(r);
      t.rows.push(n);
      if (n.children && open) n.children.forEach((ch) => add(ch, depth + 1));
    };
    t.tree.forEach((n) => add(n, 0));
    t.treeEl.appendChild(frag);
    t.treeEl.scrollTop = scroll;
  }

  const plain = (n) => ({ id: n.id, name: n.name, kind: n.kind, file: n.file, line: n.line, path: n.path, pkg: n.pkg, testName: n.testName, suiteId: n.suiteId, nodeid: n.nodeid, dynamic: n.dynamic });
  function scopeFor(n) {
    if (n.kind === 'category') return { category: n.category };
    if (n.kind === 'suite-root') return { suiteId: n.suiteId };
    return { node: plain(n) };
  }

  function nodeMenu(tab, n) {
    const t = tab.t;
    const items = [{ title: n.name }, { label: 'Lancer', icon: '▶', action: () => run(tab, scopeFor(n)) }];
    if (n.file) items.push({ label: 'Ouvrir le fichier', icon: '✎', action: () => CAI.openFile(tab.space, n.file, n.line) });
    if (n.kind === 'suite-root') {
      items.push(
        { label: 'Changer de catégorie', icon: '🗂', submenu: Object.entries(CATS).map(([id, c]) => ({ label: `${c.icon} ${c.name}`, checked: n.parent?.category === id, action: () => setCategory(tab, n, id) })) },
        { label: 'Renommer la suite…', icon: '✎', action: async () => { const v = await UI.prompt('Nom de la suite', n.name); if (v) { await api.testsUpdateSuite(t.root, n.suiteId, { name: v }); discover(tab); } } },
        { label: 'Ouvrir un terminal dans le paquet', icon: '>_', action: () => CAI.openTab(tab.space, { kind: 'terminal', cwd: n.cwd ? `${t.root}\\${n.cwd.replace(/\//g, '\\')}` : t.root }) },
      );
    }
    items.push('-',
      { label: 'Copier le nom', icon: '⧉', action: () => api.writeClipboard(n.name) },
      n.file && { label: 'Révéler dans l\'Explorateur Windows', icon: '📍', action: () => api.showItem(n.file) });
    if (n.children) items.push('-',
      { label: 'Tout déplier', icon: '⇲', action: () => { const w = (x) => { if (x.children) { t.expanded.add(x.id); x.children.forEach(w); } }; w(n); renderTree(tab); } },
      { label: 'Tout replier', icon: '⇱', action: () => { const w = (x) => { t.expanded.delete(x.id); (x.children || []).forEach(w); }; w(n); renderTree(tab); } });
    return items;
  }

  async function setCategory(tab, n, cat) {
    await api.testsUpdateSuite(tab.t.root, n.suiteId, { category: cat });
    UI.toast(`« ${n.name} » rangée dans ${CATS[cat].name}`, { ms: 2000 });
    discover(tab);
  }

  function moreMenu(tab) {
    const t = tab.t;
    return [
      { label: 'Détecter les tests du workspace', icon: '🔍', action: () => detect(tab) },
      { label: 'Modifier .robot/tests.json', icon: '✎', action: () => CAI.openFile(tab.space, `${t.root}\\.robot\\tests.json`) },
      '-',
      { label: 'Lancer une catégorie', icon: '▶', submenu: t.tree.map((c) => ({ label: `${c.icon} ${c.name}`, hint: `${count([c])} tests`, action: () => run(tab, { category: c.category }) })) },
      { label: 'Tout déplier', icon: '⇲', action: () => { t.index.forEach((n) => n.children && t.expanded.add(n.id)); renderTree(tab); } },
      { label: 'Tout replier', icon: '⇱', action: () => { t.expanded.clear(); renderTree(tab); } },
      { label: 'Effacer les résultats', icon: '⌫', action: () => { t.results = {}; t.status.clear(); t.lastRun = null; discover(tab); } },
      '-',
      { label: t.outOpen ? 'Masquer la sortie' : 'Afficher la sortie', icon: '▤', action: () => t.toggleOut() },
      { label: 'Ouvrir un terminal dans le projet', icon: '>_', action: () => CAI.openTab(tab.space, { kind: 'terminal', cwd: t.root }) },
    ];
  }

  function treeKey(tab, e) {
    const t = tab.t;
    if (!t.rows?.length) return;
    const i = t.rows.findIndex((n) => n.id === t.selected);
    const cur = t.rows[i];
    const sel = (n) => { if (!n) return; t.selected = n.id; renderTree(tab); renderDetail(tab); t.treeEl.querySelector('.selected')?.scrollIntoView({ block: 'nearest' }); };
    if (e.key === 'ArrowDown') sel(t.rows[i + 1] || t.rows[0]);
    else if (e.key === 'ArrowUp') sel(t.rows[i - 1] || t.rows[t.rows.length - 1]);
    else if (e.key === 'ArrowRight' && cur?.children) { t.expanded.add(cur.id); renderTree(tab); }
    else if (e.key === 'ArrowLeft' && cur?.children) { t.expanded.delete(cur.id); renderTree(tab); }
    else if (e.key === 'Enter' && cur) run(tab, scopeFor(cur));
    else return;
    e.preventDefault();
  }

  // ---------- Détails ----------
  function renderDetail(tab) {
    const t = tab.t;
    const n = t.index?.get(t.selected);
    if (!n) {
      const c = counts(t);
      const box = h('div', 'tool-empty');
      box.innerHTML = `<div class="robot big">${tab.space.bot.svg}</div>` +
        (t.lastRun ? `<b>${c.failed ? `${c.failed} test${c.failed > 1 ? 's' : ''} en échec` : 'Tout est vert ✨'}</b><div>${c.passed} réussis · ${c.skipped} ignorés · ${UI.fmtDuration(t.lastRun.duration)}</div>` : '<b>Sélectionnez un test</b><div>ou lancez une catégorie entière avec ▶</div>');
      // Résumé par catégorie
      if (t.tree.length) {
        const list = h('div', 'tt-cats');
        for (const cat of t.tree) {
          const cc = counts(t, [cat]);
          const r = h('div', 'tt-cat-row');
          r.innerHTML = `<span>${cat.icon}</span><span class="tt-name">${esc(cat.name)}</span><span class="muted">${cat.children.length} suite${cat.children.length > 1 ? 's' : ''} · ${count([cat])} tests</span>${cc.failed ? `<b class="g-D">${cc.failed}✗</b>` : cc.passed ? `<b class="g-A">${cc.passed}✓</b>` : ''}`;
          const b = h('button', 'icon-btn', '▶');
          b.title = `Lancer ${cat.name}`;
          b.addEventListener('click', () => run(tab, { category: cat.category }));
          r.appendChild(b);
          list.appendChild(r);
        }
        box.appendChild(list);
      }
      t.detail.innerHTML = '';
      t.detail.appendChild(box);
      return;
    }
    const st = nodeStatus(t, n);
    const res = n.kind === 'test' || n.kind === 'suite-root' ? resultFor(t, n) : null;
    const d = h('div', 'tt-det');
    const where = n.kind === 'suite-root' ? `${esc(n.fwLabel)}${n.cwd ? ' · ' + esc(n.cwd) : ''}` : n.file ? `<a class="link" data-open>${esc(n.file.split(/[\\/]/).slice(-2).join('/'))}${n.line ? ':' + n.line : ''}</a>` : '';
    d.innerHTML = `<div class="tt-det-head st-${st}"><span class="tt-st big">${ICON[st]}</span><div><div class="tt-det-name">${esc(n.name)}</div>` +
      `<div class="tt-det-meta">${LABEL[st]}${res?.duration ? ' · ' + UI.fmtDuration(res.duration) : ''}${where ? ' · ' + where : ''}</div></div></div>`;
    if (n.requires) d.appendChild(h('div', 'tt-warn', `⚠ ${esc(n.requires)}`));
    const actions = h('div', 'tt-det-actions');
    const runB = h('button', 'tb-btn small primary', '▶ Lancer');
    runB.addEventListener('click', () => run(tab, scopeFor(n)));
    actions.appendChild(runB);
    if (n.file) { const o = h('button', 'tb-btn small', '✎ Ouvrir'); o.addEventListener('click', () => CAI.openFile(tab.space, n.file, n.line)); actions.appendChild(o); }
    d.appendChild(actions);
    d.querySelector('[data-open]')?.addEventListener('click', () => CAI.openFile(tab.space, n.file, n.line));
    if (res?.message) {
      d.appendChild(h('div', 'tt-sec', 'Message d\'erreur'));
      const pre = h('pre', 'tt-msg');
      pre.innerHTML = linkify(UI.ansiToHtml(res.message), t.root);
      pre.addEventListener('click', (e) => { const a = e.target.closest('[data-file]'); if (a) CAI.openFile(tab.space, a.dataset.file, +a.dataset.line || undefined); });
      d.appendChild(pre);
      const copy = h('button', 'tb-btn small', '⧉ Copier l\'erreur');
      copy.addEventListener('click', () => { api.writeClipboard(res.message); UI.toast('Erreur copiée', { ms: 1400 }); });
      d.appendChild(copy);
    }
    if (n.children) {
      const failed = [];
      const walk = (x) => { if (x.kind === 'test' && t.status.get(x.id) === 'failed') failed.push(x); (x.children || []).forEach(walk); };
      walk(n);
      const cc = counts(t, [n]);
      d.appendChild(h('div', 'tt-sec', failed.length ? `Échecs (${failed.length})` : `${count([n])} tests · ${cc.passed} réussis · ${cc.skipped} ignorés`));
      for (const f of failed.slice(0, 80)) {
        const r = h('div', 'tt-fail-row', `<span class="g-D">✗</span> ${esc(f.name)} <span class="muted">${esc((f.file || '').split(/[\\/]/).pop())}</span>`);
        r.addEventListener('click', () => { t.selected = f.id; let p = f.parent; while (p) { t.expanded.add(p.id); p = p.parent; } renderTree(tab); renderDetail(tab); });
        d.appendChild(r);
      }
    }
    t.detail.innerHTML = '';
    t.detail.appendChild(d);
  }

  function linkify(html, root) {
    return html.replace(/((?:[A-Za-z]:)?[\w./\\-]+\.(?:[cm]?[jt]sx?|py|go|rs|vue|svelte)):(\d+)(?::(\d+))?/g, (m, f, l) => {
      const abs = /^[A-Za-z]:|^[\\/]/.test(f) ? f : `${root}\\${f.replace(/\//g, '\\')}`;
      return `<a class="link" data-file="${esc(abs)}" data-line="${l}">${m}</a>`;
    });
  }

  // ---------- Exécution ----------
  async function run(tab, scope) {
    const t = tab.t;
    if (t.running || !t.info?.suites?.length) return;
    const runId = `run${++runSeq}`;
    t.running = runId;
    byRun.set(runId, tab);
    let target = null;
    if (scope.node) target = t.index.get(scope.node.id);
    else if (scope.suiteId) target = t.index.get(`suite:${scope.suiteId}`);
    else if (scope.category) target = t.index.get(`cat:${scope.category}`);
    const marked = [];
    const mark = (n) => { if (n.kind === 'test' || n.kind === 'suite-root') { marked.push(n.id); t.status.set(n.id, 'running'); } (n.children || []).forEach(mark); };
    if (target) mark(target);
    else if (scope.suiteIds) scope.suiteIds.forEach((id) => { const s = t.index.get(`suite:${id}`); if (s) mark(s); });
    else t.tree.forEach(mark);
    const prev = new Map(t.status);
    t.progress.classList.remove('hidden');
    t.stopBtn.classList.remove('hidden');
    tab.space.robotEl.classList.add('testing');
    renderTree(tab);
    t.term.write(`\r\n\x1b[1;35m▶ ${target ? target.name : 'Toutes les suites'}\x1b[0m  \x1b[90m${new Date().toLocaleTimeString('fr-FR')}\x1b[0m\r\n`);
    CAI.say(tab.space, target ? `Je teste « ${target.name} »…` : 'C\'est parti pour les tests !', 1500);
    let res = null;
    try { res = await api.testsRun(t.root, scope, runId); }
    catch (e) { t.term.write(`\r\n\x1b[31m${e.message}\x1b[0m\r\n`); }
    byRun.delete(runId);
    t.running = null;
    t.progress.classList.add('hidden');
    t.stopBtn.classList.add('hidden');
    tab.space.robotEl.classList.remove('testing');
    // Les tests lancés sans résultat reprennent leur état précédent
    for (const id of marked) if (t.status.get(id) === 'running') t.status.set(id, t.prevStatus?.get(id) && t.prevStatus.get(id) !== 'running' ? t.prevStatus.get(id) : 'idle');
    if (res) {
      Object.assign(t.results, res.results);
      t.lastRun = { duration: res.duration, code: res.code };
      applyResults(tab);
    }
    t.prevStatus = new Map(t.status);
    void prev;
    renderTree(tab);
    renderDetail(tab);
    if (res) {
      const vals = Object.values(res.results);
      const failed = vals.filter((r) => r.status === 'failed').length;
      const passed = vals.filter((r) => r.status === 'passed').length;
      if (res.stopped) CAI.say(tab.space, 'Exécution arrêtée', 1500);
      else if (!vals.length && res.code) { CAI.say(tab.space, `La commande a échoué (code ${res.code}) — voir la sortie`, 3500); t.toggleOut(true); }
      else if (failed) { CAI.say(tab.space, `${failed} échec${failed > 1 ? 's' : ''}… on répare ?`, 3000); tab.el.classList.add('unread'); }
      else CAI.say(tab.space, `${passed} test${passed > 1 ? 's' : ''} au vert 🎉`, 2500);
      tab.el.dataset.badge = counts(t).failed ? String(counts(t).failed) : '';
      CAI.refreshCrew?.();
    }
  }

  function runFailed(tab) {
    const t = tab.t;
    const failed = [...t.status].filter(([, s]) => s === 'failed').map(([id]) => t.index.get(id)).filter((n) => n && n.kind === 'test');
    if (!failed.length) return;
    if (failed.length === 1) return run(tab, { node: plain(failed[0]) });
    const suites = [...new Set(failed.map((n) => n.suiteId))];
    if (suites.length === 1) {
      const files = [...new Set(failed.map((n) => n.file))];
      if (files.length === 1) { const f = t.index.get(`${suites[0]}::${failed[0].id.split('::')[1]}`); if (f) return run(tab, { node: plain(f) }); }
    }
    run(tab, { suiteIds: suites });
  }

  function setWatch(tab, on, quiet) {
    const t = tab.t;
    t.watch = on;
    t.watchBtn.classList.toggle('on', on);
    if (!quiet) { CAI.say(tab.space, on ? 'Je surveille vos fichiers 👀' : 'Surveillance arrêtée', 1500); CAI.save(); }
  }

  api.onTestsOut((runId, chunk) => {
    const tab = byRun.get(runId);
    if (!tab) return;
    tab.t.term.write(chunk);
    CAI.talk(tab.space);
  });

  api.onFsChanged((id) => {
    const tab = byWatch.get(id);
    if (!tab) return;
    const t = tab.t;
    clearTimeout(t.watchTimer);
    t.watchTimer = setTimeout(() => {
      if (t.running) return;
      if (t.watch) {
        const failedN = [...t.status.values()].filter((s) => s === 'failed').length;
        if (failedN) runFailed(tab); else run(tab, { all: true });
      } else discover(tab);
    }, 1200);
  });

  (window.TabKinds = window.TabKinds || {}).tests = TestsTab;
})();
