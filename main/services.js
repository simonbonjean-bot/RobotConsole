// RobotConsole — services d'un workspace (.robot/services.json)
// Chaque service tourne dans le service des terminaux (il survit donc à la fermeture de l'app).
// Ce module suit leur état, détecte les ports ouverts, vérifie une URL de santé et redémarre
// automatiquement un service planté si demandé.
const { execFile } = require('child_process');
const net = require('net');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const Workspace = require('./workspace');
const { pathKey } = require('./platform');
const { unixSnapshot } = require('./system-snapshot');

const PROBE_MS = 4000;

class Services {
  constructor({ ptyHost, shells }) {
    this.ptyHost = ptyHost;
    this.shells = shells;
    this.ws = new Map(); // root -> { defs, st: Map(id -> état), subs: Set(webContents) }
    this.bySession = new Map(); // sessionId -> { root, id }
    this.timer = null;
  }

  scope(root) { return 'svc:' + pathKey(root); }

  defsOf(root) {
    const data = Workspace.readJson(Workspace.file(root, 'services.json'), { services: [] });
    return (data.services || []).map((s, i) => ({ id: s.id || `svc${i + 1}`, ...s }));
  }

  saveDefs(root, defs) {
    Workspace.writeJson(Workspace.file(root, 'services.json'), { services: defs });
    const w = this.ws.get(root);
    if (w) { w.defs = defs; this.push(root); }
  }

  async open(root, wc) {
    let w = this.ws.get(root);
    if (!w) {
      w = { defs: this.defsOf(root), st: new Map(), subs: new Set(), autostarted: false };
      this.ws.set(root, w);
      // Retrouve les services qui tournent encore dans le service des terminaux
      const list = await this.ptyHost.sessions().catch(() => []);
      const scope = this.scope(root);
      for (const s of list.filter((x) => x.scope === scope)) {
        const id = s.id.split('|')[1];
        if (!id) continue;
        const prev = w.st.get(id);
        if (prev && prev.started > s.started) continue;
        w.st.set(id, { sessionId: s.id, state: s.alive ? 'running' : (s.exitCode === 0 ? 'exited' : 'crashed'), exitCode: s.exitCode, started: s.started, ended: s.ended, pid: s.pid, restarts: 0, ports: [], health: null });
        this.bySession.set(s.id, { root, id });
      }
    }
    if (wc) {
      w.subs.add(wc);
      wc.once('destroyed', () => w.subs.delete(wc));
    }
    if (!w.autostarted) {
      w.autostarted = true;
      for (const d of w.defs) if (d.autostart && !this.isRunning(root, d.id)) this.start(root, d.id);
    }
    this.ensureTimer();
    this.push(root);
    this.probe(root);
    return this.snapshot(root);
  }

  reload(root) {
    const w = this.ws.get(root);
    if (!w) return;
    w.defs = this.defsOf(root);
    this.push(root);
  }

  isRunning(root, id) {
    const st = this.ws.get(root)?.st.get(id);
    return st && (st.state === 'running' || st.state === 'starting');
  }

  commandFor(def) {
    const shell = this.shells.find((s) => s.id === def.shellId) || this.shells[0];
    const id = shell.id;
    if (id === 'pwsh' || id === 'powershell') return { shell, args: ['-NoLogo', '-NoProfile', '-Command', def.command] };
    if (id === 'cmd') return { shell, args: ['/d', '/s', '/c', def.command] };
    return { shell, args: ['-lc', def.command] };
  }

  async start(root, id) {
    const w = this.ws.get(root);
    const def = w?.defs.find((d) => d.id === id);
    if (!def || !def.command) return;
    const old = w.st.get(id);
    if (old?.sessionId) { this.ptyHost.send({ t: 'kill', id: old.sessionId }).catch(() => {}); this.bySession.delete(old.sessionId); }
    const sessionId = `svc-${crypto.randomBytes(4).toString('hex')}|${id}`;
    const { shell, args } = this.commandFor(def);
    let cwd = def.cwd ? path.resolve(root, def.cwd) : root;
    if (!fs.existsSync(cwd)) cwd = root;
    const st = { sessionId, state: 'starting', started: Date.now(), ended: null, exitCode: null, pid: null, restarts: old?.restarts || 0, ports: [], health: null, manualStop: false };
    w.st.set(id, st);
    this.bySession.set(sessionId, { root, id });
    await this.ptyHost.send({
      t: 'create', id: sessionId, scope: this.scope(root), shellId: shell.id, file: shell.file, args,
      cols: 120, rows: 30, cwd,
      env: { ...envNoColor(), TERM: 'xterm-256color', COLORTERM: 'truecolor', FORCE_COLOR: '1', ...(def.env || {}) },
    });
    setTimeout(() => { if (st.state === 'starting') { st.state = 'running'; this.push(root); } }, 1200);
    this.push(root);
    this.probe(root);
    return sessionId;
  }

