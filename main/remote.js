// RobotConsole — accès à distance (téléphone / tablette) aux robots « ouverts »
// Serveur HTTP + WebSocket sur le réseau local (ou un VPN type Tailscale), protégé par un jeton.
// Seuls les robots ouverts (lecture seule ou contrôle) et leurs sessions sont visibles.
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const QRCode = require('qrcode');

const ROOT = path.join(__dirname, '..');
const STATIC = {
  '/': ['renderer/remote/index.html', 'text/html; charset=utf-8'],
  '/remote.js': ['renderer/remote/remote.js', 'text/javascript; charset=utf-8'],
  '/remote.css': ['renderer/remote/remote.css', 'text/css; charset=utf-8'],
  '/vendor/xterm.js': ['node_modules/@xterm/xterm/lib/xterm.js', 'text/javascript; charset=utf-8'],
  '/vendor/xterm.css': ['node_modules/@xterm/xterm/css/xterm.css', 'text/css; charset=utf-8'],
  // fit + webgl réunis dans un même fichier : le relais (déjà déployé) ne demande que celui-ci
  '/vendor/addon-fit.js': [['node_modules/@xterm/addon-fit/lib/addon-fit.js', 'node_modules/@xterm/addon-webgl/lib/addon-webgl.js'], 'text/javascript; charset=utf-8'],
  '/icon.png': ['build/icon.png', 'image/png'],
};
const COOKIE = 'rc_k';
const readEntry = (entry) => (Array.isArray(entry[0])
  ? Buffer.from(entry[0].map((f) => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n;\n'), 'utf8')
  : fs.readFileSync(path.join(ROOT, entry[0])));

const newToken = () => crypto.randomBytes(32).toString('base64url');

class Remote {
  constructor({ ptyHost, getWc, getSpeechHistory }) {
    this.ptyHost = ptyHost;
    this.getWc = getWc; // wcId -> webContents | null
    this.getSpeechHistory = getSpeechHistory;
    this.server = null;
    this.wss = null;
    this.port = 0;
    this.token = '';
    this.error = null;
    this.robots = new Map(); // wcId -> [robot]
    this.extra = new Map(); // `${wcId}:${tabId}` -> Set(sessionId) — sessions annoncées par un aperçu (logs de services…)
    this.clients = new Set();
    this.pending = new Map(); // reqId -> ws
    this.viewSent = new Map(); // wcId -> JSON des robots affichés sur un appareil (dernier envoi à la fenêtre)
    this.seq = 0;
    this.outputSeq = new Map();
  }

  // ---------- Serveur ----------
  get running() { return !!this.server?.listening; }

  async start({ port, token }) {
    await this.stop();
    this.port = port | 0 || 7777;
    this.token = token;
    this.error = null;
    const server = http.createServer((req, res) => this._http(req, res));
    const wss = new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024 });
    server.on('upgrade', (req, sock, head) => {
      const url = new URL(req.url, 'http://x');
      if (url.pathname !== '/ws' || !this._authorized(req, url)) { sock.write('HTTP/1.1 401 Unauthorized\r\n\r\n'); sock.destroy(); return; }
      wss.handleUpgrade(req, sock, head, (ws) => this._connection(ws));
    });
    this.server = server;
    this.wss = wss;
    await new Promise((resolve) => {
      server.once('error', (err) => { this.error = err.code === 'EADDRINUSE' ? `Port ${this.port} déjà utilisé` : String(err.message || err); this.server = null; resolve(); });
      server.listen(this.port, '0.0.0.0', resolve);
    });
  }

  async stop() {
    // Les téléphones passés par le relais restent connectés : seul le serveur local s'arrête
    for (const ws of [...this.clients]) if (!ws.virtual) { try { ws.close(4001, 'stopped'); } catch {} this.clients.delete(ws); }
    const s = this.server;
    this.server = null;
    this.wss = null;
    if (s) await new Promise((r) => s.close(() => r()));
  }

  setToken(token) {
    this.token = token;
    for (const ws of this.clients) if (!ws.virtual) { try { ws.close(4003, 'token'); } catch {} }
  }

  urls(hash = '') {
    const out = [];
    for (const [name, list] of Object.entries(os.networkInterfaces())) {
      for (const a of list || []) {
        if (a.family !== 'IPv4' && a.family !== 4) continue;
        if (a.internal) continue;
        out.push({ name, address: a.address, url: `http://${a.address}:${this.port}/?k=${this.token}${hash}` });
      }
    }
    // Le vrai réseau local d'abord (Wi-Fi / Ethernet), puis Tailscale, puis les adaptateurs virtuels (WSL, Hyper-V, Docker, VM, partage de connexion)
    const VIRTUAL = /vethernet|wsl|hyper-v|virtualbox|vmware|docker|vbox|loopback|bluetooth|connexion au réseau local\*|local area connection\*/i;
    const rank = ({ name, address: ip }) => {
      if (VIRTUAL.test(name) || /^192\.168\.137\./.test(ip)) return 4;
      if (/^(192\.168\.|10\.)/.test(ip)) return 0;
      if (/^100\./.test(ip)) return 1;
      if (/^172\.(1[6-9]|2\d|3[01])\./.test(ip)) return 2;
      return 3;
    };
    return out.sort((a, b) => rank(a) - rank(b));
  }

  async info() {
    const urls = this.running ? this.urls() : [];
    let qr = null;
    if (urls[0]) { try { qr = await QRCode.toString(urls[0].url, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' }); } catch {} }
    const qrs = {};
    for (const u of urls) { try { qrs[u.address] = await QRCode.toString(u.url, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' }); } catch {} }
    return { running: this.running, port: this.port, error: this.error, urls, qr, qrs, clients: this.clients.size };
  }

  // Lien et QR code d'un robot précis (ouvre directement ses onglets sur le téléphone)
  async robotInfo(rid) {
    if (!this.running) return { running: false, error: this.error };
    const urls = this.urls(`#/r/${encodeURIComponent(rid)}`);
    for (const u of urls) { try { u.qr = await QRCode.toString(u.url, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' }); } catch {} }
    return { running: true, port: this.port, urls };
  }

  // ---------- HTTP ----------
  _tokenOk(t) {
    if (!t || !this.token) return false;
    const a = Buffer.from(String(t)), b = Buffer.from(this.token);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }
  _cookie(req) {
    const m = /(?:^|;\s*)rc_k=([^;]+)/.exec(req.headers.cookie || '');
    return m ? decodeURIComponent(m[1]) : null;
  }
  _authorized(req, url) { return this._tokenOk(url.searchParams.get('k')) || this._tokenOk(this._cookie(req)); }

  _http(req, res) {
    const url = new URL(req.url, 'http://x');
    const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY' };
    if (req.method !== 'GET') { res.writeHead(405, headers); return res.end(); }
    if (!this._authorized(req, url)) {
      res.writeHead(401, { ...headers, 'Content-Type': 'text/html; charset=utf-8' });
      return res.end('<!doctype html><meta name="viewport" content="width=device-width"><body style="font-family:sans-serif;background:#0e1117;color:#c9d1d9;padding:24px"><h2>RobotConsole</h2><p>Accès refusé : scannez le QR code affiché dans Réglages → Accès à distance.</p><p>Access denied: scan the QR code from Settings → Remote access.</p>');
    }
    // Jeton dans l'URL : on le range dans un cookie puis on le retire de la barre d'adresse
    if (url.searchParams.has('k')) {
      res.writeHead(302, { ...headers, Location: '/', 'Set-Cookie': `${COOKIE}=${encodeURIComponent(this.token)}; Path=/; Max-Age=31536000; HttpOnly; SameSite=Strict` });
      return res.end();
    }
    const entry = STATIC[url.pathname];
    if (!entry) { res.writeHead(404, headers); return res.end(); }
    let buf;
    try { buf = readEntry(entry); } catch { res.writeHead(404, headers); return res.end(); }
    res.writeHead(200, { ...headers, 'Content-Type': entry[1] });
    res.end(buf);
  }

  // ---------- Robots publiés par les fenêtres ----------
  publish(wcId, robots) {
    const list = (Array.isArray(robots) ? robots : []).filter((r) => r && (r.mode === 'read' || r.mode === 'control'));
    if (list.length) this.robots.set(wcId, list); else this.robots.delete(wcId);
    this._revalidate();
    this._broadcastList();
  }
  dropWindow(wcId) {
    if (!this.robots.has(wcId)) return;
    this.robots.delete(wcId);
    for (const k of [...this.extra.keys()]) if (k.startsWith(wcId + ':')) this.extra.delete(k);
    this._revalidate();
    this._broadcastList();
  }

  _list() {
    const out = [];
    for (const [wcId, list] of this.robots) for (const r of list) out.push({ ...r, wcId });
    return out;
  }
  _findTab(wcId, tabId) {
    const r = (this.robots.get(wcId) || []).find((x) => x.tabs?.some((t) => t.id === tabId));
    return r ? { robot: r, tab: r.tabs.find((t) => t.id === tabId) } : null;
  }
  // Droit sur une session : 'control' (saisie possible), 'read', ou null
  _sessionMode(sessionId) {
    let mode = null;
    for (const [wcId, list] of this.robots) {
      for (const r of list) {
        for (const t of r.tabs || []) {
          const direct = t.sessionId === sessionId && t.kind === 'terminal';
          const viaSnap = this.extra.get(`${wcId}:${t.id}`)?.has(sessionId);
          if (direct) { if (r.mode === 'control') return 'control'; mode = 'read'; }
          else if (viaSnap) mode = mode || 'read';
        }
      }
    }
    return mode;
  }

  _revalidate() {
    for (const ws of this.clients) {
      for (const id of [...ws.subs]) if (!this._sessionMode(id)) { ws.subs.delete(id); this._send(ws, { t: 'exit', id, revoked: true }); }
      if (ws.watch && !this._findTab(ws.watch.wcId, ws.watch.tabId)) this._unwatch(ws);
    }
  }
  // Signale à chaque fenêtre lesquels de ses robots sont affichés sur un autre appareil
  _viewersChanged() {
    const by = new Map();
    for (const c of this.clients) if (c.view) { if (!by.has(c.view.wcId)) by.set(c.view.wcId, new Set()); by.get(c.view.wcId).add(c.view.key); }
    for (const wcId of new Set([...by.keys(), ...this.viewSent.keys()])) {
      const keys = [...(by.get(wcId) || [])].sort();
      const json = JSON.stringify(keys);
      if ((this.viewSent.get(wcId) || '[]') === json) continue;
      if (keys.length) this.viewSent.set(wcId, json); else this.viewSent.delete(wcId);
      const wc = this.getWc(wcId);
      if (wc && !wc.isDestroyed()) wc.send('remote:viewers', keys);
    }
  }
  _broadcastList() { for (const ws of this.clients) this._send(ws, { t: 'robots', robots: this._list() }); }

  speech(wcId, entry, duration) {
    if (!(this.robots.get(wcId) || []).some((r) => r.key === entry.rid)) return;
    for (const ws of this.clients) this._send(ws, { t: 'speech', wcId, key: entry.rid, entry, duration });
  }
  speechChanged(rid) {
    for (const [wcId, robots] of this.robots) {
      if (robots.some((r) => r.key === rid)) {
        for (const ws of this.clients) this._send(ws, { t: 'speechChanged', wcId, key: rid });
      }
    }
  }

  // ---------- Aperçus et actions (relayés vers la fenêtre) ----------
  _watchers(wcId, tabId) { let n = 0; for (const c of this.clients) if (c.watch?.wcId === wcId && c.watch?.tabId === tabId) n++; return n; }
  _setWatch(wcId, tabId, on) {
    const wc = this.getWc(wcId);
    if (wc && !wc.isDestroyed()) wc.send('remote:watch', tabId, on);
  }
  _unwatch(ws) {
    const w = ws.watch;
    if (!w) return;
    ws.watch = null;
    if (!this._watchers(w.wcId, w.tabId)) this._setWatch(w.wcId, w.tabId, false);
  }
  snapshot(wcId, tabId, snap) {
    const ids = new Set();
    const walk = (o) => { if (!o || typeof o !== 'object') return; if (typeof o.sessionId === 'string') ids.add(o.sessionId); for (const v of Object.values(o)) if (typeof v === 'object') walk(v); };
    walk(snap);
    this.extra.set(`${wcId}:${tabId}`, ids);
    for (const ws of this.clients) if (ws.watch?.wcId === wcId && ws.watch?.tabId === tabId) this._send(ws, { t: 'snapshot', wcId, tabId, snap });
  }
  actionResult(reqId, result) {
    const ws = this.pending.get(reqId);
    this.pending.delete(reqId);
    if (!ws) return;
    const req = ws._reqs.get(reqId);
    ws._reqs.delete(reqId);
    this._send(ws, { t: 'actionResult', req, result: result || {} });
  }

  // ---------- Terminaux ----------
  onData(id, data) {
    const seq = (this.outputSeq.get(id) || 0) + 1;
    this.outputSeq.set(id, seq);
    for (const ws of this.clients) if (ws.subs.has(id)) this._send(ws, { t: 'data', id, data, seq });
    return seq;
  }
  onExit(id, code) { for (const ws of this.clients) if (ws.subs.has(id)) this._send(ws, { t: 'exit', id, code }); }
  onResize(id, cols, rows) { for (const ws of this.clients) if (ws.subs.has(id)) this._send(ws, { t: 'resized', id, cols, rows }); }

  // ---------- WebSocket ----------
  _send(ws, msg) { if (ws.readyState === 1) ws.send(JSON.stringify(msg)); }

  // Téléphone connecté via le relais (main/relay.js) : même traitement qu'un client local
  attachVirtual(sock) { this._connection(sock); }

  _connection(ws) {
    ws.subs = new Set();
    ws.watch = null;
    ws._reqs = new Map();
    this.clients.add(ws);
    this._send(ws, { t: 'robots', robots: this._list() });
    ws.on('message', (raw) => { let m; try { m = JSON.parse(String(raw)); } catch { return; } this._handle(ws, m).catch(() => {}); });
    ws.on('close', () => {
      this.clients.delete(ws);
      this._unwatch(ws);
      if (ws.view) { ws.view = null; this._viewersChanged(); }
      for (const [k, c] of this.pending) if (c === ws) this.pending.delete(k);
    });
    // Ping régulier : détecte les téléphones partis en veille
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });
    const timer = setInterval(() => {
      if (!ws.isAlive) { clearInterval(timer); return ws.terminate(); }
      ws.isAlive = false;
      try { ws.ping(); } catch {}
    }, 30000);
    ws.on('close', () => clearInterval(timer));
  }

  async _handle(ws, m) {
    switch (m.t) {
      case 'list': this._send(ws, { t: 'robots', robots: this._list() }); break;
      case 'speechHistory': {
        const wcId = m.wcId | 0, key = String(m.key || '');
        const allowed = () => (this.robots.get(wcId) || []).some((r) => r.key === key);
        const reply = (result) => this._send(ws, { t: 'actionResult', req: m.req, result });
        if (!allowed()) return reply({ error: 'Accès refusé' });
        try {
          if (!this.getSpeechHistory) throw new Error('Historique indisponible');
          const entries = await this.getSpeechHistory(key);
          if (!allowed()) return reply({ error: 'Accès retiré' });
          reply({ entries });
        } catch (error) {
          console.error('[remote:speechHistory]', error);
          reply({ error: String(error.message || error) });
        }
        break;
      }
      case 'attach': {
        const id = String(m.id || '');
        const mode = this._sessionMode(id);
        if (!mode) return this._send(ws, { t: 'attached', id, found: false, denied: true });
        ws.subs.add(id);
        const r = await this.ptyHost.attach(id); // sans cols/rows : la taille du PC ne change pas
        this._send(ws, { t: 'attached', id, found: !!r?.found, data: r?.data || '', segs: r?.segs, alive: r?.alive, exitCode: r?.exitCode, cols: r?.cols || 80, rows: r?.rows || 24, mode });
        break;
      }
      case 'detach': ws.subs.delete(String(m.id || '')); break;
      case 'input': {
        const id = String(m.id || '');
        if (!ws.subs.has(id) || this._sessionMode(id) !== 'control' || typeof m.data !== 'string') return;
        this.ptyHost.send({ t: 'write', id, data: m.data.slice(0, 64 * 1024) }).catch(() => {});
        break;
      }
      case 'watch': {
        this._unwatch(ws);
        const wcId = m.wcId | 0, tabId = String(m.tabId || '');
        if (!this._findTab(wcId, tabId)) return;
        ws.watch = { wcId, tabId };
        this._setWatch(wcId, tabId, true);
        break;
      }
      case 'unwatch': this._unwatch(ws); break;
      case 'view': { // robot actuellement affiché sur l'appareil (ou aucun)
        ws.view = m.key ? { wcId: m.wcId | 0, key: String(m.key).slice(0, 32) } : null;
        this._viewersChanged();
        break;
      }
      case 'action': {
        const wcId = m.wcId | 0, tabId = String(m.tabId || '');
        const found = this._findTab(wcId, tabId);
        const reply = (result) => this._send(ws, { t: 'actionResult', req: m.req, result });
        if (!found) return reply({ error: 'Onglet introuvable' });
        // En lecture seule, la fenêtre n'accepte que les actions de consultation (navigation, aperçu)
        const wc = this.getWc(wcId);
        if (!wc || wc.isDestroyed()) return reply({ error: 'Fenêtre fermée' });
        const reqId = `r${++this.seq}`;
        this.pending.set(reqId, ws);
        ws._reqs.set(reqId, m.req);
        wc.send('remote:action', reqId, tabId, String(m.action || ''), m.args && typeof m.args === 'object' ? m.args : {});
        setTimeout(() => { if (this.pending.get(reqId) === ws) this.actionResult(reqId, { error: 'Pas de réponse' }); }, 60000);
        break;
      }
    }
  }
}

Remote.newToken = newToken;
// Fichiers de la page mobile, servis aussi à travers le relais (canal chiffré)
Remote.file = (p) => {
  const entry = STATIC[p === '/index.html' ? '/' : p];
  if (!entry || entry[1].startsWith('image/')) return null;
  try { return { type: entry[1], data: readEntry(entry).toString('utf8') }; } catch { return null; }
};
module.exports = Remote;
