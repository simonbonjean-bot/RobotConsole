const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const crypto = require('node:crypto');
const vm = require('node:vm');
const { spawnSync, execFileSync } = require('node:child_process');
const createPlatform = require('../shared/platform');
const { parseProcesses, parseSs, parseLsof, unixSnapshot } = require('../main/system-snapshot');
const { socketPath, listenLocal } = require('../main/local-socket');
const { pipeFor } = require('../main/speech');
const PtyClient = require('../main/ptyclient');
const { voiceCommand } = require('../main/speech-voice');

test('POSIX paths preserve case, filesystem roots and directory boundaries', () => {
  for (const os of ['linux', 'darwin']) {
    const p = createPlatform(os);
    assert.notEqual(p.pathKey('/work/API'), p.pathKey('/work/api'));
    assert.equal(p.pathKey('/'), '/');
    assert.equal(p.joinPath('/work/My Project', 'apps/api'), '/work/My Project/apps/api');
    assert.equal(p.joinPath('/', '.robot', 'services.json'), '/.robot/services.json');
    assert.equal(p.parentPath('/home'), '/');
    assert.equal(p.parentPath('/'), '/');
    assert.equal(p.withinPath('/work/api', '/work'), true);
    assert.equal(p.withinPath('/work-other/api', '/work'), false);
    assert.equal(p.withinPath('/work', '/'), true);
    assert.equal(p.withinPath('/work', '/Work'), false);
  }
});

test('Windows paths retain drive roots, case folding and portable template paths', () => {
  const p = createPlatform('win32');
  assert.equal(p.pathKey('C:\\Work\\API'), p.pathKey('c:/work/api/'));
  assert.equal(p.joinPath('C:\\Work', 'apps/api'), 'C:\\Work\\apps\\api');
  assert.equal(p.parentPath('C:\\Work'), 'C:\\');
  assert.equal(p.parentPath('C:\\'), 'C:\\');
  assert.equal(p.withinPath('C:\\WORK\\api', 'c:\\work'), true);
  assert.equal(p.withinPath('C:\\workspace', 'C:\\work'), false);
});

test('workspace switcher lists only open app windows and restores the selected window without creating one', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  const from = source.indexOf("ipcMain.handle('ws:listOpen'");
  const to = source.indexOf("ipcMain.on('ws:open'", from);
  assert.ok(from >= 0 && to > from);
  const handlers = {}, calls = [];
  const entry = (id, ws, winId = 'main', extra = {}) => ({
    ws, winId, ...extra,
    win: {
      webContents: { id }, isDestroyed: () => !!extra.destroyed,
      isMinimized: () => !!extra.minimized,
      restore: () => calls.push(['restore', id]),
      show: () => calls.push(['show', id]),
      focus: () => calls.push(['focus', id]),
    },
  });
  const windows = new Map([
    [1, entry(1, 'first')], [2, entry(2, 'second', 'main', { minimized: true })],
    [3, entry(3, 'second', 'wabc')], [4, entry(4, 'closed', 'main', { closed: true })],
    [5, entry(5, 'destroyed', 'main', { destroyed: true })], [6, entry(6, null)],
  ]);
  vm.runInNewContext(source.slice(from, to), {
    ipcMain: { handle(name, handler) { handlers[name] = handler; } },
    windows, Workspace: { load: (root) => ({ name: `Project ${root}` }) },
  });
  const list = handlers['ws:listOpen']({ sender: { id: 1 } });
  assert.deepEqual(Array.from(list, (item) => item.wcId), [1, 2, 3, 6]);
  assert.equal(list[0].current, true);
  assert.equal(list[1].current, false);
  assert.equal(list[1].name, 'Project second');
  assert.equal(list[2].winId, 'wabc');
  assert.equal(list[3].name, 'Fenêtre sans workspace');
  handlers['win:focus']({}, 2);
  assert.deepEqual(calls, [['restore', 2], ['show', 2], ['focus', 2]]);
  calls.length = 0;
  handlers['win:focus']({}, 3);
  assert.deepEqual(calls, [['show', 3], ['focus', 3]]);
  for (const id of [4, 5, 99]) assert.throws(() => handlers['win:focus']({}, id), /fenêtre est fermée/);
  assert.equal(windows.size, 6);
});

