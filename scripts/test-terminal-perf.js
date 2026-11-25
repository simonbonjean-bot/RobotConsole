const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const SocketWriter = require('../main/socket-writer');
const TerminalFlow = require('../main/terminal-flow');
const PtyClient = require('../main/ptyclient');
const Remote = require('../main/remote');
const Services = require('../main/services');

class Socket extends EventEmitter {
  constructor() { super(); this.messages = []; this.saturated = false; this.destroyed = false; }
  write(data, callback) { this.messages.push(JSON.parse(data)); callback?.(); return !this.saturated; }
  setEncoding() {}
  setTimeout() {}
  destroy() { this.destroyed = true; this.emit('close'); }
}

test('socket saturation preserves message order until drain and rejects unsent data on close', async () => {
  const socket = new Socket();
  const pressure = [];
  const writer = new SocketWriter(socket, (blocked) => pressure.push(blocked));
  socket.saturated = true;
  await writer.send({ n: 1 });
  const second = writer.send({ n: 2 });
  const third = writer.send({ n: 3 });
  assert.deepEqual(socket.messages, [{ n: 1 }]);
  socket.saturated = false;
  socket.emit('drain');
  await Promise.all([second, third]);
  assert.deepEqual(socket.messages, [{ n: 1 }, { n: 2 }, { n: 3 }]);
  assert.ok(pressure.includes(true));
  socket.saturated = true;
  await writer.send({ n: 4 });
  const rejected = assert.rejects(writer.send({ n: 5 }), /fermée/);
  socket.destroy();
  await rejected;
});

test('a chunk is acknowledged once after every renderer consumes or detaches', () => {
  const credits = [];
  const flow = new TerminalFlow((...args) => credits.push(args));
  const token = flow.track('a', 100, [1, 2]);
  flow.consumed('a', token, 1);
  flow.consumed('a', token, 1);
  flow.consumed('wrong-session', token, 2);
  flow.consumed('a', token, 99);
  assert.deepEqual(credits, []);
  flow.detach(2);
  flow.consumed('a', token, 2);
  flow.track('service-without-renderer', 12, []);
  assert.deepEqual(credits, [['a', 100], ['service-without-renderer', 12]]);
  assert.equal(flow.pending.size, 0);
});

test('PtyClient serializes writes through socket saturation and rejects interrupted requests', async () => {
  const client = new PtyClient(__dirname);
  const socket = new Socket();
  client._bind(socket);
  socket.saturated = true;
  await client.send({ t: 'one' });
  const second = client.send({ t: 'two' });
  const third = client.send({ t: 'three' });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(socket.messages.map((m) => m.t), ['one']);
  socket.saturated = false;
  socket.emit('drain');
  await Promise.all([second, third]);
  assert.deepEqual(socket.messages.map((m) => m.t), ['one', 'two', 'three']);
  const pending = client.sessions();
  await new Promise((resolve) => setImmediate(resolve));
  const rejected = assert.rejects(pending, /interrompue/);
  socket.destroy();
  await rejected;
  assert.equal(client.waiters.size, 0);
});

function hostHarness() {
  let connection;
  const timers = new Map();
  let timerId = 0;
  const terminal = {
    cols: 80, rows: 24, pid: 123, paused: false, pauses: 0,
    pause() { this.paused = true; this.pauses++; },
    resume() { this.paused = false; },
    resize(cols, rows) { this.cols = cols; this.rows = rows; },
    onData(fn) { this.data = fn; },
    onExit(fn) { this.exit = fn; },
    write() {}, kill() {},
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'main', 'ptyhost.js'), 'utf8'), {
    require(name) {
      if (name === 'net') return { createServer(fn) { connection = fn; return {}; } };
      if (name === '@lydell/node-pty') return { spawn: () => terminal };
      if (name === './local-socket') return { listenLocal: () => new Promise(() => {}) };
      if (name === './socket-writer') return SocketWriter;
      throw new Error(name);
    },
    process: { argv: ['node', 'host', 'test-pipe'], exit() {} }, console,
    setTimeout(fn) { const id = ++timerId; timers.set(id, fn); return id; },
    clearTimeout(id) { timers.delete(id); },
  });
  const connect = () => {
    const socket = new Socket();
    connection(socket);
    socket.send = (message) => socket.emit('data', JSON.stringify(message) + '\n');
    return socket;
  };
  return {
    terminal, connect,
    flush() { const pending = [...timers.values()]; timers.clear(); pending.forEach((fn) => fn()); },
  };
}

