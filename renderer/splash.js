// RobotConsole — écran de démarrage : workspaces connus, nouveau workspace, infos sur le programme
(async function () {
  const $ = (s) => document.querySelector(s);
  const h = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
  const info = await window.splash.info();

  Themes.apply(info.theme);

  // ---------- En-tête ----------
  const hero = Robot.generate(Robot.randomSeed(), { legs: true });
  $('#sp-hero-bot').innerHTML = hero.svg;
  $('#sp-hero-bot').style.setProperty('--blink-delay', `-${hero.blinkDelay}s`);
  $('#sp-desc').textContent = info.description;
  document.documentElement.style.setProperty('--hero', Themes.spaceAccent(hero));

  // ---------- Infos ----------
  const rows = [
    ['Version', info.version],
    ['Electron', info.versions.electron],
    ['Chromium', info.versions.chrome],
    ['Node.js', info.versions.node],
    ['Système', info.platform],
    ['Données', info.dataDir],
  ];
  const infoEl = $('#sp-info');
  for (const [k, v] of rows) {
    const r = h('div', 'sp-info-row');
    r.append(h('span', 'k', k), Object.assign(h('span', 'v'), { textContent: v, title: v }));
    infoEl.append(r);
  }

  // ---------- Actions ----------
  // Ouverture : on affiche un écran de chargement jusqu'à ce que la fenêtre du workspace apparaisse
  // (c'est elle qui ferme cet écran de démarrage).
  let busy = false;
  function loading(title) {
    busy = true;
    const layer = h('div', 'sp-loading');
    const card = h('div', 'sp-loading-card');
    const bot = h('div', 'robot sp-loading-bot', hero.svg);
    const t = h('div', 'sp-loading-title');
    t.textContent = title;
    card.append(bot, t, h('div', 'sp-loading-bar', '<span></span>'), h('div', 'sp-loading-sub', 'Préparation de la fenêtre…'));
    layer.appendChild(card);
    document.body.appendChild(layer);
    setTimeout(() => { busy = false; layer.remove(); }, 12000); // si la fenêtre ne s'ouvre pas
  }
  const nameOf = (root) => String(root || '').split(/[\\/]/).filter(Boolean).pop() || root;
  const go = {
    open: (root) => { if (busy) return; loading(`Ouverture de ${items.find((w) => w.root === root)?.name || nameOf(root)}…`); window.splash.open(root); },
    blank: () => { if (busy) return; loading("Ouverture d'une session vierge…"); window.splash.blank(); },
    restore: () => { if (busy) return; loading('Restauration de la session…'); window.splash.restore(); },
    create: async (root, name) => {
      if (busy) return false;
      dlg.hidden = true;
      loading(`Création de ${name || nameOf(root)}…`);
      const ok = await window.splash.create(root, name);
      if (!ok) { busy = false; document.querySelector('.sp-loading')?.remove(); }
      return ok;
    },
  };
  const dlg = $('#sp-dlg');
  let pending = null;
  async function newWorkspace(mode) {
    const p = await window.splash.pick(mode);
    if (!p) return;
    if (p.isWorkspace) { go.open(p.root); return; }
    pending = p;
    $('#sp-dlg-path').textContent = p.root;
    $('#sp-dlg-name').value = p.name;
    dlg.hidden = false;
    $('#sp-dlg-name').select();
  }
  const closeDlg = () => { dlg.hidden = true; pending = null; };
  $('#sp-dlg-cancel').onclick = closeDlg;
  dlg.addEventListener('mousedown', (e) => { if (e.target === dlg) closeDlg(); });
  $('#sp-dlg-form').onsubmit = (e) => {
    e.preventDefault();
    if (pending) go.create(pending.root, $('#sp-dlg-name').value);
  };

  $('#sp-new').onclick = () => newWorkspace('new');
  $('#sp-openfolder').onclick = () => newWorkspace('open');
  $('#sp-blank').onclick = () => go.blank();
  if (info.session.length) {
    const names = [...new Set(info.session.map((w) => w.name))];
    $('#sp-restore').hidden = false;
    $('#sp-restore-sub').textContent = `${info.session.length} fenêtre${info.session.length > 1 ? 's' : ''} · ${names.slice(0, 3).join(', ')}${names.length > 3 ? '…' : ''}`;
    $('#sp-restore').title = names.join('\n');
    $('#sp-restore').onclick = () => go.restore();
  }
  $('#sp-min').onclick = () => window.splash.minimize();
  $('#sp-close').onclick = () => window.splash.quit();
  $('#sp-show').checked = info.showSplash;
  $('#sp-show').onchange = (e) => window.splash.setShow(e.target.checked);

  // ---------- Liste des workspaces ----------
  function ago(ms) {
    if (!ms) return '';
    const s = (Date.now() - ms) / 1000;
    if (s < 60) return "à l'instant";
    if (s < 3600) return `il y a ${Math.round(s / 60)} min`;
    if (s < 86400) return `il y a ${Math.round(s / 3600)} h`;
    if (s < 86400 * 30) return `il y a ${Math.round(s / 86400)} j`;
    return new Date(ms).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  let items = info.recent.slice();
  const listEl = $('#sp-list');
  let sel = 0;
  function render() {
    const q = $('#sp-filter').value.trim().toLowerCase();
    const shown = items.filter((w) => !q || w.name.toLowerCase().includes(q) || w.root.toLowerCase().includes(q));
    listEl.innerHTML = '';
    if (!items.length) {
      listEl.append(h('div', 'sp-empty', 'Aucun workspace pour l\'instant.<br>Créez-en un ou ouvrez un dossier pour commencer.'));
      return;
    }
    if (!shown.length) { listEl.append(h('div', 'sp-empty', 'Aucun résultat.')); return; }
    sel = Math.min(sel, shown.length - 1);
    shown.forEach((w, i) => {
      const bot = Robot.generate(w.seed, { legs: true, traits: w.robot?.traits });
      const row = h('div', 'sp-ws' + (i === sel ? ' sel' : ''));
      row.tabIndex = -1;
      row.style.setProperty('--ws-accent', Themes.spaceAccent(bot));
      const r = h('div', 'robot sp-ws-bot', bot.svg);
      r.style.setProperty('--blink-delay', `-${bot.blinkDelay}s`);
      const txt = h('div', 'sp-ws-text');
      const name = h('div', 'sp-ws-name'); name.textContent = w.name;
      const path = h('div', 'sp-ws-path'); path.textContent = w.root; path.title = w.root;
      txt.append(name, path);
      const when = h('div', 'sp-ws-when'); when.textContent = ago(w.used);
      const reveal = h('button', 'sp-ws-btn', '📂'); reveal.title = 'Ouvrir le dossier dans l\'Explorateur Windows';
      reveal.onclick = (e) => { e.stopPropagation(); window.splash.reveal(w.root); };
      const forget = h('button', 'sp-ws-btn', '✕'); forget.title = 'Retirer de la liste (le dossier n\'est pas supprimé)';
      forget.onclick = (e) => { e.stopPropagation(); window.splash.forget(w.root); items = items.filter((x) => x !== w); render(); };
      row.append(r, txt, when, reveal, forget);
      row.onclick = () => go.open(w.root);
      row.onmouseenter = () => { sel = i; listEl.querySelectorAll('.sp-ws').forEach((x, j) => x.classList.toggle('sel', j === i)); };
      listEl.append(row);
    });
  }
  $('#sp-filter').addEventListener('input', () => { sel = 0; render(); });
  render();

  // ---------- Clavier ----------
  document.addEventListener('keydown', (e) => {
    if (!dlg.hidden) { if (e.key === 'Escape') closeDlg(); return; }
    const rowsEl = [...listEl.querySelectorAll('.sp-ws')];
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!rowsEl.length) return;
      e.preventDefault();
      sel = (sel + (e.key === 'ArrowDown' ? 1 : -1) + rowsEl.length) % rowsEl.length;
      rowsEl.forEach((x, j) => x.classList.toggle('sel', j === sel));
      rowsEl[sel].scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter') {
      if (rowsEl[sel]) { e.preventDefault(); rowsEl[sel].click(); }
    } else if (e.key === 'Escape') {
      if ($('#sp-filter').value) { $('#sp-filter').value = ''; render(); } else window.splash.quit();
    } else if ((e.ctrlKey && e.key.toLowerCase() === 'n')) { e.preventDefault(); newWorkspace('new'); }
    else if ((e.ctrlKey && e.key.toLowerCase() === 'o')) { e.preventDefault(); newWorkspace('open'); }
    else if (e.key.length === 1 && !e.ctrlKey && !e.altKey && document.activeElement !== $('#sp-filter') && items.length) $('#sp-filter').focus();
  });
})();
