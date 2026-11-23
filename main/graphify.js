// RobotConsole — Graphify (https://github.com/Graphify-Labs/graphify)
// Lance le CLI « graphify » (paquet PyPI « graphifyy ») sur un dossier et sert graphify-out/ en local
// pour l'afficher dans un webview (le webview n'accepte que http/https).
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const { execFile, spawn } = require('child_process');
const { killTree } = require('./platform');

const OUT = 'graphify-out';
const ENV = { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1', NO_COLOR: '1', FORCE_COLOR: '0' };

// ---------- Exécutable ----------
let exe = null; // chemin résolu (ou 'graphify' si trouvé dans le PATH)
function candidates() {
  const home = os.homedir();
  const win = process.platform === 'win32';
  const name = win ? 'graphify.exe' : 'graphify';
  return ['graphify', path.join(home, '.local', 'bin', name), ...(win ? [] : [path.join(home, '.local', 'pipx', 'bin', name)])];
}
function tryVersion(cmd) {
  return new Promise((resolve) => {
    execFile(cmd, ['--version'], { windowsHide: true, timeout: 20000, env: ENV }, (err, stdout, stderr) => {
      if (err) return resolve(null);
      resolve((stdout || stderr || '').trim().split(/\r?\n/).pop() || 'graphify');
    });
  });
}
async function version(force) {
  if (exe && !force) { const v = await tryVersion(exe); if (v) return { ok: true, version: v, exe }; }
  for (const c of candidates()) {
    if (c !== 'graphify' && !fs.existsSync(c)) continue;
    const v = await tryVersion(c);
    if (v) { exe = c; return { ok: true, version: v, exe: c }; }
  }
  exe = null;
  return { ok: false };
}

// ---------- État du dossier de sortie ----------
function statOf(file) { try { return fs.statSync(file); } catch { return null; } }
function graphStats(file, st) {
  if (!st || st.size > 80 * 1024 * 1024) return null;
  try {
    const g = JSON.parse(fs.readFileSync(file, 'utf8'));
    const nodes = Array.isArray(g.nodes) ? g.nodes : [];
    const links = Array.isArray(g.links) ? g.links : Array.isArray(g.edges) ? g.edges : [];
    const comms = new Set(nodes.map((n) => n.community ?? n.community_id ?? n.cluster).filter((c) => c !== undefined && c !== null));
    const meta = g.graph && typeof g.graph === 'object' ? g.graph : {};
    return { nodes: nodes.length, links: links.length, communities: comms.size || null, graphifyVersion: meta.graphify_version || null };
  } catch { return null; }
}
async function status(root) {
  const out = path.join(root, OUT);
  const html = statOf(path.join(out, 'graph.html'));
  const json = statOf(path.join(out, 'graph.json'));
  const rep = statOf(path.join(out, 'GRAPH_REPORT.md'));
  let report = null;
  if (rep && rep.size < 2 * 1024 * 1024) { try { report = fs.readFileSync(path.join(out, 'GRAPH_REPORT.md'), 'utf8'); } catch {} }
  return {
    out, exists: !!statOf(out),
    html: !!html, json: !!json, report,
    updated: Math.max(html?.mtimeMs || 0, json?.mtimeMs || 0, rep?.mtimeMs || 0) || null,
    stats: graphStats(path.join(out, 'graph.json'), json),
  };
}

// ---------- Serveur local (127.0.0.1) pour graphify-out ----------
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.md': 'text/markdown; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2' };
let server = null;
let port = 0;
const roots = new Map(); // jeton -> dossier graphify-out
const tokens = new Map(); // dossier -> jeton
function startServer() {
  if (server) return Promise.resolve();
  return new Promise((resolve, reject) => {
    server = http.createServer((req, res) => {
      const m = /^\/([a-f0-9]{32})\/(.*)$/.exec((req.url || '').split('?')[0]);
      const base = m && roots.get(m[1]);
      if (!base || req.method !== 'GET') { res.writeHead(404); return res.end(); }
      let rel;
      try { rel = decodeURIComponent(m[2] || 'graph.html'); } catch { res.writeHead(400); return res.end(); }
      const file = path.resolve(base, rel);
      if (file !== base && !file.startsWith(base + path.sep)) { res.writeHead(403); return res.end(); }
      fs.readFile(file, (err, data) => {
        if (err) { res.writeHead(404); return res.end(); }
        res.writeHead(200, { 'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
        res.end(data);
      });
    });
    server.on('error', (e) => { server = null; reject(e); });
    server.listen(0, '127.0.0.1', () => { port = server.address().port; resolve(); });
  });
}
async function serve(root) {
  await startServer();
  const out = path.resolve(root, OUT);
  let t = tokens.get(out);
  if (!t) { t = crypto.randomBytes(16).toString('hex'); tokens.set(out, t); roots.set(t, out); }
  return `http://127.0.0.1:${port}/${t}/graph.html`;
}

// ---------- Exécutions ----------
const runs = new Map(); // id -> { child, stopped }
const STEPS = {
  build: [['extract', '.', '--code-only'], ['cluster-only', '.', '--no-label']],
  update: [['update', '.'], ['cluster-only', '.', '--no-label']],
  html: [['export', 'html']],
};
async function run(id, root, mode, onData, onEnd) {
  const v = await version();
  if (!v.ok) { onEnd({ ok: false, error: 'graphify introuvable' }); return; }
  const steps = [...(STEPS[mode] || STEPS.build)];
  const r = { child: null, stopped: false };
  runs.set(id, r);
  const step = (args) => new Promise((resolve) => {
    onData(`\x1b[36m$ graphify ${args.join(' ')}\x1b[0m\n`);
    const child = r.child = spawn(exe, args, { cwd: root, windowsHide: true, detached: process.platform !== 'win32', env: ENV });
    const pipe = (d) => onData(d.toString('utf8').replace(/\r\n/g, '\n'));
    child.stdout.on('data', pipe);
    child.stderr.on('data', pipe);
    child.on('error', (e) => { onData(`${e.message}\n`); resolve(-1); });
    child.on('close', (code) => resolve(code ?? -1));
  });
  let code = 0;
  for (const args of steps) {
    code = await step(args);
    if (r.stopped || code !== 0) break;
  }
  // Le HTML n'est pas toujours écrit par l'étape de regroupement : on l'exporte s'il manque.
  if (!r.stopped && code === 0 && mode !== 'html' && !statOf(path.join(root, OUT, 'graph.html'))) code = await step(STEPS.html[0]);
  runs.delete(id);
  onEnd({ ok: !r.stopped && code === 0, code, stopped: r.stopped });
}
function stop(id) {
  const r = runs.get(id);
  if (!r) return;
  r.stopped = true;
  killTree(r.child);
}
function stopAll() { for (const id of runs.keys()) stop(id); server?.close(); }

module.exports = { version, status, serve, run, stop, stopAll, OUT };
