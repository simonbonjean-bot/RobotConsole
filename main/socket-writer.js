// Respecte drain sans laisser les messages suivants dépasser une écriture saturée.
class SocketWriter {
  constructor(socket, pressure = () => {}) {
    this.socket = socket;
    this.pressure = pressure;
    this.queue = [];
    this.blocked = false;
    this.closed = false;
    socket.on('drain', () => { this.blocked = false; this.flush(); });
    socket.on('close', () => this.close(new Error('Connexion aux terminaux fermée')));
    socket.on('error', (error) => this.close(error));
  }

  send(message) {
    if (this.closed) return Promise.reject(new Error('Connexion aux terminaux fermée'));
    return new Promise((resolve, reject) => {
      this.queue.push({ data: JSON.stringify(message) + '\n', resolve, reject });
      this.flush();
    });
  }

  flush() {
    while (!this.blocked && !this.closed && this.queue.length) {
      const item = this.queue.shift();
      try {
        this.blocked = !this.socket.write(item.data, (error) => error ? item.reject(error) : item.resolve());
      } catch (error) { item.reject(error); this.close(error); }
    }
    this.pressure(this.blocked);
  }

  close(error) {
    this.closed = true;
    for (const item of this.queue.splice(0)) item.reject(error);
    this.pressure(false);
  }
}

module.exports = SocketWriter;
