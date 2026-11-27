const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const PromptText = require('../shared/prompt');
const { PromptStore } = require('../main/prompt-store');

test('prompt injection uses bracketed paste and validates only when requested', () => {
  assert.equal(PromptText.wire('Première ligne\r\nDeuxième ligne', { bracketed: true, submit: true }),
    '\x1b[200~Première ligne\nDeuxième ligne\x1b[201~\r');
  assert.equal(PromptText.wire('Un\n\nDeux\n', { bracketed: true, submit: false }), '\x1b[200~Un\n\nDeux\n\x1b[201~');
  assert.equal(PromptText.wire('Un\nDeux', { bracketed: false, submit: false }), 'Un\rDeux');
  assert.equal(PromptText.wire('Texte', { bracketed: true, submit: false }), '\x1b[200~Texte\x1b[201~');
  assert.equal(PromptText.wire('Texte', { bracketed: false, submit: true }), 'Texte\r');
  for (const text of ['\x1b[201~danger', 'texte\x03', '\0', 'x'.repeat(PromptText.MAX_SEND + 1)]) {
    assert.throws(() => PromptText.wire(text, { bracketed: true, submit: true }));
  }
  assert.throws(() => PromptText.wire('é'.repeat(PromptText.MAX_SEND / 2 + 1), { bracketed: true, submit: true }));
  assert.throws(() => PromptText.validate({ text: 'é'.repeat(PromptText.MAX_TEXT / 2 + 1), documents: [] }));
});

test('drafts migrate the existing library, survive restart, update in place and remove empty drafts', async (t) => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'robotconsole-drafts-'));
  t.after(() => fs.rm(temp, { recursive: true, force: true }));
  const file = path.join(temp, 'prompts.json');
  await fs.writeFile(file, JSON.stringify({ version: 1, history: [], favorites: [] }));
  const store = new PromptStore(file);
  const draft = { text: 'Première ligne\n\nDeuxième ligne', documents: [{ path: 'C:\\notes.md', mode: 'content' }] };
  await Promise.all([store.saveDraft('a', draft, 'workspace-a'), store.saveDraft('b', draft, 'workspace-b')]);
  const reloaded = new PromptStore(file);
  assert.equal((await reloaded.list()).drafts.length, 2);
  await reloaded.saveDraft('a', { ...draft, text: 'Version modifiée' }, 'workspace-a');
  const entries = (await reloaded.list()).drafts;
  assert.equal(entries.length, 2);
  assert.equal(entries[0].text, 'Version modifiée');
  assert.deepEqual(entries[0].documents, draft.documents);
  await reloaded.saveDraft('a', { text: '', documents: [] }, 'workspace-a');
  assert.deepEqual((await reloaded.list()).drafts.map((entry) => entry.id), ['b']);
  await reloaded.remove('drafts', 'b');
  assert.deepEqual((await reloaded.list()).drafts, []);
  await reloaded.saveDraft('blank', { text: '\n\n  ', documents: [] }, 'workspace-a');
  assert.equal((await reloaded.list()).drafts[0].text, '\n\n  ');
  assert.throws(() => reloaded.saveDraft('invalid', { text: '', documents: [null] }, 'workspace-a'));
  await assert.rejects(async () => reloaded.saveDraft('', draft, 'workspace-a'), /invalide/);
});

test('AI configuration encrypts keys, keeps them out of settings responses and refuses insecure storage', async (t) => {
  const { PromptAssistant } = require('../main/prompt-assistant');
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'robotconsole-assistant-'));
  t.after(() => fs.rm(temp, { recursive: true, force: true }));
  const file = path.join(temp, 'assistant.json');
  const safeStorage = {
    isEncryptionAvailable: () => true, getSelectedStorageBackend: () => 'test',
    encryptString: (text) => Buffer.from(text.split('').reverse().join('')),
    decryptString: (data) => data.toString().split('').reverse().join(''),
  };
  const assistant = new PromptAssistant({ file, safeStorage });
  const config = await assistant.settings();
  await assistant.save({ ...config, provider: 'api', model: 'test-model', apiKey: 'sk-ant-test-key' });
  const saved = await assistant.settings();
  assert.equal(saved.hasKey, true);
  assert.equal(saved.apiKey, undefined);
  assert.equal(saved.encryptedKey, undefined);
  assert.equal((await fs.readFile(file, 'utf8')).includes('sk-ant-test-key'), false);
  await assistant.save({ ...saved, model: 'updated-model' });
  assert.equal((await assistant.settings()).hasKey, true);
  safeStorage.getSelectedStorageBackend = () => 'basic_text';
  await assert.rejects(assistant.save({ ...saved, apiKey: 'sk-ant-other-key' }), /stockage sécurisé/);
  await assistant.save({ ...saved, removeKey: true });
  assert.equal((await assistant.settings()).hasKey, false);
});

