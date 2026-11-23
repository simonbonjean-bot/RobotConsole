class TerminalFlow {
  constructor(acknowledge) {
    this.acknowledge = acknowledge;
    this.pending = new Map();
    this.sequence = 0;
  }

  track(id, size, consumers) {
    const token = ++this.sequence;
    const waiting = new Set(consumers);
    if (waiting.size) this.pending.set(token, { id, size, waiting });
    else this.acknowledge(id, size);
    return token;
  }

  consumed(id, token, consumer) {
    const item = this.pending.get(token);
    if (!item || item.id !== id || !item.waiting.delete(consumer)) return;
    if (!item.waiting.size) {
      this.pending.delete(token);
      this.acknowledge(id, item.size);
    }
  }

  detach(consumer, id) {
    for (const [token, item] of this.pending) {
      if (id === undefined || item.id === id) this.consumed(item.id, token, consumer);
    }
  }
}

module.exports = TerminalFlow;
