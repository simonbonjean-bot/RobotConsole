(function () {
  const { h, esc } = UI;
  const states = { ok: 'Disponible', stale: 'Observation ancienne', unavailable: 'Indisponible', error: 'Erreur' };
  const timestamp = (value) => value ? new Date(value).toLocaleString() : 'Jamais';

  function quotaText(q) {
    if (q.unlimited) return 'Illimité';
    const values = q.used != null && q.limit != null ? `${q.used} / ${q.limit} ${q.unit || ''}` : null;
    const percentage = q.usedPercent == null ? null : `${Math.round(q.usedPercent * 10) / 10} % consommé`;
    return [values, percentage].filter(Boolean).join(' · ') || 'Consommation non communiquée';
  }

  async function refresh(tab, force = false) {
    const s = tab.s;
    if (s.loading || s.disposed) return;
    s.loading = true;
    s.refresh.disabled = true;
    s.summary.textContent = 'Actualisation…';
    try {
      const providers = await window.api.subscriptionsRead(force);
      if (s.disposed) return;
      s.providers = providers;
      render(tab);
      s.summary.textContent = `${providers.filter((p) => p.status === 'ok').length} / ${providers.length} disponibles`;
      tab.onUsage?.(providers);
      return true;
    } catch (e) {
      if (!s.disposed) {
        s.summary.textContent = 'Actualisation impossible';
        tab.onUsage?.(null);
        UI.toast(e.message, { kind: 'error' });
      }
      return false;
    } finally {
      s.loading = false;
      if (!s.disposed) s.refresh.disabled = false;
    }
  }

  function render(tab) {
    const s = tab.s;
    s.list.replaceChildren();
    for (const provider of s.providers) {
      const card = h('section', 'subscription-card');
      card.dataset.provider = provider.id;
      const header = h('div', 'subscription-header');
      header.append(h('b', '', esc(provider.name)), h('span', `subscription-state state-${provider.status}`, esc(states[provider.status] || provider.status)));
      card.append(header);
      if (provider.plan) card.append(h('div', 'muted', `Abonnement : ${esc(provider.plan)}`));
      if (provider.message) card.append(h('p', 'subscription-message', esc(provider.message)));
      for (const q of provider.quotas) {
        const row = h('div', 'subscription-quota');
        row.append(h('b', '', esc(q.label)), h('div', '', esc(quotaText(q))));
        if (!q.unlimited && q.usedPercent != null) {
          const progress = h('progress', q.usedPercent >= 90 ? 'quota-warning' : '');
          progress.max = 100;
          progress.value = q.usedPercent;
          progress.setAttribute('aria-label', q.label);
          row.append(progress);
        }
        if (q.resetAt) row.append(h('div', 'muted', `Réinitialisation : ${esc(timestamp(q.resetAt))}`));
        if (q.overage > 0) row.append(h('div', 'quota-warning', `Dépassement : ${esc(q.overage)} ${esc(q.unit || '')}`));
        card.append(row);
      }
      card.append(h('div', 'muted subscription-meta', `Source : ${esc(provider.source)}<br>Dernière lecture : ${esc(timestamp(provider.updatedAt))}`));
      if (provider.id === 'claude') {
        const actions = h('div', 'empty-actions');
        const install = h('button', 'tb-btn small', 'Activer le connecteur Claude');
        install.addEventListener('click', async () => {
          if (!(await UI.confirm('Activer le connecteur Claude ?', 'Ajoute une ligne de statut dans les réglages utilisateur Claude, avec sauvegarde des réglages existants. Une ligne de statut déjà configurée ne sera pas remplacée. Seuls les quotas seront enregistrés localement.', { ok: 'Activer' }))) return;
          install.disabled = true;
          try {
            const result = await window.api.subscriptionsClaudeInstall();
            UI.toast(result.message, { ms: 6000 });
            await refresh(tab, true);
          } catch (e) { UI.toast(e.message, { kind: 'error', ms: 8000 }); }
          finally { install.disabled = false; }
        });
        const copy = h('button', 'tb-btn small', 'Copier la commande du connecteur');
        copy.addEventListener('click', () => { window.api.writeClipboard(provider.command); UI.toast('Commande copiée. Votre script de statut peut l’appeler avec le même JSON sur stdin.'); });
        actions.append(install, copy);
        card.append(actions);
      }
      s.list.append(card);
    }
  }

  const ModelUsage = {
    mount(tab) {
      const s = tab.s = { providers: [], disposed: false, loading: false };
      tab.pane.classList.add('tool-pane', 'subscriptions-pane');
      const bar = h('div', 'tool-bar');
      s.summary = h('span', 'muted');
      s.refresh = h('button', 'tb-btn small', 'Actualiser');
      s.refresh.addEventListener('click', () => refresh(tab, true));
      bar.append(h('span', 'tool-badge', 'Usage des modèles'), s.summary, h('div', 'tb-spacer'), s.refresh);
      const note = h('div', 'subscription-note muted', 'Quotas des abonnements, distincts des coûts API. Une donnée indisponible ne signifie pas un quota épuisé. Actualisation automatique toutes les 5 minutes.');
      s.list = h('div', 'subscriptions-list');
      tab.pane.append(bar, note, s.list);
      refresh(tab);
    },
    refresh,
    activate(tab) { return refresh(tab); },
    focus(tab) { tab.s.refresh.focus(); },
    resize() {},
    dispose(tab) { tab.s.disposed = true; },
    serialize() { return {}; },
    remoteSnapshot(tab) {
      return {
        summary: 'Quotas des abonnements IA',
        actions: [{ id: 'refresh', label: 'Actualiser' }],
        sections: tab.s.providers.map((p) => ({
          title: p.name,
          items: [{ id: p.id, label: p.name, badge: states[p.status], status: p.status === 'ok' ? 'ok' : p.status === 'error' ? 'bad' : 'warn',
            detail: p.message || '', meta: `Dernière lecture : ${timestamp(p.updatedAt)}` },
          ...p.quotas.map((q) => ({ id: q.id, label: q.label, detail: quotaText(q), meta: q.resetAt ? `Réinitialisation : ${timestamp(q.resetAt)}` : '' }))],
        })),
      };
    },
    async remoteAction(tab, action) {
      if (action !== 'refresh') return { error: 'Action inconnue' };
      if (!(await refresh(tab, true))) return { error: 'Actualisation impossible ou déjà en cours' };
      return { toast: 'Lecture des quotas terminée' };
    },
  };
  window.ModelUsage = ModelUsage;
})();
