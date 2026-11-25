// RobotConsole — hôte des terminaux (processus indépendant de la fenêtre)
// Lancé avec ELECTRON_RUN_AS_NODE=1. Garde les shells vivants quand l'application est fermée,
// et rejoue la sortie récente quand l'application se reconnecte.
const net = require('net');
const pty = require('@lydell/node-pty');
const { listenLocal } = require('./local-socket');
const SocketWriter = require('./socket-writer');

const PIPE = process.argv[2];
const MAX_BUFFER = 400 * 1024; // sortie conservée par session (caractères)
const IDLE_EXIT_MS = 60 * 1000; // sans client ni session : on s'arrête

const sessions = new Map(); // id -> { p, buf, alive, exitCode, shellId }
let client = null;
let idleTimer = null;
let writer = null;
let transportBlocked = false;
let flowControl = false;
const HIGH_WATER = 256 * 1024;
const LOW_WATER = 64 * 1024;

function regulate(s) {
  const pause = !!client && (transportBlocked || (flowControl && s.pending >= HIGH_WATER) || (s.paused && flowControl && s.pending > LOW_WATER));
  if (!s.alive || pause === !!s.paused) return;
  s.paused = pause;
  if (pause) s.p.pause(); else s.p.resume();
}

function send(msg) {
  if (writer && client && !client.destroyed) {
    if (msg.t === 'data' && flowControl) {
      const s = sessions.get(msg.id);
      if (s) { s.pending += msg.data.length; regulate(s); }
    }
    const target = client;
    writer.send(msg).catch((error) => { if (client === target && !target.destroyed) { console.error('[ptyhost:send]', error); target.destroy(); } });
  }
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
  const s = { p, pending: 0, segs: [segment(p.cols, p.rows)], size: 0, alive: true, exitCode: null, shellId: m.shellId, cwd: m.cwd, scope: m.scope || '', pid: p.pid, started: Date.now(), ended: null };
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
  // Envoie tout de suite la sortie en attente (avant un redimensionnement, un rattachement, la fin)
  s.flush = () => { if (outTimer) { clearTimeout(outTimer); outTimer = null; } if (out) { send({ t: 'data', id: m.id, data: out }); out = ''; } };
  p.onData((d) => {
    record(s, d);
    out += d;
    if (out.length >= 32 * 1024) s.flush();
    else if (!outTimer) outTimer = setTimeout(s.flush, 8);
    armInit(400);
  });
  regulate(s);
  s.finish = (exitCode) => {
    if (!s.alive) return;
    s.flush();
    clearTimeout(initTimer);
    s.alive = false;
    s.ended = Date.now();
    s.exitCode = exitCode;
    send({ t: 'exit', id: m.id, code: exitCode });
    scheduleIdleExit();
  };
  p.onExit(({ exitCode }) => s.finish(exitCode));
}

