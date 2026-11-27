(function () {
  const { h } = UI;
  const model = PaletteModel;
  const t = (text) => I18n.t(text);
  let state = null, sequence = 0;

  const screenName = (id) => CAI.screens.find((screen) => screen.id === id)?.name || '';
  const item = (label, icon, category, options = {}) => ({ label, icon, category, ...options });
  const current = () => state?.steps[state.steps.length - 1];
  const alive = (space) => space && CAI.spaces.includes(space);
  function requireSource(source) {
    if (source.space && !alive(source.space)) throw new Error(t('La zone d’origine n’existe plus'));
    if (source.tab && (!source.space.tabs.includes(source.tab) || source.tab.disposed)) throw new Error(t('L’onglet d’origine n’existe plus'));
  }
  function requireTab(tab) {
    if (!alive(tab.space) || !tab.space.tabs.includes(tab) || tab.disposed) throw new Error(t('Cet onglet n’existe plus'));
  }
  function zones(onPick, { screenId, exclude } = {}) {
    return CAI.spaces.filter((space) => space !== exclude && (!screenId || space.screenId === screenId)).map((space) =>
      item(space.name, space.bot.svg, 'Zone', {
        detail: screenName(space.screenId), userLabel: true, robot: true,
        run: () => { if (!alive(space)) throw new Error(t('Cette zone n’existe plus')); return onPick(space); },
      }));
  }
  function screenItems(onPick) {
    return CAI.screens.map((screen) => item(screen.name, '▣', 'Écran', {
      userLabel: true, color: screen.color,
      next: onPick ? () => onPick(screen) : undefined,
      run: onPick ? undefined : () => CAI.switchScreen(screen.id),
    }));
  }
  function moveTo(source, destination) {
    requireSource(source);
    CAI.revealSpace(destination);
    CAI.moveTab(source.tab, destination);
    CAI.revealTab(source.tab);
  }
  function moveStep(source) {
    return model.step(t('Déplacer l’onglet actif'), [
      item('Vers une zone', '◈', 'Déplacer', { next: () => model.step(t('Choisir une zone'), zones((space) => moveTo(source, space), { exclude: source.space })) }),
      item('Vers un écran', '▣', 'Déplacer', { next: () => model.step(t('Choisir un écran'), screenItems((screen) => {
        const destinations = zones((space) => moveTo(source, space), { screenId: screen.id, exclude: source.space });
        destinations.push(item('Nouvelle zone dans cet écran', '＋', 'Zone', { run: () => {
          requireSource(source);
          moveTo(source, CAI.createPaletteSpace(screen.id));
        } }));
        return model.step(screen.name, destinations, { userTitle: true });
      })) }),
    ]);
  }
  function fileStep(workspace) {
    return model.step(workspace.name, [], { userTitle: true, workspace, includeIgnored: false, files: true });
  }
  async function workspacesStep() {
    const [context, opened] = await Promise.all([api.context(), api.listOpenWorkspaces()]);
    const seen = new Set();
    const workspaces = [CAI.ws, ...opened, ...context.recent].filter((workspace) => {
      if (!workspace?.root) return false;
      const key = Platform.pathKey(workspace.root);
      if (seen.has(key)) return false;
      seen.add(key); return true;
    });
    return model.step(t('Choisir un workspace'), workspaces.map((workspace) => item(workspace.name, '◆', 'Workspace', {
      userLabel: true, detail: workspace.root, next: () => fileStep(workspace),
    })));
  }
  function rootStep(source) {
    return model.step(t('Palette de commandes'), [
      item('Ouvrir un onglet', '＋', 'Ouvrir', { keywords: 'new tab open', next: () => model.step(t('Choisir un type d’onglet'),
        CAI.paletteKinds.filter((kind) => kind.id !== 'editor').map((kind) => item(kind.label, kind.icon, 'Type d’onglet', {
          run: () => { requireSource(source); return CAI.openKind(source.space || null, kind.id); },
        }))) }),
      item('Déplacer l’onglet actif', '↗', 'Déplacer', { keywords: 'move tab zone screen', disabled: !source.tab, next: () => moveStep(source) }),
      item('Rechercher un fichier', '⌕', 'Fichiers', { keywords: 'file find fichier', disabled: !CAI.ws, next: () => fileStep(CAI.ws) }),
      item('Rechercher dans un autre workspace', '◆', 'Fichiers', { keywords: 'file workspace ailleurs', next: workspacesStep }),
      item('Changer d’onglet', '⇄', 'Naviguer', { keywords: 'switch tab', next: () => model.step(t('Choisir un onglet'),
        CAI.spaces.flatMap((space) => space.tabs.map((tab) => item(tab.title, CAI.tabIconHtml(tab), 'Onglet', {
          userLabel: true, detail: `${space.name} · ${screenName(space.screenId)}`,
          run: () => { requireTab(tab); CAI.revealTab(tab); },
        })))) }),
      item('Changer de zone', '◈', 'Naviguer', { keywords: 'switch zone robot', next: () => model.step(t('Choisir une zone'), [
        ...zones((space) => CAI.revealSpace(space)),
        item('Nouvelle zone', '＋', 'Zone', { keywords: 'creer create new', run: () => CAI.createPaletteSpace(source.screenId) }),
      ]) }),
      item('Changer d’écran', '▣', 'Naviguer', { keywords: 'switch screen ecran', next: () => model.step(t('Choisir un écran'), [
        ...screenItems(),
        item('Nouvel écran', '＋', 'Écran', { keywords: 'creer create new', run: () => CAI.createPaletteScreen() }),
      ]) }),
    ]);
  }

  function cancelRequest(session) {
    clearTimeout(session.timer);
    if (session.requestId) api.cancelFileSearch(session.requestId);
    session.requestId = null;
    session.generation++;
  }
  function close(restore = true) {
    if (!state) return;
    const session = state;
    state = null;
    cancelRequest(session);
    cancelAnimationFrame(session.frame);
    session.observer.disconnect();
    session.card.remove();
    if (restore && !sourceChanged(session)) {
      if (session.focus?.isConnected && session.anchor.contains(session.focus)) session.focus.focus();
      else if (session.source.tab && session.source.space.tabs.includes(session.source.tab)) CAI.revealTab(session.source.tab);
    }
  }
  function sourceChanged(session) {
    return CAI.activeSpace !== session.source.space ||
      CAI.currentScreen.id !== session.source.screenId ||
      session.source.space?.activeTab !== session.source.tab;
  }
  function position(session) {
    const rect = session.anchor.getBoundingClientRect();
    const left = Math.max(0, rect.left), top = Math.max(0, rect.top);
    const width = Math.max(0, Math.min(innerWidth, rect.right) - left);
    const height = Math.max(0, Math.min(innerHeight, rect.bottom) - top);
    session.card.style.width = `${Math.min(560, Math.max(0, width - 16))}px`;
    session.card.style.maxHeight = `${Math.max(0, height - 16)}px`;
    session.card.style.left = `${left + width / 2}px`;
    session.card.style.top = `${top + height / 2}px`;
  }
  function watch(session) {
    if (state !== session) return;
    if (sourceChanged(session) || !session.anchor.isConnected) { close(false); return; }
    session.frame = requestAnimationFrame(() => watch(session));
  }
  function render() {
    if (!state) return;
    const session = state, step = current();
    session.input.value = step.query;
    session.input.placeholder = t(step.files ? 'Rechercher un nom ou un chemin…' : 'Rechercher une action ou une destination…');
    session.crumbs.replaceChildren();
    session.steps.forEach((part, index) => {
      const button = h('button', 'palette-crumb');
      button.type = 'button'; button.textContent = part.title;
      if (part.userTitle) button.dataset.noI18n = '';
      button.disabled = index === session.steps.length - 1;
      button.addEventListener('click', () => backTo(index));
      session.crumbs.appendChild(button);
    });
    session.options.hidden = !step.files;
    session.widen.checked = !!step.includeIgnored;
    session.rows = model.filter(step.items.map((row) => ({ ...row, keywords: `${row.keywords || ''} ${row.userLabel ? '' : t(row.label)}` })), step.query);
    step.selected = Math.min(step.selected, Math.max(0, session.rows.length - 1));
    if (session.rows[step.selected]?.disabled) {
      const first = session.rows.findIndex((row) => !row.disabled);
      if (first >= 0) step.selected = first;
    }
    session.list.replaceChildren();
    session.rows.forEach((row, index) => {
      const button = h('div', `palette-row${row.robot ? ' palette-zone' : ''}`);
      button.id = `palette-option-${index}`; button.setAttribute('role', 'option');
      button.setAttribute('aria-selected', String(index === step.selected));
      button.setAttribute('aria-disabled', String(!!row.disabled));
      const icon = h('span', `palette-icon${row.robot ? ' robot' : ''}`, row.icon);
      if (row.color) icon.style.color = row.color;
      const text = h('span', 'palette-text');
      const label = h('span', 'palette-label'); label.textContent = row.userLabel ? row.label : t(row.label);
      if (row.userLabel) label.dataset.noI18n = '';
      text.appendChild(label);
      if (row.detail) { const detail = h('span', 'palette-detail'); detail.textContent = row.detail; detail.dataset.noI18n = ''; text.appendChild(detail); }
      const badge = h('span', 'palette-category'); badge.textContent = t(row.category);
      button.append(icon, text, badge);
      if (row.next) button.appendChild(h('span', 'palette-chevron', '›'));
      button.addEventListener('mousedown', (event) => event.preventDefault());
      button.addEventListener('click', () => { step.selected = index; enter(); });
      session.list.appendChild(button);
    });
    session.input.setAttribute('aria-activedescendant', session.rows.length ? `palette-option-${step.selected}` : '');
    session.status.textContent = step.loading ? t('Recherche en cours…') : step.error || step.warning ||
      (!session.rows.length ? t('Aucun résultat') : '');
    session.list.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
    position(session);
  }
  function scheduleSearch() {
    if (!state) return;
    const session = state, step = current();
    cancelRequest(session);
    if (!step.files) return render();
    const generation = session.generation;
    step.loading = true; step.error = ''; step.warning = ''; step.items = [];
    render();
    session.timer = setTimeout(async () => {
      const requestId = `palette-${++sequence}`;
      session.requestId = requestId;
      try {
        const result = await api.searchFiles({ root: step.workspace.root, query: step.query, includeIgnored: step.includeIgnored, requestId });
        if (state !== session || current() !== step || generation !== session.generation) return;
        step.items = result.files.map((file) => item(file.relative.split(/[\\/]/).pop(), '✎', 'Fichier', {
          userLabel: true, detail: `${step.workspace.name} · ${file.relative}`, keywords: file.relative,
          run: () => { requireSource(session.source); return CAI.openFile(session.source.space || CAI.ensureSpace(), file.path); },
        }));
        step.warning = result.partial ? t('Résultats partiels : affinez la recherche') : '';
        if (result.warnings.length) step.warning = [step.warning, ...result.warnings].filter(Boolean).join(' · ');
      } catch (error) {
        if (state !== session || current() !== step || generation !== session.generation) return;
        step.error = `${t('Recherche impossible')} : ${error.message}`;
      }
      if (state === session && current() === step && generation === session.generation) { step.loading = false; render(); }
    }, 180);
  }
  function backTo(index) {
    if (!state || state.busy) return;
    cancelRequest(state);
    state.steps.splice(index + 1);
    if (current().files) scheduleSearch(); else render();
    state.input.focus();
  }
  async function enter() {
    if (!state || state.busy) return;
    const session = state, row = session.rows[current().selected];
    if (!row || row.disabled) return;
    session.busy = true;
    try {
      requireSource(session.source);
      if (row.next) {
        const next = await row.next();
        if (state !== session) return;
        cancelRequest(session);
        session.steps.push(next);
        session.busy = false;
        if (next.files) scheduleSearch(); else render();
        session.input.focus();
      } else {
        close(false);
        await row.run();
      }
    } catch (error) {
      if (state === session) { current().error = error.message; session.busy = false; render(); }
      else UI.toast(error.message);
    }
  }
  function onKey(event) {
    if (!state || event.isComposing) return;
    if (model.shortcut(event, Platform.isMac)) return;
    const step = current();
    let handled = true;
    if (event.key === 'Escape') close();
    else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      const delta = event.key === 'ArrowDown' ? 1 : -1;
      for (let count = 0; count < state.rows.length; count++) {
        step.selected = model.selection(step.selected, delta, state.rows.length);
        if (!state.rows[step.selected].disabled) break;
      }
      render();
    } else if (event.target === state.input && (event.key === 'Enter' || (event.key === 'ArrowRight' &&
      state.input.selectionStart === state.input.value.length && state.input.selectionEnd === state.input.value.length))) enter();
    else if (event.key === 'ArrowLeft' && !step.query && state.steps.length > 1) backTo(state.steps.length - 2);
    else handled = false;
    if (handled) event.preventDefault();
    event.stopPropagation();
  }
  function toggle() {
    if (state) return close();
    if (!window.CAI || document.querySelector('.dlg-overlay, .overlay:not(.hidden):not(.prompt-overlay), .prompt-confirm') ||
      document.querySelector('#boot:not(.done)')) return;
    UI.closeMenus();
    const space = CAI.activeSpace, tab = space?.activeTab;
    const anchor = tab?.pane || space?.host || document.getElementById('spaces');
    const card = h('section', 'command-palette');
    card.setAttribute('aria-label', t('Palette de commandes'));
    const head = h('div', 'palette-head');
    const title = h('strong'); title.textContent = t('Palette de commandes');
    const dismiss = h('button', 'icon-btn', '✕'); dismiss.type = 'button'; dismiss.setAttribute('aria-label', t('Fermer'));
    dismiss.addEventListener('click', () => close());
    head.append(title, dismiss);
    const crumbs = h('nav', 'palette-crumbs'); crumbs.setAttribute('aria-label', t('Parcours de commande'));
    const input = h('input', 'palette-input');
    input.setAttribute('role', 'combobox'); input.setAttribute('aria-expanded', 'true');
    input.setAttribute('aria-controls', 'palette-results'); input.setAttribute('aria-autocomplete', 'list');
    input.setAttribute('aria-label', t('Rechercher une commande ou un fichier')); input.autocomplete = 'off'; input.spellcheck = false;
    const options = h('label', 'palette-options'), widen = h('input'); widen.type = 'checkbox';
    const optionLabel = h('span'); optionLabel.textContent = t('Inclure fichiers ignorés et dépendances'); options.append(widen, optionLabel);
    const list = h('div', 'palette-results'); list.id = 'palette-results'; list.setAttribute('role', 'listbox');
    list.setAttribute('aria-label', t('Résultats de recherche'));
    const status = h('div', 'palette-status'); status.setAttribute('role', 'status');
    const footer = h('div', 'palette-footer'); footer.textContent = t('↑↓ Choisir · → Entrée Valider · ← Retour · Échap Fermer');
    card.append(head, crumbs, input, options, list, status, footer);
    const source = { space, tab, screenId: CAI.currentScreen.id };
    state = { card, input, crumbs, options, widen, list, status, source, anchor, focus: document.activeElement,
      steps: [rootStep(source)], generation: 0, rows: [], observer: new ResizeObserver(() => state && position(state)) };
    document.body.appendChild(card);
    state.observer.observe(anchor);
    input.addEventListener('input', () => { current().query = input.value; current().selected = 0; scheduleSearch(); });
    widen.addEventListener('change', () => { current().includeIgnored = widen.checked; scheduleSearch(); });
    card.addEventListener('keydown', onKey, true);
    render(); input.focus(); watch(state);
  }
  function init() {
    document.addEventListener('mousedown', (event) => { if (state && !state.card.contains(event.target)) close(false); }, true);
    document.addEventListener('focusin', (event) => { if (state && !state.card.contains(event.target)) close(false); });
    window.addEventListener('blur', () => close(false));
    window.addEventListener('resize', () => { if (state) position(state); });
    api.onCommandPalette?.(() => toggle());
  }
  window.CommandPalette = { init, toggle, close, get isOpen() { return !!state; } };
})();
