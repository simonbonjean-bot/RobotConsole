(function () {
  const { h, esc } = UI;
  let bar, panel, sessionsButton, usageButton, sessionsPane, usagePane, list, summary, refreshButton;
  let active = null, sessions = [], pendingRead = null, disposed = false, usageTab;
  const timers = [];
  const stopping = new Set();
  const text = (tag, cls, value) => { const el = h(tag, cls); el.textContent = value; return el; };
  const localTabs = (id) => CAI.spaces.flatMap((space) => space.tabs).filter((tab) => (tab.ptyId || tab.spec?.sessionId) === id);

  function close(focus = false) {
    const button = active === 'sessions' ? sessionsButton : usageButton;
    active = null;
    panel.hidden = true;
    sessionsButton.setAttribute('aria-expanded', 'false');
    usageButton.setAttribute('aria-expanded', 'false');
    if (focus) button.focus();
  }

  function renderSessions() {
    list.replaceChildren();
    if (!sessions.length) { list.append(text('p', 'muted', 'Aucune session persistante.')); return; }
    for (const session of sessions) {
      const tabs = localTabs(session.id);
      const card = h('section', 'session-row');
      card.dataset.session = session.id;
      const details = h('div', 'session-details');
      const name = tabs.map((tab) => `${tab.space.name} · ${tab.title}`).join(', ') || session.shellId || session.id;
      const title = text('b', '', name);
      title.dataset.noI18n = '';
      details.append(title);
      const state = session.alive ? 'Active' : 'Terminée';
      details.append(text('span', 'session-state', state));
      const association = tabs.length ? 'Liée à cette fenêtre' :
        session.attachedWindows ? 'Liée à une autre fenêtre' : 'En arrière-plan';
      details.append(text('div', 'muted', association));
      const meta = text('div', 'muted session-meta',
        `${session.id} · PID ${session.pid ?? '—'} · ${new Date(session.started).toLocaleString()} · ${UI.fmtDuration((session.ended || Date.now()) - session.started)}`);
      meta.dataset.noI18n = '';
      details.append(meta);
      const scope = text('div', 'muted session-meta', session.cwd || session.scope || 'Global');
      scope.dataset.noI18n = '';
      details.append(scope);
      const actions = h('div', 'session-actions');
      if (tabs.length) {
        const reveal = text('button', 'tb-btn small', 'Afficher');
        reveal.addEventListener('click', () => { close(); CAI.revealTerminal(tabs[0]); });
        actions.append(reveal);
      }
      const stop = text('button', 'tb-btn small danger-btn', session.alive ? 'Arrêter' : 'Retirer');
      stop.disabled = stopping.has(session.id);
      stop.addEventListener('click', async () => {
        const question = session.alive
          ? 'Le shell et ses programmes seront arrêtés. Les onglets liés, y compris dans les autres fenêtres, seront affectés. Cette action est irréversible.'
          : 'Supprimer cette session terminée de la liste et libérer son historique conservé ?';
        if (!(await UI.confirm(session.alive ? 'Arrêter cette session ?' : 'Retirer cette session ?', `<b>${esc(name)}</b><br>${esc(question)}`, { ok: session.alive ? 'Arrêter' : 'Retirer', danger: true }))) return;
        if (stopping.has(session.id)) return;
        stopping.add(session.id);
        stop.disabled = true;
        try {
          await window.api.terminatePtySession(session.id);
          await refreshSessions(true);
        } catch (error) { UI.toast(error.message, { kind: 'error' }); }
        finally {
          stopping.delete(session.id);
          if (!disposed) stop.disabled = false;
        }
      });
      actions.append(stop);
      card.append(details, actions);
      list.append(card);
    }
  }

  function refreshSessions(report = false) {
    if (disposed) return Promise.resolve();
    if (pendingRead) return report ? pendingRead.then(() => refreshSessions(true)) : pendingRead;
    pendingRead = readSessions(report).finally(() => { pendingRead = null; });
    return pendingRead;
  }

  async function readSessions(report) {
    refreshButton.disabled = true;
    try {
      const result = await window.api.listPtySessions();
      if (disposed) return;
      sessions = result;
      const count = sessions.filter((session) => session.alive).length;
      sessionsButton.textContent = I18n.t('Sessions : {0}', count);
      summary.textContent = I18n.t('{0} actives · {1} terminées', count, sessions.length - count);
      sessionsButton.classList.remove('status-warning');
      if (active === 'sessions') renderSessions();
    } catch (error) {
      if (disposed) return;
      summary.textContent = 'Lecture des sessions impossible';
      sessionsButton.textContent = 'Sessions : erreur';
      sessionsButton.classList.add('status-warning');
      if (active === 'sessions') list.replaceChildren(text('p', 'muted', error.message));
      if (report) UI.toast(error.message, { kind: 'error' });
    } finally {
      if (!disposed) refreshButton.disabled = false;
    }
  }

  function updateUsage(providers) {
    usageButton.replaceChildren(text('span', '', 'Usage des modèles'));
    usageButton.classList.toggle('status-warning', !providers || providers.some((p) => p.status !== 'ok'));
    if (!providers) { usageButton.append(text('span', '', 'Erreur')); return; }
    for (const provider of providers) {
      const known = provider.quotas.filter((q) => !q.unlimited && q.usedPercent != null);
      const value = provider.status !== 'ok' ? (provider.status === 'stale' ? 'Observation ancienne' : 'Indisponible') :
        known.length ? `${Math.round(Math.max(...known.map((q) => q.usedPercent)))} %` :
          provider.quotas.some((q) => q.unlimited) ? 'Illimité' : 'Consommation non communiquée';
      const item = h('span', 'status-provider');
      item.append(text('b', '', provider.name), document.createTextNode(' '), text('span', '', value));
      item.title = I18n.t('{0} : quota le plus consommé ; cliquer pour les détails', provider.name);
      item.classList.toggle('status-warning', known.some((q) => q.usedPercent >= 90) || provider.status !== 'ok');
      usageButton.append(item);
    }
  }

  function open(which) {
    if (!bar || disposed) return;
    active = which;
    panel.hidden = false;
    sessionsPane.hidden = which !== 'sessions';
    usagePane.hidden = which !== 'usage';
    sessionsButton.setAttribute('aria-expanded', String(which === 'sessions'));
    usageButton.setAttribute('aria-expanded', String(which === 'usage'));
    panel.setAttribute('aria-label', which === 'sessions' ? 'Sessions persistantes' : 'Usage des modèles');
    if (which === 'sessions') { renderSessions(); refreshSessions(true); }
    else ModelUsage.activate(usageTab);
    panel.querySelector('button').focus();
  }

  function mount() {
    bar = document.getElementById('status-bar');
    panel = document.getElementById('status-panel');
    sessionsButton = document.getElementById('status-sessions');
    usageButton = document.getElementById('status-usage');
    sessionsPane = h('div', 'status-sessions-pane');
    usagePane = h('div', 'status-usage-pane');
    usagePane.hidden = true;
    const header = h('div', 'tool-bar');
    summary = text('span', 'muted', 'Actualisation…');
    refreshButton = text('button', 'tb-btn small', 'Actualiser');
    refreshButton.addEventListener('click', () => refreshSessions(true));
    const dismiss = text('button', 'tb-btn small status-dismiss', 'Fermer');
    dismiss.addEventListener('click', () => close(true));
    header.append(text('b', '', 'Sessions persistantes'), summary, h('div', 'tb-spacer'), refreshButton);
    const note = text('p', 'subscription-note muted', 'Toutes les sessions de RobotConsole, y compris les autres workspaces et les services. Fermer la fenêtre ne les arrête pas.');
    list = h('div', 'sessions-list');
    sessionsPane.append(header, note, list);
    panel.append(dismiss, sessionsPane, usagePane);
    for (const [button, which] of [[sessionsButton, 'sessions'], [usageButton, 'usage']]) {
      button.addEventListener('click', () => active === which ? close(true) : open(which));
    }
    panel.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') { event.preventDefault(); close(true); }
      event.stopPropagation();
    });
    document.addEventListener('mousedown', outside);
    usageTab = { pane: usagePane, onUsage: updateUsage };
    ModelUsage.mount(usageTab);
    refreshSessions();
    timers.push(setInterval(() => { if (!document.hidden) refreshSessions(); }, 30000));
    timers.push(setInterval(() => { if (!document.hidden) ModelUsage.refresh(usageTab, true); }, 5 * 60000));
    window.addEventListener('beforeunload', dispose, { once: true });
  }

  function outside(event) {
    if (active && !panel.contains(event.target) && !bar.contains(event.target) && !event.target.closest('.dlg-overlay')) close();
  }

  function dispose() {
    disposed = true;
    timers.forEach(clearInterval);
    document.removeEventListener('mousedown', outside);
    if (usageTab) ModelUsage.dispose(usageTab);
  }

  window.StatusBar = { mount, open, dispose };
})();
