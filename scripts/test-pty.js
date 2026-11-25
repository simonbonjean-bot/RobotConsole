const assert = require('node:assert/strict');
const net = require('node:net');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const PtyClient = require('../main/ptyclient');

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'robotconsole-pty-test-'));
  const client = new PtyClient(root);
  // Hôte attaché au test : aucun processus persistant n'est lancé.
  const host = spawn(process.execPath, [path.join(__dirname, '..', 'main', 'ptyhost.js'), client.pipe], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: ['ignore', 'ignore', 'pipe'],
  });
  let diagnostics = '';
  host.stderr.on('data', (data) => { diagnostics += data; });
  let socket;
  let output = '';
  const waiters = [];
  const messages = [];
  const wait = (label, predicate) => {
    const found = messages.find(predicate);
    if (found) return Promise.resolve(found);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`PTY timeout (${label}): ${diagnostics}\nOutput: ${JSON.stringify(output.slice(-4000))}\nMessages: ${JSON.stringify(messages.slice(-5))}`)), 15000);
      waiters.push((message) => { if (predicate(message)) { clearTimeout(timer); resolve(message); return true; } return false; });
    });
  };
  const connect = async () => {
    for (let i = 0; i < 100; i++) {
      if (host.exitCode !== null) throw new Error('PTY host exited: ' + diagnostics);
      try {
        socket = net.connect(client.pipe);
        await new Promise((resolve, reject) => { socket.once('connect', resolve); socket.once('error', reject); });
        break;
      } catch (error) {
        socket.destroy();
        if (!['ENOENT', 'ECONNREFUSED'].includes(error.code) || i === 99) throw error;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }
    socket.setEncoding('utf8');
    let buffer = '';
    socket.on('data', (chunk) => {
      buffer += chunk;
      let end;
      while ((end = buffer.indexOf('\n')) >= 0) {
        const message = JSON.parse(buffer.slice(0, end));
        buffer = buffer.slice(end + 1);
        messages.push(message);
        if (message.t === 'data') output += message.data;
        for (let i = waiters.length - 1; i >= 0; i--) if (waiters[i](message)) waiters.splice(i, 1);
      }
    });
  };
  const send = (message) => socket.write(JSON.stringify(message) + '\n');
  try {
    await connect();
    const win = process.platform === 'win32';
    const env = { ...process.env };
    for (const key of Object.keys(env)) if (key.toUpperCase() === 'PATH') delete env[key];
    env.PATH = [path.join(__dirname, '..', 'bin'), process.env.PATH || ''].join(path.delimiter);
    env.TERM = 'xterm-256color';
    send({
      t: 'create', id: 'test', scope: 'test', shellId: 'default',
      file: win ? process.env.ComSpec || 'cmd.exe' : '/bin/sh', args: win ? ['/d', '/q'] : ['-i'],
      cols: 80, rows: 24, cwd: root,
      env,
      init: ['echo RC_PTY_OK', 'robot-say --help'],
    });
    await wait('startup command', () => output.includes('RC_PTY_OK'));
    await wait('robot-say help', () => output.includes('--history'));
    const probe = net.connect(client.pipe);
    await once(probe, 'connect');
    probe.destroy();
    await once(probe, 'close');
    send({ t: 'resize', id: 'test', cols: 100, rows: 30 });
    await wait('resize', (m) => m.t === 'resized' && m.cols === 100 && m.rows === 30);
    socket.destroy();
    await connect();
    send({ t: 'hello' });
    const sessions = await wait('sessions', (m) => m.t === 'sessions');
    assert.equal(sessions.list[0].alive, true);
    send({ t: 'attach', id: 'test' });
    const attached = await wait('attach', (m) => m.t === 'attached');
    assert.equal(attached.found, true);
    assert.ok(attached.data.includes('RC_PTY_OK'));
    assert.equal(attached.cols, 100);
    assert.equal(sessions.list[0].cwd, root);
    send({ t: 'terminate', id: 'test' });
    const terminated = await wait('termination confirmation', (m) => m.t === 'terminated');
    assert.equal(terminated.error, undefined);
    await wait('exit', (m) => m.t === 'exit');
    console.log('PTY: shell, robot-say, resize, reconnection, replay and shutdown passed.');
  } finally {
    if (socket && !socket.destroyed) send({ t: 'shutdown' });
    socket?.destroy();
    if (host.exitCode === null) {
      const timer = setTimeout(() => host.kill(), 3000);
      await once(host, 'exit');
      clearTimeout(timer);
    }
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