  stop(root, id) {
    const st = this.ws.get(root)?.st.get(id);
    if (!st?.sessionId) return;
    st.manualStop = true;
    st.state = 'stopped';
    st.ended = Date.now();
    this.ptyHost.send({ t: 'kill', id: st.sessionId }).catch(() => {});
    this.push(root);
  }

  async terminateSession(sessionId) {
    const ref = this.bySession.get(sessionId);
    const st = ref && this.ws.get(ref.root)?.st.get(ref.id);
    if (!st || st.sessionId !== sessionId) return this.ptyHost.terminate(sessionId);
    const previous = st.manualStop;
    st.manualStop = true;
    try { await this.ptyHost.terminate(sessionId); }
    catch (error) { st.manualStop = previous; throw error; }
    st.state = 'stopped';
    st.ended = Date.now();
    st.ports = [];
    this.push(ref.root);
  }

  async restart(root, id) {
    this.stop(root, id);
    await new Promise((r) => setTimeout(r, 400));
    return this.start(root, id);
  }

  // Appelé pour chaque fin de session du service des terminaux
  onExit(sessionId, code) {
    const ref = this.bySession.get(sessionId);
    if (!ref) return false;
    const w = this.ws.get(ref.root);
    const st = w?.st.get(ref.id);
    if (!st || st.sessionId !== sessionId) return true;
    if (st.manualStop) return true;
    st.exitCode = code;
    st.ended = Date.now();
    st.state = code === 0 ? 'exited' : 'crashed';
    st.ports = [];
    const def = w.defs.find((d) => d.id === ref.id);
    if (def?.restart && code !== 0) {
      const recent = (st.crashTimes || []).filter((t) => Date.now() - t < 60000);
      recent.push(Date.now());
      st.crashTimes = recent;
      if (recent.length <= 5) {
        st.state = 'restarting';
        setTimeout(() => {
          const cur = w.st.get(ref.id);
          if (cur === st && !st.manualStop) { this.start(ref.root, ref.id).then(() => { const n = w.st.get(ref.id); if (n) { n.restarts = st.restarts + 1; n.crashTimes = recent; } }); }
        }, 1500);
      }
    }
    this.push(ref.root);
    return true;
  }

  snapshot(root) {
    const w = this.ws.get(root);
    if (!w) return { defs: [], status: {} };
    const status = {};
    for (const [id, st] of w.st) {
      const { crashTimes, ...rest } = st;
      status[id] = rest;
    }
    return { defs: w.defs, status };
  }

  push(root) {
    const w = this.ws.get(root);
    if (!w) return;
    const snap = this.snapshot(root);
    for (const wc of w.subs) if (!wc.isDestroyed()) wc.send('svc:status', root, snap);
  }

  ensureTimer() {
    if (this.timer) return;
    this.timer = setInterval(() => {
      for (const [root, w] of this.ws) if (w.subs.size) this.probe(root);
    }, PROBE_MS);
  }

  // ---------- Sondes : processus, ports en écoute, mémoire, URL de santé ----------
  async probe(root) {
    const w = this.ws.get(root);
    if (!w) return;
    const running = [...w.st.entries()].filter(([, s]) => s.state === 'running' || s.state === 'starting');
    if (!running.length) return;
    const [sessions, sys] = await Promise.all([this.ptyHost.sessions().catch(() => []), systemSnapshot()]);
    const byId = new Map(sessions.map((s) => [s.id, s]));
    for (const [id, st] of running) {
      const sess = byId.get(st.sessionId);
      if (sess) st.pid = sess.pid;
      st.probeError = sys?.error || '';
      if (!st.pid || !sys) continue;
      const tree = descendants(st.pid, sys.procs);
      st.procs = tree.size;
      st.mem = [...tree].reduce((a, pid) => a + (sys.mem.get(pid) || 0), 0);
      st.ports = [...new Set(sys.listen.filter((l) => tree.has(l.pid)).map((l) => l.port))].sort((a, b) => a - b);
    }
    await Promise.all(running.map(async ([id, st]) => {
      const def = w.defs.find((d) => d.id === id);
      if (!def) return;
      const url = def.health || def.url;
      if (url) st.health = await httpCheck(url);
      else if (def.port) st.health = { ok: await tcpCheck(def.port), port: def.port };
    }));
    this.push(root);
  }

