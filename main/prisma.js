// RobotConsole — Prisma et base de données du workspace
//   - détecte les schema.prisma du dossier, lit modèles / enums / migrations
//   - se connecte à la base (PostgreSQL) avec l'URL du .env du projet, sans jamais l'envoyer à l'interface
const fs = require('fs');
const path = require('path');

const SKIP = new Set(['node_modules', '.git', 'dist', 'build', 'coverage', '.next', 'out', 'target', '.venv', 'venv', '.robot', 'vendor', '.turbo', '.claude']);
const exists = (p) => { try { return fs.existsSync(p); } catch { return false; } };
const readText = (p) => { try { return fs.readFileSync(p, 'utf8'); } catch { return ''; } };
const MAX_ROWS = 1000;
const OID = { 16: 'bool', 17: 'bytea', 20: 'int8', 21: 'int2', 23: 'int4', 25: 'text', 114: 'json', 700: 'float4', 701: 'float8', 1043: 'varchar', 1082: 'date', 1083: 'time', 1114: 'timestamp', 1184: 'timestamptz', 1700: 'numeric', 2950: 'uuid', 3802: 'jsonb', 1009: 'text[]', 1007: 'int4[]' };

// ---------- Détection des projets ----------
function find(root) {
  const out = [];
  const seen = new Set();
  const add = (schema) => {
    const key = schema.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    const dir = packageDir(schema, root);
    out.push({ id: path.relative(root, schema).replace(/\\/g, '/') || path.basename(schema), schema, dir, rel: path.relative(root, schema).replace(/\\/g, '/') });
  };
  (function scan(dir, depth) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isFile() && e.name === 'schema.prisma') { if (!isGenerated(dir)) add(p); }
      else if (e.isDirectory() && e.name === 'schema' && path.basename(dir) === 'prisma' && fs.readdirSync(p).some((f) => f.endsWith('.prisma'))) add(p);
      else if (e.isDirectory() && depth < 4 && !SKIP.has(e.name) && !e.name.startsWith('.')) scan(p, depth + 1);
    }
  })(root, 0);
  return out;
}

// Copie du schéma placée par « prisma generate » à côté du client généré : à ignorer
function isGenerated(dir) {
  return ['index.d.ts', 'client.d.ts', 'client.ts', 'edge.js', 'wasm.js'].some((f) => exists(path.join(dir, f))) || /[\\/]\.prisma([\\/]|$)/.test(dir);
}

// Dossier du package.json qui contient le schéma (là où lancer les commandes prisma)
function packageDir(schema, root) {
  let d = path.dirname(schema);
  const stop = path.resolve(root).toLowerCase();
  while (true) {
    if (exists(path.join(d, 'package.json'))) return d;
    if (path.resolve(d).toLowerCase() === stop) return d;
    const up = path.dirname(d);
    if (up === d) return path.dirname(schema);
    d = up;
  }
}

function runner(dir) {
  let d = dir;
  while (true) {
    if (exists(path.join(d, 'pnpm-lock.yaml'))) return 'pnpm exec prisma';
    if (exists(path.join(d, 'yarn.lock'))) return 'yarn prisma';
    if (exists(path.join(d, 'bun.lockb')) || exists(path.join(d, 'bun.lock'))) return 'bunx prisma';
    if (exists(path.join(d, 'package-lock.json'))) return 'npx prisma';
    const up = path.dirname(d);
    if (up === d) return 'npx prisma';
    d = up;
  }
}

// ---------- Lecture du schéma ----------
function schemaFiles(schema) {
  try {
    if (fs.statSync(schema).isDirectory()) return fs.readdirSync(schema).filter((f) => f.endsWith('.prisma')).sort().map((f) => path.join(schema, f));
  } catch {}
  return [schema];
}

