// RobotConsole — connexion au service des terminaux (main/ptyhost.js)
// Le service tourne dans un processus détaché : les shells survivent à la fermeture de l'application.
const net = require('net');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

class PtyClient {
  constructor(userDataDir) {
    const h = crypto.createHash('sha1').update(userDataDir.toLowerCase()).digest('hex').slice(0, 12);
    this.pipe = process.platform === 'win32' ? `\\\\.\\pipe\\robotconsole-ptyhost-${h}` : path.join(require('os').tmpdir(), `robotconsole-ptyhost-${h}.sock`);
    this.sock = null;
    this.connecting = null;
    this.waiters = new Map(); // clé -> [resolve]
    this.onData = () => {};
    this.onExit = () => {};
  }

  connect() {
    if (this.sock && !this.sock.destroyed) return Promise.resolve(this.sock);
    if (this.connecting) return this.connecting;
    this.connecting = (async () => {
      let spawned = false;
      for (let i = 0; i < 60; i++) {
        try {
          const sock = await this._tryConnect();
          this._bind(sock);
          return sock;
        } catch {
          if (!spawned) { this._spawnHost(); spawned = true; }
          await new Promise((r) => setTimeout(r, 100));
        }
      }
      throw new Error('Service des terminaux injoignable');
    })().finally(() => { this.connecting = null; });
    return this.connecting;
  }

  _tryConnect() {
    return new Promise((resolve, reject) => {
      const s = net.connect(this.pipe);
      s.once('connect', () => { s.removeAllListeners('error'); resolve(s); });
      s.once('error', reject);
    });
  }

  _spawnHost() {
    const child = spawn(process.execPath, [path.join(__dirname, 'ptyhost.js'), this.pipe], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    child.unref();
  }

  _bind(sock) {
    this.sock = sock;
    sock.setEncoding('utf8');
    let acc = '';
    sock.on('data', (chunk) => {
      acc += chunk;
      let i;
      while ((i = acc.indexOf('\n')) >= 0) {
        const line = acc.slice(0, i);
        acc = acc.slice(i + 1);
        if (!line) continue;
        let m;
        try { m = JSON.parse(line); } catch { continue; }
        if (m.t === 'data') this.onData(m.id, m.data);
        else if (m.t === 'exit') this.onExit(m.id, m.code, m.error);
        else if (m.t === 'sessions') this._resolve('sessions', m.list);
        else if (m.t === 'attached') this._resolve('attach:' + m.id, m);
      }
    });
    const gone = () => { if (this.sock === sock) this.sock = null; };
    sock.on('close', gone);
    sock.on('error', gone);
  }

  _wait(key) {
    return new Promise((resolve) => {
      if (!this.waiters.has(key)) this.waiters.set(key, []);
      this.waiters.get(key).push(resolve);
    });
  }
  _resolve(key, v) {
    const list = this.waiters.get(key);
    if (!list) return;
    this.waiters.delete(key);
    list.forEach((r) => r(v));
  }

  async send(msg) {
    const s = await this.connect();
    s.write(JSON.stringify(msg) + '\n');
  }

  async request(msg, key) {
    const p = this._wait(key);
    await this.send(msg);
    return p;
  }

  sessions() { return this.request({ t: 'hello' }, 'sessions'); }
  attach(id, cols, rows) { return this.request({ t: 'attach', id, cols, rows }, 'attach:' + id); }
}

module.exports = PtyClient;