// Sortie conservée par morceaux, chacun avec la taille du terminal au moment où il a été produit :
// le rejeu redimensionne aux mêmes moments, sinon les lignes se coupent ailleurs et les programmes
// qui redessinent en remontant le curseur (Claude Code, vim…) s'affichent en vrac.
function segment(cols, rows) {
  return { cols, rows, chunks: [], head: 0, offset: 0, size: 0 };
}
function record(s, d) {
  if (!d) return;
  const last = s.segs[s.segs.length - 1];
  last.chunks.push(d);
  last.size += d.length;
  s.size += d.length;
  while (s.size > MAX_BUFFER && s.segs.length > 1) { s.size -= s.segs[0].size; s.segs.shift(); }
  let cut = Math.max(0, s.size - MAX_BUFFER);
  last.size -= cut;
  s.size -= cut;
  while (cut > 0) {
    const available = last.chunks[last.head].length - last.offset;
    if (cut < available) { last.offset += cut; break; }
    cut -= available;
    last.chunks[last.head++] = null;
    last.offset = 0;
  }
  if (last.head >= 1024 && last.head * 2 >= last.chunks.length) {
    last.chunks = last.chunks.slice(last.head);
    last.head = 0;
  }
  if (last.chunks[last.head]?.length > MAX_BUFFER) {
    last.chunks[last.head] = last.chunks[last.head].slice(last.offset);
    last.offset = 0;
  }
}
function segmentData(g) {
  // L'historique n'est assemblé qu'au rattachement, pas à chaque écho de frappe.
  return (g.chunks[g.head] || '').slice(g.offset) + g.chunks.slice(g.head + 1).join('');
}
function resize(id, s, cols, rows) {
  if (!s.alive) return;
  s.flush(); // la sortie produite à l'ancienne taille part avant « resized »
  try { s.p.resize(Math.max(2, cols | 0), Math.max(2, rows | 0)); } catch { return; }
  const last = s.segs[s.segs.length - 1];
  if (last.cols !== s.p.cols || last.rows !== s.p.rows) {
    if (!last.size) { last.cols = s.p.cols; last.rows = s.p.rows; }
    else s.segs.push(segment(s.p.cols, s.p.rows));
  }
  send({ t: 'resized', id, cols: s.p.cols, rows: s.p.rows });
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
    case 'flow':
      flowControl = m.enabled === true;
      for (const x of sessions.values()) { x.pending = 0; regulate(x); }
      break;
    case 'ack':
      if (s && Number.isSafeInteger(m.size) && m.size > 0) { s.pending = Math.max(0, s.pending - m.size); regulate(s); }
      break;
    case 'hello':
      send({ t: 'sessions', capabilities: { terminate: true }, list: [...sessions].map(([id, x]) => ({ id, alive: x.alive, exitCode: x.exitCode, shellId: x.shellId, cwd: x.cwd, scope: x.scope, pid: x.p.pid || x.pid, started: x.started, ended: x.ended })) });
      break;
    case 'create': create(m); break;
    case 'attach':
      if (!s) send({ t: 'attached', id: m.id, found: false });
      else {
        s.flush?.(); // tout ce qui est parti avant « attached » fait partie du rejeu
        if (m.cols && m.rows) resize(m.id, s, m.cols, m.rows);
        const segs = s.segs.filter((g, i) => g.size || i === s.segs.length - 1)
          .map((g) => ({ cols: g.cols, rows: g.rows, data: segmentData(g) }));
        send({ t: 'attached', id: m.id, found: true, data: segs.map((g) => g.data).join(''), segs, alive: s.alive, exitCode: s.exitCode, shellId: s.shellId, cols: s.p.cols, rows: s.p.rows });
      }
      break;
    case 'write': if (s?.alive) s.p.write(m.data); break;
    case 'resize': if (s) resize(m.id, s, m.cols, m.rows); break;
    case 'kill': kill(m.id); break;
    case 'terminate':
      try {
        if (s?.alive) { s.p.kill(); s.finish(-1); }
        sessions.delete(m.id);
        send({ t: 'terminated', id: m.id });
        scheduleIdleExit();
      } catch (error) {
        send({ t: 'terminated', id: m.id, error: String(error.message || error) });
      }
      break;
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
  // Une sonde de socket ne doit pas déconnecter le véritable client.
  sock.setTimeout(5000, () => sock.destroy());
  sock.setEncoding('utf8');
  let acc = '';
  sock.on('data', (chunk) => {
    if (client !== sock) {
      if (client && !client.destroyed) client.destroy();
      client = sock;
      transportBlocked = false;
      flowControl = false;
      writer = new SocketWriter(sock, (blocked) => {
        if (client !== sock) return;
        transportBlocked = blocked;
        for (const s of sessions.values()) regulate(s);
      });
      for (const s of sessions.values()) { s.pending = 0; regulate(s); }
      clearTimeout(idleTimer);
      sock.setTimeout(0);
    }
    acc += chunk;
    let i;
    while ((i = acc.indexOf('\n')) >= 0) {
      const line = acc.slice(0, i);
      acc = acc.slice(i + 1);
      if (!line) continue;
      try { handle(JSON.parse(line)); } catch {}
    }
  });
  const gone = () => {
    if (client === sock) {
      client = null; writer = null; transportBlocked = false; flowControl = false;
      for (const s of sessions.values()) { s.pending = 0; regulate(s); }
      scheduleIdleExit();
    }
  };
  sock.on('close', gone);
  sock.on('error', gone);
});

listenLocal(server, PIPE).then(() => {
  server.on('error', (error) => { console.error('[ptyhost]', error); process.exit(1); });
  scheduleIdleExit();
}, (error) => { console.error('[ptyhost]', error); process.exit(1); });
