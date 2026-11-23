const net = require('net');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { pathKey } = require('./platform');
const { socketPath, listenLocal } = require('./local-socket');

function pipeFor(userData) {
  const hash = crypto.createHash('sha256').update(pathKey(path.resolve(userData))).digest('hex').slice(0, 16);
  return process.platform === 'win32' ? `\\\\.\\pipe\\robotconsole-speech-${hash}` : socketPath(`speech-${hash}`);
}

class Speech {
  constructor({ userData, deliver }) {
    this.pipe = pipeFor(userData);
    this.historyFile = path.join(userData, 'speech-history.jsonl');
    this.deliver = deliver;
    this.windows = new Map();
    this.sockets = new Set();
    this.historyQueue = Promise.resolve();
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
    return this.historyOperation(async () => {
      await fs.promises.mkdir(path.dirname(this.historyFile), { recursive: true });
      const file = await fs.promises.open(this.historyFile, 'a+', 0o600);
      try {
        const { size } = await file.stat();
        const last = Buffer.alloc(1);
        if (size) await file.read(last, 0, 1, size - 1);
        await file.writeFile((size && last[0] !== 10 ? '\n' : '') + JSON.stringify(record) + '\n');
      } finally { await file.close(); }
      return record;
    });
  }

  historyOperation(operation) {
    const result = this.historyQueue.then(operation);
    this.historyQueue = result.catch(() => {});
    return result;
  }

  history(rid, limit = 200) {
    return this.historyOperation(async () => {
      const entries = [];
      let cursor = null;
      do {
        const page = await this.readHistoryPage(rid, { cursor, limit: limit === null ? 200 : Math.min(200, limit - entries.length) });
        entries.unshift(...page.entries);
        cursor = page.nextCursor;
      } while (cursor && (limit === null || entries.length < limit));
      return entries;
    });
  }

  historyPage(rid, options = {}) {
    return this.historyOperation(() => this.readHistoryPage(rid, options));
  }

  historyEntry(line, offset) {
    const entry = JSON.parse(line.toString('utf8'));
    // Legacy IDs are stable across reads/restarts without rewriting the entire log.
    // A deletion persists these IDs before offsets can change.
    if (!entry.id) entry.id = `legacy-${crypto.createHash('sha256').update(String(offset)).update(':').update(line).digest('hex')}`;
    return entry;
  }

  async readHistoryPage(rid, options = {}) {
    if (typeof rid !== 'string' || !rid || !options || typeof options !== 'object') throw new Error('Historique invalide.');
    const { cursor = null, limit = 100 } = options;
    if (!Number.isInteger(limit) || limit < 1 || limit > 200) throw new Error('Limite d’historique invalide.');
    let previous = null;
    if (cursor !== null) {
      try {
        if (typeof cursor !== 'string' || cursor.length > 2048) throw new Error();
        previous = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
        if (previous.rid !== rid || !Number.isSafeInteger(previous.offset) || previous.offset < 0 || typeof previous.file !== 'string') throw new Error();
      } catch { throw new Error('Curseur d’historique invalide. Actualisez les messages.'); }
    }
    let file;
    try {
      file = await fs.promises.open(this.historyFile, 'r');
    } catch (error) {
      if (error.code === 'ENOENT' && !previous) return { entries: [], nextCursor: null };
      throw error;
    }
    try {
      const stat = await file.stat();
      const identity = `${stat.dev}:${stat.ino}:${stat.birthtimeMs}`;
      if (previous && (previous.file !== identity || previous.offset > stat.size)) throw new Error('Historique modifié. Actualisez les messages.');
      let position = previous ? previous.offset : stat.size;
      let end = position, carry = Buffer.alloc(0), scanned = 0;
      const entries = [];
      const page = (offset) => ({
        entries: entries.reverse(),
        nextCursor: offset > 0 ? Buffer.from(JSON.stringify({ rid, file: identity, offset })).toString('base64url') : null,
      });
      while (position > 0) {
        const start = Math.max(0, position - 64 * 1024);
        const chunk = Buffer.alloc(position - start);
        const { bytesRead } = await file.read(chunk, 0, chunk.length, start);
        if (bytesRead !== chunk.length) throw new Error('Historique modifié. Actualisez les messages.');
        const data = Buffer.concat([chunk, carry]);
        let lineEnd = data.length;
        for (let i = data.length - 1; i >= 0; i--) {
          if (data[i] !== 10) continue;
          const offset = start + i + 1;
          const line = data.subarray(i + 1, lineEnd);
          if (line.length) {
            const entry = this.historyEntry(line, offset);
            if (entry.rid === rid) entries.push(entry);
          }
          scanned += end - offset;
          end = offset;
          if (entries.length >= limit || scanned >= 512 * 1024) return page(offset);
          lineEnd = i;
        }
        carry = data.subarray(0, lineEnd);
        position = start;
      }
      if (carry.length) {
        const entry = this.historyEntry(carry, 0);
        if (entry.rid === rid) entries.push(entry);
      }
      return page(0);
    } finally { await file.close(); }
  }

  remove(rid, id = null) {
    if (typeof rid !== 'string' || !rid || (id !== null && (typeof id !== 'string' || !id))) throw new Error('Cible de suppression invalide.');
    return this.historyOperation(async () => {
      const temporary = `${this.historyFile}.${crypto.randomUUID()}.tmp`;
      let output, input, removed = 0;
      try {
        try { input = await fs.promises.open(this.historyFile, 'r'); }
        catch (error) {
          if (error.code !== 'ENOENT') throw error;
          if (id !== null) throw new Error('Message introuvable ou déjà supprimé.');
          return 0;
        }
        output = await fs.promises.open(temporary, 'wx', 0o600);
        let carry = Buffer.alloc(0), offset = 0;
        const keep = (line) => {
          if (!line.length) return '';
          const entry = this.historyEntry(line, offset);
          if (entry.rid === rid && (id === null || entry.id === id)) { removed++; return ''; }
          return JSON.stringify(entry) + '\n';
        };
        for await (const chunk of input.createReadStream({ autoClose: false })) {
          const data = Buffer.concat([carry, chunk]);
          let start = 0, text = '';
          for (let i = 0; i < data.length; i++) {
            if (data[i] !== 10) continue;
            text += keep(data.subarray(start, i));
            offset += i + 1 - start;
            start = i + 1;
          }
          carry = data.subarray(start);
          if (text) await output.writeFile(text);
        }
        if (carry.length) await output.writeFile(keep(carry));
        await input.close(); input = null;
        await output.close(); output = null;
        if (id !== null && !removed) throw new Error('Message introuvable ou déjà supprimé.');
        if (removed) await fs.promises.rename(temporary, this.historyFile);
        return removed;
      } finally {
        await input?.close();
        await output?.close();
        await fs.promises.unlink(temporary).catch((error) => { if (error.code !== 'ENOENT') throw error; });
      }
    });
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
    return listenLocal(this.server, this.pipe).then(() => {
      this.server.on('error', (error) => console.error('[speech]', error));
    });
  }

  stop() {
    for (const socket of this.sockets) socket.destroy();
    this.server?.close();
  }
}

module.exports = { Speech, pipeFor };
