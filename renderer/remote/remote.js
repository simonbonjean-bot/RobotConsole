// RobotConsole — page mobile d'accès à distance (téléphone / tablette)
// Robots ouverts → onglets → terminal (xterm) ou aperçu interactif selon le type d'onglet.
(() => {
  const EN = !/^fr\b/i.test(navigator.language || '');
  const T = (fr, en) => (EN ? en : fr);
  const $ = (s, r = document) => r.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const h = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };

  const view = $('#view'), tabsEl = $('#tabs'), titleEl = $('#title'), backBtn = $('#back'), connEl = $('#conn');
  let ws = null, robots = [], route = parseRoute(), reqSeq = 0, gotList = false;
  const pending = new Map(); // req -> callback
  let term = null; // terminal affiché : { id, xterm, mode }
  let watching = null; // onglet dont on reçoit l'aperçu
  let sheetLog = null; // journal ouvert en plein écran : { id, xterm }

  // ---------- Connexion ----------
  function connect() {
    if (ws && ws.readyState <= 1) return;
    // Via le relais, la page reçoit un transport chiffré à la place du WebSocket local
    ws = window.RCTransport ? window.RCTransport() : new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
    ws.onopen = () => { connEl.classList.add('on'); send({ t: 'list' }); render(true); };
    ws.onclose = (e) => {
      connEl.classList.remove('on');
      if (e.code === 4003) { view.innerHTML = `<div class="empty">${T('Jeton changé : rescannez le QR code dans RobotConsole.', 'Token changed: scan the QR code again in RobotConsole.')}</div>`; return; }
      setTimeout(connect, 1500);
    };
    ws.onmessage = (ev) => { let m; try { m = JSON.parse(ev.data); } catch { return; } onMessage(m); };
  }
  const send = (m) => { if (ws?.readyState === 1) ws.send(JSON.stringify(m)); };
  function action(robot, tabId, act, args = {}) {
    return new Promise((resolve) => {
      const req = ++reqSeq;
      pending.set(req, resolve);
      send({ t: 'action', wcId: robot.wcId, tabId, action: act, args, req });
    });
  }

  function onMessage(m) {
    switch (m.t) {
      case 'robots': robots = m.robots || []; gotList = true; render(); break;
      case 'attached':
        if (term?.id === m.id) attachedTerm(term, m);
        if (sheetLog?.id === m.id) { sheetLog.xterm.resize(m.cols || 80, m.rows || 24); sheetLog.xterm.write(m.data || ''); }
        if (m.denied) toast(T('Accès refusé', 'Access denied'), true);
        break;
      case 'data':
        if (term?.id === m.id) term.xterm.write(m.data);
        if (sheetLog?.id === m.id) sheetLog.xterm.write(m.data);
        break;
      case 'resized':
        if (term?.id === m.id) { term.xterm.resize(m.cols, m.rows); fitFont(); }
        if (sheetLog?.id === m.id) sheetLog.xterm.resize(m.cols, m.rows);
        break;
      case 'exit':
        if (term?.id === m.id) term.xterm.write(m.revoked ? `\r\n\x1b[33m[${T('accès retiré', 'access revoked')}]\x1b[0m\r\n` : `\r\n\x1b[90m[${T('processus terminé', 'process exited')}${m.code != null ? ' · code ' + m.code : ''}]\x1b[0m\r\n`);
        break;
      case 'snapshot':
        if (watching && watching.wcId === m.wcId && watching.tabId === m.tabId) renderSnapshot(m.snap);
        break;
      case 'actionResult': {
        const cb = pending.get(m.req);
        pending.delete(m.req);
        cb?.(m.result || {});
        break;
      }
    }
  }

  // ---------- Navigation : #/r/<robot>/<onglet> (le lien / QR code d'un robot ouvre directement ses onglets) ----------
  function parseRoute() {
    const [r, key, tabId] = location.hash.replace(/^#\/?/, '').split('/').map(decodeURIComponent);
    return r === 'r' && key ? { key, tabId: tabId || null } : { key: null, tabId: null };
  }
  function go(key, tabId) {
    location.hash = key == null ? '' : `/r/${encodeURIComponent(key)}${tabId ? '/' + encodeURIComponent(tabId) : ''}`;
  }
  addEventListener('hashchange', () => { route = parseRoute(); render(true); });
  backBtn.addEventListener('click', () => { if (route.key) go(null); });
  const curRobot = () => robots.find((r) => r.key === route.key);

  // ---------- Icône de l'onglet / de l'écran d'accueil : le robot affiché ----------
  const APP_ICON = '/icon.png';
  const iconCache = new Map();
  let iconFor = '';
  function setIcon(svg, name) {
    document.title = name ? `${name} · RobotConsole` : 'RobotConsole';
    const key = svg || '';
    if (key === iconFor) return;
    iconFor = key;
    if (!svg) return applyIcon(APP_ICON);
    if (iconCache.has(svg)) return applyIcon(iconCache.get(svg));
    let src = svg.includes('xmlns=') ? svg : svg.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');
    const img = new Image();
    img.onload = () => {
      try {
        const c = document.createElement('canvas');
        c.width = c.height = 180;
        const g = c.getContext('2d');
        g.fillStyle = '#0e1117';
        g.beginPath(); g.roundRect ? g.roundRect(0, 0, 180, 180, 36) : g.rect(0, 0, 180, 180); g.fill();
        g.drawImage(img, 14, 14, 152, 152);
        const url = c.toDataURL('image/png');
        iconCache.set(svg, url);
        if (iconFor === key) applyIcon(url);
      } catch { applyIcon('data:image/svg+xml;charset=utf-8,' + encodeURIComponent(src)); }
    };
    img.onerror = () => applyIcon(APP_ICON);
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(src);
  }
  function applyIcon(href) {
    for (const rel of ['icon', 'apple-touch-icon']) {
      let l = document.querySelector(`link[rel="${rel}"]`);
      if (!l) { l = document.createElement('link'); l.rel = rel; document.head.appendChild(l); }
      l.href = href;
    }
  }

  // ---------- Rendu ----------
  let shown = ''; // ce qui est affiché (évite de tout reconstruire à chaque mise à jour)
  function render(force) {
    const r = curRobot();
    if (!route.key || !r) {
      closeTerm(); unwatch();
      backBtn.classList.toggle('hidden', !route.key);
      tabsEl.classList.add('hidden');
      titleEl.textContent = 'RobotConsole';
      setIcon(null);
      shown = 'list';
      // Lien d'un robot qui n'est (plus) ouvert à distance
      if (route.key && gotList) { view.innerHTML = `<div class="empty"><div style="font-size:48px">🔒</div>${T('Ce robot n\'est pas ouvert à distance.<br><small>Dans RobotConsole : clic sur le robot → 📡 Partage.</small>', 'This robot is not open for remote access.<br><small>In RobotConsole: click the robot → 📡 Sharing.</small>')}</div>`; return; }
      return renderList();
    }
    setIcon(r.svg, r.name);
    backBtn.classList.remove('hidden');
    titleEl.innerHTML = `<span class="mini">${r.svg || ''}</span><span>${esc(r.name)}</span><span class="pill ${r.mode}">${r.mode === 'control' ? T('contrôle', 'control') : T('lecture', 'read-only')}</span>`;
    renderTabs(r);
    const tab = r.tabs.find((t) => t.id === route.tabId) || r.tabs.find((t) => t.active) || r.tabs[0];
    if (!tab) { closeTerm(); unwatch(); shown = ''; view.innerHTML = `<div class="empty">${T('Aucun onglet', 'No tabs')}</div>`; return; }
    const sig = `${r.key}/${tab.id}/${tab.sessionId || ''}/${r.mode}`;
    if (!force && sig === shown) return;
    shown = sig;
    if (tab.kind === 'terminal') { unwatch(); openTerm(r, tab); }
    else { closeTerm(); openSnapshot(r, tab); }
  }

  function renderList() {
    view.innerHTML = '';
    if (!robots.length) {
      view.innerHTML = `<div class="empty"><div style="font-size:48px">📡</div>${ws?.readyState === 1
        ? T('Aucun robot ouvert.<br><small>Dans RobotConsole : clic sur un robot → 📡 Partage.</small>', 'No open robot.<br><small>In RobotConsole: click a robot → 📡 Sharing.</small>')
        : T('Connexion…', 'Connecting…')}</div>`;
      return;
    }
    const grid = h('div', 'robots');
    for (const r of robots) {
      const c = h('div', 'rcard');
      c.innerHTML = `<div class="robot">${r.svg || ''}</div><b>${esc(r.name)}</b><small>${r.tabs.length} ${T('onglet(s)', 'tab(s)')}</small><span class="pill ${r.mode}">${r.mode === 'control' ? T('contrôle', 'control') : T('lecture seule', 'read-only')}</span>`;
      c.addEventListener('click', () => go(r.key));
      grid.appendChild(c);
    }
    view.appendChild(grid);
  }

  function renderTabs(r) {
    tabsEl.classList.remove('hidden');
    const cur = route.tabId || (r.tabs.find((t) => t.active) || r.tabs[0])?.id;
    tabsEl.innerHTML = '';
    for (const t of r.tabs) {
      const b = h('button', 'tabbtn' + (t.id === cur ? ' on' : '') + (t.exited ? ' exited' : ''));
      b.innerHTML = `<span>${t.kind === 'terminal' ? '&gt;_' : esc(t.icon || '•')}</span><span class="t">${esc(t.title)}</span>`;
      b.addEventListener('click', () => go(r.key, t.id));
      tabsEl.appendChild(b);
      if (t.id === cur) requestAnimationFrame(() => b.scrollIntoView({ inline: 'nearest', block: 'nearest' }));
    }
  }

  // ---------- Terminal ----------
  let fontSize = +(localStorageGet('rc-font') || 0);
  function localStorageGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
  function localStorageSet(k, v) { try { localStorage.setItem(k, v); } catch {} }

  function openTerm(r, tab) {
    closeTerm();
    view.innerHTML = '';
    if (!tab.sessionId) { view.innerHTML = `<div class="empty">${T('Terminal pas encore démarré…', 'Terminal not started yet…')}</div>`; shown = ''; return; }
    const control = r.mode === 'control';
    const wrap = h('div', 'termwrap');
    const bar = h('div', 'termbar', `<span>${control ? T('Contrôle : ce que vous tapez part sur le PC', 'Control: what you type goes to the PC') : T('Lecture seule', 'Read-only')}</span><span class="sp"></span>`);
    const minus = h('button', 'btn small', 'A−'), plus = h('button', 'btn small', 'A+'), fit = h('button', 'btn small', '↔');
    bar.append(minus, plus, fit);
    const scroll = h('div', 'termscroll');
    wrap.append(bar, scroll);
    view.appendChild(wrap);
    const xterm = new Terminal({
      fontFamily: 'ui-monospace, "Cascadia Mono", Menlo, Consolas, monospace', fontSize: fontSize || 11, scrollback: 5000,
      disableStdin: !control, cursorBlink: control, convertEol: false, allowProposedApi: true,
      theme: { background: '#000000', foreground: '#c9d1d9' },
    });
    xterm.open(scroll);
    term = { id: tab.sessionId, xterm, mode: r.mode, scroll };
    if (control) {
      xterm.onData((d) => sendInput(applyMods(d)));
      wrap.append(keyBar(), inputBar());
    }
    minus.addEventListener('click', () => setFont((xterm.options.fontSize || 11) - 1));
    plus.addEventListener('click', () => setFont((xterm.options.fontSize || 11) + 1));
    fit.addEventListener('click', () => { fontSize = 0; localStorageSet('rc-font', ''); fitFont(); });
    send({ t: 'attach', id: tab.sessionId });
  }
  function attachedTerm(t, m) {
    if (!m.found) { t.xterm.write(`\x1b[90m[${T('session introuvable', 'session not found')}]\x1b[0m`); return; }
    t.xterm.resize(m.cols || 80, m.rows || 24);
    t.xterm.reset();
    t.xterm.write(m.data || '', () => t.xterm.scrollToBottom());
    fitFont();
  }
  function setFont(px) {
    if (!term) return;
    fontSize = Math.max(5, Math.min(24, px));
    localStorageSet('rc-font', String(fontSize));
    term.xterm.options.fontSize = fontSize;
  }
  // Taille de police pour que les colonnes du PC tiennent dans la largeur de l'écran
  function fitFont() {
    if (!term || fontSize) return;
    const w = term.scroll.clientWidth - 10;
    const cols = term.xterm.cols || 80;
    const px = Math.max(5, Math.min(15, Math.floor((w / cols) / 0.6)));
    term.xterm.options.fontSize = px;
  }
  addEventListener('resize', () => fitFont());
  function closeTerm() {
    if (!term) return;
    send({ t: 'detach', id: term.id });
    term.xterm.dispose();
    term = null;
  }

  // Modificateurs « collants » (Ctrl / Alt) appliqués à la prochaine touche
  const mods = { ctrl: false, alt: false };
  let modBtns = {};
  function applyMods(d) {
    if (!mods.ctrl && !mods.alt) return d;
    let out = d;
    if (mods.ctrl && d.length === 1) {
      const c = d.toUpperCase().charCodeAt(0);
      if (c >= 64 && c <= 95) out = String.fromCharCode(c - 64);
      else if (d === ' ') out = '\x00';
    }
    if (mods.alt) out = '\x1b' + out;
    mods.ctrl = mods.alt = false;
    Object.values(modBtns).forEach((b) => b.classList.remove('on'));
    return out;
  }
  const sendInput = (data) => { if (term && term.mode === 'control') send({ t: 'input', id: term.id, data }); };
  function keyBar() {
    const bar = h('div', 'keys');
    const KEYS = [
      ['Échap', '\x1b'], ['Tab', '\t'], ['Ctrl', 'ctrl'], ['Alt', 'alt'], ['^C', '\x03'], ['^D', '\x04'], ['^Z', '\x1a'], ['^L', '\x0c'],
      ['↑', '\x1b[A'], ['↓', '\x1b[B'], ['←', '\x1b[D'], ['→', '\x1b[C'], ['⇞', '\x1b[5~'], ['⇟', '\x1b[6~'], ['Début', '\x1b[H'], ['Fin', '\x1b[F'], ['⏎', '\r'],
    ];
    modBtns = {};
    for (const [label, seq] of KEYS) {
      const b = h('button', 'key', esc(EN ? ({ 'Échap': 'Esc', 'Début': 'Home', 'Fin': 'End' }[label] || label) : label));
      if (seq === 'ctrl' || seq === 'alt') {
        modBtns[seq] = b;
        b.addEventListener('click', () => { mods[seq] = !mods[seq]; b.classList.toggle('on', mods[seq]); });
      } else b.addEventListener('click', () => { sendInput(applyMods(seq)); });
      b.addEventListener('mousedown', (e) => e.preventDefault()); // garde le clavier ouvert
      bar.appendChild(b);
    }
    return bar;
  }
  function inputBar() {
    const f = h('form', 'inputbar');
    const inp = h('input');
    inp.placeholder = T('Commande… (Entrée pour envoyer)', 'Command… (Enter to send)');
    inp.autocapitalize = 'off'; inp.autocomplete = 'off'; inp.spellcheck = false;
    inp.setAttribute('autocorrect', 'off');
    const go = h('button', 'btn primary', '⏎');
    go.type = 'submit';
    f.append(inp, go);
    f.addEventListener('submit', (e) => { e.preventDefault(); sendInput(applyMods(inp.value) + '\r'); inp.value = ''; });
    return f;
  }

  // ---------- Aperçus des autres onglets ----------
  function openSnapshot(r, tab) {
    unwatch();
    watching = { wcId: r.wcId, tabId: tab.id, robot: r, tab };
    view.innerHTML = '<div class="empty">…</div>';
    send({ t: 'watch', wcId: r.wcId, tabId: tab.id });
  }
  function unwatch() { if (watching) { send({ t: 'unwatch' }); watching = null; } }

  const canRun = (a) => watching && (watching.robot.mode === 'control' || a.read);
  async function runAction(a, args = {}) {
    if (!watching) return;
    if (a.danger && !confirm(`${a.label.replace(/^\W+\s*/, '')} ?`)) return;
    if (a.prompt) { const v = prompt(a.prompt); if (v == null) return; args = { ...args, value: v }; }
    const { robot, tab } = watching;
    const res = await action(robot, tab.id, a.id, { ...(a.args || {}), ...args });
    if (res.error) return toast(res.error, true);
    if (res.toast) toast(res.toast);
    if (res.text != null || res.image || res.table) showSheet(res);
  }
  function actButtons(list, args) {
    const box = h('div', 'iacts');
    for (const a of list || []) {
      if (!canRun(a)) continue;
      const b = h('button', 'btn small' + (a.danger ? ' danger' : ''), esc(a.label));
      b.addEventListener('click', (e) => { e.stopPropagation(); runAction(a, args); });
      box.appendChild(b);
    }
    return box.children.length ? box : null;
  }

  function renderSnapshot(snap) {
    if (!watching) return;
    const keep = view.scrollTop;
    view.innerHTML = '';
    if (!snap || snap.unavailable) { view.innerHTML = `<div class="empty">${T('Aperçu indisponible pour ce type d\'onglet', 'No preview for this tab type')}</div>`; return; }
    if (snap.error) { view.innerHTML = `<div class="empty">${esc(snap.error)}</div>`; return; }
    if (snap.summary) { const s = h('div', 'summary' + (snap.busy ? ' busy' : '')); s.appendChild(document.createTextNode(snap.summary)); view.appendChild(s); }
    if (snap.tabs) {
      const seg = h('div', 'seg');
      for (const t of snap.tabs) { const b = h('button', 'btn small' + (t.on ? ' on' : ''), esc(t.label)); b.addEventListener('click', () => runAction({ id: t.id, read: true })); seg.appendChild(b); }
      view.appendChild(seg);
    }
    const top = actButtons(snap.actions);
    if (top) { top.className = 'acts'; view.appendChild(top); }
    for (const sec of snap.sections || []) {
      const s = h('div', 'section');
      if (sec.title || sec.actions?.length) {
        const t = h('h4', '', `<span>${esc(sec.title || '')}</span><span class="sp"></span>`);
        const a = actButtons(sec.actions);
        if (a) { a.className = ''; a.style.cssText = 'display:flex;gap:6px'; t.appendChild(a); }
        s.appendChild(t);
      }
      if (!sec.items?.length) s.appendChild(h('div', 'meta', `<small style="color:var(--muted)">${T('(vide)', '(empty)')}</small>`));
      for (const it of sec.items || []) s.appendChild(itemEl(it));
      view.appendChild(s);
    }
    if (snap.text) {
      if (snap.textTitle) view.appendChild(h('div', 'out-title', esc(snap.textTitle)));
      const pre = h('pre', 'out');
      pre.textContent = snap.text;
      view.appendChild(pre);
      requestAnimationFrame(() => { pre.scrollTop = pre.scrollHeight; });
    }
    view.scrollTop = keep;
  }

  function itemEl(it) {
    const el = h('div', 'item ' + (it.status ? 's-' + it.status : 'plain'));
    el.innerHTML = `<div class="row1"><span class="lbl">${esc(it.label)}</span>${it.badge ? `<span class="badge">${esc(it.badge)}</span>` : ''}</div>` +
      (it.detail ? `<div class="det">${esc(it.detail)}</div>` : '') + (it.meta ? `<div class="meta">${esc(it.meta)}</div>` : '');
    if (it.ports?.length && !window.RC_RELAY) { // les ports du PC ne sont joignables qu'en réseau local
      const p = h('div', 'ports');
      for (const port of it.ports) { const a = h('a', '', `:${esc(port)} ↗`); a.href = `http://${location.hostname}:${port}`; a.target = '_blank'; a.rel = 'noopener'; a.addEventListener('click', (e) => e.stopPropagation()); p.appendChild(a); }
      el.appendChild(p);
    }
    const acts = actButtons(it.actions, { item: it.id }) || (it.sessionId ? h('div', 'iacts') : null);
    if (it.sessionId) {
      const b = h('button', 'btn small', `▤ ${esc(it.logLabel || T('Journal', 'Logs'))}`);
      b.addEventListener('click', (e) => { e.stopPropagation(); openLog(it.sessionId, it.label); });
      acts.appendChild(b);
    }
    if (acts) el.appendChild(acts);
    if (it.tap && canRun(it.tap)) { el.classList.add('tap'); el.addEventListener('click', () => runAction(it.tap, { item: it.id })); }
    return el;
  }

  // ---------- Plein écran : fichier, diff, capture, table, journal ----------
  function sheet(title) {
    const s = h('div', 'sheet');
    const head = h('header');
    const back = h('button', 'hbtn', '‹');
    const t = h('div', '');
    t.id = 'title';
    t.textContent = title || '';
    head.append(back, t);
    s.body = h('div', 'body');
    s.append(head, s.body);
    document.body.appendChild(s);
    // Le bouton « retour » du téléphone ferme la fenêtre plein écran
    history.pushState({ sheet: true }, '');
    const onPop = () => { removeEventListener('popstate', onPop); s.remove(); s.onClose?.(); };
    addEventListener('popstate', onPop);
    back.addEventListener('click', () => history.back());
    return s;
  }
  function showSheet(res) {
    const s = sheet(res.title);
    if (res.image) { const img = h('img'); img.src = res.image; s.body.appendChild(img); return; }
    if (res.table) {
      const t = h('table', 'grid');
      t.innerHTML = `<thead><tr>${res.table.columns.map((c) => `<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>${res.table.rows.map((r) => `<tr>${r.map((v) => (v === null ? '<td class="null">NULL</td>' : `<td>${esc(v)}</td>`)).join('')}</tr>`).join('')}</tbody>`;
      s.body.appendChild(t);
      return;
    }
    const pre = h('pre', res.diff ? '' : 'wrap');
    if (res.diff) pre.innerHTML = String(res.text).split('\n').map((l) => `<span class="${l.startsWith('@@') ? 'hunk' : l.startsWith('+') && !l.startsWith('+++') ? 'add' : l.startsWith('-') && !l.startsWith('---') ? 'del' : ''}">${esc(l)}</span>`).join('\n');
    else pre.textContent = res.text;
    s.body.appendChild(pre);
  }
  function openLog(id, title) {
    const s = sheet(`▤ ${title}`);
    s.body.style.background = '#000';
    const xterm = new Terminal({ fontFamily: 'ui-monospace, Menlo, Consolas, monospace', fontSize: 10, disableStdin: true, scrollback: 5000, theme: { background: '#000000' } });
    xterm.open(s.body);
    sheetLog = { id, xterm };
    s.onClose = () => { send({ t: 'detach', id }); xterm.dispose(); if (sheetLog?.id === id) sheetLog = null; };
    send({ t: 'attach', id });
  }

  // ---------- Divers ----------
  let toastTimer = null;
  function toast(text, error) {
    const t = $('#toast');
    t.textContent = text;
    t.className = 'show' + (error ? ' error' : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.className = ''; }, 2600);
  }
  // Retour au premier plan (téléphone sorti de veille) : reconnexion immédiate
  document.addEventListener('visibilitychange', () => { if (!document.hidden && ws?.readyState !== 1 && ws?.readyState !== 0) connect(); });

  if (window.RC_RELAY) {
    const sw = h('button', 'hbtn', '⇄');
    sw.title = T('Changer de PC', 'Switch PC');
    sw.style.fontSize = '20px';
    sw.addEventListener('click', () => window.RC_RELAY.switchPc());
    connEl.before(sw);
    connEl.title = window.RC_RELAY.host?.name || '';
  }
  connect();
  render(true);
})();