test('PTY pauses for slow rendering, retains output/resize order, and resumes with credits', () => {
  const host = hostHarness();
  const socket = host.connect();
  socket.send({ t: 'flow', enabled: true });
  socket.send({ t: 'create', id: 'pty', cols: 80, rows: 24 });
  const first = 'a'.repeat(256 * 1024);
  host.terminal.data(first);
  assert.equal(host.terminal.paused, true);
  socket.send({ t: 'ack', id: 'pty', size: first.length - 100 * 1024 });
  assert.equal(host.terminal.paused, true, 'low water hysteresis avoids rapid pause/resume');
  socket.send({ t: 'ack', id: 'pty', size: 100 * 1024 });
  assert.equal(host.terminal.paused, false);
  host.terminal.data('before resize');
  socket.send({ t: 'resize', id: 'pty', cols: 100, rows: 30 });
  host.terminal.data('after resize');
  host.terminal.exit({ exitCode: 0 });
  assert.deepEqual(socket.messages.map((m) => m.t), ['data', 'data', 'resized', 'data', 'exit']);
  assert.equal(socket.messages.filter((m) => m.t === 'data').map((m) => m.data).join(''), first + 'before resizeafter resize');
});

test('PTY transport saturation pauses production independently from renderer credits', () => {
  const host = hostHarness();
  const socket = host.connect();
  socket.send({ t: 'create', id: 'pty', cols: 80, rows: 24 });
  socket.saturated = true;
  host.terminal.data('x'.repeat(32 * 1024));
  assert.equal(host.terminal.paused, true);
  socket.send({ t: 'resize', id: 'pty', cols: 120, rows: 40 });
  assert.equal(socket.messages.length, 1);
  socket.saturated = false;
  socket.emit('drain');
  assert.equal(host.terminal.paused, false);
  assert.deepEqual(socket.messages.map((m) => m.t), ['data', 'resized']);
});

test('disconnect releases paused sessions; reconnect replays the retained tail at recorded sizes', () => {
  const host = hostHarness();
  const socket = host.connect();
  socket.send({ t: 'flow', enabled: true });
  socket.send({ t: 'create', id: 'pty', cols: 80, rows: 24 });
  host.terminal.data('a'.repeat(256 * 1024));
  assert.equal(host.terminal.paused, true);
  socket.destroy();
  assert.equal(host.terminal.paused, false);
  host.terminal.data('disconnected output');
  host.flush();
  const reconnected = host.connect();
  reconnected.send({ t: 'flow', enabled: true });
  reconnected.send({ t: 'attach', id: 'pty', cols: 100, rows: 30 });
  const attached = reconnected.messages.find((m) => m.t === 'attached');
  assert.ok(attached.data.endsWith('disconnected output'));
  assert.equal(attached.segs[0].cols, 80);
  assert.equal(attached.cols, 100);
  assert.equal(host.terminal.paused, false);
});

test('session management lists metadata without history and confirms stop, failure and removal', () => {
  const host = hostHarness();
  const socket = host.connect();
  socket.send({ t: 'create', id: 'pty', cols: 80, rows: 24, cwd: 'project', scope: 'term:project', shellId: 'pwsh' });
  host.terminal.data('private terminal output');
  socket.send({ t: 'hello' });
  const response = socket.messages.findLast((m) => m.t === 'sessions');
  assert.equal(response.capabilities.terminate, true);
  assert.equal(response.list[0].cwd, 'project');
  assert.equal(response.list[0].scope, 'term:project');
  assert.ok(!JSON.stringify(response).includes('private terminal output'));
  host.terminal.kill = () => { throw new Error('kill refused'); };
  socket.send({ t: 'terminate', id: 'pty' });
  assert.equal(socket.messages.at(-1).error, 'kill refused');
  socket.send({ t: 'hello' });
  assert.equal(socket.messages.at(-1).list[0].alive, true, 'failed termination preserves the session');
  host.terminal.kill = () => {};
  socket.send({ t: 'terminate', id: 'pty' });
  assert.deepEqual(socket.messages.at(-1), { t: 'terminated', id: 'pty' });
  assert.equal(socket.messages.filter((m) => m.t === 'exit').length, 1, 'subscribers are notified even if the native exit event is delayed');
  host.terminal.exit({ exitCode: 0 });
  assert.equal(socket.messages.filter((m) => m.t === 'exit').length, 1, 'native exit never duplicates the stop notification');
  socket.send({ t: 'hello' });
  assert.deepEqual(socket.messages.at(-1).list, []);
  socket.send({ t: 'terminate', id: 'pty' });
  assert.equal(socket.messages.at(-1).error, undefined, 'removing an already absent session is idempotent');
});