test('workspace menu adds open workspaces without removing existing actions and surfaces focus/list errors', async () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'app.js'), 'utf8');
  const from = source.indexOf('  async function workspaceMenu(');
  const to = source.indexOf('  async function pickWorkspace(', from);
  assert.ok(from >= 0 && to > from);
  const focused = [], errors = [];
  let items, failList = false, failFocus = false;
  const sandbox = {
    ctx: { ws: { name: 'Current', root: 'current' }, recent: [{ name: 'Recent', root: 'recent' }] },
    Platform: createPlatform('win32'), I18n: { t: (template, value) => template.replace('{0}', value) },
    UI: { menu(value) { items = value; }, toast(message) { errors.push(message); } },
    wsBadge: {}, renameWorkspace() {}, workspaceStudio() {}, rerollWorkspace() {}, pickWorkspace() {},
    api: {
      async listOpenWorkspaces() {
        if (failList) throw new Error('List failed');
        return [
          { wcId: 1, winId: 'main', name: 'Current', root: 'current', current: true },
          { wcId: 2, winId: 'main', name: '<Other>', root: 'other', current: false },
          { wcId: 3, winId: 'wabc', name: '<Other>', root: 'other', current: false },
        ];
      },
      async focusWindow(id) { if (failFocus) throw new Error('Closed window'); focused.push(id); },
    },
  };
  vm.runInNewContext(source.slice(from, to), sandbox);
  await sandbox.workspaceMenu();
  assert.equal(items[0].title, 'Workspaces ouverts');
  assert.equal(items.find((item) => item.label === 'Current').checked, true);
  assert.equal(items.find((item) => item.label === 'Current').disabled, true);
  assert.ok(items.some((item) => item.label === '<Other> · Fenêtre ABC'));
  for (const label of ['Renommer le workspace…', 'Ouvrir un autre workspace…', 'Workspaces récents', 'Fermer le workspace']) {
    assert.ok(items.some((item) => item.label === label), `Preserve ${label}`);
  }
  await items.find((item) => item.label === '<Other>').action();
  assert.deepEqual(focused, [2]);
  failFocus = true;
  await items.find((item) => item.label === '<Other>').action();
  assert.deepEqual(errors, ['Closed window']);
  failList = true;
  await sandbox.workspaceMenu();
  assert.equal(errors.at(-1), 'List failed');
  assert.ok(items.some((item) => item.label === 'Ouvrir un autre workspace…'), 'Existing menu remains usable if listing fails');
});

test('templates resolve real POSIX workspace paths rather than creating backslash filenames', () => {
  for (const platform of ['linux', 'darwin', 'win32']) {
    const root = platform === 'win32' ? 'C:\\Project' : '/home/Project';
    const context = vm.createContext({
      Platform: createPlatform(platform), window: {}, UI: { h() {}, esc: (s) => s },
      CAI: { ws: { root } }, Settings: { data: {} },
    });
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'renderer', 'tab-models.js'), 'utf8'), context);
    const { specFor } = context.window.TabModels;
    assert.equal(specFor({ kind: 'terminal', dir: 'apps/api' }).cwd,
      platform === 'win32' ? 'C:\\Project\\apps\\api' : '/home/Project/apps/api');
    assert.equal(specFor({ kind: 'explorer', dir: '/tmp/project' }).root, '/tmp/project');
  }
});

test('Command shortcuts are available on macOS without changing Unix Ctrl+C', () => {
  assert.equal(createPlatform('darwin').primary({ metaKey: true }), true);
  assert.equal(createPlatform('darwin').primary({ ctrlKey: true }), true);
  assert.equal(!!createPlatform('linux').primary({ metaKey: true }), false);
  assert.equal(createPlatform('darwin').copyModifier({ altKey: true }), true);
  assert.equal(createPlatform('win32').copyModifier({ ctrlKey: true }), true);
});

test('POSIX command arguments are literal even with shell metacharacters', () => {
  const quote = createPlatform('linux').quoteShell;
  const value = 'a b\'c"$HOME`whoami`\\d\nsecond line';
  assert.equal(quote("a'b"), "'a'\\''b'");
  if (process.platform !== 'win32') {
    const result = execFileSync('/bin/sh', ['-c', `printf '%s' ${quote(value)}`], { encoding: 'utf8' });
    assert.equal(result, value);
  }
});

test('process and listening-port parsers handle Linux and macOS output', () => {
  const ps = parseProcesses('  123 1 2048\n 124 123 16\n');
  assert.deepEqual(ps.procs, [{ pid: 123, ppid: 1 }, { pid: 124, ppid: 123 }]);
  assert.equal(ps.mem.get(123), 2048 * 1024);
  assert.deepEqual(parseSs(
    'LISTEN 0 511 127.0.0.1:3000 0.0.0.0:* users:(("node",pid=123,fd=20))\n' +
    'LISTEN 0 128 [::]:4000 [::]:* users:(("node",pid=124,fd=21),("node",pid=125,fd=21))\n'),
  [{ pid: 123, port: 3000 }, { pid: 124, port: 4000 }, { pid: 125, port: 4000 }]);
  assert.deepEqual(parseLsof('p123\nn127.0.0.1:3000\nn[::1]:4000\np124\nn*:5000\n'),
    [{ pid: 123, port: 3000 }, { pid: 123, port: 4000 }, { pid: 124, port: 5000 }]);
});

