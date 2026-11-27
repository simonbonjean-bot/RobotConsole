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
      tab.promptDraftId = spec.promptDraftId || null;
      tab.attachOnly = !!spec.attachOnly; // simple vue sur une session (ex. un service) : ne pas la tuer à la fermeture
      tab.exited = false;
      // Commandes lancées au démarrage (modèles d'espace)
      tab.init = Array.isArray(spec.commands) ? spec.commands : String(spec.commands || '').split(/\r?\n/).filter((c) => c.trim());

      const term = new Terminal({ ...termOptions(), allowProposedApi: true, theme: Themes.terminal(tab.space.bot) });
      const fit = new FitAddon.FitAddon();
      const search = new SearchAddon.SearchAddon();
      const serializer = new SerializeAddon.SerializeAddon();
      term.loadAddon(fit);
      term.loadAddon(search);
      term.loadAddon(serializer);
      term.loadAddon(new WebLinksAddon.WebLinksAddon((_e, uri) => window.open(uri)));
      Object.assign(tab, { term, fit, search, serializer, outputSeq: 0 });

      tab.pane.classList.add('term-pane');
      tab.pane.addEventListener('contextmenu', async (e) => {
        if (e.target.closest?.('.prompt-overlay')) return;
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
        if (Platform.primary(e) && !e.altKey && !e.shiftKey && k === 'c' && term.hasSelection()) {
          api.writeClipboard(term.getSelection());
          term.clearSelection();
          return false;
        }
        if (Platform.primary(e) && !e.altKey && (k === 'v') ) { e.preventDefault(); Terminal_.paste(tab); return false; }
        if (Platform.primary(e) && e.shiftKey && k === 'c') { Terminal_.copy(tab); return false; }
        if (e.shiftKey && !e.ctrlKey && e.key === 'Insert') { Terminal_.paste(tab); return false; }
        if (Platform.primary(e) && !e.shiftKey && !e.altKey && k === 'f') { openSearch(tab); return false; }
        // Maj+Entrée : retour à la ligne sans valider (Claude Code et autres CLI interactifs reconnaissent Échap+Entrée)
        if (e.shiftKey && !e.ctrlKey && !e.altKey && e.key === 'Enter') {
          e.preventDefault();
          if (!tab.exited && tab.ptyId) api.write(tab.ptyId, '\x1b\r');
          return false;
        }
        return true;
      });

      term.open(tab.pane);
      if (Settings.data.gpuRendering) enableGpu(tab);
      try { fit.fit(); } catch {}

      term.onData((d) => {
        tab.space.lastInput = Date.now(); // pour distinguer l'écho de la frappe d'un vrai travail
        if (tab.exited) { if (d === '\r') start(tab); return; }
        api.write(tab.ptyId, d);
      });
      term.onResize(({ cols, rows }) => { if (!tab.exited && tab.ptyId && !tab.replaying) api.resize(tab.ptyId, cols, rows); });
      term.onTitleChange((t) => {
        const short = (t.split(/[\\/]/).filter(Boolean).pop() || t).replace(/\.exe$/i, '');
        CAI.setAutoTitle(tab, short, t);
      });

      if (spec.sessionId) attach(tab, spec.sessionId);
      else start(tab);
    },

    activate(tab) { this.resize(tab); },
    focus(tab) { if (!window.PromptEditor?.focusFor?.(tab)) tab.term.focus(); },
    resize(tab) {
      if (!tab.pane.offsetParent) return;
      try { tab.fit.fit(); } catch {}
    },

    dispose(tab) {
      window.PromptEditor?.closeFor(tab);
      if (tab.ptyId) { tabsByPty.delete(tab.ptyId); if (tab.attachOnly) api.detachPty(tab.ptyId); else api.kill(tab.ptyId); }
      tab.disposed = true;
      clearTimeout(tab.reconnectTimer);
      disableGpu(tab);
      tab.term.dispose();
    },

    serialize(tab) {
      return { shellId: tab.shellId, cwd: tab.cwd || undefined, sessionId: tab.ptyId || undefined, commands: tab.init.length ? tab.init : undefined, attachOnly: tab.attachOnly || undefined, promptDraftId: tab.promptDraftId || tab.spec?.promptDraftId || undefined };
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

    remoteReadActions: ['terminal-snapshot'],
    async remoteSnapshot(tab) {
      const deadline = Date.now() + 5000;
      while (tab.queue || tab.replaying) {
        if (tab.disposed || Date.now() >= deadline) throw new Error('Terminal en cours de synchronisation');
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      if (tab.disposed) throw new Error('Terminal fermé');
      return new Promise((resolve) => tab.term.write('', () => resolve({
        terminal: { id: tab.ptyId, seq: tab.renderedSeq ?? tab.outputSeq, cols: tab.term.cols, rows: tab.term.rows, data: tab.serializer.serialize() },
      })));
    },
    remoteAction(tab, action) {
      if (action === 'terminal-snapshot') return Terminal_.remoteSnapshot(tab);
      return { error: 'Action non disponible' };
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
    async inject(tab, text, submit, dialogOptions = {}) {
      if (dialogOptions.signal?.aborted) return false;
      if (tab.disposed || tab.exited || !tab.ptyId) throw new Error('Le terminal est fermé ou déconnecté');
      const bracketed = tab.term.modes.bracketedPasteMode;
      if (!bracketed && text.includes('\n')) {
        if (!(await UI.confirm('Ce terminal ne protège pas le collage multiligne',
          'Les retours à la ligne peuvent exécuter des commandes immédiatement. Vérifiez que votre CLI est prêt à recevoir le texte.',
          { ...dialogOptions, ok: submit ? 'Envoyer quand même' : 'Insérer quand même', danger: true }))) return false;
      }
      if (dialogOptions.signal?.aborted) return false;
      await api.injectPrompt(tab.ptyId, text, { bracketed, submit });
      tab.space.lastInput = Date.now();
      return true;
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
      { label: 'Rédiger un prompt…', icon: '✎', hint: CAI.shortcutHint('prompt'), action: () => PromptEditor.open(tab) },
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
    tab.attachGeneration = (tab.attachGeneration || 0) + 1;
    clearTimeout(tab.reconnectTimer);
    tab.attaching = false;
    tab.queue = null;
    tab.replaying = false;
    if (tab.ptyId) { tabsByPty.delete(tab.ptyId); if (tab.attachOnly) api.detachPty(tab.ptyId); else api.kill(tab.ptyId); }
    tab.attachOnly = false;
    tab.exited = false;
    tab.el.classList.remove('exited');
    tab.space.robotEl.classList.remove('exited');
    tab.ptyId = `p${++nid}-${Date.now().toString(36)}`;
    tabsByPty.set(tab.ptyId, tab);
    tab.term.reset();
    tab.outputSeq = 0;
    tab.renderedSeq = 0;
    try {
      const res = await api.createPty({ id: tab.ptyId, shellId: tab.shellId, cols: tab.term.cols, rows: tab.term.rows, cwd: tab.cwd, init: tab.init, scope: CAI.scope });
      tab.shellId = res.shellId;
      CAI.save();
    } catch (err) {
      tab.term.write(`\x1b[31m${I18n.t('Impossible de lancer le shell : {0}', err.message)}\x1b[0m\r\n`);
    }
  }

  // Reprend une session qui tourne toujours dans le service en arrière-plan
  // Rejoue la sortie conservée morceau par morceau, chacun à la taille où il a été produit
  // (sinon les lignes se coupent ailleurs et Claude Code / vim s'affichent en vrac)
  function writeChunked(term, data, done) {
    // xterm ne peut céder le thread qu'entre deux writes, pas au milieu d'une grosse sortie.
    const chunkSize = 16 * 1024;
    let offset = 0;
    for (; offset + chunkSize < data.length; offset += chunkSize) {
      term.write(data.slice(offset, offset + chunkSize));
    }
    term.write(data.slice(offset), done);
  }

  function replaySegs(term, segs, data, done, current = () => true) {
    if (!current()) return;
    if (!segs?.length) { writeChunked(term, data || '', () => { if (current()) done?.(); }); return; }
    let i = 0;
    const next = () => {
      if (!current()) return;
      if (i >= segs.length) return done?.();
      const g = segs[i++];
      if (g.cols && g.rows && (g.cols !== term.cols || g.rows !== term.rows)) term.resize(g.cols, g.rows);
      writeChunked(term, g.data || '', next);
    };
    next();
  }

  async function attach(tab, sessionId) {
    if (tab.attaching || tab.disposed) return;
    tab.attaching = true;
    const generation = tab.attachGeneration = (tab.attachGeneration || 0) + 1;
    const current = () => !tab.disposed && tab.attachGeneration === generation && tab.ptyId === sessionId;
    tab.ptyId = sessionId;
    tabsByPty.set(sessionId, tab);
    tab.queue = [];
    let res = null;
    try { res = await api.attachPty({ id: sessionId, cols: tab.term.cols, rows: tab.term.rows }); }
    catch (error) {
      if (!current()) return;
      tab.attaching = false;
      for (const item of tab.queue || []) api.ackData?.(sessionId, item.token);
      tab.queue = null;
      if (!tab.disposed) {
        console.error('[pty:attach]', error);
        tab.term.write(`\r\n\x1b[31m${String(error.message)}\x1b[0m\r\n`);
        tab.reconnectTimer = setTimeout(() => attach(tab, sessionId), 1000);
      }
      return;
    }
    if (!current()) { if (tab.disposed) api.detachPty(sessionId); return; }
    tab.attaching = false;
    if (!res?.found) {
      tab.queue = null;
      // La session n'existe plus (redémarrage du PC…) : on relance un shell neuf
      tabsByPty.delete(sessionId);
      tab.ptyId = null;
      start(tab);
      return;
    }
    // Ce qui est arrivé avant la réponse fait déjà partie du rejeu ; on garde la suite pour après
    for (const item of tab.queue) api.ackData?.(sessionId, item.token);
    tab.queue = [];
    const replaySeq = tab.outputSeq;
    tab.replaying = true;
    const { cols, rows } = tab.term;
    tab.term.write('', () => {
      if (!current()) return;
      tab.term.reset();
      replaySegs(tab.term, res.segs, res.data, () => {
        if (!current()) return;
        if (tab.term.cols !== cols || tab.term.rows !== rows) tab.term.resize(cols, rows);
        tab.replaying = false;
        tab.renderedSeq = replaySeq;
        if (res.alive && tab.ptyId) api.resize(tab.ptyId, tab.term.cols, tab.term.rows);
        const queued = tab.queue || [];
        tab.queue = null;
        queued.forEach((item) => writeOutput(tab, sessionId, item));
        if (!res.alive) markExited(tab, res.exitCode, true);
      }, current);
    });
  }

  function markExited(tab, code, quiet) {
    if (tab.exited) return;
    tab.exited = true;
    tab.el.classList.add('exited');
    tab.term.write(`\r\n\x1b[90m[${I18n.t('Processus terminé (code {0}) — Entrée pour relancer, Ctrl+Maj+W pour fermer', code)}]\x1b[0m\r\n`);
    const terms = tab.space.tabs.filter((t) => t.kind === 'terminal');
    if (terms.every((t) => t.exited)) tab.space.robotEl.classList.add('exited');
    if (!quiet) CAI.say(tab.space, code === 0 ? 'Mission accomplie !' : `Aïe, code ${code}…`);
  }

  function writeOutput(tab, pid, item) {
    writeChunked(tab.term, item.data, () => {
      tab.renderedSeq = item.seq;
      api.ackData?.(pid, item.token);
    });
  }

  api.onData((pid, data, seq, token) => {
    const tab = tabsByPty.get(pid);
    if (!tab || tab.disposed) { api.ackData?.(pid, token); return; }
    tab.outputSeq = seq;
    const item = { data, seq, token };
    if (tab.queue) { tab.queue.push(item); return; }
    writeOutput(tab, pid, item);
    CAI.talk(tab.space);
    CAI.markUnread(tab);
  });

  api.onExit((pid, code) => {
    const tab = tabsByPty.get(pid);
    if (!tab) return;
    markExited(tab, code);
  });
  api.onPtyDisconnect?.(() => {
    for (const [id, tab] of tabsByPty) {
      if (tab.disposed) continue;
      tab.attachGeneration = (tab.attachGeneration || 0) + 1;
      tab.attaching = false;
      tab.queue = [];
      clearTimeout(tab.reconnectTimer);
      tab.reconnectTimer = setTimeout(() => attach(tab, id), 200);
    }
  });

  (window.TabKinds = window.TabKinds || {}).terminal = Terminal_;
})();
