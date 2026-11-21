// RobotConsole — connexion à un relais auto-hébergé (robotconsole-relay)
// Le PC se connecte en sortie au relais ; les téléphones du même compte ouvrent des canaux vers lui.
// Chaque canal est chiffré de bout en bout (ECDH P-256 + HKDF-SHA256 → AES-256-GCM) : le relais ne lit rien.
// Un nouveau téléphone doit être approuvé sur le PC (code à 6 chiffres affiché des deux côtés).
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const { EventEmitter } = require('events');
const WebSocket = require('ws');

const PROTOCOL = 1;
const readJson = (p, d) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return d; } };
const writeJson = (p, v) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, JSON.stringify(v, null, 2)); };
const b64 = (buf) => Buffer.from(buf).toString('base64url');
const unb64 = (s) => Buffer.from(String(s || ''), 'base64url');

// Faux WebSocket côté PC : Remote le traite comme un client local
class VirtualSocket extends EventEmitter {
  constructor(sendFn, closeFn) { super(); this.readyState = 1; this.virtual = true; this._send = sendFn; this._close = closeFn; }
  send(s) { if (this.readyState === 1) this._send(String(s)); }
  ping() { setImmediate(() => this.emit('pong')); } // la vivacité est gérée par le relais
  close() { this.terminate(); }
  terminate() { if (this.readyState !== 1) return; this.readyState = 3; this._close(); this.emit('close'); }
}

class Relay {
  constructor({ dataDir, remote, files, approve, onChange, deviceName }) {
    this.file = path.join(dataDir, 'relay.json');
    this.pairFile = path.join(dataDir, 'relay-pairings.json');
    this.keyFile = path.join(dataDir, 'relay-key.json');
    this.remote = remote; // instance de Remote (main/remote.js)
    this.files = files; // (path) -> { type, data } | null : fichiers de la page mobile
    this.approve = approve; // async ({ name, code }) -> bool
    this.onChange = onChange || (() => {});
    this.deviceName = deviceName || os.hostname();
    this.cfg = readJson(this.file, {});
    this.ws = null;
    this.connected = false;
    this.error = null;
    this.retry = 0;
    this.timer = null;
    this.channels = new Map();
    this._key();
  }

  // ---------- Clé du PC (longue durée) ----------
  _key() {
    let k = readJson(this.keyFile, null);
    const ecdh = crypto.createECDH('prime256v1');
    if (k?.priv) ecdh.setPrivateKey(Buffer.from(k.priv, 'hex'));
    else { ecdh.generateKeys(); k = { priv: ecdh.getPrivateKey('hex') }; writeJson(this.keyFile, k); }
    this.ecdh = ecdh;
    this.pub = b64(ecdh.getPublicKey()); // non compressée (65 octets), comme l'export « raw » de WebCrypto
  }

  // ---------- État et réglages ----------
  status() {
    return {
      url: this.cfg.url || '', linked: !!this.cfg.deviceToken, enabled: this.cfg.enabled !== false && !!this.cfg.deviceToken,
      connected: this.connected, error: this.error, user: this.cfg.user || null, deviceId: this.cfg.deviceId || null, deviceName: this.cfg.deviceName || null,
      phones: Object.entries(this.pairings()).map(([id, p]) => ({ id, name: p.name, added: p.added, seen: p.seen, online: [...this.channels.values()].some((c) => c.clientId === id && c.ready) })),
    };
  }
  _save() { writeJson(this.file, this.cfg); }
  pairings() { return readJson(this.pairFile, {}); }
  forgetPhone(id) {
    const p = this.pairings();
    delete p[id];
    writeJson(this.pairFile, p);
    for (const c of this.channels.values()) if (c.clientId === id) this._closeChannel(c, true);
    this.onChange();
  }
  // Lien du robot pour le QR code
  robotLink(rid) {
    if (!this.connected || !this.cfg.url || !this.cfg.deviceId) return null;
    return `${this.cfg.url}/?pc=${encodeURIComponent(this.cfg.deviceId)}#/r/${encodeURIComponent(rid)}`;
  }

