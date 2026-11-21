// RobotConsole — hôte des terminaux (processus indépendant de la fenêtre)
// Lancé avec ELECTRON_RUN_AS_NODE=1. Garde les shells vivants quand l'application est fermée,
// et rejoue la sortie récente quand l'application se reconnecte.
const net = require('net');
const pty = require('@lydell/node-pty');

const PIPE = process.argv[2];
const MAX_BUFFER = 400 * 1024; // sortie conservée par session (caractères)
const IDLE_EXIT_MS = 60 * 1000; // sans client ni session : on s'arrête

const sessions = new Map(); // id -> { p, buf, alive, exitCode, shellId }
let client = null;
let idleTimer = null;

function send(msg) {
  if (client && !client.destroyed) client.write(JSON.stringify(msg) + '\n');
}

function scheduleIdleExit() {
  clearTimeout(idleTimer);
  if (client || [...sessions.values()].some((s) => s.alive)) return;
  idleTimer = setTimeout(() => process.exit(0), IDLE_EXIT_MS);
}

function create(m) {
  if (sessions.has(m.id)) return;
  let p;
  try {
    p = pty.spawn(m.file, m.args || [], {
      name: 'xterm-256color', cols: Math.max(2, m.cols | 0), rows: Math.max(2, m.rows | 0), cwd: m.cwd, env: m.env,
    });
  } catch (err) {
    send({ t: 'exit', id: m.id, code: -1, error: String(err.message || err) });
    return;
  }
  const s = { p, buf: '', alive: true, exitCode: null, shellId: m.shellId, scope: m.scope || '', pid: p.pid, started: Date.now(), ended: null };
  sessions.set(m.id, s);

  // Commandes de démarrage (modèles d'espace) : envoyées une par une, chaque fois que
  // le shell est resté silencieux un instant (invite affichée et prête).
  const pendingInit = (m.init || []).filter((c) => c.trim());
  let initTimer = null;
  const armInit = (delay) => {
    if (!pendingInit.length) return;
    clearTimeout(initTimer);
    initTimer = setTimeout(() => { if (s.alive && pendingInit.length) p.write(pendingInit.shift() + '\r'); }, delay);
  };
  let outTimer = null, out = '';
  p.onData((d) => {
    s.buf += d;
    if (s.buf.length > MAX_BUFFER) s.buf = s.buf.slice(s.buf.length - MAX_BUFFER);
    out += d;
    if (!outTimer) outTimer = setTimeout(() => { outTimer = null; send({ t: 'data', id: m.id, data: out }); out = ''; }, 8);
    armInit(400);
  });
  p.onExit(({ exitCode }) => {
    if (outTimer) { clearTimeout(outTimer); outTimer = null; send({ t: 'data', id: m.id, data: out }); out = ''; }
    s.alive = false;
    s.ended = Date.now();
    s.exitCode = exitCode;
    send({ t: 'exit', id: m.id, code: exitCode });
    scheduleIdleExit();
  });
}

function kill(id) {
  const s = sessions.get(id);
  if (!s) return;
  sessions.delete(id);
  if (s.alive) { try { s.p.kill(); } catch {} }
  scheduleIdleExit();
}

function handle(m) {
  const s = sessions.get(m.id);
  switch (m.t) {
    case 'hello':
      send({ t: 'sessions', list: [...sessions].map(([id, x]) => ({ id, alive: x.alive, exitCode: x.exitCode, shellId: x.shellId, scope: x.scope, pid: x.p.pid || x.pid, started: x.started, ended: x.ended })) });
      break;
    case 'create': create(m); break;
    case 'attach':
      if (!s) send({ t: 'attached', id: m.id, found: false });
      else {
        if (s.alive && m.cols && m.rows) { try { s.p.resize(Math.max(2, m.cols), Math.max(2, m.rows)); send({ t: 'resized', id: m.id, cols: s.p.cols, rows: s.p.rows }); } catch {} }
        send({ t: 'attached', id: m.id, found: true, data: s.buf, alive: s.alive, exitCode: s.exitCode, shellId: s.shellId, cols: s.p.cols, rows: s.p.rows });
      }
      break;
    case 'write': if (s?.alive) s.p.write(m.data); break;
    case 'resize': if (s?.alive) { try { s.p.resize(Math.max(2, m.cols), Math.max(2, m.rows)); send({ t: 'resized', id: m.id, cols: s.p.cols, rows: s.p.rows }); } catch {} } break;
    case 'kill': kill(m.id); break;
    case 'gc': {
      // Ne touche qu'aux sessions de la même portée (une fenêtre / un workspace)
      const keep = new Set(m.keep || []);
      for (const [id, x] of [...sessions]) if (x.scope === (m.scope || '') && !keep.has(id)) kill(id);
      break;
    }
    case 'shutdown':
      for (const id of [...sessions.keys()]) kill(id);
      process.exit(0);
  }
}

const server = net.createServer((sock) => {
  // Un seul client à la fois : le plus récent gagne
  if (client && !client.destroyed) client.destroy();
  client = sock;
  clearTimeout(idleTimer);
  sock.setEncoding('utf8');
  let acc = '';
  sock.on('data', (chunk) => {
    acc += chunk;
    let i;
    while ((i = acc.indexOf('\n')) >= 0) {
      const line = acc.slice(0, i);
      acc = acc.slice(i + 1);
      if (!line) continue;
      try { handle(JSON.parse(line)); } catch {}
    }
  });
  const gone = () => { if (client === sock) { client = null; scheduleIdleExit(); } };
  sock.on('close', gone);
  sock.on('error', gone);
});

server.on('error', () => process.exit(1)); // un autre hôte écoute déjà
server.listen(PIPE, scheduleIdleExit);