test('PtyClient confirms termination with new and already-running legacy hosts', async () => {
  for (const modern of [true, false]) {
    const client = new PtyClient(__dirname);
    const socket = new Socket();
    const writes = [];
    let present = true, refused = false;
    socket.write = (data, callback) => {
      const request = JSON.parse(data);
      writes.push(request.t);
      let response;
      if (request.t === 'hello') response = { t: 'sessions', capabilities: modern ? { terminate: true } : undefined, list: present ? [{ id: 'pty' }] : [] };
      if (request.t === 'terminate') {
        response = { t: 'terminated', id: request.id, ...(refused ? { error: 'kill refused' } : {}) };
        if (!refused) present = false;
      }
      if (request.t === 'kill' && !refused) present = false;
      callback?.();
      if (response) queueMicrotask(() => socket.emit('data', JSON.stringify(response) + '\n'));
      return true;
    };
    client._bind(socket);
    await client.terminate('pty');
    assert.equal(present, false);
    assert.ok(writes.includes(modern ? 'terminate' : 'kill'));
    present = refused = true;
    await assert.rejects(client.terminate('pty'), modern ? /kill refused/ : /non confirmé/);
    assert.equal(present, true);
    socket.destroy();
  }
});

test('stopping a managed service from the session panel suppresses automatic restart and preserves errors', async (t) => {
  let service, failed = false;
  const host = { async terminate(id) {
    if (failed) throw new Error('kill refused');
    service.onExit(id, -1);
  } };
  service = new Services({ ptyHost: host, shells: [] });
  const state = { sessionId: 'pty', state: 'running', ports: [3000], manualStop: false };
  service.ws.set('root', { defs: [{ id: 'server', restart: true }], st: new Map([['server', state]]) });
  service.bySession.set('pty', { root: 'root', id: 'server' });
  service.push = () => {};
  failed = true;
  await assert.rejects(service.terminateSession('pty'), /kill refused/);
  assert.equal(state.manualStop, false);
  assert.equal(state.state, 'running');
  failed = false;
  await service.terminateSession('pty');
  assert.equal(state.manualStop, true);
  assert.equal(state.state, 'stopped');
  assert.deepEqual(state.ports, []);
  await service.terminateSession('unmanaged');
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let restarts = 0;
  service.start = async () => { restarts++; };
  state.manualStop = false;
  service.onExit('pty', 1);
  assert.equal(state.state, 'restarting');
  await service.terminateSession('pty');
  t.mock.timers.tick(1500);
  assert.equal(restarts, 0, 'a stop also cancels a restart that was already scheduled');
});

test('session IPC annotates live attachments and only releases credits after a successful stop', async () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  const from = source.indexOf("ipcMain.handle('pty:sessions'");
  const to = source.indexOf("ipcMain.on('pty:detach'", from);
  const handlers = {}, detached = [], exits = [];
  let failed = false;
  const owners = new Map([['pty', [{ id: 1, isDestroyed: () => false }, { id: 2, isDestroyed: () => true }]]]);
  vm.runInNewContext(source.slice(from, to), {
    ipcMain: { handle(name, fn) { handlers[name] = fn; } },
    ptyHost: { async sessions() { return [{ id: 'pty' }]; } },
    owners,
    services: { async terminateSession() { if (failed) throw new Error('kill refused'); } },
    sendTo(...args) { exits.push(args); },
    terminalFlow: { detach(id, session) { detached.push([id, session]); } },
  });
  const sessions = await handlers['pty:sessions']();
  assert.equal(sessions[0].attachedWindows, 1);
  await assert.rejects(handlers['pty:terminate']({}, ''), /Session invalide/);
  failed = true;
  await assert.rejects(handlers['pty:terminate']({}, 'pty'), /kill refused/);
  assert.equal(owners.has('pty'), true);
  assert.deepEqual(detached, []);
  failed = false;
  await handlers['pty:terminate']({}, 'pty');
  assert.equal(owners.has('pty'), false);
  assert.deepEqual(detached, [[1, 'pty'], [2, 'pty']]);
  assert.deepEqual(exits, [['pty', 'pty:exit', -1]], 'old hosts notify attached tabs before ownership is released');
});

