// RobotConsole — Docker du workspace
// Ne montre que ce qui appartient au workspace :
//   - les fichiers compose du dossier (racine et sous-dossiers : docker/, deploy/…)
//   - les conteneurs dont le projet compose a été lancé depuis le workspace (labels Docker)
const { execFile, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { pathKey, withinPath } = require('./platform');

const COMPOSE_RE = /^(docker-)?compose([.-][\w.-]+)?\.ya?ml$/i;
const SKIP = new Set(['node_modules', '.git', 'dist', 'build', '.next', '.turbo', 'coverage', 'vendor', 'target']);
const logs = new Map(); // id -> child

function docker(args, cwd, timeout = 60000) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    execFile('docker', args, { cwd, windowsHide: true, timeout, maxBuffer: 32 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (process.env.ROBOTCONSOLE_DEBUG) console.error(`[docker ${Date.now() - t0}ms] ${args.join(' ')} ${err ? 'ERR ' + err.message : ''}`);
      resolve({ ok: !err, code: err ? err.code : 0, stdout: String(stdout || ''), stderr: String(stderr || '') });
    });
  });
}

function parseLines(s) {
  s = s.trim();
  if (!s) return [];
  if (s.startsWith('[')) { try { return JSON.parse(s); } catch { return []; } }
  return s.split(/\r?\n/).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}

const norm = (p) => pathKey(path.resolve(p));
const inside = (p, root) => withinPath(path.resolve(p), path.resolve(root));

// Fichiers compose du workspace (racine + 2 niveaux de sous-dossiers)
function composeFiles(root) {
  const out = [];
  const scan = (dir, depth) => {
    let ents = [];
    try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      if (e.isFile() && COMPOSE_RE.test(e.name)) out.push(path.join(dir, e.name));
      else if (e.isDirectory() && depth < 2 && !SKIP.has(e.name) && !e.name.startsWith('.')) scan(path.join(dir, e.name), depth + 1);
    }
  };
  if (root) scan(root, 0);
  // Les fichiers « principaux » d'abord (compose.yml, puis dev…)
  return out.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}
function rank(f) {
  const n = path.basename(f).toLowerCase();
  const d = f.split(/[\\/]/).length;
  return d * 10 + (/^(docker-)?compose\.ya?ml$/.test(n) ? 0 : /dev|local/.test(n) ? 1 : /prod/.test(n) ? 4 : 2);
}
function composeFile(root) { return composeFiles(root)[0] || null; }

// Labels « k=v,k=v » (la valeur de config_files peut elle-même contenir des virgules)
function parseLabels(s) {
  const out = {};
  let last = null;
  for (const part of String(s || '').split(',')) {
    const i = part.indexOf('=');
    if (i > 0 && /^[\w.-]+$/.test(part.slice(0, i))) { last = part.slice(0, i); out[last] = part.slice(i + 1); }
    else if (last) out[last] += ',' + part;
  }
  return out;
}

const inflight = new Map();
const cache = new Map();
function status(root, opts = {}) {
  const key = `${root}`;
  const c = cache.get(key);
  if (c && Date.now() - c.at < 1500) return Promise.resolve(c.value);
  if (inflight.has(key)) return inflight.get(key);
  const p = statusNow(root, opts).then((value) => { cache.set(key, { at: Date.now(), value }); return value; }).finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}
function invalidate(root) { cache.delete(`${root}`); }

let versionCache = null;
const servicesCache = new Map(); // fichier -> { mtime, names, error }

async function composeServices(root, file) {
  const mtime = fs.statSync(file).mtimeMs;
  const c = servicesCache.get(file);
  if (c && c.mtime === mtime) return c;
  const r = await docker(['compose', '-f', file, 'config', '--services'], path.dirname(file));
  const v = { mtime, names: r.stdout.split(/\r?\n/).map((s) => s.trim()).filter(Boolean), error: r.ok ? '' : (r.stderr || '').trim().split('\n').slice(-3).join('\n') };
  servicesCache.set(file, v);
  return v;
}

