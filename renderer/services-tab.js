// RobotConsole — onglet « Services » : services du workspace (.robot/services.json)
// État en direct, ports détectés, mémoire, santé HTTP, redémarrage auto, journaux interactifs.
(function () {
  const api = window.api;
  const { h, esc } = UI;
  const tabs = new Set();
  const bySession = new Map(); // sessionId -> tab (journal affiché)

  const ST = {
    running: ['En cours', 'ok'], starting: ['Démarrage…', 'warn'], restarting: ['Redémarrage…', 'warn'],
    stopped: ['Arrêté', 'off'], exited: ['Terminé', 'off'], crashed: ['Planté', 'bad'],
  };

  const ServicesTab = {
    icon: '<span class="kind-svc">🛰</span>',
    defaultTitle() { return 'Services'; },

    mount(tab, spec) {
      const s = tab.s = { root: spec.root, defs: [], status: {}, selected: spec.selected || null, logSession: null };
      tab.pane.classList.add('services-pane', 'tool-pane');
      const bar = h('div', 'tool-bar');
      s.badge = h('span', 'tool-badge', `🛰 ${esc((Platform.pathKey(CAI.ws?.root) === Platform.pathKey(spec.root) ? CAI.ws?.name : spec.root.split(/[\\/]/).pop()) || 'Services')}`);
      s.sum = h('div', 'tt-summary');
      const btn = (html, title, fn, cls = 'tb-btn small') => { const b = h('button', cls, html); b.title = title; b.addEventListener('click', fn); return b; };
      bar.append(s.badge, s.sum, h('div', 'tb-spacer'),
        btn('＋ Ajouter', 'Ajouter un service', () => editService(tab, null), 'tb-btn small'),
        btn('▶ Tout démarrer', 'Démarrer tous les services arrêtés', () => startAll(tab), 'tb-btn small primary'),
        btn('■ Tout arrêter', 'Arrêter tous les services', () => stopAll(tab), 'tb-btn small'),
        btn('⋯', 'Plus', (e) => UI.menu(moreMenu(tab), e.currentTarget), 'icon-btn'));
      const main = h('div', 'tool-main');
      s.list = h('div', 'sv-list');
      const split = h('div', 'ex-split');
      s.side = h('div', 'dk-side');
      main.append(s.list, split, s.side);
      split.addEventListener('mousedown', (e) => {
        e.preventDefault();
        const x0 = e.clientX, w0 = s.list.offsetWidth;
        const move = (ev) => { s.list.style.width = `${Math.max(280, Math.min(w0 + ev.clientX - x0, tab.pane.offsetWidth - 260))}px`; };
        const up = () => { removeEventListener('mousemove', move); removeEventListener('mouseup', up); fitLogs(tab); };
        addEventListener('mousemove', move);
        addEventListener('mouseup', up);
      });
      tab.pane.append(bar, main);
      s.list.innerHTML = '<div class="tool-empty"><div class="spinner"></div>Chargement des services…</div>';
      tabs.add(tab);
      api.svcOpen(s.root).then((snap) => { update(tab, snap); greet(tab); });
      s.tick = setInterval(() => { if (tab.pane.offsetParent) tick(tab); }, 1000);
    },

    activate(tab) { fitLogs(tab); },
    focus(tab) { tab.s.term?.focus(); },
    resize(tab) { fitLogs(tab); },
    dispose(tab) {
      clearInterval(tab.s.tick);
      detachLogs(tab);
      tab.s.term?.dispose();
      tabs.delete(tab);
    },
    serialize(tab) { return { root: tab.s.root, selected: tab.s.selected || undefined }; },
    applyTheme(tab) { if (tab.s.term) tab.s.term.options.theme = Themes.terminal(tab.space.bot); },

    // Accès à distance (téléphone / tablette)
    remoteSnapshot(tab) {
      const s = tab.s;
      const up = s.defs.filter((d) => isUp(s.status[d.id])).length;
      return {
        summary: `${up} / ${s.defs.length} en cours`,
        actions: [{ id: 'startAll', label: '▶ Tout démarrer' }, { id: 'stopAll', label: '■ Tout arrêter', danger: true }],
        sections: [{
          items: s.defs.map((d) => {
            const st = s.status[d.id] || { state: 'stopped' };
            const [label, cls] = ST[st.state] || [st.state, 'off'];
            const live = isUp(st);
            const meta = [];
            if (live && st.started) meta.push(`⏱ ${UI.fmtDuration(Date.now() - st.started)}`);
            else if (st.ended) meta.push(`⏹ il y a ${UI.fmtDuration(Date.now() - st.ended)}${st.exitCode != null ? ` · code ${st.exitCode}` : ''}`);
            if (live && st.mem) meta.push(`▦ ${UI.fmtBytes(st.mem)}`);
            if (st.health) meta.push(`${st.health.ok ? '♥' : '✗'} ${st.health.code || (st.health.ok ? 'ok' : st.health.error || 'fermé')}`);
            return {
              id: d.id, label: d.name || d.id, status: cls, badge: label, detail: d.command || '', meta: meta.join(' · '),
              ports: st.ports || [], sessionId: st.sessionId || undefined, logLabel: 'Journal',
              actions: live ? [{ id: 'restart', label: '⟳ Redémarrer' }, { id: 'stop', label: '■ Arrêter', danger: true }] : [{ id: 'start', label: '▶ Démarrer' }],
            };
          }),
        }],
      };
    },
    async remoteAction(tab, action, { item } = {}) {
      const d = tab.s.defs.find((x) => x.id === item);
      if (action === 'startAll') return startAll(tab);
      if (action === 'stopAll') return stopAll(tab);
      if (!d) return { error: 'Service introuvable' };
      if (action === 'start') await start(tab, d);
      else if (action === 'stop') await stop(tab, d);
      else if (action === 'restart') await restart(tab, d);
      return { toast: `${d.name || d.id} : ok` };
    },
  };

  function greet(tab) {
    const s = tab.s;
    const n = s.defs.length;
    const up = s.defs.filter((d) => isUp(s.status[d.id])).length;
    CAI.say(tab.space, n ? `${up}/${n} service${n > 1 ? 's' : ''} en route` : 'Aucun service : ajoutons-en un !', 2200);
  }

  const isUp = (st) => st && ['running', 'starting', 'restarting'].includes(st.state);

  function update(tab, snap) {
    const s = tab.s;
    const before = s.status;
    s.defs = snap.defs;
    s.status = snap.status;
    // Réactions du robot aux changements d'état
    for (const d of s.defs) {
      const a = before[d.id]?.state, b = s.status[d.id]?.state;
      if (a && b && a !== b) {
        if (b === 'crashed') { CAI.say(tab.space, `${d.name || d.id} a planté (code ${s.status[d.id].exitCode}) !`, 3000); tab.el.classList.add('unread'); }
        else if (b === 'running' && a !== 'running') CAI.talk(tab.space);
      }
    }
    if (!s.selected && s.defs[0]) s.selected = s.defs[0].id;
    // Le journal suit la nouvelle session après un redémarrage
    const cur = s.status[s.selected];
    if (s.logSession && cur?.sessionId && cur.sessionId !== s.logSession) attachLogs(tab, s.selected);
    render(tab);
  }

  function render(tab) {
    const s = tab.s;
    const up = s.defs.filter((d) => isUp(s.status[d.id])).length;
    const crashed = s.defs.filter((d) => s.status[d.id]?.state === 'crashed').length;
    s.sum.innerHTML = `<span class="g-A">● ${up}</span><span class="muted">/ ${s.defs.length}</span>${crashed ? `<span class="g-D">✗ ${crashed} planté${crashed > 1 ? 's' : ''}</span>` : ''}`;
    const scroll = s.list.scrollTop;
    s.list.innerHTML = '';
    if (!s.defs.length) {
      const box = h('div', 'tool-empty');
      box.innerHTML = `<div class="robot big">${tab.space.bot.svg}</div><b>Aucun service</b><div>Un service est une commande longue (serveur web, API, watcher…) que RobotConsole lance, surveille et redémarre au besoin. Les services continuent quand l'application est fermée.</div>`;
      const add = h('button', 'tb-btn primary', '＋ Ajouter un service');
      add.addEventListener('click', () => editService(tab, null));
      const sug = h('button', 'tb-btn', '✨ Suggestions du projet');
      sug.addEventListener('click', () => suggest(tab));
      const row = h('div', 'empty-actions');
      row.append(add, sug);
      box.appendChild(row);
      s.list.appendChild(box);
    }
    for (const d of s.defs) s.list.appendChild(card(tab, d));
    s.list.scrollTop = scroll;
    if (!s.logSession) renderSide(tab);
  }

  function card(tab, d) {
    const s = tab.s;
    const st = s.status[d.id] || { state: 'stopped' };
    const [label, cls] = ST[st.state] || [st.state, 'off'];
    const el = h('div', `dk-card sv-card st-${cls}` + (s.selected === d.id ? ' selected' : ''));
    el.dataset.id = d.id;
    const up = isUp(st);
    const ports = (st.ports || []).map((p) => `<a class="dk-port" data-port="${p}" title="Ouvrir http://localhost:${p}">:${p}</a>`).join('');
    const health = st.health ? `<span class="dk-health ${st.health.ok ? 'h-healthy' : 'h-unhealthy'}" title="${esc(st.health.url || 'port ' + st.health.port)}">${st.health.ok ? '♥' : '✗'} ${st.health.code || (st.health.ok ? 'ok' : esc(st.health.error || 'fermé'))}${st.health.ms ? ` · ${st.health.ms} ms` : ''}</span>` : '';
    el.innerHTML = `<div class="dk-top"><span class="dk-dot"></span><span class="dk-name">${esc(d.name || d.id)}</span>` +
      `${d.autostart ? '<span class="tool-badge" title="Démarre avec le workspace">auto</span>' : ''}${d.restart ? '<span class="tool-badge" title="Redémarre s\'il plante">♻</span>' : ''}${health}<span class="dk-state">${label}</span></div>` +
      `<div class="dk-sub mono">${esc(d.command || '')}</div>` +
      `<div class="dk-stats">${up ? `<span class="sv-uptime" title="Démarré le ${new Date(st.started).toLocaleString('fr-FR')}">⏱ ${UI.fmtDuration(Date.now() - st.started)}</span>` : st.ended ? `<span title="${new Date(st.ended).toLocaleString('fr-FR')}">⏹ il y a ${UI.fmtDuration(Date.now() - st.ended)}${st.exitCode != null ? ` · code ${st.exitCode}` : ''}</span>` : ''}` +
      `${up && st.pid ? `<span title="PID du processus">#${st.pid}</span>` : ''}${up && st.mem ? `<span title="Mémoire (${st.procs} processus)">▦ ${UI.fmtBytes(st.mem)}</span>` : ''}${st.restarts ? `<span title="Redémarrages automatiques">♻ ${st.restarts}</span>` : ''}` +
      `${d.cwd ? `<span title="Dossier">📁 ${esc(d.cwd)}</span>` : ''}${st.probeError ? `<span title="${esc(st.probeError)}">⚠ ${esc(st.probeError)}</span>` : ''}</div>` + (ports ? `<div class="dk-ports">${ports}</div>` : '');
    const actions = h('div', 'dk-actions');
    const b = (html, title, fn, extra = '') => { const x = h('button', 'icon-btn ' + extra, html); x.title = title; x.addEventListener('click', (ev) => { ev.stopPropagation(); fn(ev); }); actions.appendChild(x); return x; };
    if (up) {
      b('⟳', 'Redémarrer', () => restart(tab, d));
      b('■', 'Arrêter', () => stop(tab, d));
    } else b('▶', 'Démarrer', () => start(tab, d), 'go');
    b('▤', 'Journal', () => { s.selected = d.id; attachLogs(tab, d.id); render(tab); });
    if (d.url || st.ports?.length) b('↗', 'Ouvrir dans le navigateur', () => window.open(d.url || `http://localhost:${st.ports[0]}`));
    b('✎', 'Modifier', () => editService(tab, d));
    const more = b('⋯', 'Plus', () => UI.menu(serviceMenu(tab, d), more));
    el.appendChild(actions);
    el.addEventListener('click', (ev) => {
      const port = ev.target.closest('[data-port]');
      if (port) { window.open(`http://localhost:${port.dataset.port}`); return; }
      s.selected = d.id;
      if (s.logSession) attachLogs(tab, d.id);
      render(tab);
    });
    el.addEventListener('dblclick', () => attachLogs(tab, d.id));
    el.addEventListener('contextmenu', (ev) => { ev.preventDefault(); UI.menu(serviceMenu(tab, d), ev.clientX, ev.clientY); });
    return el;
  }

  // Met à jour les durées sans tout redessiner
  function tick(tab) {
    const s = tab.s;
    for (const el of s.list.querySelectorAll('.sv-card')) {
      const st = s.status[el.dataset.id];
      const u = el.querySelector('.sv-uptime');
      if (u && st?.started) u.textContent = `⏱ ${UI.fmtDuration(Date.now() - st.started)}`;
    }
  }

  function serviceMenu(tab, d) {
    const s = tab.s;
    const st = s.status[d.id] || {};
    const up = isUp(st);
    return [
      { title: d.name || d.id },
      up ? { label: 'Redémarrer', icon: '⟳', action: () => restart(tab, d) } : { label: 'Démarrer', icon: '▶', action: () => start(tab, d) },
      up && { label: 'Arrêter', icon: '■', action: () => stop(tab, d) },
      { label: 'Journal', icon: '▤', action: () => attachLogs(tab, d.id) },
      { label: 'Journal dans un onglet terminal', icon: '>_', disabled: !st.sessionId, action: () => CAI.openTab(tab.space, { kind: 'terminal', sessionId: st.sessionId, attachOnly: true }, { title: `🛰 ${d.name || d.id}` }) },
      ...(st.ports || []).map((p) => ({ label: `Ouvrir http://localhost:${p}`, icon: '↗', action: () => window.open(`http://localhost:${p}`) })),
      d.url && { label: `Ouvrir ${d.url}`, icon: '↗', action: () => window.open(d.url) },
      '-',
      { label: 'Démarrage automatique', checked: !!d.autostart, action: () => patch(tab, d, { autostart: !d.autostart }) },
      { label: 'Redémarrer s\'il plante', checked: !!d.restart, action: () => patch(tab, d, { restart: !d.restart }) },
      '-',
      { label: 'Modifier…', icon: '✎', action: () => editService(tab, d) },
      { label: 'Dupliquer', icon: '⧉', action: () => save(tab, [...s.defs, { ...d, id: uniqueId(s, d.id), name: `${d.name || d.id} (copie)`, autostart: false }]) },
      { label: 'Copier la commande', icon: '⧉', action: () => api.writeClipboard(d.command) },
      { label: 'Ouvrir un terminal dans son dossier', icon: '>_', action: () => CAI.openTab(tab.space, { kind: 'terminal', cwd: d.cwd ? (/^[a-z]:|^[\\/]/i.test(d.cwd) ? d.cwd : Platform.joinPath(s.root, d.cwd)) : s.root }) },
      { label: 'Supprimer', icon: '🗑', danger: true, action: async () => {
        if (!(await UI.confirm('Supprimer le service ?', `<b>${esc(d.name || d.id)}</b> sera retiré de services.json${up ? ' et arrêté' : ''}.`, { ok: 'Supprimer', danger: true }))) return;
        if (up) await api.svcStop(s.root, d.id);
        save(tab, s.defs.filter((x) => x.id !== d.id));
      } },
    ];
  }

  function moreMenu(tab) {
    const s = tab.s;
    return [
      { label: 'Suggestions depuis le projet…', icon: '✨', action: () => suggest(tab) },
      { label: 'Modifier services.json', icon: '✎', action: () => CAI.openFile(tab.space, Platform.joinPath(s.root, '.robot', 'services.json')) },
      { label: 'Recharger la configuration', icon: '⟳', action: () => api.svcReload(s.root) },
      '-',
      { label: 'Redémarrer tous les services lancés', icon: '⟳', action: () => s.defs.filter((d) => isUp(s.status[d.id])).forEach((d) => restart(tab, d)) },
    ];
  }

  // ---------- Actions ----------
  async function start(tab, d) {
    if (!d.command) return UI.toast('Ce service n\'a pas de commande', { kind: 'error' });
    CAI.say(tab.space, `Je lance ${d.name || d.id}…`, 1500);
    await api.svcStart(tab.s.root, d.id);
    tab.s.selected = d.id;
    attachLogs(tab, d.id);
  }
  async function stop(tab, d) { await api.svcStop(tab.s.root, d.id); CAI.say(tab.space, `${d.name || d.id} arrêté`, 1400); }
  async function restart(tab, d) { CAI.say(tab.space, `Je relance ${d.name || d.id}…`, 1400); await api.svcRestart(tab.s.root, d.id); tab.s.selected = d.id; attachLogs(tab, d.id); }
  function startAll(tab) { tab.s.defs.filter((d) => !isUp(tab.s.status[d.id]) && d.command).forEach((d) => api.svcStart(tab.s.root, d.id)); CAI.say(tab.space, 'Tout le monde en piste !', 1600); }
  function stopAll(tab) { tab.s.defs.filter((d) => isUp(tab.s.status[d.id])).forEach((d) => api.svcStop(tab.s.root, d.id)); CAI.say(tab.space, 'Extinction des feux', 1600); }

  function save(tab, defs) { return api.svcSave(tab.s.root, defs.map(({ ...d }) => d)); }
  function patch(tab, d, p) { return save(tab, tab.s.defs.map((x) => (x.id === d.id ? { ...x, ...p } : x))); }
  function uniqueId(s, base) {
    let id = String(base || 'service').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-|-$/g, '') || 'service';
    let i = 2;
    const taken = new Set(s.defs.map((d) => d.id));
    let out = id;
    while (taken.has(out)) out = `${id}-${i++}`;
    return out;
  }

  async function suggest(tab) {
    const s = tab.s;
    const list = await api.svcSuggest(s.root);
    if (!list.length) return UI.toast('Aucune suggestion trouvée (package.json, manage.py, main.go, Cargo.toml…)');
    UI.menu([{ title: 'Ajouter depuis le projet' }, ...list.map((x) => ({
      label: x.name, hint: x.command, icon: '✨',
      action: () => save(tab, [...s.defs, { id: uniqueId(s, x.name), name: x.name, command: x.command, cwd: '', autostart: false, restart: false }]),
    }))], innerWidth / 2 - 150, 120);
  }

  // ---------- Éditeur de service ----------
  function editService(tab, d) {
    const s = tab.s;
    const isNew = !d;
    d = d || { id: '', name: '', command: '', cwd: '', shellId: '', port: '', url: '', env: {}, autostart: false, restart: true };
    const ov = h('div', 'overlay dlg-overlay');
    const card = h('div', 'dlg svc-dlg');
    card.innerHTML = `<h3>${isNew ? 'Nouveau service' : 'Modifier le service'}</h3>`;
    const field = (label, input, hint) => { const r = h('label', 'svc-field'); r.innerHTML = `<span>${label}${hint ? `<small>${hint}</small>` : ''}</span>`; r.appendChild(input); card.appendChild(r); return input; };
    const inp = (v, ph) => { const i = h('input', 'set-input'); i.value = v ?? ''; i.placeholder = ph || ''; i.spellcheck = false; return i; };
    const name = field('Nom', inp(d.name, 'api, web, worker…'));
    const command = field('Commande', inp(d.command, 'npm run dev'), 'Lancée dans le shell choisi');
    const cwdWrap = h('div', 'svc-row');
    const cwd = inp(d.cwd, '(racine du workspace)');
    const pick = h('button', 'icon-btn', '📂');
    pick.addEventListener('click', async () => {
      const p = await api.pickFolder(s.root);
      if (p) cwd.value = Platform.withinPath(p, s.root) ? p.slice(s.root.replace(/[\\/]+$/, '').length).replace(/^[\\/]/, '') : p;
    });
    cwdWrap.append(cwd, pick);
    field('Dossier', cwdWrap, 'Relatif au workspace');
    const shell = h('select', 'set-input');
    shell.innerHTML = '<option value="">Shell par défaut</option>' + CAI.shells.map((x) => `<option value="${x.id}">${esc(x.label)}</option>`).join('');
    shell.value = d.shellId || '';
    field('Shell', shell);
    const port = field('Port attendu', inp(d.port, '3000'), 'Pour vérifier qu\'il écoute');
    const url = field('URL de santé', inp(d.url || d.health, 'http://localhost:3000/health'), 'Interrogée toutes les 4 s');
    const env = h('textarea', 'set-input tpl-cmds');
    env.rows = 3;
    env.placeholder = 'NODE_ENV=development\nPORT=3000';
    env.value = Object.entries(d.env || {}).map(([k, v]) => `${k}=${v}`).join('\n');
    field('Variables d\'environnement', env, 'Une par ligne : CLÉ=valeur');
    const checks = h('div', 'svc-checks');
    const cb = (label, v) => { const l = h('label', 'svc-check'); const c = h('input'); c.type = 'checkbox'; c.checked = !!v; l.append(c, document.createTextNode(label)); checks.appendChild(l); return c; };
    const autostart = cb('Démarrer avec le workspace', d.autostart);
    const restart = cb('Redémarrer automatiquement s\'il plante', d.restart);
    card.appendChild(checks);
    const actions = h('div', 'dlg-actions');
    const cancel = h('button', 'tb-btn', 'Annuler');
    const ok = h('button', 'tb-btn primary', isNew ? 'Ajouter' : 'Enregistrer');
    const okStart = h('button', 'tb-btn', isNew ? 'Ajouter et démarrer' : 'Enregistrer et redémarrer');
    actions.append(cancel, okStart, ok);
    card.appendChild(actions);
    ov.appendChild(card);
    document.body.appendChild(ov);
    name.focus();
    card.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Escape') ov.remove(); });
    cancel.addEventListener('click', () => ov.remove());
    ov.addEventListener('mousedown', (e) => { if (e.target === ov) ov.remove(); });
    const commit = async (andStart) => {
      if (!command.value.trim()) { command.focus(); command.classList.add('invalid'); return; }
      const envObj = {};
      for (const line of env.value.split(/\r?\n/)) { const m = line.match(/^\s*([\w.]+)\s*=\s*(.*)$/); if (m) envObj[m[1]] = m[2]; }
      const out = {
        id: isNew ? uniqueId(s, name.value || command.value.split(' ').pop()) : d.id,
        name: name.value.trim() || command.value.trim(), command: command.value.trim(), cwd: cwd.value.trim(),
        shellId: shell.value || undefined, port: port.value ? +port.value : undefined, url: url.value.trim() || undefined,
        env: Object.keys(envObj).length ? envObj : undefined, autostart: autostart.checked, restart: restart.checked,
      };
      const defs = isNew ? [...s.defs, out] : s.defs.map((x) => (x.id === d.id ? out : x));
      await save(tab, defs);
      ov.remove();
      if (andStart) { s.defs = defs; isUp(s.status[out.id]) ? restart_(tab, out) : start(tab, out); }
    };
    const restart_ = (t, x) => restart(t, x);
    ok.addEventListener('click', () => commit(false));
    okStart.addEventListener('click', () => commit(true));
  }

  // ---------- Journal (terminal interactif attaché au service) ----------
  function renderSide(tab) {
    const s = tab.s;
    const d = s.defs.find((x) => x.id === s.selected);
    s.side.innerHTML = '';
    const box = h('div', 'tool-empty');
    if (!d) { box.innerHTML = `<div class="robot big">${tab.space.bot.svg}</div><b>Sélectionnez un service</b>`; s.side.appendChild(box); return; }
    const st = s.status[d.id];
    box.innerHTML = `<div class="robot big">${tab.space.bot.svg}</div><b>${esc(d.name || d.id)}</b><div class="mono">${esc(d.command)}</div><div>${esc(ST[st?.state]?.[0] || 'Arrêté')}</div>`;
    const row = h('div', 'empty-actions');
    if (st?.sessionId) { const b = h('button', 'tb-btn primary', '▤ Afficher le journal'); b.addEventListener('click', () => attachLogs(tab, d.id)); row.appendChild(b); }
    if (!isUp(st)) { const b = h('button', 'tb-btn', '▶ Démarrer'); b.addEventListener('click', () => start(tab, d)); row.appendChild(b); }
    box.appendChild(row);
    s.side.appendChild(box);
  }

  async function attachLogs(tab, id) {
    const s = tab.s;
    const st = s.status[id];
    const d = s.defs.find((x) => x.id === id);
    detachLogs(tab);
    if (!st?.sessionId) { renderSide(tab); return; }
    s.side.innerHTML = '';
    const head = h('div', 'dk-log-head');
    head.innerHTML = `<span>▤ ${esc(d?.name || id)}</span><span class="muted mono">${esc(d?.command || '')}</span>`;
    const clear = h('button', 'icon-btn', '⌫');
    clear.title = 'Effacer l\'affichage';
    const close = h('button', 'icon-btn', '✕');
    close.title = 'Fermer le journal';
    head.append(h('div', 'tb-spacer'), clear, close);
    const body = h('div', 'dk-log-body');
    s.side.append(head, body);
    s.term?.dispose();
    s.term = new Terminal({ fontFamily: Settings.data.fontFamily, fontSize: Math.max(10, Settings.data.fontSize - 1), scrollback: 20000, theme: Themes.terminal(tab.space.bot) });
    s.fit = new FitAddon.FitAddon();
    s.term.loadAddon(s.fit);
    s.term.open(body);
    s.termHost = body;
    UI.termClipboard(s.term, body, { interactive: true }); // copier / coller (Ctrl+C ne coupe plus le service s'il y a une sélection)
    new ResizeObserver(() => fitLogs(tab)).observe(body);
    const sid = st.sessionId;
    s.logSession = sid;
    bySession.set(sid, tab);
    s.term.onData((data) => api.write(sid, data)); // le journal est interactif (stdin du service)
    clear.addEventListener('click', () => s.term.clear());
    close.addEventListener('click', () => { detachLogs(tab); renderSide(tab); });
    requestAnimationFrame(() => fitLogs(tab));
    const res = await api.attachPty({ id: sid, cols: s.term.cols, rows: s.term.rows });
    if (s.logSession !== sid) return;
    if (res?.data) s.term.write(res.data);
    if (res && !res.alive) s.term.write(`\r\n\x1b[90m[${I18n.t('terminé, code {0}', res.exitCode)}]\x1b[0m\r\n`);
  }

  function detachLogs(tab) {
    const s = tab.s;
    if (!s.logSession) return;
    bySession.delete(s.logSession);
    s.logSession = null;
  }

  function fitLogs(tab) {
    const s = tab.s;
    if (!s.term || !s.termHost?.offsetParent) return;
    try { s.fit.fit(); } catch {}
  }

  api.onData((id, data) => {
    const tab = bySession.get(id);
    if (!tab) return;
    tab.s.term.write(data);
    CAI.talk(tab.space);
  });
  api.onExit((id, code) => {
    const tab = bySession.get(id);
    if (tab) tab.s.term.write(`\r\n\x1b[90m[${I18n.t('terminé, code {0}', code)}]\x1b[0m\r\n`);
  });
  api.onSvcStatus((root, snap) => {
    for (const tab of tabs) if (Platform.pathKey(tab.s.root) === Platform.pathKey(root)) update(tab, snap);
  });

  (window.TabKinds = window.TabKinds || {}).services = ServicesTab;
})();
