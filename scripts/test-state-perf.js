const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { StateStore } = require('../main/state-store');

const tick = () => new Promise((resolve) => setImmediate(resolve));
function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function memoryStore() {
  const files = new Map(), commits = [], errors = [];
  let gate = null, failure = null;
  const store = new StateStore({
    onError: (error) => errors.push(error),
    io: {
      async mkdir() {},
      async writeFile(file, text) {
        const waiting = gate; gate = null;
        if (waiting) await waiting.promise;
        files.set(file, text);
      },
      async rename(from, to) {
        if (failure) { const error = failure; failure = null; throw error; }
        files.set(to, files.get(from)); files.delete(from);
        commits.push([to, JSON.parse(files.get(to))]);
      },
      async readFile(file) {
        if (!files.has(file)) throw new Error('Missing file');
        return files.get(file);
      },
      async rm(file) { files.delete(file); },
    },
  });
  return {
    store, files, commits, errors,
    block() { return gate = deferred(); },
    fail() { failure = new Error('rename failed'); },
  };
}

if (process.versions.electron) {
  runElectron().catch((error) => {
    console.error(error);
    require('electron').app.exit(1);
  });
} else {
  const { test } = require('node:test');

  test('saves serialize per file, coalesce pending snapshots and capture values at submission', async () => {
    const h = memoryStore(), gate = h.block();
    const first = h.store.save('state.json', { n: 0 });
    const snapshot = { n: 1 };
    h.store.save('state.json', snapshot);
    snapshot.n = 2;
    for (let n = 2; n <= 100; n++) h.store.save('state.json', { n });
    const flushed = h.store.flush('state.json');
    let done = false;
    flushed.then(() => { done = true; });
    await tick();
    assert.equal(done, false);
    assert.equal(h.commits.length, 0);
    gate.resolve();
    await Promise.all([first, flushed]);
    assert.deepEqual(h.commits.map(([, value]) => value.n), [0, 100]);
    const value = { n: 101 }, saved = h.store.save('state.json', value);
    value.n = 999;
    await saved;
    assert.equal(h.commits.at(-1)[1].n, 101);
  });

  test('different files progress independently and flush all waits for every file', async () => {
    const h = memoryStore(), gate = h.block();
    h.store.save('one.json', { n: 1 });
    await tick();
    await h.store.save('two.json', { n: 2 });
    assert.equal(h.commits.length, 1);
    assert.equal(h.commits[0][0], 'two.json');
    const flushed = h.store.flush();
    let done = false;
    flushed.then(() => { done = true; });
    await tick();
    assert.equal(done, false);
    gate.resolve();
    await flushed;
    assert.equal(h.store.files.size, 0);
  });

  test('initial writes and reads are barriers, never lost in save coalescing', async () => {
    const h = memoryStore(), gate = h.block();
    h.store.write('state.json', { n: 0 });
    h.store.save('state.json', { n: 1 });
    const loaded = h.store.read('state.json');
    h.store.save('state.json', { n: 2 });
    h.store.write('state.json', { n: 3 });
    h.store.save('state.json', { n: 4 });
    gate.resolve();
    assert.deepEqual(await loaded, { n: 1 });
    await h.store.flush();
    assert.deepEqual(h.commits.map(([, value]) => value.n), [0, 1, 2, 3, 4]);
  });

  test('transfer merges after older saves and deletion cannot be undone by queued old state', async () => {
    const h = memoryStore(), gate = h.block();
    h.store.save('main.json', { spaces: ['latest'] });
    h.store.update('main.json', (state) => ({ ...state, pendingSpaces: ['returned'] }));
    const loaded = h.store.read('main.json');
    h.store.save('secondary.json', { spaces: ['old'] });
    h.store.save('secondary.json', { spaces: ['new'] });
    h.store.remove('secondary.json');
    gate.resolve();
    assert.deepEqual(await loaded, { spaces: ['latest'], pendingSpaces: ['returned'] });
    await h.store.flush();
    assert.equal(h.files.has('secondary.json'), false);
  });

  test('failed replacement preserves the previous document, cleans up and allows later saves', async () => {
    const h = memoryStore();
    await h.store.write('state.json', { n: 1 });
    h.fail();
    assert.equal(await h.store.save('state.json', { n: 2 }), false);
    assert.equal(h.errors.length, 1);
    assert.deepEqual(JSON.parse(h.files.get('state.json')), { n: 1 });
    assert.equal(h.files.size, 1, 'No orphaned temporary file after failure');
    assert.equal(await h.store.save('state.json', { n: 3 }), true);
    assert.deepEqual(await h.store.read('state.json'), { n: 3 });
  });

  test('unserializable state is reported without throwing or blocking later saves', async () => {
    const h = memoryStore(), circular = {};
    circular.self = circular;
    assert.equal(await h.store.save('state.json', circular), false);
    assert.equal(h.errors.length, 1);
    assert.equal(await h.store.save('state.json', { n: 1 }), true);
    assert.deepEqual(await h.store.read('state.json'), { n: 1 });
  });

  test('real filesystem replacement leaves the old JSON readable until rename', async () => {
    const root = fs.mkdtempSync(path.join(__dirname, '.state-perf-'));
    try {
      const file = path.join(root, 'state.json'), gate = deferred(), reached = deferred();
      fs.writeFileSync(file, '{"n":1}');
      const store = new StateStore({
        io: { ...fs.promises, async rename(from, to) {
          assert.equal(path.dirname(from), path.dirname(to));
          reached.resolve();
          await gate.promise;
          return fs.promises.rename(from, to);
        } },
      });
      const saved = store.save(file, { n: 2 });
      await reached.promise;
      assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { n: 1 });
      gate.resolve();
      assert.equal(await saved, true);
      assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { n: 2 });
      assert.deepEqual(fs.readdirSync(root), ['state.json']);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });

  test('Electron preserves final state on reload, close, transfer/delete and app quit', { timeout: 60000 }, () => {
    const root = fs.mkdtempSync(path.join(__dirname, '.state-perf-app-'));
    try {
      fs.writeFileSync(path.join(root, 'settings.json'), JSON.stringify({ showSplash: false, robotVoice: false }));
      fs.writeFileSync(path.join(root, 'state.json'), JSON.stringify({
        version: 2, spaces: [{ name: 'Initial', seed: 'state-test', rid: 'state-test', tabs: [] }],
      }));
      const env = { ...process.env, ROBOTCONSOLE_USERDATA: root, ROBOTCONSOLE_NO_SPLASH: '1' };
      delete env.ELECTRON_RUN_AS_NODE;
      const result = require('node:child_process').spawnSync(require('electron'), [__filename], {
        env, encoding: 'utf8', timeout: 55000,
      });
      assert.equal(result.error, undefined, result.error?.message);
      assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
      const main = JSON.parse(fs.readFileSync(path.join(root, 'state.json'), 'utf8'));
      assert.equal(main.spaces[0].name, 'App final main');
      const secondaryFile = fs.readdirSync(root).find((name) => /^state-w.*\.json$/.test(name));
      assert.ok(secondaryFile, 'App quit keeps the secondary window state');
      assert.equal(JSON.parse(fs.readFileSync(path.join(root, secondaryFile), 'utf8')).spaces[0].name, 'App final secondary');
      assert.equal(fs.readdirSync(root).some((name) => name.endsWith('.tmp')), false);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });
}

