const fs = require('node:fs');
const { randomUUID } = require('node:crypto');
const { StateStore } = require('./state-store');
const PromptText = require('../shared/prompt');

class PromptStore {
  constructor(file) {
    this.file = file;
    this.disk = new StateStore();
    this.pending = Promise.resolve();
  }

  run(action, save = false) {
    const task = this.pending.then(async () => {
      let data;
      try { data = JSON.parse(await fs.promises.readFile(this.file, 'utf8')); }
      catch (error) {
        if (error.code !== 'ENOENT') throw error;
        data = { version: 1, history: [], favorites: [] };
      }
      if (data.version !== 1 || !Array.isArray(data.history) || !Array.isArray(data.favorites)) throw new Error('Historique des prompts invalide');
      if (data.drafts === undefined) data.drafts = [];
      if (!Array.isArray(data.drafts)) throw new Error('Brouillons des prompts invalides');
      const result = action(data);
      if (save) await this.disk.atomicWrite(this.file, JSON.stringify(data, null, 2));
      return result;
    });
    // Une erreur est transmise à l'appelant, sans bloquer les opérations suivantes.
    this.pending = task.then(() => {}, () => {});
    return task;
  }

  list() { return this.run((data) => data); }

  saveDraft(id, draft, workspace) {
    if (typeof id !== 'string' || !/^[\w-]{1,80}$/.test(id)) throw new Error('Brouillon invalide');
    const empty = draft?.text === '' && Array.isArray(draft.documents) && !draft.documents.length;
    const value = PromptText.validate(draft, { allowEmpty: true });
    return this.run((data) => {
      const previous = data.drafts.find((entry) => entry.id === id);
      data.drafts = data.drafts.filter((entry) => entry.id !== id);
      if (empty) return;
      if (data.drafts.length >= 200) throw new Error('Maximum 200 brouillons ; supprimez un brouillon');
      const entry = { ...value, id, workspace: workspace || null, created: previous?.created || Date.now(), updated: Date.now() };
      data.drafts.unshift(entry);
      return entry;
    }, true);
  }

  add(kind, draft, workspace) {
    if (!['history', 'favorites'].includes(kind)) throw new Error('Liste de prompts invalide');
    const value = PromptText.validate(draft);
    const title = typeof draft.title === 'string' ? draft.title.trim().slice(0, 120) : '';
    return this.run((data) => {
      const entry = { ...value, title, id: randomUUID(), workspace: workspace || null, created: Date.now() };
      if (kind === 'favorites' && data.favorites.length >= 200) throw new Error('Maximum 200 favoris ; supprimez un favori avant d’en ajouter un');
      if (kind === 'history') {
        const fingerprint = JSON.stringify(value);
        data.history = data.history.filter((item) => item.workspace !== entry.workspace ||
          JSON.stringify({ text: item.text, documents: item.documents }) !== fingerprint);
      }
      data[kind].unshift(entry);
      if (kind === 'history') data.history = data.history.slice(0, 100);
      return entry;
    }, true);
  }

  remove(kind, id) {
    if (!['history', 'favorites', 'drafts'].includes(kind) || typeof id !== 'string') throw new Error('Prompt invalide');
    return this.run((data) => { data[kind] = data[kind].filter((entry) => entry.id !== id); }, true);
  }

  clearHistory(workspace, all = false) {
    return this.run((data) => {
      data.history = all ? [] : data.history.filter((entry) => entry.workspace !== (workspace || null));
    }, true);
  }
}

module.exports = { PromptStore };
