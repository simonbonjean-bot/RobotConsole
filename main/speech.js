const net = require('net');
const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');

function pipeFor(userData) {
  const hash = crypto.createHash('sha256').update(path.resolve(userData).toLowerCase()).digest('hex').slice(0, 16);
  return process.platform === 'win32' ? `\\\\.\\pipe\\robotconsole-speech-${hash}` : path.join(os.tmpdir(), `robotconsole-speech-${hash}.sock`);
}

class Speech {
  constructor({ userData, deliver }) {
    this.pipe = pipeFor(userData);
    this.historyFile = path.join(userData, 'speech-history.jsonl');
    this.deliver = deliver;
    this.windows = new Map();
    this.sockets = new Set();
  }

  publish(wcId, robots) { this.windows.set(wcId, robots); }
  dropWindow(wcId) { this.windows.delete(wcId); }
  list() {
    return [...this.windows].flatMap(([wcId, robots]) => robots.map((robot) => ({ ...robot, wcId })));
  }

  target({ robot, session, cwd }) {
    let candidates = this.list();
    if (robot) candidates = candidates.filter((r) => r.rid === robot || r.name === robot);
    else if (session) candidates = candidates.filter((r) => r.sessions.includes(session));
    else {
      const contains = (root) => {
        const relative = path.relative(path.resolve(root), path.resolve(cwd));
        return !relative || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative));
      };
      candidates = candidates.filter((r) => cwd && r.roots.some(contains));
    }
    if (!candidates.length) throw new Error('Aucun robot correspondant. Ouvrez RobotConsole ou utilisez --robot avec un identifiant de --list.');
    if (candidates.length !== 1) throw new Error('Plusieurs robots correspondent. Utilisez --robot avec un identifiant de --list.');
    return candidates[0];
  }

  record(entry) {
    if (typeof entry.text !== 'string' || !entry.text.trim() || entry.text.length > 4000) throw new Error('Message vide ou trop long (4000 caractères maximum).');
    const record = { id: crypto.randomUUID(), at: new Date().toISOString(), rid: entry.rid, name: entry.name, text: entry.text, source: entry.source || 'app' };
    fs.mkdirSync(path.dirname(this.historyFile), { recursive: true });
    fs.appendFileSync(this.historyFile, JSON.stringify(record) + '\n', { mode: 0o600 });
    return record;
  }

  history(rid, limit = 200) {
    const entries = this.readHistory().filter((entry) => entry.rid === rid);
    return limit === null ? entries : entries.slice(-limit);
  }

  readHistory() {
    if (!fs.existsSync(this.historyFile)) return [];
    let migrated = false;
    const entries = fs.readFileSync(this.historyFile, 'utf8').split('\n').filter(Boolean).map((line) => {
      const entry = JSON.parse(line);
      if (!entry.id) { entry.id = crypto.randomUUID(); migrated = true; }
      return entry;
    });
    if (migrated) this.writeHistory(entries);
    return entries;
  }

  writeHistory(entries) {
    const temporary = `${this.historyFile}.${crypto.randomUUID()}.tmp`;
    try {
      fs.writeFileSync(temporary, entries.map((entry) => JSON.stringify(entry) + '\n').join(''), { mode: 0o600, flag: 'wx' });
      fs.renameSync(temporary, this.historyFile);
    } finally {
      if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    }
  }

  remove(rid, id = null) {
    if (typeof rid !== 'string' || !rid || (id !== null && (typeof id !== 'string' || !id))) throw new Error('Cible de suppression invalide.');
    const entries = this.readHistory();
    const kept = entries.filter((entry) => entry.rid !== rid || (id !== null && entry.id !== id));
    const removed = entries.length - kept.length;
    if (id !== null && !removed) throw new Error('Message introuvable ou déjà supprimé.');
    if (removed) this.writeHistory(kept);
    return removed;
  }

  async handle(message) {
    if (message.action === 'list') return this.list().map(({ rid, name }) => ({ rid, name }));
    const target = this.target(message);
    if (message.action === 'history') return this.history(target.rid);
    if (message.action !== 'say') throw new Error('Action inconnue.');
    if (typeof message.text !== 'string' || !message.text.trim() || message.text.length > 4000) throw new Error('Message vide ou trop long (4000 caractères maximum).');
    await this.deliver(target, message.text);
    return { rid: target.rid, name: target.name };
  }

  start() {
    this.server = net.createServer((socket) => {
      this.sockets.add(socket);
      socket.on('close', () => this.sockets.delete(socket));
      socket.on('error', () => socket.destroy());
      socket.setEncoding('utf8');
      socket.setTimeout(10000, () => socket.destroy());
      let buffer = '';
      socket.on('data', (chunk) => {
        buffer += chunk;
        if (Buffer.byteLength(buffer) > 32768) { socket.destroy(); return; }
        const end = buffer.indexOf('\n');
        if (end < 0) return;
        socket.removeAllListeners('data');
        Promise.resolve().then(() => this.handle(JSON.parse(buffer.slice(0, end))))
          .then((result) => socket.end(JSON.stringify({ ok: true, result }) + '\n'),
            (error) => socket.end(JSON.stringify({ ok: false, error: error.message }) + '\n'));
      });
    });
    return new Promise((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(this.pipe, () => {
        this.server.removeListener('error', reject);
        this.server.on('error', (error) => console.error('[speech]', error));
        if (process.platform !== 'win32') fs.chmodSync(this.pipe, 0o600);
        resolve();
      });
    });
  }

  stop() {
    for (const socket of this.sockets) socket.destroy();
    this.server?.close();
  }
}

module.exports = { Speech, pipeFor };