function parseSchema(schema) {
  const res = { datasource: null, generators: [], models: [], enums: [] };
  for (const file of schemaFiles(schema)) {
    const lines = readText(file).split(/\r?\n/);
    let cur = null;
    let doc = [];
    lines.forEach((raw, i) => {
      const line = raw.trim();
      if (!cur) {
        if (line.startsWith('///')) { doc.push(line.slice(3).trim()); return; }
        const m = line.match(/^(model|enum|view|type|datasource|generator)\s+(\w+)\s*\{/);
        if (m) { cur = { kind: m[1], name: m[2], file, line: i + 1, doc: doc.join(' '), fields: [], attrs: [], values: [], props: {} }; }
        if (line && !line.startsWith('//')) doc = [];
        return;
      }
      if (line === '}') {
        if (cur.kind === 'datasource') res.datasource = { name: cur.name, ...cur.props, line: cur.line, file };
        else if (cur.kind === 'generator') res.generators.push({ name: cur.name, ...cur.props });
        else if (cur.kind === 'enum') res.enums.push({ name: cur.name, file, line: cur.line, doc: cur.doc, values: cur.values, dbName: mapOf(cur.attrs) });
        else res.models.push({ kind: cur.kind, name: cur.name, file, line: cur.line, doc: cur.doc, fields: cur.fields, attrs: cur.attrs, dbName: mapOf(cur.attrs) || cur.name });
        cur = null; doc = [];
        return;
      }
      if (!line || line.startsWith('//') && !line.startsWith('///')) return;
      if (line.startsWith('///')) { doc.push(line.slice(3).trim()); return; }
      const body = stripComment(line);
      if (cur.kind === 'datasource' || cur.kind === 'generator') {
        const m = body.match(/^(\w+)\s*=\s*(.+)$/);
        if (m) cur.props[m[1]] = m[2].trim();
        return;
      }
      if (body.startsWith('@@')) { cur.attrs.push(body); return; }
      if (cur.kind === 'enum') {
        const m = body.match(/^(\w+)/);
        if (m) cur.values.push({ name: m[1], line: i + 1 });
        doc = [];
        return;
      }
      const m = body.match(/^(\w+)\s+(\w+)(\[\])?(\?)?\s*(.*)$/);
      if (!m) return;
      const attrs = m[5] || '';
      cur.fields.push({
        name: m[1], type: m[2], list: !!m[3], optional: !!m[4], line: i + 1, doc: doc.join(' '),
        id: /@id\b/.test(attrs), unique: /@unique\b/.test(attrs), updatedAt: /@updatedAt\b/.test(attrs),
        default: (attrs.match(/@default\(((?:[^()]|\([^()]*\))*)\)/) || [])[1] || null,
        relation: /@relation\b/.test(attrs) ? (attrs.match(/@relation\(((?:[^()]|\([^()]*\))*)\)/) || [])[1] || '' : null,
        dbType: (attrs.match(/@db\.(\w+(?:\([^)]*\))?)/) || [])[1] || null,
        dbName: (attrs.match(/@map\("([^"]+)"\)/) || [])[1] || null,
        attrs,
      });
      doc = [];
    });
  }
  const modelNames = new Set(res.models.map((m) => m.name));
  const enumNames = new Set(res.enums.map((e) => e.name));
  for (const mo of res.models) for (const f of mo.fields) f.ref = modelNames.has(f.type) ? 'model' : enumNames.has(f.type) ? 'enum' : null;
  return res;
}
function stripComment(line) {
  let q = false;
  for (let i = 0; i < line.length - 1; i++) {
    if (line[i] === '"' && line[i - 1] !== '\\') q = !q;
    if (!q && line[i] === '/' && line[i + 1] === '/') return line.slice(0, i).trim();
  }
  return line;
}
function mapOf(attrs) { for (const a of attrs) { const m = a.match(/^@@map\("([^"]+)"\)/); if (m) return m[1]; } return null; }
function unquote(v) { return v && /^".*"$/.test(v) ? v.slice(1, -1) : v; }

// ---------- Variables d'environnement (.env) ----------
function parseEnv(text) {
  const env = {};
  for (const raw of text.split(/\r?\n/)) {
    const m = raw.match(/^\s*(?:export\s+)?([\w.-]+)\s*=\s*(.*)?\s*$/);
    if (!m) continue;
    let v = (m[2] || '').trim();
    if (/^"/.test(v)) v = v.replace(/^"((?:[^"\\]|\\.)*)".*$/, '$1').replace(/\\n/g, '\n');
    else if (/^'/.test(v)) v = v.replace(/^'([^']*)'.*$/, '$1');
    else v = v.replace(/\s+#.*$/, '');
    env[m[1]] = v;
  }
  return env;
}
function loadEnv(project) {
  const dirs = [path.dirname(project.schema), project.dir, path.join(project.dir, 'prisma')];
  const env = {};
  // Les premiers trouvés gagnent (comme Prisma : .env du projet puis du schéma)
  for (const d of [project.dir, path.dirname(project.schema), ...dirs]) {
    const p = path.join(d, '.env');
    if (!exists(p)) continue;
    const e = parseEnv(readText(p));
    for (const k of Object.keys(e)) if (!(k in env)) env[k] = e[k];
  }
  return { ...env, ...pickEnv(process.env) };
}
const pickEnv = (e) => Object.fromEntries(Object.entries(e).filter(([k]) => /URL$/.test(k)));

function resolveUrl(project, ds) {
  if (!ds?.url) return { url: null, source: null };
  const m = ds.url.match(/^env\(\s*"([^"]+)"\s*\)$/);
  if (!m) return { url: unquote(ds.url), source: 'schema.prisma' };
  const env = loadEnv(project);
  return { url: env[m[1]] || null, source: m[1] };
}
function describeUrl(url) {
  try {
    const u = new URL(url);
    return { host: u.hostname, port: u.port || '5432', database: decodeURIComponent(u.pathname.replace(/^\//, '')), user: decodeURIComponent(u.username), schema: u.searchParams.get('schema') || 'public' };
  } catch { return null; }
}

// ---------- Projets en cache ----------
const projects = new Map(); // `${root}|${id}` -> { project, url, schema }
function getProject(root, id) {
  const list = find(root);
  const p = list.find((x) => x.id === id) || list[0];
  if (!p) return null;
  const parsed = parseSchema(p.schema);
  const { url, source } = resolveUrl(p, parsed.datasource);
  const entry = { project: p, parsed, url, source };
  projects.set(`${root}|${p.id}`, entry);
  return entry;
}

function info(root, id) {
  const list = find(root);
  if (!list.length) return { found: false, projects: [] };
  const e = getProject(root, id);
  const ds = e.parsed.datasource;
  const provider = unquote(ds?.provider) || null;
  return {
    found: true,
    projects: list.map((p) => ({ id: p.id, rel: p.rel })),
    project: { id: e.project.id, rel: e.project.rel, schema: e.project.schema, dir: e.project.dir, runner: runner(e.project.dir), defaultLocation: path.relative(e.project.dir, e.project.schema).replace(/\\/g, '/') === 'prisma/schema.prisma' },
    provider,
    supported: ['postgresql', 'postgres', 'cockroachdb'].includes(provider),
    connection: e.url ? describeUrl(e.url) : null,
    urlSource: e.source,
    datasourceLine: ds?.line || null,
    generators: e.parsed.generators.map((g) => ({ name: g.name, provider: unquote(g.provider), output: unquote(g.output) })),
    models: e.parsed.models,
    enums: e.parsed.enums,
  };
}

// ---------- Connexion PostgreSQL ----------
let pg = null;
const pools = new Map(); // url -> Pool
function poolFor(root, id) {
  const e = projects.get(`${root}|${id}`) || getProject(root, id);
  if (!e) throw new Error('Aucun schema.prisma trouvé');
  if (!e.url) throw new Error(`Variable ${e.source || 'DATABASE_URL'} introuvable (fichier .env du projet)`);
  if (!pg) pg = require('pg');
  let pool = pools.get(e.url);
  if (!pool) {
    const u = new URL(e.url);
    const schema = u.searchParams.get('schema');
    // Paramètres propres à Prisma que pg ne connaît pas
    for (const k of ['schema', 'connection_limit', 'pool_timeout', 'pgbouncer', 'socket_timeout', 'connect_timeout', 'statement_cache_size']) u.searchParams.delete(k);
    pool = new pg.Pool({ connectionString: u.toString(), max: 3, idleTimeoutMillis: 60000, connectionTimeoutMillis: 6000, statement_timeout: 30000, application_name: 'RobotConsole' });
    pool.on('error', () => {});
    pool.schema = schema || 'public';
    pools.set(e.url, pool);
  }
  return pool;
}
function errInfo(err) {
  const code = err.code;
  let msg = err.message || String(err);
  if (code === 'ECONNREFUSED') msg = `Connexion refusée par ${err.address || 'le serveur'}:${err.port || ''} — la base est-elle démarrée ?`;
  else if (code === '28P01') msg = 'Mot de passe refusé par PostgreSQL';
  else if (code === '3D000') msg = `La base n'existe pas : ${err.message}`;
  else if (code === 'ENOTFOUND') msg = `Hôte introuvable : ${err.hostname}`;
  return { ok: false, error: msg, code, position: err.position ? Number(err.position) : null, detail: err.detail || null, hint: err.hint || null };
}

function cell(v) {
  if (v == null) return null;
  if (typeof v === 'bigint') return v.toString();
  if (v instanceof Date) return isNaN(v) ? String(v) : v.toISOString();
  if (Buffer.isBuffer(v)) return '\\x' + v.subarray(0, 64).toString('hex') + (v.length > 64 ? `… (${v.length} o)` : '');
  if (typeof v === 'object') return JSON.stringify(v);
  return v;
}
const qid = (s) => '"' + String(s).replace(/"/g, '""') + '"';

async function ping(root, id) {
  try {
    const pool = poolFor(root, id);
    const r = await pool.query('select version() as v, current_database() as db');
    return { ok: true, version: String(r.rows[0].v).split(' ').slice(0, 2).join(' '), database: r.rows[0].db };
  } catch (e) { return errInfo(e); }
}

async function tables(root, id) {
  try {
    const pool = poolFor(root, id);
    const r = await pool.query(`
      select n.nspname as schema, c.relname as name, c.relkind as kind, greatest(c.reltuples, 0)::bigint as estimate
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where c.relkind in ('r','v','m','p') and n.nspname not in ('pg_catalog','information_schema') and n.nspname not like 'pg_toast%'
      order by (n.nspname = $1) desc, n.nspname, c.relname`, [pool.schema]);
    return { ok: true, defaultSchema: pool.schema, tables: r.rows.map((t) => ({ schema: t.schema, name: t.name, view: t.kind !== 'r' && t.kind !== 'p', estimate: Number(t.estimate) })) };
  } catch (e) { return errInfo(e); }
}

async function rows(root, id, opts = {}) {
  try {
    const pool = poolFor(root, id);
    const schema = opts.schema || pool.schema;
    const cols = await pool.query(`select column_name, data_type, udt_name from information_schema.columns where table_schema = $1 and table_name = $2 order by ordinal_position`, [schema, opts.table]);
    if (!cols.rows.length) return { ok: false, error: `Table introuvable : ${schema}.${opts.table}` };
    const names = cols.rows.map((c) => c.column_name);
    const from = `${qid(schema)}.${qid(opts.table)}`;
    const params = [];
    let where = '';
    if (opts.filter) {
      params.push(`%${opts.filter}%`);
      where = ' where ' + names.map((n) => `${qid(n)}::text ilike $1`).join(' or ');
    }
    const order = names.includes(opts.orderBy) ? ` order by ${qid(opts.orderBy)} ${opts.dir === 'desc' ? 'desc' : 'asc'} nulls last` : '';
    const limit = Math.min(Math.max(1, opts.limit | 0 || 100), 500);
    const offset = Math.max(0, opts.offset | 0);
    const t0 = Date.now();
    const data = await pool.query({ text: `select * from ${from}${where}${order} limit ${limit} offset ${offset}`, values: params, rowMode: 'array' });
    let total;
    let estimated = false;
    const est = await pool.query(`select greatest(c.reltuples, 0)::bigint as n from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = $1 and c.relname = $2`, [schema, opts.table]);
    if (!where && Number(est.rows[0]?.n) > 100000) { total = Number(est.rows[0].n); estimated = true; }
    else total = Number((await pool.query(`select count(*)::bigint as n from ${from}${where}`, params)).rows[0].n);
    return { ok: true, columns: cols.rows.map((c) => ({ name: c.column_name, type: c.udt_name || c.data_type })), rows: data.rows.map((r) => r.map(cell)), total, estimated, offset, limit, ms: Date.now() - t0 };
  } catch (e) { return errInfo(e); }
}

// Lecture seule ? (heuristique : premier mot-clé de chaque instruction)
function isReadOnly(sql) {
  const stmts = sql.replace(/--.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '').split(';').map((s) => s.trim()).filter(Boolean);
  return stmts.length > 0 && stmts.every((s) => /^(select|with|explain|show|table|values)\b/i.test(s) && !/\b(insert|update|delete|drop|alter|truncate|create|grant|revoke)\b/i.test(s.replace(/'(?:[^']|'')*'/g, '')));
}

async function query(root, id, sql, opts = {}) {
  const readOnly = isReadOnly(sql);
  if (!readOnly && !opts.allowWrite) return { ok: false, needsConfirm: true, error: 'Cette requête modifie la base : confirmation nécessaire' };
  let client;
  try {
    const pool = poolFor(root, id);
    client = await pool.connect();
    const t0 = Date.now();
    await client.query(readOnly ? 'begin read only' : 'begin');
    let r = await client.query({ text: sql, rowMode: 'array' });
    await client.query(readOnly ? 'rollback' : 'commit');
    const ms = Date.now() - t0;
    if (Array.isArray(r)) r = r.filter((x) => x.fields?.length).pop() || r[r.length - 1];
    const fields = r.fields || [];
    const all = r.rows || [];
    return { ok: true, readOnly, command: r.command, rowCount: r.rowCount, columns: fields.map((f) => ({ name: f.name, type: OID[f.dataTypeID] || String(f.dataTypeID) })), rows: all.slice(0, MAX_ROWS).map((x) => x.map(cell)), truncated: all.length > MAX_ROWS, ms };
  } catch (e) {
    try { await client?.query('rollback'); } catch {}
    return errInfo(e);
  } finally { client?.release(); }
}

// ---------- Migrations ----------
async function migrations(root, id) {
  const e = projects.get(`${root}|${id}`) || getProject(root, id);
  if (!e) return { ok: false, error: 'Aucun schema.prisma trouvé' };
  const base = fs.statSync(e.project.schema).isDirectory() ? path.dirname(e.project.schema) : path.dirname(e.project.schema);
  const dir = path.join(base, 'migrations');
  let local = [];
  try { local = fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort(); } catch {}
  const out = { ok: true, dir, local: local.length, db: null, dbError: null, list: [] };
  const applied = new Map();
  try {
    const pool = poolFor(root, id);
    const r = await pool.query(`select migration_name, started_at, finished_at, rolled_back_at, applied_steps_count, logs from ${qid(pool.schema)}."_prisma_migrations" order by started_at`);
    for (const m of r.rows) applied.set(m.migration_name, m);
    out.db = r.rows.length;
  } catch (err) { out.dbError = err.code === '42P01' ? 'La table _prisma_migrations n\'existe pas encore (aucune migration appliquée)' : errInfo(err).error; }
  const names = [...new Set([...local, ...applied.keys()])].sort();
  for (const name of names) {
    const a = applied.get(name);
    let status = 'pending';
    if (a) status = a.rolled_back_at ? 'rolledback' : !a.finished_at ? 'failed' : 'applied';
    if (a && !local.includes(name)) status = 'dbonly';
    if (!a && out.dbError) status = 'unknown';
    out.list.push({ name, status, file: local.includes(name) ? path.join(dir, name, 'migration.sql') : null, appliedAt: a?.finished_at ? cell(a.finished_at) : null, logs: a?.logs || null });
  }
  return out;
}
function migrationSql(file) {
  if (!/migration\.sql$/i.test(file || '')) return '';
  return readText(file);
}

async function close(root, id) {
  const e = projects.get(`${root}|${id}`);
  if (!e?.url) return;
  const p = pools.get(e.url);
  if (p) { pools.delete(e.url); try { await p.end(); } catch {} }
}
async function closeAll() { for (const p of pools.values()) try { await p.end(); } catch {} pools.clear(); }

// ---------- Plans du diagramme (.robot/diagrams) ----------
const crypto = require('crypto');
const diagDir = (root) => path.join(root, '.robot', 'diagrams');
const diagFile = (root, id) => path.join(diagDir(root), String(id || 'schema').replace(/[^\w.-]+/g, '_').replace(/_?schema\.prisma$/, '') + '.json');
const ASSET_RE = /^[a-f0-9]{16}\.(png|jpe?g|gif|webp|svg)$/;
const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml' };

function diagramLoad(root, id) {
  let data = null;
  try { data = JSON.parse(fs.readFileSync(diagFile(root, id), 'utf8')); } catch {}
  const assets = {};
  for (const plan of data?.plans || []) {
    for (const it of plan.items || []) {
      if (it.type !== 'image' || !ASSET_RE.test(it.src || '') || assets[it.src]) continue;
      try { assets[it.src] = `data:${MIME[it.src.split('.').pop()]};base64,` + fs.readFileSync(path.join(diagDir(root), 'assets', it.src)).toString('base64'); } catch {}
    }
  }
  return { data, assets, file: diagFile(root, id) };
}
function diagramSave(root, id, data) {
  const f = diagFile(root, id);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, JSON.stringify(data, null, 1) + '\n');
  return true;
}
// Enregistre une image (data URL) dans .robot/diagrams/assets ; renvoie son nom de fichier
function diagramSaveImage(root, dataUrl) {
  const m = String(dataUrl).match(/^data:image\/(png|jpe?g|gif|webp|svg\+xml);base64,(.+)$/);
  if (!m) throw new Error("Format d'image non pris en charge");
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > 12 * 1024 * 1024) throw new Error('Image trop lourde (12 Mo maximum)');
  const ext = m[1] === 'svg+xml' ? 'svg' : m[1] === 'jpeg' ? 'jpg' : m[1];
  const name = crypto.createHash('sha1').update(buf).digest('hex').slice(0, 16) + '.' + ext;
  const dir = path.join(diagDir(root), 'assets');
  fs.mkdirSync(dir, { recursive: true });
  const f = path.join(dir, name);
  if (!exists(f)) fs.writeFileSync(f, buf);
  return name;
}

module.exports = { diagramLoad, diagramSave, diagramSaveImage, find, parseSchema, parseEnv, info, ping, tables, rows, query, isReadOnly, migrations, migrationSql, close, closeAll };
