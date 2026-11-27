// Éditeur de prompts : les commandes / restent locales, les commandes des CLI restent intactes.
(function () {
  const { h } = UI;
  const api = window.api;
  const editors = new Map();
  let nextId = 0;
  const copy = (value) => JSON.parse(JSON.stringify(value));
  const label = (tag, cls, text) => { const el = h(tag, cls); el.textContent = I18n.t(text); return el; };
  const userLabel = (tag, cls, text) => { const el = h(tag, cls); el.textContent = text; el.setAttribute('data-no-i18n', ''); return el; };
  api.onPromptSpelling((status) => editors.forEach((editor) => editor.spelling(status)));

  function open(tab) {
    const existing = editors.get(tab);
    if (existing) { existing.focus(); return; }
    const initial = tab.promptDraft || { text: '', documents: [] };
    let documents = copy(initial.documents);
    let library = { history: [], favorites: [], drafts: [] };
    let listKind = 'history';
    let busy = false;
    let command = null;
    let matches = [];
    let chosen = 0;
    let fileMenu = null;
    let autosaveTimer;
    let loaded = false;
    let revision = 0;
    let savedRevision = -1;
    if (!tab.promptDraftId) {
      tab.promptDraftId = crypto.randomUUID();
      CAI.save();
    }

    const overlay = h('div', 'overlay prompt-overlay');
    const controller = new AbortController();
    const dialogOptions = { parent: overlay, signal: controller.signal };
    const id = 'prompt-' + (++nextId);
    const card = h('section', 'prompt-card');
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-labelledby', id + '-heading');
    const heading = label('h3', '', 'Rédiger un prompt');
    heading.id = id + '-heading';
    const target = userLabel('div', 'prompt-target', tab.title + ' · ' + tab.space.name);
    const toolbar = h('div', 'prompt-toolbar');
    const body = h('div', 'prompt-body');
    const editor = h('div', 'prompt-main');
    const input = h('textarea', 'set-input prompt-input');
    input.value = initial.text;
    input.maxLength = PromptText.MAX_TEXT;
    input.setAttribute('aria-label', I18n.t('Texte du prompt'));
    input.placeholder = I18n.t('Rédigez ici. Tapez / pour les documents, l’historique et les favoris. Entrée ajoute une ligne ; Ctrl+Entrée envoie.');
    input.spellcheck = Settings.data.promptSpellcheck !== false;
    input.lang = I18n.lang === 'fr' ? 'fr' : 'en-US';
    const commands = h('div', 'prompt-commands');
    commands.hidden = true;
    commands.setAttribute('role', 'listbox');
    commands.id = id + '-commands';
    input.setAttribute('aria-controls', commands.id);
    input.setAttribute('aria-expanded', 'false');
    const documentList = h('div', 'prompt-documents');
    const preview = h('pre', 'prompt-preview');
    preview.hidden = true;
    const count = h('div', 'prompt-count');
    const saveStatus = h('div', 'prompt-hint prompt-save-status');
    saveStatus.setAttribute('role', 'status');
    const hint = label('div', 'prompt-hint', 'Les chemins sont ajoutés au prompt ; le CLI reste responsable de lire les documents. « Contenu texte » inclut le fichier.');
    const error = h('div', 'prompt-error');
    error.setAttribute('role', 'alert');
    const assistantPanel = h('details', 'prompt-assistant');
    assistantPanel.appendChild(label('summary', '', 'Assistant IA'));
    const assistantForm = Settings.promptAssistantForm(perform);
    const assistantStatus = h('div', 'prompt-hint');
    assistantStatus.setAttribute('role', 'status');
    const proposal = h('textarea', 'set-input prompt-proposal');
    proposal.rows = 5;
    proposal.readOnly = true;
    proposal.setAttribute('aria-label', I18n.t('Proposition IA'));
    const proposalBox = h('div', 'prompt-proposal-box');
    proposalBox.hidden = true;
    proposalBox.append(label('strong', '', 'Proposition IA'), proposal,
      button('Appliquer la proposition', async () => {
        await api.savePromptDraft(crypto.randomUUID(), draft());
        input.value = proposal.value;
        proposalBox.hidden = true;
        changed();
        state.focusAfter = input;
      }, 'prompt-apply-proposal'),
      button('Ignorer', () => { proposalBox.hidden = true; }));
    const configureAssistant = button('Configurer dans les paramètres', () => Settings.open('prompt-ai'), 'prompt-open-settings');
    const improve = button('Améliorer avec l’IA', async () => {
      if (!input.value.trim()) throw new Error('Rédigez un prompt ou ajoutez un document');
      if (!await UI.confirm('Envoyer ce texte à l’assistant IA ?',
        'Seul le texte du prompt sera transmis au fournisseur configuré. Les documents ne sont pas envoyés. Cette opération peut consommer votre quota ou des crédits API.',
        { ...dialogOptions, ok: 'Améliorer' })) return;
      assistantStatus.textContent = I18n.t('Reformulation en cours…');
      try {
        const result = await api.improvePrompt(input.value);
        if (state.closed) return;
        proposal.value = result;
        proposalBox.hidden = false;
      } finally { assistantStatus.textContent = ''; }
    }, 'prompt-improve');
    assistantPanel.append(assistantForm.element, assistantStatus, configureAssistant, improve, proposalBox);
    editor.append(input, commands, documentList, preview, count, saveStatus, hint, assistantPanel);

    const aside = h('aside', 'prompt-library');
    const libraryTabs = h('div', 'prompt-library-tabs');
    const filter = h('label', 'prompt-all-workspaces');
    const allWorkspaces = h('input');
    allWorkspaces.type = 'checkbox';
    filter.append(allWorkspaces, label('span', '', 'Tous les workspaces'));
    const librarySearch = h('input', 'set-input prompt-library-search');
    librarySearch.placeholder = I18n.t('Rechercher un prompt');
    librarySearch.setAttribute('aria-label', I18n.t('Rechercher un prompt'));
    const entries = h('div', 'prompt-entries');
    const clear = button('Effacer l’historique', async () => {
      if (!await UI.confirm('Effacer l’historique des prompts ?', allWorkspaces.checked
        ? 'Les prompts de tous les workspaces seront supprimés de l’historique local.'
        : 'Les prompts de ce workspace seront supprimés de l’historique local.', { ...dialogOptions, danger: true, ok: 'Effacer' })) return;
      await api.clearPromptHistory(allWorkspaces.checked);
      await refresh();
    }, 'prompt-clear');
    aside.append(libraryTabs, filter, librarySearch, entries, clear,
      label('div', 'prompt-hint', 'Brouillons, historique et favoris conservés sur cet ordinateur, hors du workspace. Évitez d’y enregistrer des secrets.'));
    body.append(editor, aside);

    const footer = h('div', 'prompt-footer');
    const closeButton = label('button', 'tb-btn prompt-close', 'Fermer');
    closeButton.type = 'button';
    closeButton.addEventListener('click', () => state.close());
    const favorite = button('Enregistrer un favori', () => saveFavorite(draft()), 'prompt-favorite');
    const saveDraft = button('Sauvegarder le brouillon', async () => {
      await persistDraft();
      listKind = 'drafts';
      await refresh();
    }, 'prompt-save-draft');
    const newDraft = button('Nouveau brouillon', async () => {
      await persistDraft();
      tab.promptDraftId = crypto.randomUUID();
      input.value = '';
      documents = [];
      proposalBox.hidden = true;
      renderDocuments();
      changed();
      CAI.save();
      listKind = 'drafts';
      await refresh();
      state.focusAfter = input;
    }, 'prompt-new-draft');
    const insert = button('Insérer sans envoyer', () => transmit(false), 'prompt-insert');
    const send = button('Envoyer au terminal', () => transmit(true), 'primary prompt-send');
    send.title = I18n.t('Envoyer au terminal (Ctrl+Entrée)');
    footer.append(closeButton, newDraft, saveDraft, favorite, insert, send);
    const spelling = h('label', 'prompt-spelling');
    const spellingCheck = h('input');
    spellingCheck.type = 'checkbox';
    spellingCheck.checked = input.spellcheck;
    spellingCheck.addEventListener('change', () => {
      input.spellcheck = spellingCheck.checked;
      Settings.set({ promptSpellcheck: spellingCheck.checked });
      state.spelling(state.spellingInfo);
    });
    spelling.append(spellingCheck, label('span', '', 'Orthographe FR / EN (clic droit)'));
    const spellingStatus = h('div', 'prompt-spelling-status');
    spellingStatus.setAttribute('role', 'status');
    toolbar.append(button('Document…', pickDocuments, 'prompt-add-document'),
      button('Fichiers ouverts', openFiles, 'prompt-open-files'),
      button('Aperçu', async () => {
        preview.textContent = await build();
        preview.hidden = false;
      }, 'prompt-show-preview'), spelling);
    card.append(heading, target, label('div', 'prompt-hint', 'Utilisez une invite CLI vide ; le texte est ajouté à la saisie existante.'), toolbar, spellingStatus, error, body, footer);
    overlay.appendChild(card);
    tab.pane.appendChild(overlay);

    const state = {
      tab, input, closed: false,
      focus() {
        (overlay.querySelector('.dlg-input') || overlay.querySelector('.dlg-actions .primary') || (busy ? closeButton : input)).focus();
      },
      spelling(status) {
        state.spellingInfo = status;
        spellingStatus.textContent = '';
        if (!input.spellcheck || !status || status.native) return;
        const failed = status.languages.filter((item) => item.state === 'failed').map((item) => item.language);
        if (!status.languages.length) spellingStatus.textContent = I18n.t('Dictionnaires FR / EN indisponibles');
        else if (failed.length) spellingStatus.textContent = I18n.t('Dictionnaire indisponible : {0}. Vérifiez votre connexion puis redémarrez l’application.', failed.join(', '));
        else if (status.languages.some((item) => item.state === 'loading')) spellingStatus.textContent = I18n.t('Chargement des dictionnaires orthographiques…');
      },
      close(focus = true) {
        if (state.closed) return;
        tab.promptDraft = draft();
        clearTimeout(autosaveTimer);
        window.removeEventListener('beforeunload', saveFinal);
        if (loaded) void persistDraft().catch((failure) => UI.toast(I18n.t('Brouillon non sauvegardé : {0}', failure.message), { ms: 7000 }));
        state.closed = true;
        controller.abort();
        if (fileMenu?.isConnected) UI.closeMenus();
        overlay.remove();
        if (editors.get(tab) === state) editors.delete(tab);
        if (focus && !tab.disposed && CAI.activeSpace === tab.space && tab.space.activeTab === tab) tab.term.focus();
      },
    };
    editors.set(tab, state);
    function draft() { return { text: input.value, documents: copy(documents) }; }
    function changed(save = true) {
      tab.promptDraft = draft();
      revision++;
      preview.hidden = true;
      proposalBox.hidden = true;
      count.textContent = I18n.t('{0} caractères · {1} documents', String(input.value.length), String(documents.length));
      if (save && loaded) {
        saveStatus.textContent = I18n.t('Sauvegarde en attente…');
        clearTimeout(autosaveTimer);
        autosaveTimer = setTimeout(() => {
          void persistDraft().catch(() => {});
        }, 400);
      }
      updateButtons();
    }
    async function persistDraft() {
      clearTimeout(autosaveTimer);
      if (!loaded || savedRevision === revision) return;
      const currentRevision = revision;
      const value = draft();
      try {
        await api.savePromptDraft(tab.promptDraftId, value);
        savedRevision = currentRevision;
        if (revision === currentRevision) saveStatus.textContent = I18n.t('Brouillon sauvegardé automatiquement');
      } catch (failure) {
        saveStatus.textContent = I18n.t('Brouillon non sauvegardé : {0}', failure.message);
        throw failure;
      }
    }
    function saveFinal() {
      clearTimeout(autosaveTimer);
      if (loaded && savedRevision !== revision && !api.savePromptDraftFinal(tab.promptDraftId, draft())) {
        console.error('Brouillon non sauvegardé');
      }
    }
    window.addEventListener('beforeunload', saveFinal);
    function updateButtons() {
      const empty = !input.value.trim() && !documents.length;
      for (const element of card.querySelectorAll('button, input, textarea, select')) element.disabled = busy;
      closeButton.disabled = false;
      send.disabled = insert.disabled = favorite.disabled = busy || empty;
      saveDraft.disabled = busy || empty;
      improve.disabled = busy || !input.value.trim();
      assistantForm.setBusy(busy);
      card.setAttribute('aria-busy', String(busy));
    }
    async function perform(action) {
      if (busy || state.closed) return;
      const focused = document.activeElement;
      busy = true;
      error.textContent = '';
      updateButtons();
      try { await action(); }
      catch (failure) {
        if (!state.closed) error.textContent = I18n.t(failure.message);
        else UI.toast(failure.message, { ms: 6000 });
      } finally {
        busy = false;
        updateButtons();
        if (!state.closed && CAI.activeSpace === tab.space && tab.space.activeTab === tab &&
            (document.activeElement === document.body || overlay.contains(document.activeElement))) {
          (state.focusAfter || (card.contains(focused) ? focused : input)).focus();
        }
        state.focusAfter = null;
      }
    }
    function button(text, action, cls = '') {
      const element = label('button', 'tb-btn ' + cls, text);
      element.type = 'button';
      element.addEventListener('click', () => { void perform(action); });
      return element;
    }
    async function refresh() {
      const [result, spelling] = await Promise.all([api.listPrompts(), api.promptSpellingStatus()]);
      if (state.closed) return;
      library = result;
      state.spelling(spelling);
      renderLibrary();
    }
    function renderLibrary() {
      entries.replaceChildren();
      filter.hidden = listKind === 'favorites';
      clear.hidden = listKind !== 'history';
      for (const tabButton of libraryTabs.children) tabButton.classList.toggle('active', tabButton.dataset.kind === listKind);
      const query = librarySearch.value.toLocaleLowerCase();
      const workspace = CAI.ws?.root || null;
      const items = library[listKind].filter((entry) =>
        (listKind === 'favorites' || allWorkspaces.checked || Platform.pathKey(entry.workspace) === Platform.pathKey(workspace)) &&
        ((entry.title || '') + ' ' + entry.text + ' ' + entry.documents.map((doc) => doc.path).join(' ')).toLocaleLowerCase().includes(query));
      for (const entry of items) {
        const item = h('article', 'prompt-entry');
        const description = h('div', 'prompt-entry-description');
        description.setAttribute('data-no-i18n', '');
        description.append(userLabel('strong', '', entry.title || entry.text.trim().split('\n')[0].slice(0, 80) || entry.documents[0]?.path),
          userLabel('small', '', new Date(entry.updated || entry.created).toLocaleString() + (entry.workspace ? '\n' + entry.workspace : '')));
        const actions = h('div', 'prompt-entry-actions');
        actions.append(button('Reprendre', async () => {
          const value = PromptText.validate(entry, { allowEmpty: listKind === 'drafts' });
          if ((input.value.trim() || documents.length) && !await UI.confirm('Remplacer le brouillon ?', 'Le brouillon actuel sera remplacé par ce prompt.', { ...dialogOptions, ok: 'Reprendre' })) return;
          if (input.value.trim() || documents.length) await api.savePromptDraft(crypto.randomUUID(), draft());
          input.value = value.text;
          documents = value.documents;
          renderDocuments();
          changed();
          state.focusAfter = input;
        }, 'prompt-reuse'));
        if (listKind === 'history') actions.append(button('Favori', () => saveFavorite(entry)));
        actions.append(button('Supprimer', async () => {
          if (!await UI.confirm('Supprimer ce prompt ?', 'Cette suppression est définitive.', { ...dialogOptions, danger: true, ok: 'Supprimer' })) return;
          await api.removePrompt(listKind, entry.id);
          if (listKind === 'drafts' && entry.id === tab.promptDraftId) {
            tab.promptDraftId = crypto.randomUUID();
            CAI.save();
          }
          await refresh();
        }, 'prompt-remove'));
        item.append(description, actions);
        entries.appendChild(item);
      }
      if (!items.length) entries.appendChild(label('div', 'prompt-hint', 'Aucun prompt dans cette liste.'));
    }
    async function saveFavorite(value) {
      PromptText.validate(value);
      const title = await UI.dialog({ ...dialogOptions, title: 'Nom du favori', input: true,
        value: value.title || value.text.trim().split('\n')[0].slice(0, 80) || 'Document', ok: 'Enregistrer' });
      if (title === null || state.closed) return;
      if (!title.trim()) throw new Error('Donnez un nom au favori');
      await api.addPrompt('favorites', { ...value, title });
      listKind = 'favorites';
      await refresh();
      state.focusAfter = input;
    }
    function renderDocuments() {
      documentList.replaceChildren();
      for (const document of documents) {
        const row = h('div', 'prompt-document');
        const path = userLabel('span', 'prompt-document-path', document.path);
        path.title = document.path;
        const mode = h('select', 'set-input prompt-document-mode');
        mode.setAttribute('aria-label', I18n.t('Mode de référence du document'));
        for (const [value, text] of [['path', 'Chemin uniquement'], ['content', 'Contenu texte']]) {
          const option = label('option', '', text);
          option.value = value;
          mode.appendChild(option);
        }
        mode.value = document.mode;
        mode.addEventListener('change', () => { document.mode = mode.value; changed(); });
        const remove = button('Retirer', () => {
          documents = documents.filter((item) => item !== document);
          renderDocuments();
          changed();
        }, 'prompt-document-remove');
        row.append(path, mode, remove);
        documentList.appendChild(row);
      }
    }
    function addDocuments(paths) {
      const additions = paths.filter((path, index) => !documents.some((doc) => Platform.pathKey(doc.path) === Platform.pathKey(path)) &&
        paths.findIndex((other) => Platform.pathKey(other) === Platform.pathKey(path)) === index);
      if (documents.length + additions.length > PromptText.MAX_DOCUMENTS) throw new Error('Maximum 20 documents par prompt');
      documents.push(...additions.map((path) => ({ path, mode: 'path' })));
      renderDocuments();
      changed();
    }
    async function pickDocuments() {
      const paths = await api.pickPromptDocuments(tab.cwd || CAI.ws?.root);
      if (!state.closed) addDocuments(paths);
      state.focusAfter = input;
    }
    function openFiles() {
      const files = [...new Set(CAI.spaces.flatMap((space) => space.tabs.filter((item) => item.kind === 'editor' && (item.file || item.spec?.file)).map((item) => item.file || item.spec.file)))];
      fileMenu = UI.menu(files.length ? files.map((path) => ({
        label: path, action: () => { void perform(() => addDocuments([path])); },
      })) : [{ label: 'Aucun fichier ouvert', disabled: true }], toolbar.querySelector('.prompt-open-files'));
    }
    async function build() {
      return PromptText.build(draft(), (path) => api.readPromptDocument(path));
    }
    async function transmit(submit) {
      const value = draft();
      const text = await build();
      if (state.closed || !await TabKinds.terminal.inject(tab, text, submit, dialogOptions)) return;
      if (!state.closed) {
        input.value = '';
        documents = [];
        changed();
      }
      try { await api.addPrompt('history', value); }
      catch (failure) { UI.toast(I18n.t('Texte inséré, mais historique non enregistré : {0}', failure.message), { ms: 7000 }); }
      if (state.closed) UI.toast(I18n.t(submit ? 'Texte envoyé au terminal' : 'Texte inséré dans le terminal'));
      else state.close();
    }
    function insertText(text) {
      if (input.value.length + text.length > PromptText.MAX_TEXT) throw new Error('Prompt trop long (maximum 64 Ko)');
      input.setRangeText(text, input.selectionStart, input.selectionEnd, 'end');
      changed();
      state.focusAfter = input;
    }
    const options = [
      { name: 'fichier', text: 'Référencer des documents', run: pickDocuments },
      { name: 'selection', text: 'Insérer la sélection du terminal', run: () => {
        const text = tab.term.getSelection();
        if (!text) throw new Error('Aucun texte sélectionné dans le terminal');
        insertText(text);
      } },
      { name: 'dossier', text: 'Insérer le dossier de départ', run: () => {
        const root = tab.cwd || CAI.ws?.root;
        if (!root) throw new Error('Aucun dossier de départ disponible');
        insertText(root);
      } },
      { name: 'historique', text: 'Consulter l’historique', run: async () => { listKind = 'history'; await refresh(); state.focusAfter = librarySearch; } },
      { name: 'brouillons', text: 'Consulter les brouillons', run: async () => { listKind = 'drafts'; await refresh(); state.focusAfter = librarySearch; } },
      { name: 'favoris', text: 'Consulter les favoris', run: async () => { listKind = 'favorites'; await refresh(); state.focusAfter = librarySearch; } },
      { name: 'favori', text: 'Enregistrer un favori', run: () => saveFavorite(draft()) },
    ];
    function hideCommands() {
      command = null;
      commands.hidden = true;
      input.setAttribute('aria-expanded', 'false');
      input.removeAttribute('aria-activedescendant');
    }
    function renderCommands() {
      command = PromptText.commandAt(input.value, input.selectionStart, input.selectionEnd);
      matches = command ? options.filter((option) => option.name.startsWith(command.query)) : [];
      chosen = 0;
      commands.replaceChildren();
      if (!matches.length) { hideCommands(); return; }
      commands.hidden = false;
      input.setAttribute('aria-expanded', 'true');
      matches.forEach((option, index) => {
        const item = h('button', 'prompt-command');
        item.type = 'button';
        item.setAttribute('role', 'option');
        item.id = id + '-command-' + index;
        const name = label('b', '', '/' + option.name);
        name.setAttribute('data-no-i18n', '');
        item.append(name, label('span', '', option.text));
        item.addEventListener('mousedown', (event) => event.preventDefault());
        item.addEventListener('click', () => { chosen = index; void perform(chooseCommand); });
        commands.appendChild(item);
      });
      markCommand();
    }
    function markCommand() {
      [...commands.children].forEach((item, index) => item.setAttribute('aria-selected', String(index === chosen)));
      input.setAttribute('aria-activedescendant', commands.children[chosen].id);
    }
    function chooseCommand() {
      if (!command) return;
      const option = matches[chosen];
      input.setRangeText('', command.start, command.end, 'end');
      hideCommands();
      changed();
      return option.run();
    }
    input.addEventListener('input', () => { changed(); renderCommands(); });
    input.addEventListener('click', renderCommands);
    input.addEventListener('keyup', (event) => { if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) renderCommands(); });
    input.addEventListener('keydown', (event) => {
      if (event.isComposing) return;
      if (!commands.hidden && ['ArrowDown', 'ArrowUp', 'Enter', 'Tab', 'Escape'].includes(event.key) && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
        event.preventDefault();
        event.stopPropagation();
        if (event.key === 'Escape') hideCommands();
        else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          chosen = (chosen + (event.key === 'ArrowDown' ? 1 : -1) + matches.length) % matches.length;
          markCommand();
        } else void perform(chooseCommand);
      }
    });
    card.addEventListener('keydown', (event) => {
      event.stopPropagation();
      if (event.isComposing) return;
      if (Platform.primary(event) && !event.shiftKey && !event.altKey && event.key === 'Enter') {
        event.preventDefault();
        if (!send.disabled) void perform(() => transmit(true));
      } else if (event.key === 'Escape') {
        event.preventDefault();
        state.close();
      }
    });
    allWorkspaces.addEventListener('change', renderLibrary);
    librarySearch.addEventListener('input', renderLibrary);
    for (const [kind, text] of [['drafts', 'Brouillons'], ['history', 'Historique'], ['favorites', 'Favoris']]) {
      const element = button(text, async () => { listKind = kind; await refresh(); });
      element.dataset.kind = kind;
      libraryTabs.appendChild(element);
    }
    renderDocuments();
    changed(false);
    input.focus();
    void perform(async () => {
      await refresh();
      const saved = library.drafts.find((entry) => entry.id === tab.promptDraftId);
      if (!tab.promptDraft.text && !tab.promptDraft.documents.length && saved) {
        const value = PromptText.validate(saved, { allowEmpty: true });
        input.value = value.text;
        documents = value.documents;
        renderDocuments();
        changed(false);
      }
      if (state.closed) return;
      loaded = true;
      await persistDraft();
      await assistantForm.load();
    });
  }

  window.PromptEditor = {
    open,
    focusFor(tab) {
      const editor = editors.get(tab);
      if (!editor) return false;
      editor.focus();
      return true;
    },
    closeFor: (tab) => editors.get(tab)?.close(false),
  };
})();
