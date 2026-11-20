// RobotConsole — onglet « Graphify » : graphe de connaissances du projet (https://github.com/Graphify-Labs/graphify)
// Construit graphify-out/ avec le CLI (« graphify extract . --code-only », sans modèle ni clé API),
// puis affiche graph.html (webview servi en local), GRAPH_REPORT.md et le journal d'exécution.
(function () {
  const api = window.api;
  const { h, esc } = UI;
  const byRun = new Map();
  const byWatch = new Map();
  let seq = 0;
  const INSTALL = 'uv tool install graphifyy';

  const VIEWS = [['graph', 'Graphe'], ['report', 'Rapport'], ['log', 'Journal']];

  const GraphifyTab = {
    icon: '<span class="kind-graphify">🕸</span>',
    defaultTitle() { return 'Graphify'; },

    mount(tab, spec) {
      const g = tab.g = { root: spec.root, view: spec.view || 'graph', status: null, cli: null, runId: null, url: null, updated: null, watchId: `gfw-${++seq}-${Date.now().toString(36)}` };
      tab.pane.classList.add('graphify-pane', 'tool-pane');
      const bar = h('div', 'tool-bar');
      g.sum = h('div', 'tt-summary');
      const btn = (html, title, fn, cls = 'icon-btn') => { const b = h('button', cls, html); b.type = 'button'; b.title = title; b.setAttribute('aria-label', title); b.addEventListener('click', fn); return b; };
      g.seg = h('div', 'gf-seg');
      g.segBtns = {};
      for (const [k, label] of VIEWS) {
        const b = btn(label, label, () => setView(tab, k), 'gf-seg-btn');
        g.segBtns[k] = b; g.seg.appendChild(b);
      }
      g.buildBtn = btn('▶ Construire', 'Construire le graphe (code uniquement, sans clé API)', () => start(tab, 'build'), 'tb-btn');
      g.updateBtn = btn('↻ Mettre à jour', 'Mettre à jour le graphe avec les fichiers modifiés', () => start(tab, 'update'), 'tb-btn');
      g.stopBtn = btn('■ Arrêter', 'Arrêter graphify', () => api.graphifyStop(g.runId), 'tb-btn hidden');
      bar.append(h('span', 'tool-badge', '🕸 Graphify'), g.sum, h('div', 'tb-spacer'), g.seg, g.buildBtn, g.updateBtn, g.stopBtn,
        btn('⟳', 'Rafraîchir', () => refresh(tab, true)),
        btn('⋯', 'Plus', (e) => UI.menu(moreMenu(tab), e.currentTarget)));
      g.progress = h('div', 'tool-progress hidden', '<i></i>');
      g.body = h('div', 'gf-body');
      g.slot = h('div', 'gf-slot');
      g.report = h('div', 'gf-report pv-md');
      g.log = h('pre', 'gf-log');
      g.empty = h('div', 'tool-empty hidden');
      g.body.append(g.slot, g.report, g.log, g.empty);
      tab.pane.append(bar, g.progress, g.body);

      g.webview = h('webview');
      g.webview.setAttribute('partition', 'persist:graphify');
      g.webview.addEventListener('did-fail-load', (e) => { if (e.isMainFrame && e.errorCode !== -3) showEmpty(tab, `<b>Affichage impossible</b><div>${esc(e.errorDescription)}</div>`); });
      g.float = UI.floatWebview(g.webview, g.slot);
      g.log.textContent = '';
      byWatch.set(g.watchId, tab);
      setView(tab, g.view, true);
      refresh(tab, true);
    },
    activate(tab) { tab.g.float.sync(); refresh(tab); },
    resize(tab) { tab.g.float.sync(); },
    focus() {},
    dispose(tab) {
      const g = tab.g;
      if (g.runId) { api.graphifyStop(g.runId); byRun.delete(g.runId); }
      api.unwatch(g.watchId); byWatch.delete(g.watchId);
      clearTimeout(g.watchTimer);
      g.float.dispose();
    },
    serialize(tab) { return { root: tab.g.root, view: tab.g.view }; },
  };

  function setView(tab, view, silent) {
    const g = tab.g;
    g.view = view;
    for (const [k, b] of Object.entries(g.segBtns)) { b.classList.toggle('active', k === view); b.setAttribute('aria-pressed', String(k === view)); }
    render(tab);
    if (!silent) CAI.save();
  }

  function showEmpty(tab, html) {
    const g = tab.g;
    g.slot.classList.add('hidden'); g.report.classList.add('hidden'); g.log.classList.add('hidden');
    g.empty.innerHTML = html;
    g.empty.classList.remove('hidden');
    g.empty.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', () => action(tab, b.dataset.act)));
    g.float.schedule();
  }

  function action(tab, act) {
    if (act === 'build') start(tab, 'build');
    else if (act === 'recheck') refresh(tab, true, true);
    else if (act === 'copy') { api.writeClipboard(INSTALL); UI.toast('Commande copiée'); }
    else if (act === 'terminal') CAI.openKind(tab.space, 'terminal', { cwd: tab.g.root, commands: INSTALL });
    else if (act === 'log') setView(tab, 'log');
  }

  function render(tab) {
    const g = tab.g;
    const s = g.status;
    const show = (el) => { for (const e of [g.slot, g.report, g.log, g.empty]) e.classList.toggle('hidden', e !== el); g.float.schedule(); };
    if (g.view === 'log') return show(g.log);
    if (g.cli && !g.cli.ok) {
      return showEmpty(tab, `<div style="font-size:28px">🕸</div><b>graphify n'est pas installé</b>
        <div>Installez le CLI (Python 3.11+, paquet PyPI <code>graphifyy</code>) :</div>
        <pre>${esc(INSTALL)}</pre><div><small>ou <code>pipx install graphifyy</code> / <code>pip install graphifyy</code></small></div>
        <div class="empty-actions"><button class="tb-btn" data-act="terminal">&gt;_ Installer dans un terminal</button><button class="tb-btn" data-act="copy">Copier la commande</button><button class="tb-btn" data-act="recheck">⟳ Vérifier à nouveau</button></div>`);
    }
    if (!s) return showEmpty(tab, '<div class="spinner"></div>Lecture de graphify-out…');
    if (g.view === 'report') {
      if (!s.report) return showEmpty(tab, `<b>Aucun rapport</b><div>GRAPH_REPORT.md n'existe pas encore dans <code>${esc(s.out)}</code>.</div>${emptyActions(g)}`);
      g.report.innerHTML = DOMPurify.sanitize(marked.parse(s.report));
      g.report.querySelectorAll('a[href]').forEach((a) => a.addEventListener('click', (ev) => { ev.preventDefault(); if (/^https?:/.test(a.href)) window.open(a.href); }));
      return show(g.report);
    }
    if (!s.html) {
      const msg = s.json ? 'graph.json existe mais pas graph.html.' : 'Aucun graphe pour ce dossier.';
      return showEmpty(tab, `<div style="font-size:28px">🕸</div><b>${msg}</b>
        <div>Graphify analyse le code (≈ 40 langages, en local, sans clé API) et produit un graphe interactif.</div>
        <div><small><code>${esc(g.root)}</code></small></div>${emptyActions(g)}`);
    }
    show(g.slot);
    if (g.url && g.webview.getAttribute('src') !== g.url) g.webview.src = g.url;
  }
  const emptyActions = (g) => (g.runId ? '<div class="empty-actions"><button class="tb-btn" data-act="log">Voir le journal</button></div>'
    : '<div class="empty-actions"><button class="tb-btn" data-act="build">▶ Construire le graphe</button></div>');

  function summary(tab) {
    const g = tab.g; const s = g.status;
    if (g.runId) { g.sum.textContent = 'Construction en cours…'; return; }
    if (!s || !s.updated) { g.sum.textContent = ''; return; }
    const parts = [];
    if (s.stats) {
      parts.push(`${s.stats.nodes.toLocaleString('fr-FR')} nœuds`, `${s.stats.links.toLocaleString('fr-FR')} liens`);
      if (s.stats.communities) parts.push(`${s.stats.communities} communautés`);
    }
    parts.push(`màj ${new Date(s.updated).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}`);
    g.sum.textContent = parts.join(' · ');
    g.sum.title = g.cli?.ok ? `${g.cli.version} — ${s.out}` : s.out;
  }

  async function refresh(tab, reloadView, recheck) {
    const g = tab.g;
    try {
      if (!g.cli || recheck) g.cli = await api.graphifyVersion(!!recheck);
      const s = await api.graphifyStatus(g.root);
      const changed = s.updated !== g.updated;
      g.status = s; g.updated = s.updated;
      if (s.exists && g.watching !== s.out) { api.watch(g.watchId, s.out); g.watching = s.out; }
      if (s.html && !g.url) g.url = await api.graphifyServe(g.root);
      else if (s.html && g.url && (changed || reloadView) && g.webview.getAttribute('src') === g.url) g.webview.reload();
    } catch (e) {
      g.status = null;
      showEmpty(tab, `<b>Erreur</b><div>${esc(e.message || String(e))}</div>`);
      return;
    }
    buttons(tab);
    summary(tab);
    render(tab);
  }

  function buttons(tab) {
    const g = tab.g; const running = !!g.runId; const ok = g.cli?.ok;
    g.buildBtn.disabled = running || !ok;
    g.updateBtn.disabled = running || !ok || !g.status?.json;
    g.stopBtn.classList.toggle('hidden', !running);
    g.buildBtn.classList.toggle('hidden', running);
    g.updateBtn.classList.toggle('hidden', running);
    g.progress.classList.toggle('hidden', !running);
  }

  function start(tab, mode) {
    const g = tab.g;
    if (g.runId) return;
    g.runId = `gf-${++seq}-${Date.now().toString(36)}`;
    byRun.set(g.runId, tab);
    g.log.textContent = '';
    setView(tab, 'log');
    buttons(tab); summary(tab);
    CAI.talk?.(tab.space);
    api.graphifyRun(g.runId, g.root, mode);
  }

  api.onGraphifyOut((id, chunk) => {
    const tab = byRun.get(id);
    if (!tab) return;
    const log = tab.g.log;
    const atEnd = log.scrollTop + log.clientHeight >= log.scrollHeight - 8;
    log.insertAdjacentHTML('beforeend', UI.ansiToHtml(chunk));
    if (atEnd) log.scrollTop = log.scrollHeight;
  });
  api.onGraphifyEnd((id, r) => {
    const tab = byRun.get(id);
    if (!tab) return;
    byRun.delete(id);
    const g = tab.g;
    g.runId = null;
    const msg = r.ok ? 'Graphe construit !' : r.stopped ? 'Construction arrêtée.' : `Échec de graphify${r.error ? ` : ${r.error}` : r.code != null ? ` (code ${r.code})` : ''}.`;
    g.log.insertAdjacentHTML('beforeend', `\n<span class="${r.ok ? 'gf-ok' : 'gf-bad'}">${esc(msg)}</span>\n`);
    g.log.scrollTop = g.log.scrollHeight;
    CAI.say?.(tab.space, msg);
    CAI.markUnread?.(tab);
    if (r.ok) g.view = 'graph';
    refresh(tab, true).then(() => setView(tab, g.view));
  });
  // graphify-out modifié ailleurs (skill /graphify dans un terminal, hook git…) : on recharge.
  api.onFsChanged((id) => {
    const tab = byWatch.get(id);
    if (!tab || tab.g.runId) return;
    clearTimeout(tab.g.watchTimer);
    tab.g.watchTimer = setTimeout(() => refresh(tab), 1200);
  });

  function moreMenu(tab) {
    const g = tab.g; const s = g.status;
    return [
      { label: 'Ouvrir graph.html dans le navigateur', icon: '🌐', disabled: !g.url, action: () => window.open(g.url) },
      { label: 'Ouvrir dans un onglet Navigateur', icon: '🧭', disabled: !g.url, action: () => CAI.openKind(tab.space, 'browser', { url: g.url }) },
      { label: 'Régénérer graph.html', icon: '🖼', disabled: !!g.runId || !g.cli?.ok || !s?.json, action: () => start(tab, 'html') },
      '-',
      { label: 'Afficher graphify-out', icon: '📂', disabled: !s?.exists, action: () => api.openPath(s.out) },
      { label: 'Explorer graphify-out', icon: '📁', disabled: !s?.exists, action: () => CAI.openKind(tab.space, 'explorer', { root: s.out }) },
      '-',
      { label: g.cli?.ok ? g.cli.version : 'graphify non détecté', disabled: true },
      { label: 'Documentation de graphify', icon: '📖', action: () => window.open('https://github.com/Graphify-Labs/graphify') },
    ];
  }

  (window.TabKinds = window.TabKinds || {}).graphify = GraphifyTab;
})();