async function statusNow(root) {
  let ver;
  if (versionCache && Date.now() - versionCache.at < 30000) ver = versionCache.value;
  else {
    ver = await docker(['version', '--format', '{{.Server.Version}}'], root, 8000);
    if (ver.ok) versionCache = { at: Date.now(), value: ver };
  }
  if (!ver.ok) {
    const installed = !/not recognized|ENOENT|introuvable/i.test(ver.stderr) && ver.code !== 'ENOENT';
    return { available: false, installed, error: (ver.stderr || '').trim().split('\n').pop() };
  }
  const files = composeFiles(root);
  const [ps, ...svcs] = await Promise.all([
    docker(['ps', '-a', '--no-trunc', '--format', '{{json .}}'], root),
    ...files.map((f) => composeServices(root, f)),
  ]);

  // Conteneurs liés au workspace
  const all = parseLines(ps.stdout).map((r) => {
    const l = parseLabels(r.Labels);
    const cfgs = (l['com.docker.compose.project.config_files'] || '').split(',').filter(Boolean);
    return { row: r, labels: l, project: l['com.docker.compose.project'], service: l['com.docker.compose.service'], workdir: l['com.docker.compose.project.working_dir'], configs: cfgs };
  });
  const mine = all.filter((c) => (c.workdir && inside(c.workdir, root)) || c.configs.some((f) => inside(f, root)));

  const projects = files.map((file, i) => {
    const names = svcs[i].names;
    const owned = mine.filter((c) => c.configs.some((f) => norm(f) === norm(file)));
    const services = names.map((name) => ({ name, containers: owned.filter((c) => c.service === name).map(toContainer) }));
    for (const c of owned) if (!names.includes(c.service)) services.push({ name: c.service, orphan: true, containers: [toContainer(c)] });
    const running = services.filter((s) => s.containers.some((c) => c.state === 'running')).length;
    return { file, rel: path.relative(root, file).split(path.sep).join('/'), project: owned[0]?.project || null, services, running, error: svcs[i].error };
  });
  // Conteneurs du workspace lancés depuis un fichier non trouvé (supprimé, ou hors des sous-dossiers scannés)
  const known = new Set(projects.flatMap((p) => p.services.flatMap((s) => s.containers.map((c) => c.id))));
  const others = mine.filter((c) => !known.has(c.row.ID)).map(toContainer);

  // Consommation des conteneurs démarrés
  const live = [...projects.flatMap((p) => p.services.flatMap((s) => s.containers)), ...others].filter((c) => c.state === 'running');
  if (live.length) {
    const st = await docker(['stats', '--no-stream', '--format', '{{json .}}', ...live.map((c) => c.id)], root, 20000);
    const stats = new Map(parseLines(st.stdout).map((s) => [s.ID?.slice(0, 12), s]));
    for (const c of live) {
      const s = stats.get(c.id.slice(0, 12));
      if (s) c.stats = { cpu: s.CPUPerc, mem: String(s.MemUsage || '').split('/')[0].trim(), memPerc: s.MemPerc, net: s.NetIO, pids: s.PIDs };
    }
  }
  return { available: true, version: ver.stdout.trim(), projects, others };
}

function toContainer(c) {
  const r = c.row;
  const ports = [];
  for (const m of String(r.Ports || '').matchAll(/(?:[\d.:[\]]+:)?(\d+)->(\d+)\/(\w+)/g)) ports.push({ host: +m[1], target: +m[2], proto: m[3] });
  const seen = new Set();
  return {
    id: r.ID, name: r.Names, image: r.Image, state: r.State, status: r.Status, service: c.service, project: c.project,
    health: /\((healthy|unhealthy|health: starting)\)/.exec(r.Status)?.[1] || '',
    ports: ports.filter((p) => { const k = `${p.host}/${p.target}`; if (seen.has(k)) return false; seen.add(k); return true; }),
  };
}

// Actions : sur un projet compose (tout ou un service) ou sur un conteneur
async function action(root, { verb, service, container, file }) {
  let args;
  if (container) {
    const map = { start: ['start'], stop: ['stop'], restart: ['restart'], remove: ['rm', '-f'], pause: ['pause'], unpause: ['unpause'] };
    if (!map[verb]) throw new Error('Action inconnue');
    args = [...map[verb], container];
  } else {
    file = file || composeFile(root);
    if (!file) throw new Error('Aucun fichier compose dans ce workspace');
    const map = {
      up: ['up', '-d'], down: ['down'], start: ['start'], stop: ['stop'], restart: ['restart'],
      pull: ['pull'], build: ['build'], recreate: ['up', '-d', '--force-recreate'], remove: ['rm', '-f', '-s'],
    };
    if (!map[verb]) throw new Error('Action inconnue');
    args = ['compose', '-f', file, ...map[verb]];
    if (service) args.push(service);
  }
  const r = await docker(args, file ? path.dirname(file) : root, 15 * 60 * 1000);
  invalidate(root);
  return { ok: r.ok, output: (r.stdout + r.stderr).trim(), command: 'docker ' + args.join(' ') };
}

function startLogs(id, root, { service, container, file }, onData, onEnd) {
  stopLogs(id);
  file = file || composeFile(root);
  const args = container ? ['logs', '-f', '--tail', '400', '--timestamps', container]
    : ['compose', '-f', file, 'logs', '-f', '--tail', '400', '--timestamps', ...(service ? [service] : [])];
  const child = spawn('docker', args, { cwd: root, windowsHide: true });
  logs.set(id, child);
  const fwd = (d) => onData(d.toString().replace(/\r?\n/g, '\r\n'));
  child.stdout.on('data', fwd);
  child.stderr.on('data', fwd);
  child.on('close', () => { if (logs.get(id) === child) logs.delete(id); onEnd(); });
  child.on('error', (e) => { onData(`\r\n${e.message}\r\n`); });
}
function stopLogs(id) {
  const c = logs.get(id);
  if (c) { logs.delete(id); try { c.kill(); } catch {} }
}

function execCommand(root, { service, container, file }) {
  if (container) return `docker exec -it ${container} sh -c "command -v bash >/dev/null && exec bash || exec sh"`;
  return `docker compose -f "${file || composeFile(root)}" exec ${service} sh -c "command -v bash >/dev/null && exec bash || exec sh"`;
}

module.exports = { status, action, startLogs, stopLogs, execCommand, composeFile, composeFiles };