test('Unix service probes fall back to lsof and explicitly report missing tools', async () => {
  const calls = [];
  const run = async (file) => {
    calls.push(file);
    if (file === 'ps') return '123 1 20';
    if (file === 'ss') throw Object.assign(new Error('ss missing'), { code: 'ENOENT' });
    return 'p123\nn*:3000\n';
  };
  const snapshot = await unixSnapshot('linux', run);
  assert.deepEqual(calls, ['ps', 'ss', 'lsof']);
  assert.deepEqual(snapshot.listen, [{ pid: 123, port: 3000 }]);
  const missing = await unixSnapshot('darwin', async (file) => {
    if (file === 'ps') return '123 1 20';
    throw Object.assign(new Error('lsof missing'), { code: 'ENOENT' });
  });
  assert.match(missing.error, /lsof missing/);
  assert.equal(missing.procs.length, 1);
});

test('native speech commands apply volume and never use a shell', () => {
  assert.deepEqual(voiceCommand('hello', 25, 'darwin'),
    { file: '/usr/bin/say', args: ['--', '[[volm 0.25]]hello'] });
  assert.deepEqual(voiceCommand('--help; $(whoami)', 25, 'linux'),
    { file: 'spd-say', args: ['--wait', '--volume', '-50', '--', '--help; $(whoami)'] });
});

test('Unix IPC endpoints separate case-sensitive profiles', { skip: process.platform === 'win32' }, () => {
  assert.notEqual(pipeFor('/tmp/Profile'), pipeFor('/tmp/profile'));
  assert.notEqual(new PtyClient('/tmp/Profile').pipe, new PtyClient('/tmp/profile').pipe);
});

test('Unix IPC recovers stale sockets but never replaces a live server or a file',
  { skip: process.platform === 'win32' }, async (t) => {
    const endpoint = socketPath('test-' + crypto.randomBytes(4).toString('hex'));
    const stale = spawnSync(process.execPath, ['-e',
      'require("net").createServer().listen(process.argv[1], () => process.exit(0))', endpoint]);
    assert.equal(stale.status, 0, String(stale.error || stale.stderr));
    const server = net.createServer((socket) => socket.end());
    t.after(() => new Promise((resolve) => server.close(resolve)));
    await listenLocal(server, endpoint);
    assert.equal(fs.statSync(endpoint).mode & 0o777, 0o600);
    const other = net.createServer();
    await assert.rejects(listenLocal(other, endpoint), { code: 'EADDRINUSE' });
    await new Promise((resolve, reject) => {
      const socket = net.connect(endpoint);
      socket.once('connect', () => { socket.destroy(); resolve(); });
      socket.once('error', reject);
    });
    const file = socketPath('test-file-' + crypto.randomBytes(4).toString('hex'));
    fs.writeFileSync(file, 'keep');
    t.after(() => fs.unlinkSync(file));
    await assert.rejects(listenLocal(net.createServer(), file));
    assert.equal(fs.readFileSync(file, 'utf8'), 'keep');
  });

test('Unix system probes see a real owned listening port', { skip: process.platform === 'win32' }, async (t) => {
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const snapshot = await unixSnapshot();
  assert.equal(snapshot.error, undefined);
  assert.ok(snapshot.listen.some((entry) => entry.pid === process.pid && entry.port === server.address().port));
  assert.ok(snapshot.mem.get(process.pid) > 0);
});

test('cancelling Unix test runs stops the shell and its descendants', { skip: process.platform === 'win32' }, async (t) => {
  const Tests = require('../main/tests');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'robotconsole-cancel-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const marker = path.join(root, 'orphan.txt');
  const script = path.join(root, 'long task.js');
  fs.writeFileSync(script, `
    require('node:child_process').spawn(process.execPath, ['-e',
      ${JSON.stringify(`setTimeout(() => require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'orphan'), 1000)`)}],
      { stdio: 'inherit' });
    console.log('RC_CANCEL_READY');
    setInterval(() => {}, 1000);
  `);
  fs.mkdirSync(path.join(root, '.robot'));
  const quote = createPlatform(process.platform).quoteShell;
  fs.writeFileSync(path.join(root, '.robot', 'tests.json'), JSON.stringify({ suites: [{
    id: 'cancel', name: 'Cancel', framework: 'custom',
    command: `${quote(process.execPath)} ${quote(script)}`,
  }] }));
  let ready = false;
  const timer = setTimeout(() => Tests.stop('platform-cancel'), 10000);
  t.after(() => clearTimeout(timer));
  const result = await Tests.run(root, { all: true }, (data) => {
    if (data.includes('RC_CANCEL_READY')) { ready = true; Tests.stop('platform-cancel'); }
  }, 'platform-cancel');
  assert.equal(ready, true);
  assert.equal(result.stopped, true);
  await new Promise((resolve) => setTimeout(resolve, 1200));
  assert.equal(fs.existsSync(marker), false, 'No orphaned child writes after cancellation');
});