  static normUrl(u) {
    let s = String(u || '').trim().replace(/\/+$/, '');
    if (s && !/^https?:\/\//i.test(s)) s = 'https://' + s;
    const url = new URL(s);
    if (url.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(url.hostname)) throw new Error('Le relais doit être en HTTPS');
    return url.origin + url.pathname.replace(/\/+$/, '');
  }

  // ---------- Connexion du PC au compte (navigateur + code PKCE, retour sur 127.0.0.1) ----------
  async login(rawUrl, openExternal) {
    const url = Relay.normUrl(rawUrl);
    const info = await fetch(`${url}/api/info`).then((r) => r.json()).catch(() => null);
    if (!info || info.protocol == null) throw new Error('Aucun relais RobotConsole à cette adresse');
    if (info.protocol !== PROTOCOL) throw new Error(`Version de relais incompatible (protocole ${info.protocol}, attendu ${PROTOCOL})`);
    const verifier = b64(crypto.randomBytes(32));
    const challenge = b64(crypto.createHash('sha256').update(verifier).digest());
    const state = b64(crypto.randomBytes(16));
    const { code, redirect } = await new Promise((resolve, reject) => {
      const srv = http.createServer((req, res) => {
        const u = new URL(req.url, 'http://127.0.0.1');
        if (u.pathname !== '/cb') { res.writeHead(404); return res.end(); }
        const page = (msg) => `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><body style="font-family:system-ui;background:#0e1117;color:#c9d1d9;display:grid;place-items:center;height:90vh"><div style="text-align:center"><h2>RobotConsole</h2><p>${msg}</p></div>`;
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        if (u.searchParams.get('state') !== state) { res.end(page('Réponse inattendue.')); return; }
        const err = u.searchParams.get('error');
        res.end(page(err ? 'Autorisation refusée. Vous pouvez fermer cet onglet.' : 'PC relié ✓ Vous pouvez fermer cet onglet et revenir à RobotConsole.'));
        clearTimeout(to);
        srv.close();
        if (err) reject(new Error('Autorisation refusée'));
        else resolve({ code: u.searchParams.get('code'), redirect: `http://127.0.0.1:${srv.address()?.port || port}/cb` });
      });
      let port = 0;
      const to = setTimeout(() => { srv.close(); reject(new Error('Délai dépassé : aucune réponse du navigateur')); }, 5 * 60 * 1000);
      srv.listen(0, '127.0.0.1', () => {
        port = srv.address().port;
        const q = new URLSearchParams({ redirect_uri: `http://127.0.0.1:${port}/cb`, state, code_challenge: challenge, code_challenge_method: 'S256', device_name: this.deviceName });
        openExternal(`${url}/device/authorize?${q}`);
      });
    });
    const r = await fetch(`${url}/api/device/token`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code, code_verifier: verifier, redirect_uri: redirect }) }).then((x) => x.json());
    if (r.error) throw new Error(r.error === 'too_many_devices' ? 'Trop de PC reliés à ce compte' : `Échec de l'autorisation (${r.error})`);
    this.cfg = { url, deviceId: r.device_id, deviceToken: r.device_token, deviceName: r.device_name, user: r.user, enabled: true };
    this._save();
    this.start();
    return this.status();
  }

  async logout() {
    const { url, deviceToken } = this.cfg;
    this.stop();
    if (url && deviceToken) await fetch(`${url}/api/device/revoke`, { method: 'POST', headers: { Authorization: `Bearer ${deviceToken}` } }).catch(() => {});
    this.cfg = { url };
    this._save();
    this.onChange();
    return this.status();
  }

  setEnabled(on) {
    this.cfg.enabled = !!on;
    this._save();
    if (on) this.start(); else this.stop();
    return this.status();
  }

  // ---------- Connexion sortante ----------
  start() {
    this.stop(true);
    if (!this.cfg.deviceToken || this.cfg.enabled === false) return;
    this.stopped = false;
    const ws = new WebSocket(`${this.cfg.url.replace(/^http/, 'ws')}/ws/host`, { headers: { Authorization: `Bearer ${this.cfg.deviceToken}` }, maxPayload: 4 * 1024 * 1024 });
    this.ws = ws;
    ws.on('open', () => { this.connected = true; this.error = null; this.retry = 0; this.onChange(); });
    ws.on('message', (raw) => { let m; try { m = JSON.parse(String(raw)); } catch { return; } this._onRelay(m); });
    ws.on('unexpected-response', (_req, res) => {
      this.error = res.statusCode === 401 ? 'Ce PC n\'est plus relié au compte (délié depuis le relais)' : `Relais : erreur ${res.statusCode}`;
      if (res.statusCode === 401) { this.cfg.deviceToken = null; this._save(); }
    });
    ws.on('error', (e) => { if (!this.error) this.error = e.code === 'ENOTFOUND' ? 'Relais introuvable' : e.code === 'ECONNREFUSED' ? 'Relais injoignable' : String(e.message || e); });
    ws.on('close', (code) => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.connected = false;
      for (const c of [...this.channels.values()]) this._closeChannel(c, false);
      if (code === 4010) { this.error = 'Ce PC a été délié depuis le relais'; this.cfg.deviceToken = null; this._save(); }
      this.onChange();
      if (this.stopped || !this.cfg.deviceToken) return;
      const delay = Math.min(30000, 1000 * 2 ** this.retry++);
      this.timer = setTimeout(() => this.start(), delay);
    });
  }
  stop(silent) {
    this.stopped = true;
    clearTimeout(this.timer);
    const ws = this.ws;
    this.ws = null;
    this.connected = false;
    for (const c of [...this.channels.values()]) this._closeChannel(c, false);
    if (ws) { try { ws.close(); } catch {} }
    if (!silent) this.onChange();
  }
  _relaySend(m) { if (this.ws?.readyState === 1) this.ws.send(JSON.stringify(m)); }

  _onRelay(m) {
    if (m.t === 'welcome') { if (m.device?.name) this.cfg.deviceName = m.device.name; return; }
    if (m.t === 'open') { this.channels.set(m.ch, { ch: m.ch, ua: m.client?.ua || '', ready: false, inN: 0, outN: 0 }); return; }
    const c = this.channels.get(m.ch);
    if (!c) return;
    if (m.t === 'closed') return this._closeChannel(c, false);
    if (m.t === 'msg') this._onChannel(c, m.d).catch((e) => console.error('[relay]', e));
  }

  _closeChannel(c, notify) {
    if (!this.channels.has(c.ch)) return;
    this.channels.delete(c.ch);
    c.ready = false;
    if (notify) this._relaySend({ t: 'close', ch: c.ch });
    c.sock?.terminate();
    this.onChange();
  }

  // ---------- Canal chiffré ----------
  _sas(pubPhone) {
    const h = crypto.createHash('sha256').update(Buffer.concat([Buffer.from('rc-sas-v1'), unb64(pubPhone), unb64(this.pub)])).digest();
    const s = String(h.readUInt32BE(0) % 1000000).padStart(6, '0');
    return `${s.slice(0, 3)} ${s.slice(3)}`;
  }
  _iv(dir, n) { const b = Buffer.alloc(12); b[0] = dir; b.writeUInt32BE(Math.floor(n / 2 ** 32), 4); b.writeUInt32BE(n >>> 0, 8); return b; }
  _encrypt(c, obj) {
    if (!this.channels.has(c.ch)) return;
    const n = ++c.outN;
    const cipher = crypto.createCipheriv('aes-256-gcm', c.key, this._iv(2, n));
    const ct = Buffer.concat([cipher.update(JSON.stringify(obj), 'utf8'), cipher.final(), cipher.getAuthTag()]);
    this._relaySend({ t: 'msg', ch: c.ch, d: JSON.stringify({ t: 'e', n, d: b64(ct) }) });
  }
  _decrypt(c, m) {
    if (!(m.n > c.inN)) return null;
    try {
      const buf = unb64(m.d);
      const d = crypto.createDecipheriv('aes-256-gcm', c.key, this._iv(1, m.n));
      d.setAuthTag(buf.subarray(buf.length - 16));
      const out = Buffer.concat([d.update(buf.subarray(0, buf.length - 16)), d.final()]).toString('utf8');
      c.inN = m.n;
      return JSON.parse(out);
    } catch { return null; }
  }

  async _onChannel(c, d) {
    let m; try { m = JSON.parse(d); } catch { return; }
    if (m.t === 'hello' && !c.hello) {
      if (m.v !== 1 || typeof m.pub !== 'string' || typeof m.id !== 'string' || typeof m.nonce !== 'string') return this._closeChannel(c, true);
      c.hello = m;
      c.clientId = m.id.slice(0, 40);
      const nonce = crypto.randomBytes(16);
      let shared;
      try { shared = this.ecdh.computeSecret(unb64(m.pub)); } catch { return this._closeChannel(c, true); }
      c.key = Buffer.from(crypto.hkdfSync('sha256', shared, Buffer.concat([unb64(m.nonce), nonce]), Buffer.from('rc-e2e-v1'), 32));
      const known = this.pairings()[c.clientId];
      const paired = !!known && known.pub === m.pub;
      this._relaySend({ t: 'msg', ch: c.ch, d: JSON.stringify({ t: 'hello', v: 1, pub: this.pub, nonce: b64(nonce), paired }) });
      if (!paired) {
        const name = String(m.name || 'Appareil').slice(0, 60);
        const ok = await this.approve({ name, code: this._sas(m.pub), changed: !!known }).catch(() => false);
        if (!this.channels.has(c.ch)) return;
        if (!ok) { this._relaySend({ t: 'msg', ch: c.ch, d: JSON.stringify({ t: 'denied' }) }); return this._closeChannel(c, true); }
        const all = this.pairings();
        all[c.clientId] = { pub: m.pub, name, added: Date.now(), seen: Date.now() };
        writeJson(this.pairFile, all);
      } else {
        const all = this.pairings();
        all[c.clientId].seen = Date.now();
        writeJson(this.pairFile, all);
      }
      c.ready = true;
      this._encrypt(c, { t: 'ready' });
      // Remote voit ce téléphone comme un client de plus (mêmes robots ouverts, mêmes droits)
      c.sock = new VirtualSocket((s) => this._encrypt(c, { t: 'app', s }), () => this._closeChannel(c, true));
      this.remote.attachVirtual(c.sock);
      this.onChange();
      return;
    }
    if (m.t !== 'e' || !c.ready) return;
    const obj = this._decrypt(c, m);
    if (!obj) return;
    if (obj.t === 'app' && typeof obj.s === 'string') c.sock?.emit('message', obj.s);
    else if (obj.t === 'file') {
      const f = this.files(String(obj.path || ''));
      this._encrypt(c, f ? { t: 'file', id: obj.id, type: f.type, data: f.data } : { t: 'file', id: obj.id, error: 'not_found' });
    }
  }
}

module.exports = Relay;
