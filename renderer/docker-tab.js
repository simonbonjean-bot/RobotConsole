// RobotConsole — onglet « Docker » : conteneurs du workspace, regroupés par fichier compose
// Lignes compactes (état, santé, ports, CPU, mémoire, actions) + tiroir de journaux en bas.
(function () {
  const api = window.api;
  const { h, esc } = UI;
  const byLogs = new Map();
  let logSeq = 0;
  const REFRESH_MS = 5000;

  const STATE = {
    running: ['En cours', 'ok'], exited: ['Arrêté', 'off'], created: ['Créé', 'off'], paused: ['En pause', 'warn'],
    restarting: ['Redémarrage', 'warn'], dead: ['Mort', 'bad'], removing: ['Suppression', 'warn'], missing: ['Non créé', 'off'],
  };

  const DockerTab = {
    icon: '<span class="kind-docker">🐳</span>',
    defaultTitle() { return 'Docker'; },

    mount(tab, spec) {
      const d = tab.d = { root: spec.root, data: null, busy: new Set(), collapsed: new Set(spec.collapsed || []), openedOnce: new Set(spec.opened || []), filter: '', logsId: null, logH: spec.logH || 240 };
      tab.pane.classList.add('docker-pane', 'tool-pane');
      const bar = h('div', 'tool-bar');
      d.badge = h('span', 'tool-badge', '🐳 Docker');
      d.sum = h('div', 'tt-summary');
      const btn = (html, title, fn, cls = 'icon-btn') => { const b = h('button', cls, html); b.title = title; b.addEventListener('click', fn); return b; };
      const search = h('input', 'set-input tool-search');
      search.placeholder = 'Filtrer…';
      search.addEventListener('input', () => { d.filter = search.value.toLowerCase(); render(tab); });
      search.addEventListener('keydown', (e) => e.stopPropagation());
      bar.append(d.badge, d.sum, h('div', 'tb-spacer'), search,
        btn('⟳', 'Rafraîchir', () => refresh(tab, false, true)),
        btn('⋯', 'Plus', (e) => UI.menu(moreMenu(tab), e.currentTarget)));
      d.progress = h('div', 'tool-progress hidden', '<i></i>');
      d.list = h('div', 'dk2-list');
      d.drawer = h('div', 'dk2-drawer hidden');
      d.drawer.style.height = `${d.logH}px`;
      tab.pane.append(bar, d.progress, d.list, d.drawer);
      d.list.innerHTML = '<div class="tool-empty"><div class="spinner"></div>Connexion à Docker…</div>';
      refresh(tab, true);
      d.timer = setInterval(() => { if (tab.pane.offsetParent && !d.busy.size) refresh(tab); }, REFRESH_MS);
    },

    activate(tab) { refresh(tab); fitLogs(tab); },
    focus() {},
    resize(tab) { fitLogs(tab); },
    dispose(tab) { clearInterval(tab.d.timer); stopLogs(tab); tab.d.term?.dispose(); },
    serialize(tab) { return { root: tab.d.root, collapsed: [...tab.d.collapsed], logH: tab.d.logH }; },
    applyTheme(tab) { if (tab.d.term) tab.d.term.options.theme = Themes.terminal(tab.space.bot); },
  };

  async function refresh(tab, first, force) {
    const d = tab.d;
    if (d.loading) return;
    d.loading = true;
    if (force) d.progress.classList.remove('hidden');
    try { d.data = await api.dockerStatus(d.root, {}); } catch (e) { d.data = { available: false, error: e.message }; }
    d.loading = false;
    if (!d.busy.size) d.progress.classList.add('hidden');
    render(tab);
    if (first) {
      const x = d.data;
      if (!x.available) CAI.say(tab.space, x.installed === false ? 'Docker n\'est pas installé…' : 'Docker ne répond pas : Docker Desktop est-il lancé ?', 3500);
      else {
        const run = x.projects.reduce((a, p) => a + p.running, 0);
        const tot = x.projects.reduce((a, p) => a + p.services.length, 0);
        CAI.say(tab.space, x.projects.length ? `${run}/${tot} services Docker en route` : 'Aucun fichier compose dans ce workspace', 2500);
      }
    }
  }

  function render(tab) {
    const d = tab.d;
    const x = d.data;
    if (!x) return;
    if (!x.available) {
      d.badge.textContent = '🐳 Docker indisponible';
      d.sum.innerHTML = '';
      d.list.innerHTML = `<div class="tool-empty"><div class="robot big">${tab.space.bot.svg}</div><b>${x.installed === false ? 'Docker n\'est pas installé' : 'Docker ne répond pas'}</b>
        <div>${x.installed === false ? 'Installez Docker Desktop pour gérer vos conteneurs ici.' : 'Démarrez Docker Desktop, puis rafraîchissez.'}</div>${x.error ? `<pre>${esc(x.error)}</pre>` : ''}</div>`;
      return;
    }
    d.badge.textContent = `🐳 Docker ${x.version}`;
    const run = x.projects.reduce((a, p) => a + p.running, 0) + x.others.filter((c) => c.state === 'running').length;
    const tot = x.projects.reduce((a, p) => a + p.services.length, 0) + x.others.length;
    d.sum.innerHTML = `<span class="g-A">● ${run}</span><span class="muted">/ ${tot} services · ${x.projects.length} fichier${x.projects.length > 1 ? 's' : ''} compose</span>`;
    const scroll = d.list.scrollTop;
    d.list.innerHTML = '';
    if (!x.projects.length && !x.others.length) {
      d.list.innerHTML = `<div class="tool-empty"><div class="robot big">${tab.space.bot.svg}</div><b>Aucun conteneur lié à ce workspace</b><div>Ajoutez un fichier <code>compose.yml</code> (à la racine ou dans un sous-dossier comme <code>docker/</code>).</div></div>`;
      return;
    }
    // Projets avec des conteneurs démarrés d'abord
    const projects = [...x.projects].sort((a, b) => (b.running > 0) - (a.running > 0));
    for (const p of projects) d.list.appendChild(group(tab, p));
    if (x.others.length) d.list.appendChild(group(tab, { rel: 'Autres conteneurs du workspace', others: true, services: x.others.map((c) => ({ name: c.name, containers: [c] })), running: x.others.filter((c) => c.state === 'running').length }));
    d.list.scrollTop = scroll;
  }

  function group(tab, p) {
    const d = tab.d;
    const key = p.rel;
    // Par défaut : déplié s'il tourne quelque chose, replié sinon (prod, etc.)
    const collapsed = d.collapsed.has(key) || (!p.running && !d.openedOnce.has(key));
    const g = h('div', 'dk2-group' + (collapsed ? ' collapsed' : ''));
    const head = h('div', 'dk2-ghead');
    head.innerHTML = `<span class="chev${collapsed ? '' : ' open'}">›</span><span class="dk2-file">${p.others ? '📦' : '🗎'} ${esc(p.rel)}</span>` +
      (p.project ? `<span class="tool-badge">${esc(p.project)}</span>` : '') +
      `<span class="dk2-count ${p.running ? 'g-A' : 'muted'}">● ${p.running}/${p.services.length}</span>`;
    const acts = h('div', 'dk2-gacts');
    if (!p.others) {
      const b = (html, title, fn, cls = 'icon-btn') => { const x = h('button', cls, html); x.title = title; x.addEventListener('click', (e) => { e.stopPropagation(); fn(e); }); acts.appendChild(x); return x; };
      b('▶', `docker compose -f ${p.rel} up -d`, () => act(tab, { verb: 'up', file: p.file }, null, key), 'icon-btn go');
      if (p.running) b('■', `docker compose -f ${p.rel} down`, () => act(tab, { verb: 'down', file: p.file }, `Arrêter et supprimer les conteneurs de <b>${esc(p.rel)}</b> ?`, key));
      if (p.running) b('⟳', 'Tout redémarrer', () => act(tab, { verb: 'restart', file: p.file }, null, key));
      b('▤', 'Journaux de tous les services', () => startLogs(tab, { title: p.rel, file: p.file }));
      const more = b('⋯', 'Plus', () => UI.menu(groupMenu(tab, p), more));
    }
    head.appendChild(acts);
    head.addEventListener('click', () => {
      if (collapsed) { d.collapsed.delete(key); d.openedOnce.add(key); } else { d.collapsed.add(key); d.openedOnce.delete(key); }
      render(tab);
      CAI.save();
    });
    head.addEventListener('contextmenu', (e) => { if (p.others) return; e.preventDefault(); UI.menu(groupMenu(tab, p), e.clientX, e.clientY); });
    g.appendChild(head);
    if (p.error) g.appendChild(h('pre', 'tt-msg dk2-err', esc(p.error)));
    if (!collapsed) for (const s of p.services) {
      if (d.filter && !(`${s.name} ${s.containers[0]?.image || ''}`.toLowerCase().includes(d.filter))) continue;
      g.appendChild(row(tab, p, s));
    }
    return g;
  }

  function row(tab, p, s) {
    const d = tab.d;
    const c = s.containers[0];
    const state = c?.state || 'missing';
    const [label, cls] = STATE[state] || [state, 'off'];
    const key = `${p.rel}|${s.name}`;
    const r = h('div', `dk2-row st-${cls}` + (d.busy.has(key) ? ' busy' : '') + (d.logKey === key ? ' selected' : ''));
    const ports = (c?.ports || []).map((pt) => `<a class="dk-port" data-port="${pt.host}" title="Ouvrir http://localhost:${pt.host} (→ ${pt.target}/${pt.proto})">:${pt.host}</a>`).join('');
    const health = c?.health ? `<span class="dk-health h-${c.health.replace(/\W/g, '')}" title="${esc(c.health)}">${c.health === 'healthy' ? '♥' : c.health === 'unhealthy' ? '✗' : '…'}</span>` : '';
    r.innerHTML = `<span class="dk-dot"></span><span class="dk2-name" title="${esc(c?.image || '')}">${esc(s.name)}</span>${s.orphan ? '<span class="tool-badge muted">orphelin</span>' : ''}${health}` +
      `<span class="dk2-state">${label}</span><span class="dk2-ports">${ports}</span>` +
      `<span class="dk2-stats">${c?.stats ? `<span title="CPU">${esc(c.stats.cpu)}</span><span title="Mémoire (${esc(c.stats.memPerc)})">${esc(c.stats.mem)}</span>` : c?.status && state !== 'running' ? `<span class="muted">${esc(c.status)}</span>` : ''}</span>`;
    const acts = h('span', 'dk2-acts');
    const b = (html, title, fn, extra = '') => { const x = h('button', 'icon-btn ' + extra, html); x.title = title; x.addEventListener('click', (e) => { e.stopPropagation(); fn(); }); acts.appendChild(x); return x; };
    const target = p.others ? { container: c.id } : { service: s.name, file: p.file };
    if (state === 'running') {
      b('⟳', 'Redémarrer', () => act(tab, { verb: 'restart', ...target }, null, key));
      b('■', 'Arrêter', () => act(tab, { verb: 'stop', ...target }, null, key));
      b('>_', 'Shell dans le conteneur', () => shellInto(tab, target, s.name));
    } else b('▶', 'Démarrer', () => act(tab, p.others ? { verb: 'start', ...target } : { verb: 'up', ...target }, null, key), 'go');
    b('▤', 'Journaux', () => startLogs(tab, { title: s.name, key, ...(p.others ? { container: c.id } : { service: s.name, file: p.file }) }));
    const more = b('⋯', 'Plus', () => UI.menu(rowMenu(tab, p, s), more));
    r.appendChild(acts);
    r.addEventListener('click', (e) => {
      const port = e.target.closest('[data-port]');
      if (port) window.open(`http://localhost:${port.dataset.port}`);
    });
    r.addEventListener('dblclick', () => startLogs(tab, { title: s.name, key, ...(p.others ? { container: c.id } : { service: s.name, file: p.file }) }));
    r.addEventListener('contextmenu', (e) => { e.preventDefault(); UI.menu(rowMenu(tab, p, s), e.clientX, e.clientY); });
    return r;
  }

  function rowMenu(tab, p, s) {
    const c = s.containers[0];
    const running = c?.state === 'running';
    const key = `${p.rel}|${s.name}`;
    const target = p.others ? { container: c.id } : { service: s.name, file: p.file };
    const items = [{ title: `${s.name}${c?.image ? ' · ' + c.image : ''}` }];
    if (running) items.push(
      { label: 'Redémarrer', icon: '⟳', action: () => act(tab, { verb: 'restart', ...target }, null, key) },
      { label: 'Arrêter', icon: '■', action: () => act(tab, { verb: 'stop', ...target }, null, key) },
      c && { label: 'Mettre en pause', icon: '⏸', action: () => act(tab, { verb: 'pause', container: c.id }, null, key) });
    else if (c?.state === 'paused') items.push({ label: 'Reprendre', icon: '▶', action: () => act(tab, { verb: 'unpause', container: c.id }, null, key) });
    else items.push({ label: 'Démarrer', icon: '▶', action: () => act(tab, p.others ? { verb: 'start', ...target } : { verb: 'up', ...target }, null, key) });
    if (!p.others) items.push(
      { label: 'Recréer le conteneur', icon: '♻', action: () => act(tab, { verb: 'recreate', ...target }, null, key) },
      { label: 'Reconstruire (build)', icon: '🔨', action: () => act(tab, { verb: 'build', ...target }, null, key) },
      { label: 'Télécharger l\'image (pull)', icon: '⤓', action: () => act(tab, { verb: 'pull', ...target }, null, key) });
    items.push('-',
      { label: 'Journaux', icon: '▤', action: () => startLogs(tab, { title: s.name, key, ...target }) },
      { label: 'Journaux dans un onglet terminal', icon: '>_', action: () => CAI.openTab(tab.space, { kind: 'terminal', cwd: tab.d.root, commands: p.others ? `docker logs -f --tail 200 ${c.id}` : `docker compose -f "${p.file}" logs -f --tail 200 ${s.name}` }, { title: `logs ${s.name}` }) },
      { label: 'Shell dans le conteneur', icon: '>_', disabled: !running, action: () => shellInto(tab, target, s.name) });
    for (const pt of c?.ports || []) items.push({ label: `Ouvrir http://localhost:${pt.host}`, icon: '↗', action: () => window.open(`http://localhost:${pt.host}`) });
    items.push('-');
    if (c) items.push({ label: 'Copier l\'ID du conteneur', icon: '⧉', action: () => api.writeClipboard(c.id.slice(0, 12)) });
    if (c?.image) items.push({ label: 'Copier le nom de l\'image', icon: '⧉', action: () => api.writeClipboard(c.image) });
    if (c) items.push({ label: 'Supprimer le conteneur', icon: '🗑', danger: true, action: () => act(tab, p.others ? { verb: 'remove', container: c.id } : { verb: 'remove', ...target }, `Supprimer le conteneur <b>${esc(s.name)}</b> ?`, key) });
    return items;
  }

  function groupMenu(tab, p) {
    return [
      { title: p.rel },
      { label: 'Tout démarrer (up -d)', icon: '▶', action: () => act(tab, { verb: 'up', file: p.file }, null, p.rel) },
      { label: 'Tout redémarrer', icon: '⟳', disabled: !p.running, action: () => act(tab, { verb: 'restart', file: p.file }, null, p.rel) },
      { label: 'Tout arrêter (down)', icon: '■', disabled: !p.running, action: () => act(tab, { verb: 'down', file: p.file }, `Arrêter et supprimer les conteneurs de <b>${esc(p.rel)}</b> ?`, p.rel) },
      { label: 'Tout reconstruire (build)', icon: '🔨', action: () => act(tab, { verb: 'build', file: p.file }, null, p.rel) },
      { label: 'Tout télécharger (pull)', icon: '⤓', action: () => act(tab, { verb: 'pull', file: p.file }, null, p.rel) },
      '-',
      { label: 'Journaux de tous les services', icon: '▤', action: () => startLogs(tab, { title: p.rel, file: p.file }) },
      { label: `Modifier ${p.rel}`, icon: '✎', action: () => CAI.openFile(tab.space, p.file) },
      { label: 'Terminal dans ce dossier', icon: '>_', action: () => CAI.openTab(tab.space, { kind: 'terminal', cwd: p.file.replace(/[\\/][^\\/]+$/, '') }) },
    ];
  }

  function moreMenu(tab) {
    const d = tab.d;
    const ps = d.data?.projects || [];
    return [
      { label: 'Tout déplier', icon: '⇲', action: () => { d.collapsed.clear(); ps.forEach((p) => d.openedOnce.add(p.rel)); render(tab); } },
      { label: 'Tout replier', icon: '⇱', action: () => { ps.forEach((p) => d.collapsed.add(p.rel)); render(tab); } },
      '-',
      ...ps.map((p) => ({ label: `Modifier ${p.rel}`, icon: '✎', action: () => CAI.openFile(tab.space, p.file) })),
      { label: 'Ouvrir un terminal dans le workspace', icon: '>_', action: () => CAI.openTab(tab.space, { kind: 'terminal', cwd: d.root }) },
    ];
  }

  async function act(tab, opts, confirmMsg, key) {
    const d = tab.d;
    if (confirmMsg && !(await UI.confirm('Confirmer', confirmMsg, { ok: 'Continuer', danger: true }))) return;
    const k = key || 'all';
    d.busy.add(k);
    d.progress.classList.remove('hidden');
    render(tab);
    const verbs = { up: 'Démarrage', down: 'Arrêt', start: 'Démarrage', stop: 'Arrêt', restart: 'Redémarrage', pull: 'Téléchargement', build: 'Construction', recreate: 'Recréation', remove: 'Suppression', pause: 'Pause', unpause: 'Reprise' };
    CAI.say(tab.space, `${verbs[opts.verb] || opts.verb}${opts.service ? ' de ' + opts.service : ''}…`, 1800);
    try {
      const r = await api.dockerAction(d.root, opts);
      if (!r.ok) { UI.toast(`Docker : échec de « ${opts.verb} »`, { kind: 'error', ms: 5000 }); showOutput(r.command, r.output); }
      else CAI.say(tab.space, 'C\'est fait ✓', 1200);
    } catch (e) { UI.toast(e.message, { kind: 'error' }); }
    d.busy.delete(k);
    if (!d.busy.size) d.progress.classList.add('hidden');
    refresh(tab);
  }

  async function shellInto(tab, target, name) {
    const cmd = await api.dockerExecCommand(tab.d.root, target);
    CAI.openTab(tab.space, { kind: 'terminal', cwd: tab.d.root, commands: cmd }, { title: `🐳 ${name}` });
  }

  // ---------- Tiroir des journaux ----------
  function startLogs(tab, t) {
    const d = tab.d;
    stopLogs(tab);
    d.logKey = t.key || null;
    d.drawer.classList.remove('hidden');
    d.drawer.innerHTML = '';
    const grip = h('div', 'dk2-grip');
    const head = h('div', 'dk-log-head');
    head.innerHTML = `<span>▤ ${esc(t.title)}</span>`;
    const follow = h('button', 'icon-btn toggle on', '⤓');
    follow.title = 'Suivre la fin';
    const clear = h('button', 'icon-btn', '⌫');
    clear.title = 'Effacer';
    const close = h('button', 'icon-btn', '✕');
    close.title = 'Fermer les journaux';
    head.append(h('div', 'tb-spacer'), follow, clear, close);
    const body = h('div', 'dk-log-body');
    d.drawer.append(grip, head, body);
    d.term?.dispose();
    d.term = new Terminal({ fontFamily: Settings.data.fontFamily, fontSize: Math.max(10, Settings.data.fontSize - 1), disableStdin: true, scrollback: 20000, theme: Themes.terminal(tab.space.bot) });
    d.fitAddon = new FitAddon.FitAddon();
    d.term.loadAddon(d.fitAddon);
    d.term.open(body);
    d.termHost = body;
    new ResizeObserver(() => fitLogs(tab)).observe(body);
    requestAnimationFrame(() => fitLogs(tab));
    d.follow = true;
    follow.addEventListener('click', () => { d.follow = !d.follow; follow.classList.toggle('on', d.follow); if (d.follow) d.term.scrollToBottom(); });
    clear.addEventListener('click', () => d.term.clear());
    close.addEventListener('click', () => { stopLogs(tab); d.drawer.classList.add('hidden'); d.logKey = null; render(tab); });
    grip.addEventListener('mousedown', (e) => {
      e.preventDefault();
      const y0 = e.clientY, h0 = d.drawer.offsetHeight;
      const move = (ev) => { d.logH = Math.max(100, Math.min(h0 - (ev.clientY - y0), tab.pane.offsetHeight - 120)); d.drawer.style.height = `${d.logH}px`; };
      const up = () => { removeEventListener('mousemove', move); removeEventListener('mouseup', up); fitLogs(tab); CAI.save(); };
      addEventListener('mousemove', move);
      addEventListener('mouseup', up);
    });
    const id = `logs${++logSeq}`;
    d.logsId = id;
    byLogs.set(id, tab);
    api.dockerLogs(id, d.root, { service: t.service, container: t.container, file: t.file });
    render(tab);
  }

  function stopLogs(tab) {
    const d = tab.d;
    if (!d.logsId) return;
    api.dockerStopLogs(d.logsId);
    byLogs.delete(d.logsId);
    d.logsId = null;
  }

  function fitLogs(tab) { const d = tab.d; if (d.term && d.termHost?.offsetParent) { try { d.fitAddon.fit(); } catch {} } }

  function showOutput(command, output) {
    UI.dialog({ title: 'Sortie de Docker', message: `<code>${esc(command)}</code><pre class="tt-msg">${UI.ansiToHtml(output || '(vide)')}</pre>`, ok: 'Fermer', cancel: 'Copier' }).then((r) => { if (r === null) api.writeClipboard(output); });
  }

  api.onDockerLogs((id, data) => {
    const tab = byLogs.get(id);
    if (!tab) return;
    tab.d.term.write(data);
    if (tab.d.follow) tab.d.term.scrollToBottom();
    CAI.talk(tab.space);
  });
  api.onDockerLogsEnd((id) => {
    const tab = byLogs.get(id);
    if (tab) tab.d.term.write('\r\n\x1b[90m[fin du flux de journaux]\x1b[0m\r\n');
  });

  (window.TabKinds = window.TabKinds || {}).docker = DockerTab;
})();