test('long PTY histories retain the exact bounded tail across chunks, resizes and repeated attachments', () => {
  const host = hostHarness();
  const socket = host.connect();
  socket.send({ t: 'create', id: 'pty', cols: 80, rows: 24 });
  let output = '';
  const produce = (data) => { output += data; host.terminal.data(data); };
  produce('old size\r\n');
  socket.send({ t: 'resize', id: 'pty', cols: 100, rows: 30 });
  for (let i = 0; i < 6000; i++) produce(`${i}: ${'conversation '.repeat(10)}\r\n`);
  const attach = () => {
    socket.send({ t: 'attach', id: 'pty' });
    return socket.messages.findLast((m) => m.t === 'attached');
  };
  const first = attach();
  assert.equal(first.data, output.slice(-400 * 1024));
  assert.deepEqual(first.segs, [{ cols: 100, rows: 30, data: first.data }]);
  produce('\x1b[2K\r> typed');
  assert.equal(attach().data, output.slice(-400 * 1024), 'taking a replay must not consume the retained chunks');
  produce('oversized '.repeat(60000));
  assert.equal(attach().data, output.slice(-400 * 1024));
  socket.send({ t: 'resize', id: 'pty', cols: 120, rows: 40 });
  const resized = attach();
  assert.equal(resized.segs[1].data, '');
  assert.equal(resized.segs[1].cols, 120);
  produce('new dimensions');
  assert.deepEqual(attach().segs, [{ cols: 120, rows: 40, data: 'new dimensions' }],
    'overflow keeps the existing policy of dropping older resize segments');
});

test('remote mirrors subscribe without copying PTY history; legacy attachments still replay', async () => {
  const attachments = [];
  const remote = new Remote({
    ptyHost: { async attach(id) { attachments.push(id); return { found: true, data: 'legacy replay' }; } },
    getWc: () => null,
  });
  remote.robots.set(1, [{ mode: 'read', tabs: [{ kind: 'terminal', sessionId: 'pty' }] }]);
  const socket = new Socket();
  socket.readyState = 1;
  socket.subs = new Set();
  socket.send = (raw) => socket.messages.push(JSON.parse(raw));
  await remote._handle(socket, { t: 'attach', id: 'pty', replay: false });
  assert.ok(socket.subs.has('pty'));
  assert.equal(attachments.length, 0);
  assert.equal(socket.messages[0].found, true);
  assert.equal(socket.messages[0].data, undefined);
  await remote._handle(socket, { t: 'attach', id: 'pty' });
  assert.deepEqual(attachments, ['pty']);
  assert.equal(socket.messages[1].data, 'legacy replay');
  await remote._handle(socket, { t: 'attach', id: 'private', replay: false });
  assert.equal(socket.messages[2].denied, true);
  assert.ok(!socket.subs.has('private'));
});

