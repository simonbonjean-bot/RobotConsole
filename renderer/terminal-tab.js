// RobotConsole — onglet de type « terminal » (xterm.js + pty)
(function () {
  const api = window.api;
  const tabsByPty = new Map();
  let nid = 0;

  function termOptions() {
    const s = Settings.data;
    return {
      fontFamily: s.fontFamily,
      fontSize: s.fontSize,
      lineHeight: s.lineHeight,
      cursorBlink: s.cursorBlink,
      cursorStyle: s.cursorStyle,
      scrollback: s.scrollback,
    };
  }

  const Terminal_ = {
    icon: '<span class="kind-term">&gt;_</span>',

    defaultTitle(spec) {
      return CAI.shellLabel(spec.shellId);
    },

    mount(tab, spec) {
      tab.shellId = spec.shellId;
      tab.cwd = spec.cwd || null;
      tab.attachOnly = !!spec.attachOnly; // simple vue sur une session (ex. un service) : ne pas la tuer à la fermeture
      tab.exited = false;
      // Commandes lancées au démarrage (modèles d'espace)
      tab.init = Array.isArray(spec.commands) ? spec.commands : String(spec.commands || '').split(/\r?\n/).filter((c) => c.trim());

      const term = new Terminal({ ...termOptions(), allowProposedApi: true, theme: Themes.terminal(tab.space.bot) });
      const fit = new FitAddon.FitAddon();
      const search = new SearchAddon.SearchAddon();
      term.loadAddon(fit);
      term.loadAddon(search);
      term.loadAddon(new WebLinksAddon.WebLinksAddon((_e, uri) => window.open(uri)));
      Object.assign(tab, { term, fit, search });

      tab.pane.classList.add('term-pane');
      tab.pane.addEventListener('contextmenu', async (e) => {
        e.preventDefault();
        const mode = Settings.data.rightClick;
        if (mode === 'none') return;
        if (mode === 'smart') {
          if (term.hasSelection()) { api.writeClipboard(term.getSelection()); term.clearSelection(); }
          else term.paste(await api.readClipboard());
          return;
        }
        UI.menu(contextItems(tab), e.clientX, e.clientY);
      });

      // Copier / coller au clavier : Ctrl+C copie s'il y a une sélection (sinon interrompt), Ctrl+V colle
      term.attachCustomKeyEventHandler((e) => {
        if (e.type !== 'keydown') return true;
        const k = e.key.toLowerCase();
        if (e.ctrlKey && !e.altKey && !e.shiftKey && k === 'c' && term.hasSelection()) {
          api.writeClipboard(term.getSelection());
          term.clearSelection();
          return false;
        }
        if (e.ctrlKey && !e.altKey && (k === 'v') ) { e.preventDefault(); Terminal_.paste(tab); return false; }
        if (e.ctrlKey && e.shiftKey && k === 'c') { Terminal_.copy(tab); return false; }
        if (e.shiftKey && !e.ctrlKey && e.key === 'Insert') { Terminal_.paste(tab); return false; }
        if (e.ctrlKey && !e.shiftKey && !e.altKey && k === 'f') { openSearch(tab); return false; }
        return true;
      });

      term.open(tab.pane);
      if (Settings.data.gpuRendering) enableGpu(tab);
      try { fit.fit(); } catch {}

      term.onData((d) => {
        if (tab.exited) { if (d === '\r') start(tab); return; }
        api.write(tab.ptyId, d);
      });
      term.onResize(({ cols, rows }) => { if (!tab.exited && tab.ptyId) api.resize(tab.ptyId, cols, rows); });
      term.onTitleChange((t) => {
        const short = (t.split(/[\\/]/).filter(Boolean).pop() || t).replace(/\.exe$/i, '');
        CAI.setAutoTitle(tab, short, t);
      });

      if (spec.sessionId) attach(tab, spec.sessionId);
      else start(tab);
    },

    activate(tab) { this.resize(tab); },
    focus(tab) { tab.term.focus(); },
    resize(tab) {
      if (!tab.pane.offsetParent) return;
      try { tab.fit.fit(); } catch {}
    },

    dispose(tab) {
      if (tab.ptyId) { tabsByPty.delete(tab.ptyId); if (tab.attachOnly) api.detachPty(tab.ptyId); else api.kill(tab.ptyId); }
      tab.disposed = true;
      disableGpu(tab);
      tab.term.dispose();
    },

    serialize(tab) {
      return { shellId: tab.shellId, cwd: tab.cwd || undefined, sessionId: tab.ptyId || undefined, commands: tab.init.length ? tab.init : undefined, attachOnly: tab.attachOnly || undefined };
    },

    applySettings(tab, changed) {
      if (changed.some((k) => ['fontFamily', 'fontSize', 'lineHeight', 'cursorBlink', 'cursorStyle', 'scrollback'].includes(k))) {
        Object.assign(tab.term.options, termOptions());
        this.resize(tab);
      }
      if (changed.includes('gpuRendering')) {
        if (Settings.data.gpuRendering) enableGpu(tab); else disableGpu(tab);
      }
    },

    applyTheme(tab) {
      tab.term.options.theme = Themes.terminal(tab.space.bot);
    },

    copy(tab) {
      if (tab.term.hasSelection()) { api.writeClipboard(tab.term.getSelection()); return true; }
      return false;
    },
    async paste(tab) {
      const text = await api.readClipboard();
      if (!text) return;
      // Collage de plusieurs lignes : on prévient avant d'exécuter
      if (text.includes('\n') && text.trim().split('\n').length > 1 && Settings.data.confirmMultilinePaste) {
        const n = text.trim().split('\n').length;
        if (!(await UI.confirm('Coller plusieurs lignes ?', `Le texte contient <b>${n} lignes</b> : elles pourraient s'exécuter immédiatement.`, { ok: 'Coller' }))) return;
      }
      tab.term.paste(text);
      tab.term.focus();
    },
  };

  // ---------- Rendu GPU (WebGL) ----------
  // Le texte est dessiné par la carte graphique : défilement et sorties massives beaucoup plus fluides.
  // Si le contexte WebGL est perdu (pilote, mise en veille…), on revient au rendu classique.
  let gpuFailures = 0;
  function enableGpu(tab) {
    if (tab.gpu || typeof WebglAddon === 'undefined' || gpuFailures > 3) return;
    try {
      const addon = new WebglAddon.WebglAddon();
      addon.onContextLoss(() => { gpuFailures++; disableGpu(tab); setTimeout(() => { if (Settings.data.gpuRendering && !tab.disposed) enableGpu(tab); }, 1500); });
      tab.term.loadAddon(addon);
      tab.gpu = addon;
    } catch (e) {
      gpuFailures++;
      console.warn('Rendu GPU indisponible :', e.message);
    }
  }
  function disableGpu(tab) {
    if (!tab.gpu) return;
    try { tab.gpu.dispose(); } catch {}
    tab.gpu = null;
  }

  // ---------- Menu contextuel ----------
  function contextItems(tab) {
    const term = tab.term;
    const sel = term.hasSelection();
    const selText = sel ? term.getSelection() : '';
    const looksPath = /^([a-z]:\\|\.{0,2}[\\/])[^\n]+$/i.test(selText.trim());
    const looksUrl = /^https?:\/\/\S+$/.test(selText.trim());
    return [
      { label: 'Copier', icon: '⧉', hint: 'Ctrl+C', disabled: !sel, action: () => Terminal_.copy(tab) },
      { label: 'Coller', icon: '📋', hint: 'Ctrl+V', action: () => Terminal_.paste(tab) },
      { label: 'Tout sélectionner', icon: '▭', action: () => term.selectAll() },
      { label: 'Copier tout le contenu', icon: '⧉', action: () => { term.selectAll(); api.writeClipboard(term.getSelection()); term.clearSelection(); UI.toast('Contenu du terminal copié', { ms: 1500 }); } },
      sel && looksUrl && { label: 'Ouvrir le lien', icon: '↗', action: () => window.open(selText.trim()) },
      sel && looksPath && { label: 'Ouvrir le fichier', icon: '✎', action: () => CAI.openFile(tab.space, selText.trim()) },
      sel && { label: 'Rechercher la sélection sur le web', icon: '🔎', action: () => window.open('https://www.google.com/search?q=' + encodeURIComponent(selText.slice(0, 200))) },
      '-',
      { label: 'Rechercher…', icon: '⌕', hint: 'Ctrl+F', action: () => openSearch(tab) },
      { label: 'Effacer le terminal', icon: '⌫', action: () => { term.clear(); term.focus(); } },
      { label: 'Défilement en bas', icon: '⤓', action: () => term.scrollToBottom() },
      '-',
      { label: 'Interrompre (Ctrl+C)', icon: '■', disabled: tab.exited, action: () => api.write(tab.ptyId, '\x03') },
      { label: 'Redémarrer le terminal', icon: '⟳', action: () => start(tab) },
      { label: 'Nouveau terminal', icon: '＋', submenu: CAI.shells.map((s) => ({ label: s.label, action: () => CAI.openTab(tab.space, { kind: 'terminal', shellId: s.id, cwd: tab.cwd || undefined }) })) },
      { label: 'Explorer le dossier de départ', icon: '📁', action: () => CAI.openExplorer(tab.space, tab.cwd || CAI.ws?.root) },
      '-',
      { label: 'Taille du texte', icon: 'A', submenu: [
        { label: 'Agrandir', hint: '+', action: () => Settings.set({ fontSize: Math.min(28, Settings.data.fontSize + 1) }) },
        { label: 'Réduire', hint: '−', action: () => Settings.set({ fontSize: Math.max(8, Settings.data.fontSize - 1) }) },
        { label: 'Par défaut', action: () => Settings.set({ fontSize: Settings.DEFAULTS.fontSize }) },
      ] },
      { label: 'Fermer l\'onglet', icon: '✕', danger: true, action: () => CAI.closeTab(tab) },
    ];
  }

  // ---------- Barre de recherche ----------
  function openSearch(tab) {
    if (tab.searchBar) { tab.searchBar.querySelector('input').select(); return; }
    const bar = UI.h('div', 'term-search');
    const input = UI.h('input', 'set-input');
    input.placeholder = 'Rechercher…';
    const count = UI.h('span', 'ts-count');
    const opt = (label, title) => { const b = UI.h('button', 'icon-btn toggle', label); b.title = title; b.addEventListener('click', () => { b.classList.toggle('on'); run(); }); return b; };
    const cs = opt('Aa', 'Respecter la casse');
    const re = opt('.*', 'Expression régulière');
    const prev = UI.h('button', 'icon-btn', '↑');
    const next = UI.h('button', 'icon-btn', '↓');
    const close = UI.h('button', 'icon-btn', '✕');
    bar.append(input, count, cs, re, prev, next, close);
    tab.pane.appendChild(bar);
    tab.searchBar = bar;
    const opts = () => ({ caseSensitive: cs.classList.contains('on'), regex: re.classList.contains('on'), decorations: { matchOverviewRuler: '#e3b341', activeMatchColorOverviewRuler: '#ff7b72', matchBackground: '#e3b34155', activeMatchBackground: '#ff7b7299' } });
    const run = (back) => { if (!input.value) { tab.search.clearDecorations(); count.textContent = ''; return; } back ? tab.search.findPrevious(input.value, opts()) : tab.search.findNext(input.value, { ...opts(), incremental: !back }); };
    tab.search.onDidChangeResults?.(({ resultIndex, resultCount }) => { count.textContent = resultCount ? `${resultIndex + 1}/${resultCount}` : 'aucun'; });
    input.addEventListener('input', () => run());
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') { e.preventDefault(); run(e.shiftKey); }
      if (e.key === 'Escape') { e.preventDefault(); close.click(); }
    });
    prev.addEventListener('click', () => run(true));
    next.addEventListener('click', () => run());
    close.addEventListener('click', () => { tab.search.clearDecorations(); bar.remove(); tab.searchBar = null; tab.term.focus(); });
    const selText = tab.term.getSelection();
    if (selText && !selText.includes('\n')) input.value = selText;
    input.focus();
    input.select();
    if (input.value) run();
  }

  async function start(tab) {
    if (tab.ptyId) { tabsByPty.delete(tab.ptyId); if (tab.attachOnly) api.detachPty(tab.ptyId); else api.kill(tab.ptyId); }
    tab.attachOnly = false;
    tab.exited = false;
    tab.el.classList.remove('exited');
    tab.space.robotEl.classList.remove('exited');
    tab.ptyId = `p${++nid}-${Date.now().toString(36)}`;
    tabsByPty.set(tab.ptyId, tab);
    tab.term.reset();
    try {
      const res = await api.createPty({ id: tab.ptyId, shellId: tab.shellId, cols: tab.term.cols, rows: tab.term.rows, cwd: tab.cwd, init: tab.init, scope: CAI.scope });
      tab.shellId = res.shellId;
      CAI.save();
    } catch (err) {
      tab.term.write(`\x1b[31mImpossible de lancer le shell : ${err.message}\x1b[0m\r\n`);
    }
  }

  // Reprend une session qui tourne toujours dans le service en arrière-plan
  async function attach(tab, sessionId) {
    tab.ptyId = sessionId;
    tabsByPty.set(sessionId, tab);
    tab.queue = [];
    let res = null;
    try { res = await api.attachPty({ id: sessionId, cols: tab.term.cols, rows: tab.term.rows }); } catch {}
    const queued = tab.queue;
    tab.queue = null;
    if (!res?.found) {
      // La session n'existe plus (redémarrage du PC…) : on relance un shell neuf
      tabsByPty.delete(sessionId);
      tab.ptyId = null;
      start(tab);
      return;
    }
    if (res.data) tab.term.write(res.data);
    queued.forEach((d) => tab.term.write(d));
    if (!res.alive) markExited(tab, res.exitCode, true);
  }

  function markExited(tab, code, quiet) {
    tab.exited = true;
    tab.el.classList.add('exited');
    tab.term.write(`\r\n\x1b[90m[Processus terminé (code ${code}) — Entrée pour relancer, Ctrl+Maj+W pour fermer]\x1b[0m\r\n`);
    const terms = tab.space.tabs.filter((t) => t.kind === 'terminal');
    if (terms.every((t) => t.exited)) tab.space.robotEl.classList.add('exited');
    if (!quiet) CAI.say(tab.space, code === 0 ? 'Mission accomplie !' : `Aïe, code ${code}…`);
  }

  api.onData((pid, data) => {
    const tab = tabsByPty.get(pid);
    if (!tab) return;
    if (tab.queue) { tab.queue.push(data); return; }
    tab.term.write(data);
    CAI.talk(tab.space);
    CAI.markUnread(tab);
  });

  api.onExit((pid, code) => {
    const tab = tabsByPty.get(pid);
    if (!tab) return;
    markExited(tab, code);
  });

  (window.TabKinds = window.TabKinds || {}).terminal = Terminal_;
})();
