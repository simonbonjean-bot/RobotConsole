const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');

function socketPath(name) {
  const dir = path.join(os.tmpdir(), `robotconsole-${process.getuid()}`);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const stat = fs.lstatSync(dir);
  if (!stat.isDirectory() || stat.uid !== process.getuid() || (stat.mode & 0o077)) {
    throw new Error(`Dossier de sockets non privé : ${dir}`);
  }
  return path.join(dir, name + '.sock');
}

function listenLocal(server, endpoint) {
  const listen = () => new Promise((resolve, reject) => {
    const error = (e) => { server.removeListener('listening', ready); reject(e); };
    const ready = () => { server.removeListener('error', error); resolve(); };
    server.once('error', error);
    server.once('listening', ready);
    server.listen(endpoint);
  });
  return listen().catch(async (error) => {
    if (process.platform === 'win32' || error.code !== 'EADDRINUSE') throw error;
    await new Promise((resolve, reject) => {
      const probe = net.connect(endpoint);
      probe.once('connect', () => { probe.destroy(); reject(error); });
      probe.once('error', (e) => e.code === 'ECONNREFUSED' ? resolve() : reject(e));
    });
    const stat = fs.lstatSync(endpoint);
    if (!stat.isSocket() || stat.uid !== process.getuid()) throw error;
    fs.unlinkSync(endpoint);
    await listen();
  }).then(() => {
    if (process.platform !== 'win32') fs.chmodSync(endpoint, 0o600);
  });
}

module.exports = { socketPath, listenLocal };
