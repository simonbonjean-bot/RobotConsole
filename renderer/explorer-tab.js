// RobotConsole — onglet de type « explorateur de fichiers » (arbre, aperçu, Git)
(function () {
  const api = window.api;
  const byWatchId = new Map();

  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const norm = (p) => p.replace(/[\\/]+$/, '').toLowerCase();
  const sep = (p) => (p.includes('\\') ? '\\' : '/');
  const parent = (p) => { const i = Math.max(p.lastIndexOf('\\'), p.lastIndexOf('/')); return i > 0 ? p.slice(0, i) : p; };
  const baseName = (p) => p.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || p;
  const extOf = (p) => { const n = baseName(p); const i = n.lastIndexOf('.'); return i > 0 ? n.slice(i + 1).toLowerCase() : ''; };

  const LANG = {
    js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'javascript', ts: 'typescript', tsx: 'typescript',
    py: 'python', json: 'json', html: 'xml', htm: 'xml', xml: 'xml', svg: 'xml', vue: 'xml', css: 'css', scss: 'scss', less: 'less',
    ps1: 'powershell', psm1: 'powershell', sh: 'bash', bash: 'bash', bat: 'dos', cmd: 'dos', cs: 'csharp', cpp: 'cpp', cc: 'cpp', hpp: 'cpp',
    c: 'c', h: 'c', java: 'java', kt: 'kotlin', go: 'go', rs: 'rust', rb: 'ruby', php: 'php', swift: 'swift', lua: 'lua', sql: 'sql',
    yml: 'yaml', yaml: 'yaml', toml: 'ini', ini: 'ini', md: 'markdown', dockerfile: 'dockerfile', makefile: 'makefile', diff: 'diff',
  };
  const GIT_LABEL = { M: 'Modifié', A: 'Ajouté', D: 'Supprimé', U: 'Non suivi', R: 'Renommé', C: 'Conflit' };

  const ICON_DIR = '<svg viewBox="0 0 16 16"><path d="M1.5 3.5a1 1 0 0 1 1-1h3.6l1.4 1.5h6a1 1 0 0 1 1 1v7.5a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1z" fill="currentColor"/></svg>';
  const ICON_FILE = '<svg viewBox="0 0 16 16"><path d="M3.5 1.5h6l3 3v10h-9z" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/><path d="M9.5 1.5v3h3" fill="none" stroke="currentColor" stroke-width="1.3"/></svg>';

  function fmtSize(n) {
    if (n < 1024) return `${n} o`;
    if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} Ko`;
    if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} Mo`;
    return `${(n / 1024 ** 3).toFixed(1)} Go`;
  }

  const Explorer = {
    icon: '<span class="kind-dir">' + ICON_DIR + '</span>',

    defaultTitle(spec) {
      return spec.root ? baseName(spec.root) : 'Explorateur';
    },

    mount(tab, spec) {
      const h = CAI.h;
      const ex = tab.ex = {
        root: spec.root,
        view: spec.view || (Settings.data.explorerChangesFirst ? 'changes' : 'tree'),
        treeW: spec.treeW || 300,
        expanded: new Set(),
        cache: new Map(),
        git: null,
        gitMap: new Map(),
        dirty: new Set(),
        selected: null,
        mode: null, // 'file' | 'diff'
        mdSource: false,
        greeted: false,
      };
      tab.pane.classList.add('explorer-pane');

      // Barre d'outils
      const bar = h('div', 'ex-bar');
      ex.crumbs = h('div', 'ex-crumbs');
      ex.branch = h('div', 'ex-branch hidden');
      const seg = h('div', 'ex-seg');
      ex.btnTree = h('button', '', 'Fichiers');
      ex.btnChanges = h('button', '', 'Modifications <span class="ex-count"></span>');
      seg.append(ex.btnTree, ex.btnChanges);
      const btn = (html, title, fn) => { const b = h('button', 'icon-btn', html); b.title = title; b.addEventListener('click', fn); return b; };
      bar.append(
        ex.crumbs, ex.branch, h('div', 'tb-spacer'), seg,
        btn('＋', 'Nouveau fichier', () => newItem(tab, currentDir(tab), false)),
        btn('<span style="font-size:13px">📁＋</span>', 'Nouveau dossier', () => newItem(tab, currentDir(tab), true)),
        btn('⟳', 'Rafraîchir', () => refresh(tab, true)),
        btn('<span class="kind-term">&gt;_</span>', 'Ouvrir un terminal dans ce dossier', () => CAI.openTab(tab.space, { kind: 'terminal', cwd: currentDir(tab) })),
        btn('⋯', 'Plus d\'actions', (e) => UI.menu(rootMenu(tab), e.currentTarget)),
      );

      // Arbre + aperçu
      const main = h('div', 'ex-main');
      ex.tree = h('div', 'ex-tree');
      ex.tree.tabIndex = 0;
      ex.tree.style.width = `min(${ex.treeW}px, 45%)`;
      const split = h('div', 'ex-split');
      ex.preview = h('div', 'ex-preview');
      main.append(ex.tree, split, ex.preview);
      tab.pane.append(bar, main);

      ex.btnTree.addEventListener('click', () => { ex.view = 'tree'; render(tab); CAI.save(); });
      ex.btnChanges.addEventListener('click', () => { ex.view = 'changes'; render(tab); CAI.save(); });
      ex.tree.addEventListener('keydown', (e) => treeKey(tab, e));
      ex.tree.addEventListener('contextmenu', (e) => {
        if (e.target.closest('.ex-row')) return;
        e.preventDefault();
        UI.menu(rootMenu(tab), e.clientX, e.clientY);
      });
      // Déposer sur le fond de l'arbre = déplacer à la racine
      ex.tree.addEventListener('dragover', (e) => { if (dragPath && !e.target.closest('.ex-row')) { e.preventDefault(); ex.tree.classList.add('drop-root'); } });
      ex.tree.addEventListener('dragleave', () => ex.tree.classList.remove('drop-root'));
      ex.tree.addEventListener('drop', (e) => {
        ex.tree.classList.remove('drop-root');
        if (!dragPath || e.target.closest('.ex-row')) return;
        e.preventDefault();
        moveTo(tab, dragPath, ex.root, e.ctrlKey);
      });
      split.addEventListener('mousedown', (e) => dragSplit(tab, e, split));

      emptyPreview(tab);
      setRoot(tab, ex.root, true);
    },

    activate(tab) { tab.ex.editor?.layout(); },
    focus(tab) { (tab.ex.editor || tab.ex.tree).focus(); },
    resize(tab) { tab.ex.editor?.layout(); },

    async canClose(tab) { return confirmLeaveEditor(tab); },

    dispose(tab) {
      api.unwatch(tab.id);
      byWatchId.delete(tab.id);
      tab.ex.editor?.dispose();
    },

    serialize(tab) {
      return { root: tab.ex.root, view: tab.ex.view, treeW: tab.ex.treeW };
    },

    applySettings(tab, changed) {
      if (changed.includes('showHidden')) refresh(tab, true);
    },

    applyTheme() {},
  };

  // ---------- Dossier racine ----------
  async function setRoot(tab, root, first) {
    const ex = tab.ex;
    if (!root || !(await api.exists(root))) root = await api.home();
    if (/^[a-z]:/i.test(root)) root = root.replace(/\//g, '\\');
    ex.root = root.replace(/[\\/]+$/, '') || root;
    if (/^[a-z]:$/i.test(ex.root)) ex.root += '\\';
    ex.expanded = new Set([norm(ex.root)]);
    ex.cache.clear();
    ex.selected = null;
    ex.greeted = false;
    CAI.setAutoTitle(tab, baseName(ex.root), ex.root);
    renderCrumbs(tab);
    emptyPreview(tab);
    api.watch(tab.id, ex.root);
    byWatchId.set(tab.id, tab);
    await refresh(tab, true);
    if (!first) CAI.save();
  }

  function currentDir(tab) {
    const ex = tab.ex;
    if (ex.selected) return ex.selectedIsDir ? ex.selected : parent(ex.selected);
    return ex.root;
  }

  function renderCrumbs(tab) {
    const ex = tab.ex;
    ex.crumbs.innerHTML = '';
    const parts = ex.root.split(/[\\/]/).filter(Boolean);
    let acc = '';
    parts.forEach((p, i) => {
      acc = i === 0 ? (p.endsWith(':') ? p + '\\' : '/' + p) : acc.replace(/[\\/]$/, '') + sep(ex.root) + p;
      const target = acc;
      const b = CAI.h('button', 'crumb' + (i === parts.length - 1 ? ' last' : ''));
      b.textContent = p;
      b.title = target;
      b.addEventListener('click', () => { if (norm(target) !== norm(ex.root)) setRoot(tab, target); });
      ex.crumbs.appendChild(b);
      if (i < parts.length - 1) ex.crumbs.appendChild(CAI.h('span', 'crumb-sep', '›'));
    });
    requestAnimationFrame(() => { ex.crumbs.scrollLeft = ex.crumbs.scrollWidth; });
  }

  // ---------- Données ----------
  async function listDir(tab, dir) {
    const key = norm(dir);
    if (!tab.ex.cache.has(key)) {
      let entries = [];
      try { entries = await api.listDir(dir, { showHidden: Settings.data.showHidden }); } catch { /* accès refusé */ }
      tab.ex.cache.set(key, entries);
    }
    return tab.ex.cache.get(key);
  }

  async function refresh(tab, full) {
    const ex = tab.ex;
    if (full) ex.cache.clear();
    const prevCount = ex.git?.isRepo ? Object.keys(ex.git.files).length : -1;
    try { ex.git = await api.gitStatus(ex.root); } catch { ex.git = { isRepo: false }; }
    ex.gitMap = new Map();
    ex.dirty = new Set();
    if (ex.git.isRepo) {
      const top = norm(ex.git.repoRoot);
      for (const [p, info] of Object.entries(ex.git.files)) {
        const k = norm(p);
        ex.gitMap.set(k, info.code);
        let d = parent(k);
        while (d.length >= top.length && !ex.dirty.has(d)) { ex.dirty.add(d); const nd = parent(d); if (nd === d) break; d = nd; }
      }
    }
    // Précharge les dossiers dépliés
    for (const d of ex.expanded) await listDir(tab, d === norm(ex.root) ? ex.root : d);
    await render(tab);

    const count = ex.git.isRepo ? Object.keys(ex.git.files).length : 0;
    if (!ex.greeted) {
      ex.greeted = true;
      if (ex.git.isRepo) CAI.say(tab.space, count ? `${count} fichier${count > 1 ? 's' : ''} modifié${count > 1 ? 's' : ''} sur ${ex.git.branch}` : `Tout est propre sur ${ex.git.branch} ✨`);
      else CAI.say(tab.space, `J'explore « ${baseName(ex.root)} » !`);
    } else if (prevCount >= 0 && count !== prevCount) {
      CAI.say(tab.space, `${count} fichier${count > 1 ? 's' : ''} modifié${count > 1 ? 's' : ''}`, 1600);
    }
    // Actualise l'aperçu si le fichier affiché a changé
    if (ex.editor) ex.editor.checkDisk();
    else if (ex.selected && !ex.selectedIsDir) showPreview(tab, ex.selected, true);
  }

  // ---------- Rendu de l'arbre ----------
  async function render(tab) {
    const ex = tab.ex;
    const g = ex.git || {};
    ex.btnTree.classList.toggle('active', ex.view === 'tree');
    ex.btnChanges.classList.toggle('active', ex.view === 'changes');
    const n = g.isRepo ? Object.keys(g.files).length : 0;
    ex.btnChanges.querySelector('.ex-count').textContent = n ? n : '';
    ex.btnChanges.disabled = !g.isRepo;
    if (!g.isRepo && ex.view === 'changes') ex.view = 'tree';

    if (g.isRepo) {
      ex.branch.classList.remove('hidden');
      ex.branch.innerHTML = `<span class="br-ico">⎇</span>${esc(g.branch || '?')}` +
        (g.ahead ? ` <span title="Commits à pousser">↑${g.ahead}</span>` : '') +
        (g.behind ? ` <span title="Commits à tirer">↓${g.behind}</span>` : '');
      ex.branch.title = `Dépôt : ${g.repoRoot}`;
    } else ex.branch.classList.add('hidden');

    const frag = document.createDocumentFragment();
    ex.rows = [];
    if (ex.view === 'changes') {
      const files = Object.entries(g.files || {}).sort((a, b) => a[0].localeCompare(b[0]));
      if (!files.length) frag.appendChild(CAI.h('div', 'ex-empty', 'Aucune modification ✨'));
      for (const [p, info] of files) {
        const rel = p.slice(g.repoRoot.length).replace(/^[\\/]/, '');
        const dir = parent(rel) === rel ? '' : parent(rel);
        frag.appendChild(row(tab, { path: p, name: baseName(p), isDir: false, depth: 0, code: info.code, sub: dir, staged: info.staged }));
      }
    } else {
      await addChildren(tab, frag, ex.root, 0);
    }
    const scroll = ex.tree.scrollTop;
    ex.tree.innerHTML = '';
    ex.tree.appendChild(frag);
    ex.tree.scrollTop = scroll;
  }

  async function addChildren(tab, frag, dir, depth) {
    const ex = tab.ex;
    const entries = await listDir(tab, dir);
    if (!entries.length && depth === 0) frag.appendChild(CAI.h('div', 'ex-empty', 'Dossier vide'));
    for (const e of entries) {
      const k = norm(e.path);
      const open = e.isDir && ex.expanded.has(k);
      frag.appendChild(row(tab, { ...e, depth, open, code: ex.gitMap.get(k), dirty: e.isDir && ex.dirty.has(k) }));
      if (open) await addChildren(tab, frag, e.path, depth + 1);
    }
  }

  function row(tab, e) {
    const ex = tab.ex;
    const r = CAI.h('div', 'ex-row' + (e.isDir ? ' dir' : '') + (ex.selected && norm(ex.selected) === norm(e.path) ? ' selected' : ''));
    r.style.paddingLeft = `${8 + e.depth * 14}px`;
    const chev = e.isDir ? `<span class="chev${e.open ? ' open' : ''}">›</span>` : '<span class="chev"></span>';
    const icon = `<span class="ex-ico ${e.isDir ? 'd' : 'f'}">${e.isDir ? ICON_DIR : ICON_FILE}</span>`;
    const name = `<span class="ex-name${e.code ? ' g-' + e.code : ''}">${esc(e.name)}</span>`;
    const sub = e.sub ? `<span class="ex-sub">${esc(e.sub)}</span>` : '';
    const badge = e.code ? `<span class="ex-badge g-${e.code}" title="${GIT_LABEL[e.code]}${e.staged ? ' (indexé)' : ''}">${e.code}</span>` : e.dirty ? '<span class="ex-dot" title="Contient des modifications"></span>' : '';
    r.innerHTML = chev + icon + name + sub + badge;
    r.title = e.path;
    if (ex.cut && norm(ex.cut) === norm(e.path)) r.classList.add('cut');
    r.addEventListener('click', () => select(tab, e));
    r.addEventListener('dblclick', () => { if (!e.isDir && e.code !== 'D') editFile(tab, e.path); });
    r.addEventListener('contextmenu', (ev) => {
      ev.preventDefault();
      ex.selected = e.path;
      ex.selectedIsDir = e.isDir;
      ex.rows.forEach((x) => x.el.classList.toggle('selected', x.e.path === e.path));
      UI.menu(itemMenu(tab, e), ev.clientX, ev.clientY);
    });
    // Glisser-déposer : déplacer (Ctrl = copier) un fichier dans un dossier
    if (e.code !== 'D') {
      r.draggable = true;
      r.addEventListener('dragstart', (ev) => { dragPath = e.path; ev.dataTransfer.effectAllowed = 'copyMove'; ev.dataTransfer.setData('text/plain', e.path); });
      r.addEventListener('dragend', () => { dragPath = null; });
    }
    if (e.isDir) {
      r.addEventListener('dragover', (ev) => {
        if (!dragPath || norm(dragPath) === norm(e.path) || norm(e.path).startsWith(norm(dragPath) + '\\')) return;
        ev.preventDefault();
        ev.stopPropagation();
        ev.dataTransfer.dropEffect = ev.ctrlKey ? 'copy' : 'move';
        r.classList.add('drop-into');
      });
      r.addEventListener('dragleave', () => r.classList.remove('drop-into'));
      r.addEventListener('drop', (ev) => {
        r.classList.remove('drop-into');
        if (!dragPath) return;
        ev.preventDefault();
        ev.stopPropagation();
        moveTo(tab, dragPath, e.path, ev.ctrlKey);
      });
    }
    ex.rows.push({ el: r, e });
    return r;
  }

  async function select(tab, e, keepFocus) {
    const ex = tab.ex;
    if (!e.isDir && !(await confirmLeaveEditor(tab))) return;
    ex.selected = e.path;
    ex.selectedIsDir = e.isDir;
    if (e.isDir) {
      const k = norm(e.path);
      if (ex.expanded.has(k)) ex.expanded.delete(k); else ex.expanded.add(k);
      await render(tab);
    } else {
      ex.rows.forEach((x) => x.el.classList.toggle('selected', x.e.path === e.path));
      ex.mode = null;
      ex.mdSource = false;
      closeEditor(tab);
      showPreview(tab, e.path);
    }
    if (!keepFocus) ex.tree.focus();
  }

  function treeKey(tab, e) {
    const ex = tab.ex;
    if (!ex.rows?.length) return;
    let i = ex.rows.findIndex((x) => ex.selected && norm(x.e.path) === norm(ex.selected));
    const cur = ex.rows[i]?.e;
    const go = (j) => { const t = ex.rows[Math.max(0, Math.min(ex.rows.length - 1, j))]; if (t) { if (t.e.isDir) { ex.selected = t.e.path; ex.selectedIsDir = true; ex.rows.forEach((x) => x.el.classList.toggle('selected', x === t)); } else select(tab, t.e); t.el.scrollIntoView({ block: 'nearest' }); } };
    const k = e.key.toLowerCase();
    if (e.key === 'ArrowDown') go(i + 1);
    else if (e.key === 'ArrowUp') go(i - 1);
    else if (e.key === 'ArrowRight' && cur?.isDir && !ex.expanded.has(norm(cur.path))) select(tab, cur);
    else if (e.key === 'ArrowLeft' && cur?.isDir && ex.expanded.has(norm(cur.path))) select(tab, cur);
    else if (e.key === 'Enter' && cur) { if (cur.isDir) select(tab, cur); else editFile(tab, cur.path); }
    else if (e.key === 'F2' && cur) renameItem(tab, cur.path);
    else if (e.key === 'Delete' && cur) deleteItem(tab, cur.path);
    else if (e.ctrlKey && k === 'c' && cur) setClip(tab, cur.path, false);
    else if (e.ctrlKey && k === 'x' && cur) setClip(tab, cur.path, true);
    else if (e.ctrlKey && k === 'v' && clip) pasteInto(tab, cur ? (cur.isDir ? cur.path : parent(cur.path)) : ex.root);
    else if (e.ctrlKey && k === 'd' && cur) duplicate(tab, cur.path);
    else return;
    e.preventDefault();
    e.stopPropagation();
  }

  // ---------- Menus contextuels ----------
  let clip = null; // { path, cut }
  let dragPath = null;

  function itemMenu(tab, e) {
    const ex = tab.ex;
    const p = e.path;
    const dir = e.isDir ? p : parent(p);
    const code = ex.gitMap.get(norm(p));
    const repo = ex.git?.repoRoot;
    const relPath = (repo && norm(p).startsWith(norm(repo)) ? p.slice(repo.length + 1) : p.slice(ex.root.length + 1)).replace(/\\/g, '/');
    const deleted = code === 'D';
    const items = [{ title: baseName(p) }];
    if (!e.isDir) {
      items.push(
        { label: 'Aperçu', icon: '👁', action: () => select(tab, e) },
        { label: 'Modifier', icon: '✎', hint: 'Entrée', disabled: deleted, action: () => editFile(tab, p) },
        { label: 'Ouvrir dans un onglet éditeur', icon: '🗎', disabled: deleted, action: () => CAI.openFile(tab.space, p) },
        { label: "Ouvrir avec l'application par défaut", icon: '↗', disabled: deleted, action: () => api.openPath(p) },
      );
    } else {
      items.push(
        { label: ex.expanded.has(norm(p)) ? 'Replier' : 'Déplier', icon: '›', action: () => select(tab, e) },
        { label: 'Définir comme racine', icon: '⌂', action: () => setRoot(tab, p) },
        { label: 'Ouvrir dans un nouvel explorateur', icon: '📁', action: () => CAI.openTab(tab.space, { kind: 'explorer', root: p }) },
      );
    }
    items.push(
      { label: "Afficher dans l'Explorateur Windows", icon: '📍', disabled: deleted, action: () => api.showItem(p) },
      { label: 'Ouvrir un terminal ici', icon: '>_', action: () => CAI.openTab(tab.space, { kind: 'terminal', cwd: dir }) },
      '-',
      { label: 'Nouveau fichier…', icon: '＋', action: () => newItem(tab, dir, false) },
      { label: 'Nouveau dossier…', icon: '📁', action: () => newItem(tab, dir, true) },
      '-',
      { label: 'Couper', icon: '✂', hint: 'Ctrl+X', disabled: deleted, action: () => setClip(tab, p, true) },
      { label: 'Copier', icon: '⧉', hint: 'Ctrl+C', disabled: deleted, action: () => setClip(tab, p, false) },
      { label: clip ? `Coller « ${baseName(clip.path)} »` : 'Coller', icon: '📋', hint: 'Ctrl+V', disabled: !clip, action: () => pasteInto(tab, dir) },
      { label: 'Dupliquer', icon: '⧉', hint: 'Ctrl+D', disabled: deleted, action: () => duplicate(tab, p) },
      { label: 'Renommer…', icon: '✎', hint: 'F2', disabled: deleted, action: () => renameItem(tab, p) },
      { label: 'Supprimer', icon: '🗑', hint: 'Suppr', danger: true, disabled: deleted, action: () => deleteItem(tab, p) },
      '-',
      { label: 'Copier le chemin', icon: '⧉', action: () => copyText(p) },
      { label: 'Copier le chemin relatif', icon: '⧉', action: () => copyText(relPath) },
      { label: 'Copier le nom', icon: '⧉', action: () => copyText(baseName(p)) },
    );
    if (e.isDir) items.push({ label: 'Ajouter aux favoris', icon: '⭐', action: () => addFavorite(p) });
    if (code) {
      items.push('-', { title: `Git · ${GIT_LABEL[code]}` });
      if (code !== 'D') items.push({ label: 'Voir les différences', icon: '±', action: () => { select(tab, e).then(() => { ex.mode = 'diff'; showPreview(tab, p); }); } });
      items.push(
        { label: 'Indexer (git add)', icon: '＋', action: () => gitOp(tab, () => api.gitStage(repo, p), 'Fichier indexé') },
        { label: 'Retirer de l\'index', icon: '−', disabled: code === 'U', action: () => gitOp(tab, () => api.gitUnstage(repo, p), 'Fichier retiré de l\'index') },
        { label: code === 'U' ? 'Supprimer le fichier non suivi' : 'Annuler les modifications', icon: '↺', danger: true, action: async () => {
          if (await UI.confirm('Annuler les modifications ?', `Les modifications de <b>${esc(baseName(p))}</b> seront perdues${code === 'U' ? ' (le fichier part à la corbeille)' : ''}.`, { ok: 'Annuler les modifications', danger: true })) gitOp(tab, () => api.gitDiscard(repo, p, code), 'Modifications annulées');
        } },
      );
    }
    return items;
  }

  function rootMenu(tab) {
    const ex = tab.ex;
    return [
      { title: baseName(ex.root) },
      { label: 'Nouveau fichier…', icon: '＋', action: () => newItem(tab, ex.root, false) },
      { label: 'Nouveau dossier…', icon: '📁', action: () => newItem(tab, ex.root, true) },
      { label: clip ? `Coller « ${baseName(clip.path)} »` : 'Coller', icon: '📋', disabled: !clip, action: () => pasteInto(tab, ex.root) },
      '-',
      { label: 'Rafraîchir', icon: '⟳', action: () => refresh(tab, true) },
      { label: 'Tout replier', icon: '⇤', action: () => { ex.expanded = new Set([norm(ex.root)]); render(tab); } },
      { label: Settings.data.showHidden ? 'Masquer les fichiers cachés' : 'Afficher les fichiers cachés', icon: '👁', action: () => Settings.set({ showHidden: !Settings.data.showHidden }) },
      '-',
      { label: 'Ouvrir un terminal ici', icon: '>_', action: () => CAI.openTab(tab.space, { kind: 'terminal', cwd: ex.root }) },
      { label: 'Changer de dossier…', icon: '📂', action: async () => { const p = await api.pickFolder(ex.root); if (p) setRoot(tab, p); } },
      { label: 'Dossier parent', icon: '⤴', disabled: parent(ex.root) === ex.root, action: () => setRoot(tab, parent(ex.root)) },
      { label: "Ouvrir dans l'Explorateur Windows", icon: '↗', action: () => api.openPath(ex.root) },
      { label: 'Ajouter aux favoris', icon: '⭐', action: () => addFavorite(ex.root) },
      { label: 'Copier le chemin', icon: '⧉', action: () => copyText(ex.root) },
    ];
  }

  const copyText = (t) => { api.writeClipboard(t); UI.toast('Copié dans le presse-papiers', { ms: 1400 }); };

  function addFavorite(p) {
    const favs = Settings.data.explorerFavorites || [];
    if (favs.some((f) => norm(f.path) === norm(p))) return UI.toast('Déjà dans les favoris');
    Settings.set({ explorerFavorites: [...favs, { name: baseName(p), path: p }] });
    UI.toast(`« ${baseName(p)} » ajouté aux favoris`);
  }

  async function gitOp(tab, fn, msg) {
    try { await fn(); UI.toast(msg, { ms: 1600 }); } catch (e) { UI.toast(e.message, { kind: 'error' }); }
    refresh(tab, true);
  }

  // ---------- Opérations sur les fichiers ----------
  const fail = (e) => UI.toast(e.message || String(e), { kind: 'error', ms: 5000 });

  async function newItem(tab, dir, isDir) {
    const name = await UI.prompt(isDir ? 'Nouveau dossier' : 'Nouveau fichier', '', { placeholder: isDir ? 'nom-du-dossier' : 'nom.ext  (ou sous/dossier/nom.ext)', ok: 'Créer' });
    if (!name?.trim()) return;
    const target = dir.replace(/[\\/]+$/, '') + '\\' + name.trim().replace(/\//g, '\\');
    try {
      if (isDir) await api.mkdir(target); else await api.createFile(target);
      tab.ex.expanded.add(norm(dir));
      let d = parent(target);
      while (d.length > tab.ex.root.length) { tab.ex.expanded.add(norm(d)); d = parent(d); }
      await refresh(tab, true);
      if (!isDir) { await select(tab, { path: target, isDir: false }); editFile(tab, target); }
    } catch (e) { fail(e); }
  }

  async function renameItem(tab, p) {
    const name = baseName(p);
    const dot = name.lastIndexOf('.');
    const v = await UI.prompt('Renommer', name, { ok: 'Renommer', select: dot > 0 ? dot : undefined });
    if (!v || v === name) return;
    const to = parent(p) + '\\' + v;
    try {
      await api.rename(p, to);
      if (tab.ex.selected && norm(tab.ex.selected) === norm(p)) tab.ex.selected = to;
      await refresh(tab, true);
    } catch (e) { fail(e); }
  }

  async function deleteItem(tab, p) {
    if (!(await UI.confirm('Supprimer ?', `<b>${esc(baseName(p))}</b> sera envoyé à la corbeille.`, { ok: 'Supprimer', danger: true }))) return;
    try {
      if (tab.ex.editor && norm(tab.ex.editor.file) === norm(p)) closeEditor(tab, true);
      await api.trash(p);
      if (tab.ex.selected && norm(tab.ex.selected) === norm(p)) { tab.ex.selected = null; emptyPreview(tab); }
      await refresh(tab, true);
      CAI.say(tab.space, 'À la corbeille !', 1200);
    } catch (e) { fail(e); }
  }

  function setClip(tab, p, cut) {
    clip = { path: p, cut };
    tab.ex.cut = cut ? p : null;
    render(tab);
    UI.toast(`${cut ? 'Coupé' : 'Copié'} : ${baseName(p)}`, { ms: 1400 });
  }

  async function pasteInto(tab, dir) {
    if (!clip) return;
    try {
      if (clip.cut) { await api.moveItem(clip.path, dir); clip = null; tab.ex.cut = null; }
      else await api.copyItem(clip.path, dir);
      tab.ex.expanded.add(norm(dir));
      await refresh(tab, true);
    } catch (e) { fail(e); }
  }

  async function duplicate(tab, p) {
    try { const dest = await api.copyItem(p, parent(p)); await refresh(tab, true); select(tab, { path: dest, isDir: false }); } catch (e) { fail(e); }
  }

  async function moveTo(tab, from, toDir, copy) {
    if (norm(parent(from)) === norm(toDir)) return;
    try {
      if (copy) await api.copyItem(from, toDir); else await api.moveItem(from, toDir);
      tab.ex.expanded.add(norm(toDir));
      await refresh(tab, true);
      UI.toast(`${copy ? 'Copié' : 'Déplacé'} vers ${baseName(toDir)}`, { ms: 1600 });
    } catch (e) { fail(e); }
  }

  // ---------- Édition (Monaco dans le panneau d'aperçu) ----------
  async function editFile(tab, file) {
    const ex = tab.ex;
    if (ex.editor && norm(ex.editor.file) === norm(file)) { ex.editor.focus(); return; }
    if (!(await confirmLeaveEditor(tab))) return;
    closeEditor(tab, true);
    ex.selected = file;
    ex.selectedIsDir = false;
    ex.rows?.forEach((x) => x.el.classList.toggle('selected', norm(x.e.path) === norm(file)));
    const code = ex.gitMap.get(norm(file));
    const head = CAI.h('div', 'pv-head');
    head.innerHTML = `<div class="pv-title"><span class="pv-name${code ? ' g-' + code : ''}">${esc(baseName(file))}</span><span class="ed-dirty hidden">● modifié</span><span class="pv-meta">édition</span></div>`;
    const save = CAI.h('button', 'tb-btn small primary', 'Enregistrer');
    save.title = 'Enregistrer (Ctrl+S)';
    const view = CAI.h('button', 'tb-btn small', 'Aperçu');
    view.title = 'Revenir à l\'aperçu';
    const more = CAI.h('button', 'icon-btn', '⋯');
    head.append(save, view, more);
    const body = CAI.h('div', 'pv-body ed-host');
    ex.preview.innerHTML = '';
    ex.preview.append(head, body);
    const dirtyEl = head.querySelector('.ed-dirty');
    try {
      const ctl = await Editor.open(body, file, {
        onDirty: (d) => { dirtyEl.classList.toggle('hidden', !d); tab.el.classList.toggle('dirty', d); },
        onSaved: () => CAI.say(tab.space, 'Sauvegardé ✓', 1000),
      });
      if (!tab.ex || ex.preview.contains(body) === false) { ctl.dispose(); return; }
      ex.editor = ctl;
      ctl.focus();
    } catch (e) {
      body.innerHTML = `<div class="pv-empty">${esc(e.message)}<br><small>Ouvrez-le avec son application par défaut.</small></div>`;
      if (/binaire/i.test(e.message)) api.openPath(file);
      return;
    }
    save.addEventListener('click', () => ex.editor?.save().catch(fail));
    view.addEventListener('click', async () => { if (await confirmLeaveEditor(tab)) { closeEditor(tab, true); showPreview(tab, file); } });
    more.addEventListener('click', () => UI.menu([
      { label: 'Recharger depuis le disque', icon: '⟳', action: () => ex.editor?.revert() },
      { label: 'Ouvrir dans un onglet éditeur', icon: '🗎', action: async () => { if (await confirmLeaveEditor(tab)) { closeEditor(tab, true); showPreview(tab, file); CAI.openFile(tab.space, file); } } },
      { label: "Ouvrir avec l'application par défaut", icon: '↗', action: () => api.openPath(file) },
    ], more));
  }

  function closeEditor(tab, force) {
    const ex = tab.ex;
    if (!ex.editor) return;
    if (!force && ex.editor.dirty) return;
    ex.editor.dispose();
    ex.editor = null;
    tab.el.classList.remove('dirty');
  }

  async function confirmLeaveEditor(tab) {
    const ed = tab.ex?.editor;
    if (!ed?.dirty) return true;
    const r = await UI.dialog({ title: 'Modifications non enregistrées', message: `Enregistrer <b>${esc(baseName(ed.file))}</b> ?`, ok: 'Enregistrer', cancel: 'Ne pas enregistrer' });
    if (r) { try { await ed.save(); } catch (e) { fail(e); return false; } }
    closeEditor(tab, true);
    return true;
  }

  function dragSplit(tab, e, split) {
    e.preventDefault();
    const ex = tab.ex;
    const start = e.clientX, w0 = ex.tree.offsetWidth;
    split.classList.add('dragging');
    const move = (ev) => {
      ex.treeW = Math.max(160, Math.min(w0 + ev.clientX - start, tab.pane.offsetWidth - 200));
      ex.tree.style.width = `min(${ex.treeW}px, 80%)`;
    };
    const up = () => { split.classList.remove('dragging'); removeEventListener('mousemove', move); removeEventListener('mouseup', up); CAI.save(); };
    addEventListener('mousemove', move);
    addEventListener('mouseup', up);
  }

  // ---------- Aperçu ----------
  function emptyPreview(tab) {
    tab.ex.preview.innerHTML = `<div class="pv-empty"><div class="robot">${tab.space.bot.svg}</div><div>Sélectionnez un fichier pour l'afficher</div></div>`;
  }

  async function showPreview(tab, file, isRefresh) {
    const ex = tab.ex;
    const code = ex.gitMap.get(norm(file));
    if (!ex.mode) ex.mode = code ? 'diff' : 'file';
    if (code === 'D') ex.mode = 'diff';
    if (!code && ex.mode === 'diff') ex.mode = 'file';
    const token = (ex.pvToken = (ex.pvToken || 0) + 1);

    let info = null;
    let diff = null;
    try {
      if (ex.mode === 'diff') diff = await api.gitDiff(ex.git.repoRoot, file, code);
      else info = await api.readFile(file, Settings.data.previewMaxKB * 1024);
    } catch (err) {
      if (token !== ex.pvToken) return;
      if (isRefresh && code !== 'D') { ex.selected = null; emptyPreview(tab); return; }
      ex.preview.innerHTML = `<div class="pv-empty">Impossible de lire ce fichier.<br><small>${esc(err.message)}</small></div>`;
      return;
    }
    if (token !== ex.pvToken) return;

    const isMd = ['md', 'markdown'].includes(extOf(file));
    const head = CAI.h('div', 'pv-head');
    const title = CAI.h('div', 'pv-title');
    title.innerHTML = `<span class="pv-name${code ? ' g-' + code : ''}">${esc(baseName(file))}</span>` +
      (code ? `<span class="ex-badge g-${code}">${GIT_LABEL[code]}</span>` : '') +
      (info ? `<span class="pv-meta">${fmtSize(info.size)} · ${new Date(info.mtime).toLocaleString('fr-FR')}</span>` : '');
    head.appendChild(title);
    const seg = CAI.h('div', 'ex-seg');
    if (code && code !== 'D') {
      seg.append(segBtn('Fichier', ex.mode === 'file', () => { ex.mode = 'file'; showPreview(tab, file); }),
        segBtn('Diff', ex.mode === 'diff', () => { ex.mode = 'diff'; showPreview(tab, file); }));
    }
    if (isMd && ex.mode === 'file' && info?.kind === 'text') {
      seg.append(segBtn('Rendu', !ex.mdSource, () => { ex.mdSource = false; showPreview(tab, file); }),
        segBtn('Source', ex.mdSource, () => { ex.mdSource = true; showPreview(tab, file); }));
    }
    if (seg.childNodes.length) head.appendChild(seg);
    if (info?.kind === 'text' || (diff && code !== 'D')) {
      const edit = CAI.h('button', 'tb-btn small', '✎ Modifier');
      edit.title = 'Modifier ce fichier (Entrée ou double-clic)';
      edit.addEventListener('click', () => editFile(tab, file));
      head.appendChild(edit);
    }
    const open = CAI.h('button', 'icon-btn', '↗');
    open.title = "Ouvrir avec l'application par défaut";
    open.addEventListener('click', () => api.openPath(file));
    const reveal = CAI.h('button', 'icon-btn', '📍');
    reveal.title = "Afficher dans l'Explorateur Windows";
    reveal.addEventListener('click', () => api.showItem(file));
    head.append(open, reveal);

    const body = CAI.h('div', 'pv-body');
    if (diff) body.appendChild(renderDiff(diff));
    else if (info.kind === 'image') {
      body.classList.add('pv-image');
      const img = CAI.h('img');
      img.src = info.dataUrl;
      const dims = CAI.h('div', 'pv-dims');
      img.onload = () => { dims.textContent = `${img.naturalWidth} × ${img.naturalHeight} px`; };
      body.append(img, dims);
    } else if (info.kind === 'binary') {
      body.innerHTML = `<div class="pv-empty">Fichier binaire (${fmtSize(info.size)})<br><small>Double-cliquez dans l'arbre pour l'ouvrir avec son application.</small></div>`;
    } else if (isMd && !ex.mdSource) {
      body.classList.add('pv-md');
      body.innerHTML = DOMPurify.sanitize(marked.parse(info.content));
      body.querySelectorAll('a[href]').forEach((a) => a.addEventListener('click', (ev) => { ev.preventDefault(); if (/^https?:/.test(a.href)) window.open(a.href); }));
    } else {
      body.appendChild(renderCode(info.content, extOf(file) || baseName(file).toLowerCase()));
      if (info.truncated) body.appendChild(CAI.h('div', 'pv-trunc', `Aperçu tronqué à ${Settings.data.previewMaxKB} Ko (fichier de ${fmtSize(info.size)}).`));
    }
    const scroll = isRefresh ? ex.preview.querySelector('.pv-body')?.scrollTop : 0;
    ex.preview.innerHTML = '';
    ex.preview.append(head, body);
    if (scroll) body.scrollTop = scroll;
  }

  function segBtn(label, active, fn) {
    const b = CAI.h('button', active ? 'active' : '');
    b.textContent = label;
    b.addEventListener('click', fn);
    return b;
  }

  function highlight(text, ext) {
    if (text.length > 400000) return esc(text);
    const lang = LANG[ext];
    try {
      if (lang && hljs.getLanguage(lang)) return hljs.highlight(text, { language: lang, ignoreIllegals: true }).value;
      if (text.length < 60000) return hljs.highlightAuto(text).value;
    } catch {}
    return esc(text);
  }

  function renderCode(text, ext) {
    const wrap = CAI.h('div', 'code-view');
    const lines = text.split('\n').length;
    const gutter = CAI.h('pre', 'code-gutter');
    gutter.textContent = Array.from({ length: lines }, (_, i) => i + 1).join('\n');
    const pre = CAI.h('pre', 'code-text hljs');
    pre.innerHTML = highlight(text, ext);
    wrap.append(gutter, pre);
    return wrap;
  }

  function renderDiff(d) {
    const wrap = CAI.h('div', 'diff-view');
    const lines = [];
    if (d.untracked) {
      const txt = d.content.split('\n');
      txt.forEach((l, i) => lines.push({ cls: 'add', a: '', b: i + 1, t: '+' + l }));
    } else {
      if (!d.content.trim()) { wrap.innerHTML = '<div class="pv-empty">Aucune différence avec le dernier commit.</div>'; return wrap; }
      let a = 0, b = 0;
      for (const l of d.content.split('\n')) {
        if (/^(diff --git|index |--- |\+\+\+ |new file|deleted file|similarity|rename |old mode|new mode)/.test(l)) continue;
        const m = l.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)/);
        if (m) { a = +m[1]; b = +m[2]; lines.push({ cls: 'hunk', a: '…', b: '…', t: l }); continue; }
        if (l.startsWith('+')) lines.push({ cls: 'add', a: '', b: b++, t: l });
        else if (l.startsWith('-')) lines.push({ cls: 'del', a: a++, b: '', t: l });
        else if (l.startsWith('\\')) lines.push({ cls: 'meta', a: '', b: '', t: l });
        else if (l.length || a) lines.push({ cls: 'ctx', a: a++, b: b++, t: l });
      }
    }
    const added = lines.filter((l) => l.cls === 'add').length;
    const removed = lines.filter((l) => l.cls === 'del').length;
    const html = [`<div class="diff-stats"><span class="g-A">+${added}</span> <span class="g-D">−${removed}</span></div><table class="diff-table">`];
    for (const l of lines) html.push(`<tr class="d-${l.cls}"><td class="ln">${l.a}</td><td class="ln">${l.b}</td><td class="dt">${esc(l.t) || ' '}</td></tr>`);
    html.push('</table>');
    wrap.innerHTML = html.join('');
    return wrap;
  }

  // ---------- Surveillance ----------
  api.onFsChanged((id) => {
    const tab = byWatchId.get(id);
    if (!tab) return;
    CAI.talk(tab.space);
    CAI.markUnread(tab);
    refresh(tab, true);
  });

  (window.TabKinds = window.TabKinds || {}).explorer = Explorer;
})();