test('AI uses stdin and no tools for CLI, or authenticated API calls, and surfaces failures', async (t) => {
  const { PromptAssistant } = require('../main/prompt-assistant');
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'robotconsole-assistant-call-'));
  t.after(() => fs.rm(temp, { recursive: true, force: true }));
  const safeStorage = { isEncryptionAvailable: () => true, encryptString: (text) => Buffer.from(text), decryptString: (data) => data.toString() };
  let calls = 0;
  const assistant = new PromptAssistant({
    file: path.join(temp, 'assistant.json'), safeStorage,
    command: async () => ({ file: 'fake-claude', args: [] }),
    execute: async (_command, args, text, cwd) => {
      calls++;
      assert.equal(args[args.indexOf('--tools') + 1], '');
      assert.ok(args.includes('--no-session-persistence'));
      assert.ok(args.includes('--strict-mcp-config'));
      assert.equal(args.includes(text), false);
      assert.equal(cwd, path.join(temp, 'prompt-assistant'));
      return 'Prompt amélioré\n\nAvec ses contraintes';
    },
    request: async (url, options) => {
      calls++;
      assert.equal(url, 'https://api.anthropic.com/v1/messages');
      assert.equal(options.headers['x-api-key'], 'sk-ant-test-key');
      assert.equal(options.redirect, 'error');
      assert.equal(JSON.parse(options.body).messages[0].content, 'Un prompt\nà améliorer');
      return { ok: true, text: async () => JSON.stringify({ content: [{ type: 'text', text: 'Proposition\nstructurée' }] }) };
    },
  });
  assert.equal(await assistant.improve('Texte avec "quotes" & commandes'), 'Prompt amélioré\n\nAvec ses contraintes');
  assert.equal(calls, 1);
  const config = await assistant.settings();
  await assistant.save({ ...config, provider: 'api', model: 'test-model', apiKey: 'sk-ant-test-key' });
  assert.equal(await assistant.improve('Un prompt\nà améliorer'), 'Proposition\nstructurée');
  assert.equal(calls, 2);
  assistant.request = async () => ({ ok: false, status: 401 });
  await assert.rejects(assistant.improve('Texte'), /HTTP 401/);
  assistant.request = async () => ({ ok: true, text: async () => JSON.stringify({ stop_reason: 'max_tokens', content: [] }) });
  await assert.rejects(assistant.improve('Texte'), /tronquée/);
  assistant.request = async () => { throw new Error('Réseau indisponible'); };
  await assert.rejects(assistant.improve('Texte'), /Réseau/);
});

test('document paths remain exact and content is included only on request', async () => {
  const document = 'C:\\Projet avec espaces\\notes.md';
  const draft = { text: 'Analyse.', documents: [{ path: document, mode: 'path' }] };
  const reference = await PromptText.build(draft, () => { throw new Error('Must not read a reference'); });
  assert.ok(reference.endsWith(document));
  draft.documents[0].mode = 'content';
  const included = await PromptText.build(draft, async (file) => {
    assert.equal(file, document);
    return 'Contenu du document\r\nà analyser';
  });
  assert.ok(included.includes('Contenu du document\nà analyser'));
  await assert.rejects(PromptText.build(draft, async () => { throw new Error('Fichier inaccessible'); }), /inaccessible/);
  await assert.rejects(PromptText.build(draft, async () => '\x1b[201~'), /contrôle/);
  await assert.rejects(PromptText.build(draft, async () => 'x'.repeat(PromptText.MAX_SEND)), /trop long/);
  assert.throws(() => PromptText.validate({ text: '', documents: [] }), /Rédigez/);
  assert.throws(() => PromptText.validate({ text: 'texte', documents: [{ path: 'file\ncommand', mode: 'path' }] }), /invalide/);
});

test('local slash commands only match standalone tokens at the caret', () => {
  assert.deepEqual(PromptText.commandAt('Analyse /fich', 13), { start: 8, end: 13, query: 'fich' });
  assert.deepEqual(PromptText.commandAt('/favoris', 8), { start: 0, end: 8, query: 'favoris' });
  assert.equal(PromptText.commandAt('https://', 8), null);
  assert.equal(PromptText.commandAt('src/file', 8), null);
  assert.equal(PromptText.commandAt('/fichier', 8, 0), null);
});

test('prompt history and favorites persist concurrent changes, scope deletion and recover after read errors', async (t) => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'robotconsole-prompts-'));
  t.after(() => fs.rm(temp, { recursive: true, force: true }));
  const file = path.join(temp, 'prompts.json');
  const store = new PromptStore(file);
  const draft = { text: 'Analyse les changements', documents: [{ path: 'C:\\projet\\notes.md', mode: 'path' }] };
  await Promise.all([
    store.add('favorites', { ...draft, title: 'Analyse' }, 'workspace-a'),
    store.add('favorites', { ...draft, title: 'Revue' }, 'workspace-b'),
    store.add('history', draft, 'workspace-a'),
    store.add('history', draft, 'workspace-b'),
    store.add('history', draft, 'workspace-a'),
  ]);
  const reloaded = new PromptStore(file);
  const saved = await reloaded.list();
  assert.equal(saved.favorites.length, 2);
  assert.equal(saved.history.length, 2);
  assert.deepEqual(saved.history[0].documents, draft.documents);
  await reloaded.clearHistory('workspace-a');
  assert.deepEqual((await reloaded.list()).history.map((entry) => entry.workspace), ['workspace-b']);
  await reloaded.remove('favorites', saved.favorites[0].id);
  assert.equal((await reloaded.list()).favorites.length, 1);
  await fs.writeFile(file, '{bad json');
  await assert.rejects(reloaded.list());
  await fs.writeFile(file, JSON.stringify(saved));
  assert.equal((await reloaded.list()).favorites.length, 2);
  await reloaded.clearHistory(null, true);
  assert.equal((await reloaded.list()).history.length, 0);
  const bounded = {
    version: 1,
    history: Array.from({ length: 100 }, (_, i) => ({ ...draft, id: 'history-' + i, text: 'Prompt ' + i, workspace: 'workspace-a' })),
    favorites: Array.from({ length: 200 }, (_, i) => ({ ...draft, id: 'favorite-' + i, title: 'Favorite ' + i })),
  };
  await fs.writeFile(file, JSON.stringify(bounded));
  await reloaded.add('history', draft, 'workspace-a');
  const rotated = await reloaded.list();
  assert.equal(rotated.history.length, 100);
  assert.equal(rotated.history.at(-1).id, 'history-98');
  await assert.rejects(reloaded.add('favorites', draft, 'workspace-a'), /Maximum 200/);
  assert.equal((await reloaded.list()).favorites.length, 200);
});
