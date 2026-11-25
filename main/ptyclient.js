// RobotConsole — connexion au service des terminaux (main/ptyhost.js)
// Le service tourne dans un processus détaché : les shells survivent à la fermeture de l'application.
const net = require('net');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { pathKey } = require('./platform');
const { socketPath } = require('./local-socket');
const SocketWriter = require('./socket-writer');

class PtyClient {
  constructor(userDataDir) {
    const h = crypto.createHash('sha1').update(pathKey(userDataDir)).digest('hex').slice(0, 12);
    this.pipe = process.platform === 'win32' ? `\\\\.\\pipe\\robotconsole-ptyhost-${h}` : socketPath(`pty-${h}`);
    this.sock = null;
    this.connecting = null;
    this.waiters = new Map(); // clé -> [resolve]
    this.onData = () => {};
    this.onExit = () => {};
    this.onResize = () => {};
    this.onFlush = () => {}; // sortie en attente à envoyer avant un « resized » / « attached »
    this.onDisconnect = () => {};
    this.writer = null;
    this.sendChain = Promise.resolve();
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
          await this.writer.send({ t: 'flow', enabled: true });
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
      s.once('error', (error) => { s.destroy(); reject(error); });
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
    this.capabilities = {};
    this.writer = new SocketWriter(sock);
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
        else if (m.t === 'resized') { this.onFlush(m.id); this.onResize(m.id, m.cols, m.rows); }
        else if (m.t === 'sessions') { this.capabilities = m.capabilities || {}; this._resolve('sessions', m.list); }
        else if (m.t === 'attached') { this.onFlush(m.id); this._resolve('attach:' + m.id, m); }
        else if (m.t === 'terminated') this._resolve('terminate:' + m.id, m);
      }
    });
    const gone = () => {
      if (this.sock !== sock) return;
      this.sock = null;
      this.writer = null;
      const error = new Error('Connexion au service des terminaux interrompue');
      for (const list of this.waiters.values()) for (const waiter of list) waiter.reject(error);
      this.waiters.clear();
      this.onDisconnect(error);
    };
    sock.on('close', gone);
    sock.on('error', gone);
  }

  _wait(key) {
    return new Promise((resolve, reject) => {
      if (!this.waiters.has(key)) this.waiters.set(key, []);
      this.waiters.get(key).push({ resolve, reject });
    });
  }
  _resolve(key, v) {
    const list = this.waiters.get(key);
    if (!list) return;
    this.waiters.delete(key);
    list.forEach((r) => r.resolve(v));
  }

  send(msg) {
    const pending = this.sendChain.then(async () => {
      await this.connect();
      return this.writer.send(msg);
    });
    this.sendChain = pending.catch(() => {});
    return pending;
  }

  async request(msg, key) {
    await this.connect();
    const p = this._wait(key);
    // Abonne la promesse avant l'envoi, y compris si la connexion tombe pendant write().
    this.send(msg).catch((error) => {
      const list = this.waiters.get(key);
      this.waiters.delete(key);
      list?.forEach((waiter) => waiter.reject(error));
    });
    return p;
  }

  acknowledge(id, size) {
    if (!this.writer || !this.sock || this.sock.destroyed) return;
    this.writer.send({ t: 'ack', id, size }).catch((error) => console.error('[pty:ack]', error.message));
  }
  sessions() { return this.request({ t: 'hello' }, 'sessions'); }
  async terminate(id) {
    await this.sessions();
    if (!this.capabilities.terminate) {
      // Les hôtes déjà lancés survivent aux mises à jour de l'application.
      await this.send({ t: 'kill', id });
      if ((await this.sessions()).some((session) => session.id === id)) throw new Error('Arrêt de la session non confirmé');
      return;
    }
    const result = await this.request({ t: 'terminate', id }, 'terminate:' + id);
    if (result.error) throw new Error(result.error);
  }
  attach(id, cols, rows) { return this.request({ t: 'attach', id, cols, rows }, 'attach:' + id); }
}

module.exports = PtyClient;