  // Suggestions depuis package.json (scripts dev/start/serve…)
  suggestions(root) {
    const out = [];
    const pkg = Workspace.readJson(path.join(root, 'package.json'), null);
    if (pkg?.scripts) {
      for (const [k, v] of Object.entries(pkg.scripts)) {
        if (/^(dev|start|serve|watch|preview|api|server|web|storybook)/i.test(k)) out.push({ name: k, command: `npm run ${k}`, hint: v });
      }
    }
    if (fs.existsSync(path.join(root, 'manage.py'))) out.push({ name: 'django', command: 'python manage.py runserver', hint: 'Django' });
    if (fs.existsSync(path.join(root, 'main.go'))) out.push({ name: 'go run', command: 'go run .', hint: 'Go' });
    if (fs.existsSync(path.join(root, 'Cargo.toml'))) out.push({ name: 'cargo run', command: 'cargo run', hint: 'Rust' });
    return out;
  }
}

function descendants(pid, procs) {
  const kids = new Map();
  for (const p of procs) {
    if (!kids.has(p.ppid)) kids.set(p.ppid, []);
    kids.get(p.ppid).push(p.pid);
  }
  const seen = new Set([pid]);
  const stack = [pid];
  while (stack.length) {
    for (const c of kids.get(stack.pop()) || []) if (!seen.has(c)) { seen.add(c); stack.push(c); }
  }
  return seen;
}

// Une seule requête système partagée (processus + ports TCP en écoute), mise en cache 2 s
let sysCache = null, sysAt = 0, sysPending = null;
function systemSnapshot() {
  if (sysCache && Date.now() - sysAt < 2000) return Promise.resolve(sysCache);
  if (sysPending) return sysPending;
  if (process.platform !== 'win32') {
    sysPending = unixSnapshot().catch((error) => ({ procs: [], mem: new Map(), listen: [], error: error.message }))
      .then((snapshot) => { sysCache = snapshot; sysAt = Date.now(); return snapshot; })
      .finally(() => { sysPending = null; });
    return sysPending;
  }
  const script = '$p = Get-CimInstance Win32_Process | ForEach-Object { "$($_.ProcessId),$($_.ParentProcessId),$($_.WorkingSetSize)" }; ' +
    '$l = Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | ForEach-Object { "$($_.LocalPort),$($_.OwningProcess)" }; ' +
    '"P"; $p; "L"; $l';
  sysPending = new Promise((resolve) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, maxBuffer: 16 * 1024 * 1024, timeout: 15000 }, (err, stdout) => {
      sysPending = null;
      if (err) return resolve(sysCache);
      const procs = [], mem = new Map(), listen = [];
      let mode = '';
      for (const line of stdout.split(/\r?\n/)) {
        if (line === 'P' || line === 'L') { mode = line; continue; }
        const [a, b, c] = line.split(',').map(Number);
        if (mode === 'P' && a) { procs.push({ pid: a, ppid: b }); mem.set(a, c || 0); }
        if (mode === 'L' && a) listen.push({ port: a, pid: b });
      }
      sysCache = { procs, mem, listen };
      sysAt = Date.now();
      resolve(sysCache);
    });
  });
  return sysPending;
}

function tcpCheck(port, host = '127.0.0.1') {
  return new Promise((resolve) => {
    const s = net.connect({ port, host });
    const done = (ok) => { s.destroy(); resolve(ok); };
    s.setTimeout(1000, () => done(false));
    s.once('connect', () => done(true));
    s.once('error', () => done(false));
  });
}

async function httpCheck(url) {
  const t0 = Date.now();
  try {
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), 3000);
    const res = await fetch(url, { signal: ctrl.signal, redirect: 'manual' });
    clearTimeout(to);
    return { ok: res.status < 500, code: res.status, ms: Date.now() - t0, url };
  } catch (e) {
    return { ok: false, error: e.name === 'AbortError' ? 'délai dépassé' : 'injoignable', ms: Date.now() - t0, url };
  }
}

// NO_COLOR + FORCE_COLOR ensemble déclenchent un avertissement de Node : on retire NO_COLOR
function envNoColor() { const e = { ...process.env }; delete e.NO_COLOR; return e; }

module.exports = Services;