test('renderer credits follow parsing, replay discards duplicates, and snapshot boundaries remain exact', async () => {
  const handlers = {}, credits = [], attachRequests = [], timers = [];
  class Terminal {
    constructor() { this.cols = 80; this.rows = 24; this.pending = []; this.text = ''; }
    loadAddon(addon) { addon.activate?.(this); }
    open() {} attachCustomKeyEventHandler() {} onData() {} onTitleChange() {} dispose() {}
    onResize(fn) { this.resized = fn; }
    resize(cols, rows) { this.cols = cols; this.rows = rows; this.resized?.({ cols, rows }); }
    reset() { this.text = ''; }
    write(data, callback) { this.pending.push(() => { this.text += data; callback?.(); }); }
    drain() { let n = 0; while (this.pending.length) { assert.ok(++n < 1000); this.pending.shift()(); } }
  }
  const api = {
    onData(fn) { handlers.data = fn; }, onExit(fn) { handlers.exit = fn; },
    onPtyDisconnect(fn) { handlers.disconnect = fn; },
    ackData(id, token) { credits.push([id, token]); },
    attachPty: () => new Promise((resolve) => attachRequests.push(resolve)),
    detachPty() {}, kill() {}, resize() {},
  };
  const sandbox = {
    api, Terminal, console,
    Settings: { data: {} }, Themes: { terminal: () => ({}) }, I18n: { t: (s) => s },
    FitAddon: { FitAddon: class { fit() {} } },
    SearchAddon: { SearchAddon: class {} },
    SerializeAddon: { SerializeAddon: class {
      activate(term) { this.term = term; }
      serialize() { return this.term.text; }
    } },
    WebLinksAddon: { WebLinksAddon: class {} },
    CAI: { save() {}, talk() {}, markUnread() {}, say() {} },
    setTimeout(fn) { timers.push(fn); return fn; }, clearTimeout() {},
  };
  sandbox.window = sandbox;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'renderer', 'terminal-tab.js'), 'utf8'), sandbox);
  const element = () => ({ classList: { add() {}, remove() {} }, addEventListener() {} });
  const tab = { pane: element(), el: element(), space: { bot: {}, robotEl: element(), tabs: [] } };
  tab.space.tabs.push(tab);
  const kind = sandbox.TabKinds.terminal;
  kind.mount(tab, { shellId: 'test', sessionId: 'pty' });
  handlers.data('pty', 'BASELINE', 1, 1);
  attachRequests.shift()({ found: true, alive: true, data: 'BASELINE', cols: 80, rows: 24 });
  await new Promise((resolve) => setImmediate(resolve));
  handlers.data('pty', '-LIVE', 2, 2);
  assert.deepEqual(credits, [['pty', 1]], 'pre-attach data is already part of the replay');
  tab.term.drain();
  assert.equal(tab.term.text, 'BASELINE-LIVE');
  assert.deepEqual(credits, [['pty', 1], ['pty', 2]]);
  let burst = '';
  for (let seq = 3; seq <= 102; seq++) {
    const data = `${seq}:${'x'.repeat(4096)}\r\n`;
    burst += data;
    handlers.data('pty', data, seq, seq);
  }
  assert.equal(credits.length, 2, 'receiving a chunk is not enough to grant more producer credits');
  const snapshot = kind.remoteSnapshot(tab);
  handlers.data('pty', 'AFTER-SNAPSHOT', 103, 103);
  tab.term.drain();
  const state = (await snapshot).terminal;
  assert.equal(state.seq, 102);
  assert.equal(state.data, 'BASELINE-LIVE' + burst);
  assert.equal(tab.term.text, state.data + 'AFTER-SNAPSHOT');
  assert.equal(credits.length, 103);
  assert.equal(new Set(credits.map(([, token]) => token)).size, 103);
  const large = '\x1b[31m' + 'long redraw\r\n'.repeat(20000) + '\x1b[0m';
  handlers.data('pty', large, 104, 104);
  assert.ok(tab.term.pending.length > 1, 'large redraws give the parser several opportunities to yield for keyboard input');
  tab.term.pending.shift()();
  assert.equal(tab.renderedSeq, 103);
  assert.equal(credits.length, 103, 'partial parsing must not release the original chunk credit');
  const largeSnapshot = kind.remoteSnapshot(tab);
  tab.term.drain();
  assert.equal((await largeSnapshot).terminal.data, state.data + 'AFTER-SNAPSHOT' + large);
  assert.equal(tab.renderedSeq, 104);
  assert.deepEqual(credits.at(-1), ['pty', 104]);
  handlers.disconnect();
  timers.shift()();
  attachRequests.shift()({ found: true, alive: true, segs: [
    { cols: 80, rows: 24, data: 'OUTDATED' }, { cols: 100, rows: 30, data: '-REPLAY' },
  ] });
  await new Promise((resolve) => setImmediate(resolve));
  tab.term.pending.shift()();
  handlers.disconnect();
  timers.shift()();
  attachRequests.shift()({ found: true, alive: true, data: 'RECONNECTED' });
  await new Promise((resolve) => setImmediate(resolve));
  tab.term.drain();
  assert.equal(tab.term.text, 'RECONNECTED', 'reconnection cancels an older replay and resets the screen rather than duplicating history');
  handlers.exit('pty', -1);
  const pendingExitWrites = tab.term.pending.length;
  handlers.exit('pty', -1);
  assert.equal(tab.term.pending.length, pendingExitWrites, 'explicit stop confirmation and a delayed native exit do not duplicate the exit message');
  kind.dispose(tab);
});
