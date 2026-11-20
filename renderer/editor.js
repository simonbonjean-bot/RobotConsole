// RobotConsole — éditeur de code (Monaco) réutilisable + onglet « éditeur »
(function () {
  let loading = null;
  const models = new Map(); // chemin normalisé -> { model, refs, savedVersion, mtime }
  const editors = new Set();
  const norm = (p) => p.toLowerCase();

  function load() {
    if (loading) return loading;
    loading = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = '../node_modules/monaco-editor/min/vs/loader.js';
      s.onload = () => {
        window.require.config({ paths: { vs: '../node_modules/monaco-editor/min/vs' } });
        window.require(['vs/editor/editor.main'], () => { applyTheme(); resolve(window.monaco); }, reject);
      };
      s.onerror = reject;
      document.head.appendChild(s);
    });
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
      },
    });
    monaco.editor.setTheme('robot');
  }

  function options() {
    const s = Settings.data;
    return {
      fontFamily: s.fontFamily,
      fontSize: s.fontSize,
      fontLigatures: /Cascadia Code/.test(s.fontFamily),
      minimap: { enabled: s.editorMinimap },
      wordWrap: s.editorWordWrap ? 'on' : 'off',
      tabSize: s.editorTabSize || 2,
      renderWhitespace: 'selection',
      smoothScrolling: true,
      cursorSmoothCaretAnimation: 'on',
      bracketPairColorization: { enabled: true },
      scrollBeyondLastLine: false,
      automaticLayout: true,
      stickyScroll: { enabled: true },
      padding: { top: 8 },
    };
  }

  // Ouvre un fichier dans un conteneur. Renvoie un contrôleur.
  async function open(container, file, { line, onDirty, onSaved } = {}) {
    const monaco = await load();
    const { content, mtime } = await window.api.readText(file);
    const key = norm(file);
    let entry = models.get(key);
    if (!entry) {
      const model = monaco.editor.createModel(content, undefined, monaco.Uri.file(file));
      entry = { model, refs: 0, savedVersion: model.getAlternativeVersionId(), mtime };
      models.set(key, entry);
    }
    entry.refs++;
    const ed = monaco.editor.create(container, { model: entry.model, ...options(), theme: 'robot' });
    editors.add(ed);

    const isDirty = () => entry.model.getAlternativeVersionId() !== entry.savedVersion;
    let lastDirty = false;
    const sub = entry.model.onDidChangeContent(() => {
      const d = isDirty();
      if (d !== lastDirty) { lastDirty = d; onDirty?.(d); }
    });

    const ctl = {
      file, editor: ed,
      get dirty() { return isDirty(); },
      async save() {
        const mtimeNew = await window.api.writeText(file, entry.model.getValue());
        entry.savedVersion = entry.model.getAlternativeVersionId();
        entry.mtime = mtimeNew;
        lastDirty = false;
        onDirty?.(false);
        onSaved?.();
      },
      revert() {
        return window.api.readText(file).then(({ content: c, mtime: m }) => {
          entry.model.setValue(c);
          entry.savedVersion = entry.model.getAlternativeVersionId();
          entry.mtime = m;
          lastDirty = false;
          onDirty?.(false);
        });
      },
      // Recharge si le fichier a changé sur le disque et qu'il n'y a pas de modification en cours
      async checkDisk() {
        if (isDirty()) return false;
        try {
          const { content: c, mtime: m } = await window.api.readText(file);
          if (m === entry.mtime) return false;
          const state = ed.saveViewState();
          entry.model.pushEditOperations([], [{ range: entry.model.getFullModelRange(), text: c }], () => null);
          entry.savedVersion = entry.model.getAlternativeVersionId();
          entry.mtime = m;
          ed.restoreViewState(state);
          return true;
        } catch { return false; }
      },
      reveal(l, col = 1) {
        if (!l) return;
        ed.revealLineInCenter(l);
        ed.setPosition({ lineNumber: l, column: col });
        ed.focus();
      },
      focus() { ed.focus(); },
      layout() { ed.layout(); },
      dispose() {
        sub.dispose();
        editors.delete(ed);
        ed.dispose();
        if (--entry.refs <= 0) { entry.model.dispose(); models.delete(key); }
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
      const pathEl = h('div', 'ed-path');
      pathEl.textContent = spec.file;
      pathEl.title = spec.file;
      const dirty = h('span', 'ed-dirty hidden', '● modifié');
      const save = h('button', 'tb-btn small', 'Enregistrer');
      save.title = 'Enregistrer (Ctrl+S)';
      const more = h('button', 'icon-btn', '⋯');
      bar.append(pathEl, dirty, h('div', 'tb-spacer'), save, more);
      const host = h('div', 'ed-host');
      tab.pane.append(bar, host);
      const setDirty = (d) => {
        dirty.classList.toggle('hidden', !d);
        tab.el.classList.toggle('dirty', d);
      };
      open(host, spec.file, { line: spec.line, onDirty: setDirty }).then((ctl) => {
        tab.ctl = ctl;
        if (tab.disposed) ctl.dispose();
      }).catch((e) => { host.innerHTML = `<div class="pv-empty">${UI.esc(e.message)}</div>`; });
      save.addEventListener('click', () => tab.ctl?.save().catch((e) => UI.toast(e.message, { kind: 'error' })));
      more.addEventListener('click', () => UI.menu([
        { label: 'Recharger depuis le disque', icon: '⟳', action: () => tab.ctl?.revert() },
        { label: "Ouvrir avec l'application par défaut", icon: '↗', action: () => window.api.openPath(spec.file) },
        { label: "Afficher dans l'Explorateur Windows", icon: '📍', action: () => window.api.showItem(spec.file) },
        { label: 'Copier le chemin', icon: '⧉', action: () => window.api.writeClipboard(spec.file) },
      ], more));
    },
    activate(tab) { tab.ctl?.layout(); },
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
  window.Editor = { load, open, applyTheme, applySettings };
})();
