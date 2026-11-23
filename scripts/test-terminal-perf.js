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
  kind.dispose(tab);
});