async function runElectron() {
  const { app, BrowserWindow } = require('electron');
  const root = process.env.ROBOTCONSOLE_USERDATA;
  const home = path.join(root, 'home');
  fs.mkdirSync(home);
  require('node:os').homedir = () => home;
  require('../main/ptyclient').prototype.send = async () => {};
  const atomicWrite = StateStore.prototype.atomicWrite;
  StateStore.prototype.atomicWrite = async function (...args) {
    await new Promise((resolve) => setTimeout(resolve, 15));
    return atomicWrite.apply(this, args);
  };
  let stage = 'initial load';
  app.on('web-contents-created', (_event, contents) => {
    contents.on('console-message', (_event, level, message) => {
      if (level >= 2) console.error('[renderer]', message);
    });
  });
  app.disableHardwareAcceleration();
  require('../main');
  const timeout = setTimeout(() => { console.error('State integration timeout:', stage); app.exit(1); }, 45000);
  timeout.unref();
  await app.whenReady();
  const wait = async (condition) => {
    for (let i = 0; i < 400; i++) {
      if (await condition()) return;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error('Timed out waiting for state integration');
  };
  const ready = async (win) => {
    if (win.webContents.isLoading()) await new Promise((resolve) => win.webContents.once('did-stop-loading', resolve));
    await wait(() => win.webContents.executeJavaScript(`!!window.CAI?.activeSpace && !document.getElementById('boot')`));
  };
  let main = BrowserWindow.getAllWindows()[0];
  await ready(main);
  stage = 'reload';
  await main.webContents.executeJavaScript(`CAI.spaces[0].customName = true; CAI.spaces[0].name = 'Reload final'; CAI.save(); void 0;`);
  const reloaded = new Promise((resolve) => main.webContents.once('did-finish-load', resolve));
  main.reload();
  await reloaded;
  stage = 'reload readiness';
  await ready(main);
  assert.equal(await main.webContents.executeJavaScript('CAI.spaces[0].name'), 'Reload final');

  const detached = { version: 2, spaces: [{ name: 'Detached', seed: 'detached', rid: 'detached', tabs: [] }] };
  const detach = async () => {
    stage = 'detach';
    const ids = new Set(BrowserWindow.getAllWindows().map((win) => win.id));
    await main.webContents.executeJavaScript(`api.detachSpace(${JSON.stringify(detached)}); void 0;`);
    await wait(() => BrowserWindow.getAllWindows().some((win) => !ids.has(win.id)));
    const win = BrowserWindow.getAllWindows().find((item) => !ids.has(item.id));
    stage = 'detached readiness';
    await ready(win);
    assert.equal(await win.webContents.executeJavaScript('CAI.spaces[0].name'), 'Detached');
    return win;
  };
  let secondary = await detach();
  stage = 'normal window close';
  const secondaryId = (await secondary.webContents.executeJavaScript('api.context()')).winId;
  await main.webContents.executeJavaScript(`CAI.spaces[0].name = 'Window final'; CAI.save(); void 0;`);
  const closed = new Promise((resolve) => main.once('closed', resolve));
  main.close();
  await closed;
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'state.json'), 'utf8')).spaces[0].name, 'Window final');

  const returned = { version: 2, spaces: [{ name: 'Returned', seed: 'returned', rid: 'returned', tabs: [] }] };
  stage = 'return secondary';
  const removed = new Promise((resolve) => secondary.once('closed', resolve));
  await secondary.webContents.executeJavaScript(`api.saveState({ spaces: [] }); api.closeWindowNow(${JSON.stringify(returned)}); void 0;`).catch(() => {});
  await removed;
  await wait(() => BrowserWindow.getAllWindows().some((win) => win !== secondary));
  main = BrowserWindow.getAllWindows().find((win) => win !== secondary);
  stage = 'returned main readiness';
  await ready(main);
  assert.deepEqual(await main.webContents.executeJavaScript('CAI.spaces.map((sp) => sp.name)'), ['Window final', 'Returned']);
  await wait(() => !fs.existsSync(path.join(root, `state-${secondaryId}.json`)));
  secondary = await detach();
  stage = 'app quit';
  await main.webContents.executeJavaScript(`CAI.spaces[0].name = 'App final main'; CAI.save(); void 0;`);
  await secondary.webContents.executeJavaScript(`CAI.spaces[0].customName = true; CAI.spaces[0].name = 'App final secondary'; CAI.save(); void 0;`);
  app.quit();
}
