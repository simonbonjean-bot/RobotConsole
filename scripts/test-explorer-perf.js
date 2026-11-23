const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const mainRequire = require('node:module').createRequire(path.join(__dirname, '..', 'main', 'fs-git.js'));

const source = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const tick = () => new Promise((resolve) => setImmediate(resolve));
function deferred() {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
}

test('Git status is shared across concurrent callers and repository subdirectories, then refreshed', async () => {
  const handlers = new Map();
  let roots = 0, statuses = 0, fail = false;
  const repo = path.resolve('fixture-repo');
  const context = {
    module: { exports: {} }, console, setTimeout, clearTimeout,
    require(name) {
      if (name === 'electron') return { ipcMain: { handle: (key, fn) => handlers.set(key, fn), on() {} } };
      if (name === 'child_process') return { execFile(_file, args, _opts, done) {
        if (args[0] === 'rev-parse') { roots++; setImmediate(() => done(null, repo + '\n')); }
        else { statuses++; setImmediate(() => done(fail ? new Error('failed') : null, '## perfs\0 M file.js\0')); }
      } };
      return mainRequire(name);
    },
  };
  vm.runInNewContext(source('main/fs-git.js'), context);
  context.module.exports.register();
  const status = (dir) => handlers.get('git:status')(null, dir);
  const [a, b, c] = await Promise.all([status(repo), status(repo), status(path.join(repo, 'child'))]);
  assert.equal(roots, 2);
  assert.equal(statuses, 1);
  assert.equal(a, b);
  assert.equal(a, c);
  assert.equal(a.files[path.join(repo, 'file.js')].code, 'M');
  await status(repo);
  assert.equal(statuses, 2, 'Completed results must not mask later filesystem changes');
  fail = true;
  assert.equal((await status(repo)).isRepo, false);
  fail = false;
  assert.equal((await status(repo)).isRepo, true, 'A failure must not leave a stuck pending request');
});

function node() {
  return {
    innerHTML: '', textContent: '', scrollTop: 0, commits: 0,
    classList: { toggle() {}, add() {}, remove() {} },
    appendChild() { this.commits++; },
    querySelector() { return { textContent: '' }; },
  };
}
function explorer() {
  let onChange;
  const calls = { git: 0, list: 0, active: 0, maxActive: 0 };
  let gate = null;
  const api = {
    async gitStatus() {
      calls.git++; calls.active++; calls.maxActive = Math.max(calls.maxActive, calls.active);
      const waiting = gate; gate = null;
      try { if (waiting) await waiting.promise; return { isRepo: false }; }
      finally { calls.active--; }
    },
    async listDir() { calls.list++; return []; },
    onFsChanged(cb) { onChange = cb; },
    unwatch() {},
  };
  const window = { api };
  const context = {
    window, console,
    Platform: require('../shared/platform')(process.platform),
    Settings: { data: {} },
    CAI: { h: node, talk() {}, markUnread() {}, say() {} },
    document: { createDocumentFragment: node },
  };
  vm.runInNewContext(source('renderer/explorer-tab.js').replace(
    '  (window.TabKinds = window.TabKinds || {}).explorer = Explorer;',
    '  window.testing = { refresh, byWatchId, Explorer };'), context);
  const tab = {
    id: 't1', pane: { offsetParent: {} }, space: {},
    ex: {
      root: '/repo', cache: new Map(), expanded: new Set(['/repo']), view: 'tree',
      tree: node(), branch: node(), btnTree: node(), btnChanges: node(),
    },
  };
  window.testing.byWatchId.set(tab.id, tab);
  return { ...window.testing, tab, calls, api, onChange: () => onChange(tab.id), block: () => (gate = deferred()) };
}

test('A notification burst causes one follow-up refresh and no parallel work', async () => {
  const h = explorer();
  const gate = h.block();
  const refreshing = h.refresh(h.tab, true);
  for (let i = 0; i < 50; i++) h.onChange();
  assert.equal(h.calls.git, 1);
  gate.resolve();
  await refreshing;
  assert.equal(h.calls.git, 2);
  assert.equal(h.calls.maxActive, 1);
  assert.equal(h.tab.ex.tree.commits, 2);
  assert.equal(h.tab.ex.refreshing, null);
});

test('Hidden tabs defer Git, folder reads and DOM work until activation', async () => {
  const h = explorer();
  h.tab.pane.offsetParent = null;
  for (let i = 0; i < 50; i++) h.onChange();
  await tick();
  assert.equal(h.calls.git, 0);
  assert.equal(h.calls.list, 0);
  assert.equal(h.tab.ex.tree.commits, 0);
  h.tab.pane.offsetParent = {};
  h.Explorer.activate(h.tab);
  await h.tab.ex.refreshing;
  assert.equal(h.calls.git, 1);
  assert.equal(h.calls.list, 1);
  assert.equal(h.tab.ex.tree.commits, 1);
});

test('Layout resize also resumes a dirty tab from another screen or parked space', async () => {
  const h = explorer();
  h.tab.pane.offsetParent = null;
  h.onChange();
  h.tab.pane.offsetParent = {};
  h.Explorer.resize(h.tab);
  await h.tab.ex.refreshing;
  assert.equal(h.tab.ex.tree.commits, 1);
});

test('A tab hidden during Git loading does not render and catches up when shown', async () => {
  const h = explorer();
  const gate = h.block();
  const refreshing = h.refresh(h.tab, true);
  h.tab.pane.offsetParent = null;
  gate.resolve();
  await refreshing;
  assert.equal(h.tab.ex.tree.commits, 0);
  h.tab.pane.offsetParent = {};
  h.Explorer.activate(h.tab);
  await h.tab.ex.refreshing;
  assert.equal(h.tab.ex.tree.commits, 1);
});

test('A root change during loading discards the old result and refreshes the new root', async () => {
  const h = explorer();
  const gate = h.block();
  const refreshing = h.refresh(h.tab, true);
  h.tab.ex.root = '/other';
  h.tab.ex.expanded = new Set(['/other']);
  h.refresh(h.tab, true);
  gate.resolve();
  await refreshing;
  assert.equal(h.calls.git, 2);
  assert.equal(h.tab.ex.tree.commits, 1);
});

test('Closing during a refresh prevents its pending DOM update', async () => {
  const h = explorer();
  const gate = h.block();
  const refreshing = h.refresh(h.tab, true);
  h.Explorer.dispose(h.tab);
  gate.resolve();
  await refreshing;
  assert.equal(h.tab.ex.tree.commits, 0);
  assert.equal(h.calls.git, 1);
});

test('Remote viewing refreshes hidden Git data without rebuilding the desktop tree', async () => {
  const h = explorer();
  h.tab.pane.offsetParent = null;
  h.onChange();
  const snapshot = await h.Explorer.remoteSnapshot(h.tab);
  assert.equal(snapshot.sections.length, 1);
  assert.equal(h.calls.git, 1);
  assert.equal(h.tab.ex.tree.commits, 0);
  assert.equal(h.tab.ex.refreshNeeded, true, 'Desktop still needs to catch up on activation');
});
