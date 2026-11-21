(function () {
  const { h } = UI;
  function address(value) {
    const text = value.trim();
    if (!text || text === 'about:blank') return 'about:blank';
    const url = new URL(/^[a-z][a-z\d+.-]*:/i.test(text) && !/^localhost:\d/i.test(text) ? text : `https://${text}`);
    if (!['https:', 'http:'].includes(url.protocol)) throw new Error('Utilisez une adresse HTTP ou HTTPS.');
    return url.href;
  }
  const BrowserTab = {
    icon: '🌐', defaultTitle: () => 'Navigateur',
    mount(tab, spec) {
      tab.pane.classList.add('browser-pane');
      tab.url = 'about:blank';
      const bar = h('form', 'tool-bar');
      const input = h('input', 'set-input');
      input.style.cssText = 'flex:1;min-width:0';
      input.placeholder = 'https://… ou http://localhost:3000';
      input.setAttribute('aria-label', 'Adresse web');
      const view = h('webview');
      view.setAttribute('partition', 'persist:browser');
      const slot = h('div');
      slot.style.cssText = 'flex:1;min-height:0';
      const status = h('div', 'set-help');
      status.setAttribute('role', 'status');
      const button = (label, title, action) => {
        const b = h('button', 'icon-btn', label); b.type = 'button'; b.title = title;
        b.setAttribute('aria-label', title); b.addEventListener('click', action); bar.appendChild(b); return b;
      };
      const back = button('←', 'Précédent', () => view.goBack());
      const next = button('→', 'Suivant', () => view.goForward());
      const reload = button('⟳', 'Recharger', () => view.reload());
      back.disabled = next.disabled = reload.disabled = true;
      bar.appendChild(input);
      const go = h('button', 'tb-btn', 'Aller'); go.type = 'submit'; bar.appendChild(go);
      const navigate = (value) => {
        try { tab.url = address(value); input.value = tab.url; status.textContent = ''; view.src = tab.url; CAI.save(); }
        catch (e) { status.textContent = e.message; }
      };
      bar.addEventListener('submit', (e) => { e.preventDefault(); navigate(input.value); });
      view.addEventListener('dom-ready', () => { reload.disabled = false; });
      const changed = () => {
        tab.url = view.getURL(); input.value = tab.url;
        back.disabled = !view.canGoBack(); next.disabled = !view.canGoForward(); CAI.save();
      };
      view.addEventListener('did-navigate', changed);
      view.addEventListener('did-navigate-in-page', changed);
      view.addEventListener('page-title-updated', (e) => CAI.setAutoTitle(tab, e.title || 'Navigateur', tab.url));
      view.addEventListener('did-start-loading', () => { status.textContent = 'Chargement…'; });
      view.addEventListener('did-stop-loading', () => { if (status.textContent === 'Chargement…') status.textContent = ''; });
      view.addEventListener('did-fail-load', (e) => { if (e.isMainFrame && e.errorCode !== -3) status.textContent = `Chargement impossible : ${e.errorDescription}`; });
      tab.pane.append(bar, status, slot);
      // Le webview doit rester connecté : déplacer son parent recrée la page Electron.
      const float = UI.floatWebview(view, slot);
      tab.syncBrowser = float.sync;
      tab.disposeBrowser = float.dispose;
      tab.browser = view; tab.address = input; tab.navigate = navigate;
      navigate(spec.url || 'about:blank');
    },
    activate(tab) { tab.syncBrowser?.(); }, resize(tab) { tab.syncBrowser?.(); }, focus(tab) { tab.address.focus(); },
    dispose(tab) { tab.disposeBrowser(); },
    serialize(tab) { return { url: tab.url }; },

    // Accès à distance (téléphone / tablette) : la page reste affichée sur le PC, le téléphone en voit une capture
    remoteReadActions: ['shot'],
    remoteSnapshot(tab) {
      return { summary: tab.url, actions: [{ id: 'shot', label: '📷 Capture', read: true }, { id: 'reload', label: '⟳ Recharger' }, { id: 'back', label: '← Précédent' }, { id: 'go', label: '↗ Aller à…', prompt: 'Adresse' }], sections: [] };
    },
    async remoteAction(tab, action, { value } = {}) {
      const v = tab.browser;
      if (action === 'shot') {
        tab.syncBrowser?.();
        const img = await v.capturePage();
        if (!img || img.isEmpty?.()) return { error: 'Page non visible sur le PC (onglet en arrière-plan ?)' };
        let url;
        try {
          const small = img.getSize().width > 1280 ? img.resize({ width: 1280 }) : img;
          url = 'data:image/jpeg;base64,' + small.toJPEG(75).toString('base64');
        } catch { url = img.toDataURL(); }
        return { image: url, title: tab.title };
      }
      if (action === 'reload') { v.reload(); return {}; }
      if (action === 'back') { if (v.canGoBack()) v.goBack(); return {}; }
      if (action === 'go') { if (!value) return { error: 'Adresse vide' }; tab.navigate(String(value)); return {}; }
      return { error: 'Action inconnue' };
    },
  };
  (window.TabKinds = window.TabKinds || {}).browser = BrowserTab;
})();
