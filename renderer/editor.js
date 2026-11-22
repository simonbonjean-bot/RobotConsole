// RobotConsole — éditeur de code (Monaco) réutilisable + onglet « éditeur »
(function () {
  let loading = null;
  const models = new Map(); // chemin normalisé -> { model, refs, savedVersion, mtime }
  // Modèles des fichiers fermés gardés en mémoire pour retrouver leur historique (Ctrl+Z) à la réouverture
  const closedKeys = [];
  const KEEP_CLOSED = 20;
  const editors = new Set();
  const norm = (p) => p.toLowerCase();
  const T = (s, ...a) => (window.I18n ? I18n.t(s, ...a) : s.replace(/\{(\d+)\}/g, (_, i) => a[i]));

  function load() {
    if (loading) return loading;
    const script = (src) => new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = src; s.onload = res; s.onerror = rej;
      document.head.appendChild(s);
    });
    const VS = '../node_modules/monaco-editor/min/vs';
    loading = (async () => {
      // Widgets Monaco (recherche, menu contextuel, palette) en français : le fichier de langue définit
      // globalThis._VSCODE_NLS_MESSAGES et doit être chargé avant l'éditeur (un changement de langue s'applique au redémarrage)
      if (window.I18n?.lang === 'fr') await script(`${VS}/nls/lang/fr.js`).catch(() => {});
      await script(`${VS}/loader.js`);
      window.require.config({ paths: { vs: VS } });
      await new Promise((res, rej) => window.require(['vs/editor/editor.main'], res, rej));
      applyTheme();
      return window.monaco;
    })();
    return loading;
  }

  // Thème Monaco construit à partir du thème RobotConsole courant
  function applyTheme() {
    const monaco = window.monaco;
    if (!monaco) return;
    const t = Themes.current;
    const c = (x) => x.replace('#', '');
    monaco.editor.defineTheme('robot', {
      base: t.dark ? 'vs-dark' : 'vs',
      inherit: true,
      rules: [
        { token: 'keyword', foreground: c(t.syn.kw) },
        { token: 'string', foreground: c(t.syn.str) },
        { token: 'number', foreground: c(t.syn.num) },
        { token: 'comment', foreground: c(t.syn.com), fontStyle: 'italic' },
        { token: 'type', foreground: c(t.syn.type) },
        { token: 'identifier.function', foreground: c(t.syn.fn) },
        { token: 'attribute.name', foreground: c(t.syn.attr) },
        { token: 'tag', foreground: c(t.syn.kw) },
        { token: 'delimiter', foreground: c(t.ui.muted) },
      ],
      colors: {
        'editor.background': t.ui.panel,
        'editor.foreground': t.term.foreground,
        'editorLineNumber.foreground': t.ui.muted + '99',
        'editorLineNumber.activeForeground': t.ui.text,
        'editor.lineHighlightBackground': t.ui.hover + '80',
        'editor.selectionBackground': t.ui.accent + '44',
        'editorCursor.foreground': t.ui.accent,
        'editorWidget.background': t.ui.panel2,
        'editorWidget.border': t.ui.border,
        'editorGutter.background': t.ui.panel,
        'minimap.background': t.ui.panel,
        'scrollbarSlider.background': t.ui.border + '99',
        'editorIndentGuide.background1': t.ui.border,
        'editorRuler.foreground': t.ui.border,
      },
    });
    monaco.editor.setTheme('robot');
  }

  const fontSizeOf = (s) => Math.max(8, Math.min(40, s.fontSize + (s.editorZoom || 0)));

  function options() {
    const s = Settings.data;
    return {
      fontFamily: s.fontFamily,
      fontSize: fontSizeOf(s),
      fontLigatures: /Cascadia Code/.test(s.fontFamily),
      minimap: { enabled: s.editorMinimap },
      wordWrap: s.editorWordWrap ? 'on' : 'off',
      lineNumbers: s.editorLineNumbers || 'on',
      renderWhitespace: s.editorWhitespace || 'selection',
      guides: { indentation: s.editorIndentGuides !== false },
      stickyScroll: { enabled: s.editorStickyScroll !== false },
      rulers: s.editorRuler ? [s.editorRuler] : [],
      renderLineHighlight: s.editorLineHighlight === false ? 'none' : 'line',
      find: { seedSearchStringFromSelection: 'selection', autoFindInSelection: 'multiline', addExtraSpaceOnTop: false },
      folding: true,
      showFoldingControls: 'mouseover',
      multiCursorModifier: 'alt',
      smoothScrolling: true,
      cursorSmoothCaretAnimation: 'on',
      bracketPairColorization: { enabled: true },
      scrollBeyondLastLine: false,
      automaticLayout: true,
      padding: { top: 8 },
    };
  }

  // Indentation d'un nouveau modèle : réglages par défaut, puis détection depuis le contenu
  function initIndent(model) {
    const s = Settings.data;
    const insertSpaces = s.editorInsertSpaces !== false, tabSize = s.editorTabSize || 2;
    model.updateOptions({ insertSpaces, tabSize });
    model.detectIndentation(insertSpaces, tabSize);
  }

  function zoom(d) {
    const s = Settings.data;
    const z = d === 0 ? 0 : Math.max(8 - s.fontSize, Math.min(40 - s.fontSize, (s.editorZoom || 0) + d));
    Settings.set({ editorZoom: z });
  }

  // Menu « Affichage » : réglages globaux de l'éditeur
  function viewItems() {
    const s = Settings.data;
    const tog = (key, label, def = false) => ({ label, checked: s[key] ?? def, action: () => Settings.set({ [key]: !(s[key] ?? def) }) });
    const pick = (key, def, choices) => choices.map(([v, label]) => ({ label, checked: (s[key] ?? def) === v, action: () => Settings.set({ [key]: v }) }));
    return [
      tog('editorWordWrap', 'Retour à la ligne automatique'),
      tog('editorMinimap', 'Mini-carte', true),
      { label: 'Numéros de ligne', icon: '#', submenu: pick('editorLineNumbers', 'on', [['on', 'Normaux'], ['relative', 'Relatifs'], ['off', 'Masqués']]) },
      { label: 'Caractères invisibles', icon: '·', submenu: pick('editorWhitespace', 'selection', [['none', 'Jamais'], ['selection', 'Dans la sélection'], ['all', 'Toujours']]) },
      { label: 'Règle verticale', icon: '┆', submenu: pick('editorRuler', 0, [[0, 'Aucune'], [80, '80 colonnes'], [100, '100 colonnes'], [120, '120 colonnes']]) },
      tog('editorIndentGuides', "Guides d'indentation", true),
      tog('editorStickyScroll', 'En-têtes collants', true),
      tog('editorLineHighlight', 'Surligner la ligne courante', true),
      '-',
      { label: 'Zoom avant', icon: '＋', hint: 'Ctrl+=', action: () => zoom(1) },
      { label: 'Zoom arrière', icon: '－', hint: 'Ctrl+-', action: () => zoom(-1) },
      { label: 'Taille normale', icon: '⟲', hint: 'Ctrl+0', action: () => zoom(0), disabled: !s.editorZoom },
    ];
  }

  // ---------- Fichier modifié sur le disque ----------
  // Un fichier ouvert = un modèle = une surveillance (dossier parent filtré sur le nom).
  // Chaque éditeur qui l'affiche s'inscrit dans entry.views pour montrer la bande d'avertissement.
  let watchSeq = 0;
  const byWatch = new Map(); // watchId -> entry
  const entryDirty = (entry) => entry.model.getAlternativeVersionId() !== entry.savedVersion;

  function startWatch(entry) {
    entry.watchId = `editor-${++watchSeq}`;
    byWatch.set(entry.watchId, entry);
    const i = Math.max(entry.file.lastIndexOf('\\'), entry.file.lastIndexOf('/'));
    window.api.watch(entry.watchId, entry.file.slice(0, i + 1), { name: entry.file.slice(i + 1) });
  }
  function stopWatch(entry) {
    window.api.unwatch(entry.watchId);
    byWatch.delete(entry.watchId);
  }
  window.api.onFsChanged?.((id) => { const e = byWatch.get(id); if (e) diskChanged(e); });

  const notify = (entry, state) => entry.views.forEach((v) => v.banner(state));

  // Remplace le contenu par celui du disque (annulable avec Ctrl+Z) en gardant la vue de chaque éditeur
  function reloadEntry(entry, { content, mtime }) {
    const states = [...entry.views].map((v) => [v, v.ed.saveViewState()]);
    entry.model.pushStackElement();
    entry.model.pushEditOperations([], [{ range: entry.model.getFullModelRange(), text: content }], () => null);
    entry.model.pushStackElement();
    entry.savedVersion = entry.model.getAlternativeVersionId();
    entry.mtime = mtime;
    entry.pending = null;
    for (const [v, st] of states) { v.ed.restoreViewState(st); v.syncDirty(); }
  }

  async function diskChanged(entry) {
    let r;
    try { r = await window.api.readText(entry.file); } catch {
      if (!(await window.api.exists(entry.file))) notify(entry, 'deleted');
      return;
    }
    if (entry.model.isDisposed() || r.mtime === entry.mtime) return;
    if (r.content === entry.model.getValue()) { // simple « touch » ou notre propre enregistrement
      entry.mtime = r.mtime;
      if (entryDirty(entry)) { entry.savedVersion = entry.model.getAlternativeVersionId(); entry.views.forEach((v) => v.syncDirty()); }
      notify(entry, null);
      return;
    }
    if (!entryDirty(entry)) { reloadEntry(entry, r); notify(entry, 'reloaded'); }
    else { entry.pending = r; notify(entry, 'conflict'); }
  }

  // Ouvre un fichier dans un conteneur. Renvoie un contrôleur.
  async function open(container, file, { line, onDirty, onSaved } = {}) {
    const monaco = await load();
    const { content, mtime } = await window.api.readText(file);
    const key = norm(file);
    let entry = models.get(key);
    if (entry?.closed) {
      // Fichier rouvert : on reprend le modèle gardé en cache, avec tout son historique (Ctrl+Z).
      // Son contenu est remis à celui du disque par une modification annulable : même des
      // modifications fermées sans enregistrer restent récupérables avec Ctrl+Z.
      entry.closed = false;
      closedKeys.splice(closedKeys.indexOf(key), 1);
      if (entry.model.getValue() !== content) {
        entry.model.pushStackElement();
        entry.model.pushEditOperations([], [{ range: entry.model.getFullModelRange(), text: content }], () => null);
        entry.model.pushStackElement();
      }
      entry.savedVersion = entry.model.getAlternativeVersionId();
      entry.mtime = mtime;
      entry.pending = null;
      startWatch(entry);
    }
    if (!entry) {
      const model = monaco.editor.createModel(content, undefined, monaco.Uri.file(file));
      initIndent(model);
      entry = { file, model, refs: 0, savedVersion: model.getAlternativeVersionId(), mtime, views: new Set() };
      models.set(key, entry);
      startWatch(entry);
    }
    entry.refs++;
    const model = entry.model;
    const mHost = document.createElement('div');
    mHost.className = 'ed-monaco';
    const status = document.createElement('div');
    status.className = 'ed-status';
    const bannerEl = document.createElement('div');
    bannerEl.className = 'ed-banner hidden';
    container.append(bannerEl, mHost, status);
    const ed = monaco.editor.create(mHost, { model, ...options(), theme: 'robot' });
    editors.add(ed);

    const isDirty = () => model.getAlternativeVersionId() !== entry.savedVersion;
    let lastDirty = false;
    const sub = model.onDidChangeContent(() => {
      const d = isDirty();
      if (d !== lastDirty) { lastDirty = d; onDirty?.(d); }
      updateStatus();
      updateHistory();
    });

    const syncDirty = () => { const d = isDirty(); if (d !== lastDirty) { lastDirty = d; onDirty?.(d); } };

    // ---------- Bande d'avertissement (fichier modifié / supprimé sur le disque) ----------
    let bannerTimer = 0;
    function banner(state) {
      clearTimeout(bannerTimer);
      bannerEl.innerHTML = '';
      bannerEl.className = 'ed-banner' + (state ? ' ' + (state === 'reloaded' ? 'info' : 'warn') : ' hidden');
      if (!state) return;
      const msg = document.createElement('span');
      msg.className = 'ed-banner-msg';
      const act = (label, fn, primary) => {
        const b = document.createElement('button');
        b.className = 'tb-btn small' + (primary ? ' primary' : '');
        b.textContent = T(label);
        b.addEventListener('click', fn);
        return b;
      };
      const close = act('✕', () => notify(entry, null));
      close.title = T('Fermer');
      close.classList.add('ed-banner-x');
      if (state === 'reloaded') {
        msg.textContent = '⟳ ' + T('Le fichier a été modifié sur le disque : contenu rechargé (Ctrl+Z pour revenir).');
        bannerEl.append(msg, close);
        bannerTimer = setTimeout(() => banner(null), 8000);
      } else if (state === 'conflict') {
        msg.textContent = '⚠ ' + T('Le fichier a été modifié sur le disque, mais vous avez des modifications non enregistrées.');
        bannerEl.append(msg,
          act('Recharger depuis le disque', async () => { try { reloadEntry(entry, await window.api.readText(file)); notify(entry, null); } catch (e) { UI.toast(e.message, { kind: 'error' }); } }),
          act('Garder ma version', () => { if (entry.pending) entry.mtime = entry.pending.mtime; entry.pending = null; notify(entry, null); }, true));
      } else if (state === 'deleted') {
        msg.textContent = '⚠ ' + T("Le fichier n'existe plus sur le disque (supprimé ou déplacé).");
        bannerEl.append(msg, act('Enregistrer pour le recréer', () => ctl.save().catch((e) => UI.toast(e.message, { kind: 'error' })), true), close);
      }
    }
    const view = { ed, banner, syncDirty };
    entry.views.add(view);
    if (entry.pending) banner('conflict');

    const run = (id) => { ed.focus(); return ed.getAction(id)?.run(); };

    // ---------- Historique : boutons Annuler / Rétablir ----------
    const histBtn = (label, title, fn) => {
      const b = document.createElement('button');
      b.className = 'icon-btn ed-hist';
      b.textContent = label;
      b.title = T(title);
      b.addEventListener('click', fn);
      return b;
    };
    const historyBtns = [
      histBtn('↶', 'Annuler (Ctrl+Z)', () => ctl.undo()),
      histBtn('↷', 'Rétablir (Ctrl+Y)', () => ctl.redo()),
    ];
    const updateHistory = () => { historyBtns[0].disabled = !model.canUndo(); historyBtns[1].disabled = !model.canRedo(); };
    updateHistory();
    const has = (id) => !!ed.getAction(id)?.isSupported();
    let colMode = false;
    const setColMode = (on) => { colMode = on; ed.updateOptions({ columnSelection: on }); updateStatus(); ed.focus(); };

    // ---------- Barre d'état ----------
    const btn = (cls, title, onClick) => {
      const b = document.createElement('button');
      b.className = 'ed-st ' + cls;
      b.title = T(title);
      b.addEventListener('click', (e) => { e.stopPropagation(); onClick(b); });
      return b;
    };
    const stPos = btn('st-pos', 'Aller à la ligne (Ctrl+G)', () => run('editor.action.gotoLine'));
    const stCol = btn('st-col', 'Mode sélection en colonne actif : cliquer pour le désactiver', () => setColMode(false));
    const stIndent = btn('st-indent', "Changer l'indentation", (b) => UI.menu(indentItems(), b));
    const stEnc = document.createElement('span');
    stEnc.className = 'ed-st st-enc';
    stEnc.textContent = 'UTF-8';
    const stEol = btn('st-eol', 'Fin de ligne', (b) => UI.menu(eolItems(), b));
    const stLang = btn('st-lang', 'Langage du fichier', (b) => UI.menu(langItems(), b));
    const spacer = document.createElement('span');
    spacer.className = 'ed-st-spacer';
    status.append(stPos, stCol, spacer, stIndent, stEnc, stEol, stLang);

    const langName = (id) => {
      const l = monaco.languages.getLanguages().find((x) => x.id === id);
      return l?.aliases?.[0] || id;
    };
    let raf = 0;
    function updateStatus() {
      if (raf) return;
      raf = setTimeout(() => {
        raf = 0;
        if (ed.getModel() !== model) return;
        const sels = ed.getSelections() || [];
        const p = ed.getPosition() || { lineNumber: 1, column: 1 };
        let txt = T('Ln {0}, Col {1}', p.lineNumber, p.column);
        const chars = sels.reduce((n, s) => n + model.getValueLengthInRange(s), 0);
        const extra = [];
        if (chars) extra.push(T('{0} sélectionnés', chars));
        if (sels.length > 1) extra.push(T('{0} curseurs', sels.length));
        if (extra.length) txt += ` (${extra.join(' · ')})`;
        stPos.textContent = txt;
        stCol.textContent = '▦ ' + T('Colonne');
        stCol.classList.toggle('hidden', !colMode);
        const o = model.getOptions();
        stIndent.textContent = o.insertSpaces ? T('Espaces : {0}', o.indentSize ?? o.tabSize) : T('Tabulations : {0}', o.tabSize);
        stEol.textContent = model.getEOL() === '\r\n' ? 'CRLF' : 'LF';
        stLang.textContent = langName(model.getLanguageId());
      }, 30);
    }
    function indentItems() {
      const o = model.getOptions();
      return [
        { title: 'Indentation' },
        { label: 'Espaces', checked: o.insertSpaces, action: () => { model.updateOptions({ insertSpaces: true }); updateStatus(); } },
        { label: 'Tabulations', checked: !o.insertSpaces, action: () => { model.updateOptions({ insertSpaces: false }); updateStatus(); } },
        '-',
        ...[2, 4, 8].map((n) => ({ label: T('Taille : {0}', n), checked: o.tabSize === n, action: () => { model.updateOptions({ tabSize: n, indentSize: n }); updateStatus(); } })),
        '-',
        { label: "Convertir l'indentation en espaces", action: () => run('editor.action.indentationToSpaces'), disabled: !has('editor.action.indentationToSpaces') },
        { label: "Convertir l'indentation en tabulations", action: () => run('editor.action.indentationToTabs'), disabled: !has('editor.action.indentationToTabs') },
        { label: 'Détecter depuis le contenu', action: () => { const s = Settings.data; model.detectIndentation(s.editorInsertSpaces !== false, s.editorTabSize || 2); updateStatus(); } },
      ];
    }
    function eolItems() {
      const crlf = model.getEOL() === '\r\n';
      return [
        { title: 'Fin de ligne' },
        { label: 'LF (Unix, macOS)', checked: !crlf, action: () => { model.pushEOL(monaco.editor.EndOfLineSequence.LF); updateStatus(); } },
        { label: 'CRLF (Windows)', checked: crlf, action: () => { model.pushEOL(monaco.editor.EndOfLineSequence.CRLF); updateStatus(); } },
      ];
    }
    function langItems() {
      const cur = model.getLanguageId();
      const langs = monaco.languages.getLanguages().map((l) => ({ id: l.id, name: l.aliases?.[0] || l.id }))
        .sort((a, b) => a.name.localeCompare(b.name));
      return [{ title: 'Langage' }, ...langs.map((l) => ({ label: l.name, checked: l.id === cur, action: () => monaco.editor.setModelLanguage(model, l.id) }))];
    }
    const subs = [
      ed.onDidChangeCursorSelection(updateStatus),
      model.onDidChangeLanguage(updateStatus),
      model.onDidChangeOptions(updateStatus),
    ];
    updateStatus();

    // ---------- Zoom (Ctrl+molette, Ctrl+= / Ctrl+- / Ctrl+0) ----------
    const onWheel = (e) => {
      if (!e.ctrlKey) return;
      e.preventDefault(); e.stopPropagation();
      zoom(e.deltaY < 0 ? 1 : -1);
    };
    const onKey = (e) => {
      if (!e.ctrlKey || e.altKey || e.metaKey) return;
      let d = null;
      if (e.key === '+' || e.key === '=' || e.code === 'NumpadAdd') d = 1;
      else if (e.key === '-' || e.code === 'NumpadSubtract') d = -1;
      else if (!e.shiftKey && (e.key === '0' || e.code === 'Digit0' || e.code === 'Numpad0')) d = 0;
      if (d === null) return;
      e.preventDefault(); e.stopPropagation();
      zoom(d);
    };
    mHost.addEventListener('wheel', onWheel, { capture: true, passive: false });
    mHost.addEventListener('keydown', onKey, true);

    const ctl = {
      file, editor: ed,
      get dirty() { return isDirty(); },
      async save() {
        const s = Settings.data;
        if (s.editorTrimOnSave) ed.getAction('editor.action.trimTrailingWhitespace')?.run();
        if (s.editorFinalNewline) {
          const last = model.getLineCount();
          if (model.getLineLength(last) > 0) {
            const col = model.getLineMaxColumn(last);
            model.pushEditOperations(ed.getSelections(), [{ range: new monaco.Range(last, col, last, col), text: model.getEOL() }], () => null);
          }
        }
        const mtimeNew = await window.api.writeText(file, model.getValue());
        entry.savedVersion = model.getAlternativeVersionId();
        entry.mtime = mtimeNew;
        entry.pending = null;
        entry.views.forEach((v) => v.syncDirty());
        notify(entry, null);
        onSaved?.();
      },
      revert() {
        return window.api.readText(file).then(({ content: c, mtime: m }) => {
          // Annulable (Ctrl+Z) plutôt que setValue, qui effacerait l'historique
          model.pushStackElement();
          model.pushEditOperations([], [{ range: model.getFullModelRange(), text: c }], () => null);
          model.pushStackElement();
          entry.savedVersion = model.getAlternativeVersionId();
          entry.mtime = m;
          entry.pending = null;
          entry.views.forEach((v) => v.syncDirty());
          notify(entry, null);
        });
      },
      // Vérifie le fichier sur le disque (recharge ou affiche la bande d'avertissement)
      checkDisk() { return diskChanged(entry); },
      reveal(l, col = 1) {
        if (!l) return;
        ed.revealLineInCenter(l);
        ed.setPosition({ lineNumber: l, column: col });
        ed.focus();
      },
      find() { run('actions.find'); },
      undo() { ed.focus(); ed.trigger('menu', 'undo', null); },
      redo() { ed.focus(); ed.trigger('menu', 'redo', null); },
      // Boutons ↶ ↷ à placer dans la barre de l'hôte (état mis à jour automatiquement)
      historyButtons() { return historyBtns; },
      // Entrées de menu communes (onglet éditeur et édition dans l'explorateur)
      menuItems() {
        const a = (label, id, hint, icon) => ({ label, icon, hint, action: () => run(id), disabled: !has(id) });
        return [
          { label: 'Annuler la modification', icon: '↶', hint: 'Ctrl+Z', action: () => ctl.undo(), disabled: !model.canUndo() },
          { label: 'Rétablir la modification', icon: '↷', hint: 'Ctrl+Y', action: () => ctl.redo(), disabled: !model.canRedo() },
          '-',
          a('Rechercher', 'actions.find', 'Ctrl+F', '🔍'),
          a('Remplacer', 'editor.action.startFindReplaceAction', 'Ctrl+H', '⇄'),
          a('Aller à la ligne', 'editor.action.gotoLine', 'Ctrl+G', '↧'),
          a('Toutes les commandes', 'editor.action.quickCommand', 'F1', '⌘'),
          '-',
          { label: 'Sélection', icon: '▦', submenu: [
            { title: 'Alt+Maj+glisser ou Ctrl+Maj+Alt+flèches : sélection rectangulaire' },
            { label: 'Mode sélection en colonne', checked: colMode, action: () => setColMode(!colMode) },
            '-',
            a('Tout sélectionner', 'editor.action.selectAll', 'Ctrl+A'),
            a("Ajouter l'occurrence suivante", 'editor.action.addSelectionToNextFindMatch', 'Ctrl+D'),
            a('Sélectionner toutes les occurrences', 'editor.action.changeAll', 'Ctrl+F2'),
            a('Ajouter un curseur au-dessus', 'editor.action.insertCursorAbove', 'Ctrl+Alt+↑'),
            a('Ajouter un curseur au-dessous', 'editor.action.insertCursorBelow', 'Ctrl+Alt+↓'),
            a('Curseurs en fin de lignes sélectionnées', 'editor.action.insertCursorAtEndOfEachLineSelected', 'Maj+Alt+I'),
            a('Étendre la sélection', 'editor.action.smartSelect.expand', 'Maj+Alt+→'),
            a('Réduire la sélection', 'editor.action.smartSelect.shrink', 'Maj+Alt+←'),
          ] },
          { label: 'Édition', icon: '✎', submenu: [
            a('Dupliquer la ligne', 'editor.action.copyLinesDownAction', 'Maj+Alt+↓'),
            a('Monter la ligne', 'editor.action.moveLinesUpAction', 'Alt+↑'),
            a('Descendre la ligne', 'editor.action.moveLinesDownAction', 'Alt+↓'),
            a('Supprimer la ligne', 'editor.action.deleteLines', 'Ctrl+Maj+K'),
            a('Commenter / décommenter', 'editor.action.commentLine', 'Ctrl+/'),
            '-',
            a('Trier les lignes (croissant)', 'editor.action.sortLinesAscending'),
            a('Trier les lignes (décroissant)', 'editor.action.sortLinesDescending'),
            a('MAJUSCULES', 'editor.action.transformToUppercase'),
            a('minuscules', 'editor.action.transformToLowercase'),
            a('Initiales En Majuscules', 'editor.action.transformToTitlecase'),
            a('Supprimer les espaces en fin de ligne', 'editor.action.trimTrailingWhitespace'),
            a('Mettre en forme le document', 'editor.action.formatDocument', 'Maj+Alt+F'),
            '-',
            a('Tout plier', 'editor.foldAll'),
            a('Tout déplier', 'editor.unfoldAll'),
          ] },
          { label: 'Affichage', icon: '👁', submenu: viewItems() },
          '-',
        ];
      },
      focus() { ed.focus(); },
      layout() { ed.layout(); },
      dispose() {
        sub.dispose();
        subs.forEach((d) => d.dispose());
        clearTimeout(raf);
        editors.delete(ed);
        ed.dispose();
        clearTimeout(bannerTimer);
        entry.views.delete(view);
        mHost.remove();
        status.remove();
        bannerEl.remove();
        historyBtns.forEach((b) => b.remove());
        if (--entry.refs <= 0) {
          stopWatch(entry);
          entry.closed = true;
          closedKeys.push(key);
          while (closedKeys.length > KEEP_CLOSED) {
            const k = closedKeys.shift();
            models.get(k)?.model.dispose();
            models.delete(k);
          }
        }
      },
    };
    ed.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => ctl.save().then(() => UI.toast(`Enregistré : ${file.split(/[\\/]/).pop()}`, { ms: 1600 })).catch((e) => UI.toast(e.message, { kind: 'error' })));
    if (line) setTimeout(() => ctl.reveal(line), 30);
    return ctl;
  }

  function applySettings() {
    for (const ed of editors) ed.updateOptions(options());
  }

  // ---------- Onglet « éditeur » (ouvrir un fichier directement) ----------
  const EditorTab = {
    icon: '<span class="kind-edit">✎</span>',
    defaultTitle(spec) { return (spec.file || 'Fichier').split(/[\\/]/).pop(); },

    mount(tab, spec) {
      const { h } = UI;
      tab.file = spec.file;
      tab.pane.classList.add('editor-pane');
      const bar = h('div', 'ed-bar');
      // Chemin du fichier : modifiable (Entrée pour ouvrir un autre fichier, Échap pour annuler)
      const pathEl = h('input', 'ed-path');
      pathEl.spellcheck = false;
      pathEl.title = 'Chemin du fichier : modifiez-le puis Entrée pour ouvrir un autre fichier';
      const showPath = () => {
        pathEl.value = tab.file;
        setTimeout(() => { if (document.activeElement !== pathEl) pathEl.scrollLeft = pathEl.scrollWidth; }, 0);
      };
      showPath();
      const dirty = h('span', 'ed-dirty hidden', '● modifié');
      const find = h('button', 'icon-btn', '🔍');
      find.title = 'Rechercher / remplacer (Ctrl+F / Ctrl+H)';
      const save = h('button', 'tb-btn small', 'Enregistrer');
      save.title = 'Enregistrer (Ctrl+S)';
      const more = h('button', 'icon-btn', '⋯');
      bar.append(pathEl, dirty, find, save, more);
      const host = h('div', 'ed-host');
      tab.pane.append(bar, host);
      const setDirty = (d) => {
        dirty.classList.toggle('hidden', !d);
        tab.el.classList.toggle('dirty', d);
      };
      let gen = 0;
      const mountFile = (file, line) => {
        const my = ++gen;
        open(host, file, { line, onDirty: setDirty }).then((ctl) => {
          if (tab.disposed || my !== gen) { ctl.dispose(); return; }
          tab.ctl = ctl;
          find.before(...ctl.historyButtons());
        }).catch((e) => { if (my === gen) host.innerHTML = `<div class="pv-empty">${UI.esc(e.message)}</div>`; });
      };
      mountFile(spec.file, spec.line);

      const switchTo = (file) => {
        tab.ctl?.dispose();
        tab.ctl = null;
        host.innerHTML = '';
        setDirty(false);
        tab.file = file;
        showPath();
        window.CAI?.setAutoTitle(tab, file.split(/[\\/]/).pop(), file);
        window.CAI?.save();
        mountFile(file);
      };
      async function commitPath() {
        let p = pathEl.value.trim().replace(/^"(.*)"$/, '$1');
        if (!p || norm(p) === norm(tab.file)) { showPath(); return; }
        // Chemin relatif : par rapport au dossier du fichier courant
        if (!/^([a-zA-Z]:[\\/]|[\\/]{2}|\/)/.test(p)) p = tab.file.replace(/[^\\/]*$/, '') + p;
        const name = UI.esc(p.split(/[\\/]/).pop());
        if (!(await window.api.exists(p))) {
          const ok = await UI.confirm('Fichier introuvable', `<b>${UI.esc(p)}</b> ${UI.esc(T("n'existe pas. Le créer ?"))}`, { ok: 'Créer' });
          if (!ok) { showPath(); return; }
          try { await window.api.createFile(p); } catch (e) { UI.toast(e.message, { kind: 'error' }); showPath(); return; }
        }
        try { await window.api.readText(p); } catch (e) { UI.toast(e.message, { kind: 'error' }); showPath(); return; }
        const isDirty = !!tab.ctl?.dirty;
        const cur = UI.esc(tab.file.split(/[\\/]/).pop());
        const choice = await UI.dialog({
          title: 'Ouvrir un autre fichier',
          message: isDirty
            ? `${UI.esc(T('« {0} » a des modifications non enregistrées. Voulez-vous d\'abord les enregistrer ?', '§'))}<br><br>${UI.esc(T('Ouvrir {0} :', '¤'))}`.replace('§', cur).replace('¤', `<b>${name}</b>`)
            : UI.esc(T('Ouvrir {0} :', '¤')).replace('¤', `<b>${name}</b>`),
          choices: isDirty
            ? [{ label: 'Dans un nouvel onglet', value: 'tab' }, { label: 'Ne pas enregistrer', value: 'here', danger: true }, { label: 'Enregistrer et ouvrir ici', value: 'save', primary: true }]
            : [{ label: 'Dans un nouvel onglet', value: 'tab' }, { label: 'Ici', value: 'here', primary: true }],
        });
        showPath();
        if (!choice) return;
        if (choice === 'tab') { window.CAI?.openFile(tab.space, p); return; }
        if (choice === 'save') { try { await tab.ctl.save(); } catch (e) { UI.toast(e.message, { kind: 'error' }); return; } }
        switchTo(p);
      }
      pathEl.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Enter') { e.preventDefault(); commitPath(); }
        else if (e.key === 'Escape') { e.preventDefault(); showPath(); tab.ctl?.focus(); }
      });
      pathEl.addEventListener('focus', () => pathEl.select());
      pathEl.addEventListener('blur', () => setTimeout(() => { if (document.activeElement !== pathEl && !document.querySelector('.dlg-overlay')) showPath(); }, 0));

      find.addEventListener('click', () => tab.ctl?.find());
      save.addEventListener('click', () => tab.ctl?.save().catch((e) => UI.toast(e.message, { kind: 'error' })));
      more.addEventListener('click', () => UI.menu([
        ...(tab.ctl?.menuItems() || []),
        { label: 'Recharger depuis le disque', icon: '⟳', action: () => tab.ctl?.revert() },
        { label: "Ouvrir avec l'application par défaut", icon: '↗', action: () => window.api.openPath(tab.file) },
        { label: "Afficher dans l'Explorateur Windows", icon: '📍', action: () => window.api.showItem(tab.file) },
        { label: 'Copier le chemin', icon: '⧉', action: () => window.api.writeClipboard(tab.file) },
      ], more));
    },
    activate(tab) { tab.ctl?.layout(); const p = tab.pane.querySelector('.ed-path'); if (p && document.activeElement !== p) p.scrollLeft = p.scrollWidth; },
    focus(tab) { tab.ctl?.focus(); },
    resize(tab) { tab.ctl?.layout(); },
    reveal(tab, line) { tab.ctl?.reveal(line); },
    async canClose(tab) {
      if (!tab.ctl?.dirty) return true;
      const r = await UI.dialog({ title: 'Modifications non enregistrées', message: `Enregistrer « ${UI.esc(tab.title)} » avant de fermer ?`, ok: 'Enregistrer', cancel: 'Ne pas enregistrer' });
      if (r) await tab.ctl.save();
      return true;
    },
    dispose(tab) { tab.disposed = true; tab.ctl?.dispose(); },
    serialize(tab) { return { file: tab.file }; },
    applySettings() { applySettings(); },
    applyTheme() { applyTheme(); },
  };

  (window.TabKinds = window.TabKinds || {}).editor = EditorTab;
  window.Editor = { load, open, applyTheme, applySettings, viewItems };
})();
