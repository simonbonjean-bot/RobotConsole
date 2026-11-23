const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

// Only adjacent pending saves may coalesce. Reads, transfers and deletion are barriers.
class StateStore {
  constructor({ io = fs.promises, onError = (error) => console.error('[state]', error) } = {}) {
    this.io = io;
    this.onError = onError;
    this.files = new Map();
  }

  key(file) {
    const absolute = path.resolve(file);
    return process.platform === 'win32' ? absolute.toLowerCase() : absolute;
  }

  enqueue(file, kind, run, text) {
    const key = this.key(file);
    let queue = this.files.get(key);
    if (!queue) this.files.set(key, queue = { pending: [], running: false });
    const last = queue.pending.at(-1);
    if (kind === 'save' && last?.kind === 'save') {
      last.text = text;
      return last.promise;
    }
    let resolve;
    const promise = new Promise((done) => { resolve = done; });
    queue.pending.push({ kind, run, text, promise, resolve });
    if (!queue.running) void this.drain(key, queue);
    return promise;
  }

  async drain(key, queue) {
    queue.running = true;
    while (queue.pending.length) {
      const item = queue.pending.shift();
      try { item.resolve(await item.run(item)); }
      catch (error) { this.onError(error); item.resolve(false); }
    }
    this.files.delete(key);
  }

  async atomicWrite(file, text) {
    const temporary = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.${randomUUID()}.tmp`);
    try {
      await this.io.mkdir(path.dirname(file), { recursive: true });
      await this.io.writeFile(temporary, text, { encoding: 'utf8', flag: 'wx' });
      await this.io.rename(temporary, file);
      return true;
    } finally {
      await this.io.rm(temporary, { force: true }).catch(() => {});
    }
  }

  save(file, value) {
    return this.enqueueWrite(file, value, 'save');
  }

  write(file, value) {
    return this.enqueueWrite(file, value, 'write');
  }

  enqueueWrite(file, value, kind) {
    try {
      const text = JSON.stringify(value, null, 2);
      return this.enqueue(file, kind, (item) => this.atomicWrite(file, item.text), text);
    } catch (error) {
      this.onError(error);
      return Promise.resolve(false);
    }
  }

  async readFile(file, fallback) {
    try { return JSON.parse(await this.io.readFile(file, 'utf8')); }
    catch { return fallback; }
  }

  read(file, fallback = null) {
    return this.enqueue(file, 'read', () => this.readFile(file, fallback));
  }

  update(file, change, fallback = null) {
    return this.enqueue(file, 'update', async () => {
      const value = change(await this.readFile(file, fallback));
      return this.atomicWrite(file, JSON.stringify(value, null, 2));
    });
  }

  remove(file) {
    return this.enqueue(file, 'remove', async () => {
      await this.io.rm(file, { force: true });
      return true;
    });
  }

  async flush(file) {
    for (;;) {
      const queues = file === undefined ? [...this.files.values()] : [this.files.get(this.key(file))].filter(Boolean);
      if (!queues.length) return;
      // An active item has already left pending; a barrier also waits for it.
      if (file !== undefined) await this.enqueue(file, 'flush', () => true);
      else await Promise.all([...this.files.keys()].map((key) => this.enqueue(key, 'flush', () => true)));
    }
  }
}

module.exports = { StateStore };
