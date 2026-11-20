// RobotConsole — explorateur de tests (v2) : suites rangées par catégorie
//   Catégories : unitaires · intégration · end-to-end (Playwright) · règles métier · autres
//   Frameworks : Vitest, Jest, Playwright, node:test, pytest, Go, Cargo, commande perso (JUnit)
//   Configuration : .robot/tests.json  { version: 2, suites: [...] }  (générée par « Détecter »)
const { spawn, execFile } = require('child_process');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const os = require('os');
const Workspace = require('./workspace');

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'coverage', '.next', 'out', 'target', '.venv', 'venv', '__pycache__', '.robot', 'vendor', 'bin', 'obj', '.turbo', 'playwright-report', 'test-results']);
const CATEGORIES = {
  unit: { name: 'Tests unitaires', icon: '🧩', order: 1 },
  rules: { name: 'Règles métier', icon: '⚖', order: 2 },
  integration: { name: 'Intégration', icon: '🔗', order: 3 },
  e2e: { name: 'End-to-end', icon: '🎭', order: 4 },
  other: { name: 'Autres', icon: '🧪', order: 5 },
};
const FW_LABEL = { vitest: 'Vitest', jest: 'Jest', playwright: 'Playwright', node: 'node:test', pytest: 'pytest', go: 'Go', cargo: 'Cargo', custom: 'Commande' };
const RULES_RE = /(^|[\/._-])(rules?|r[eè]gles?|business|m[eé]tier|domain|polic(y|ies)|invariants?|specifications?|abilit(y|ies)|permissions?)([\/._-]|$)/i;
// Paquets qui portent la logique métier partagée (monorepos)
const RULES_PKG_RE = /^(shared|domain|core|model|models|rules|business|logic|common-domain)$/i;
const INTEG_RE = /(^|[\/._-])(integration|integ|it)([\/._-]|$)/i;
const JS_TEST = '**/*.{test,spec}.{ts,tsx,js,jsx,mts,cts,mjs,cjs}';

const runs = new Map(); // runId -> { child, stopped }
const readJson = (p) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } };
const readText = (p) => { try { return fs.readFileSync(p, 'utf8'); } catch { return ''; } };
const exists = (p) => fs.existsSync(p);
const q = (s) => `"${String(s).replace(/"/g, '\\"')}"`;
const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const rel = (root, f) => path.relative(root, f).split(path.sep).join('/');
const cfgPath = (root) => path.join(root, Workspace.DIR, 'tests.json');

// ---------- Glob simple : **, *, ?, {a,b} ----------
function globToRe(g) {
  let re = '';
  for (let i = 0; i < g.length; i++) {
    const c = g[i];
    if (c === '*') {
      if (g[i + 1] === '*') { i++; if (g[i + 1] === '/') { i++; re += '(?:.*/)?'; } else re += '.*'; }
      else re += '[^/]*';
    } else if (c === '?') re += '[^/]';
    else if (c === '{') { const j = g.indexOf('}', i); re += '(?:' + g.slice(i + 1, j).split(',').map((x) => x.split('*').map(escRe).join('[^/]*')).join('|') + ')'; i = j; }
    else re += escRe(c);
  }
  return new RegExp('^' + re + '$', 'i');
}
const matcher = (globs) => { const res = (globs || []).map((g) => globToRe(g.replace(/^\.\//, ''))); return (p) => res.some((r) => r.test(p)); };

async function walk(dir, match, out = [], base = dir, depth = 0) {
  if (depth > 14) return out;
  let ents = [];
  try { ents = await fsp.readdir(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of ents) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name) && !e.name.startsWith('.')) await walk(p, match, out, base, depth + 1); }
    else if (match(rel(base, p))) out.push(p);
  }
  return out;
}

function sh(cmd, cwd, timeout = 180000) {
  return new Promise((resolve) => {
    execFile(cmd, { cwd, shell: true, windowsHide: true, timeout, maxBuffer: 64 * 1024 * 1024, env: { ...process.env, CI: '1' } },
      (err, stdout, stderr) => resolve({ code: err ? (err.code ?? 1) : 0, stdout: String(stdout || ''), stderr: String(stderr || '') }));
  });
}

// Binaire local d'un outil (node_modules du paquet, puis des dossiers parents jusqu'à la racine)
function localBin(cwd, root, rels) {
  let d = cwd;
  for (;;) {
    for (const r of rels) { const p = path.join(d, 'node_modules', r); if (exists(p)) return p; }
    if (path.resolve(d) === path.resolve(root)) break;
    const up = path.dirname(d);
    if (up === d) break;
    d = up;
  }
  return null;
}

function python(dir) {
  for (const v of ['.venv', 'venv', 'env']) {
    const p = path.join(dir, v, process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
    if (exists(p)) return q(p);
  }
  return 'python';
}

// ---------- Détection : génère la liste des suites ----------
function packageDirs(root) {
  const dirs = [root];
  const globs = [];
  const pkg = readJson(path.join(root, 'package.json'));
  if (Array.isArray(pkg?.workspaces)) globs.push(...pkg.workspaces);
  else if (Array.isArray(pkg?.workspaces?.packages)) globs.push(...pkg.workspaces.packages);
  const pnpm = readText(path.join(root, 'pnpm-workspace.yaml'));
  const block = pnpm.match(/packages:\s*\n((?:\s*-\s*.+\n?)+)/);
  if (block) for (const m of block[1].matchAll(/-\s*['"]?([^'"\n#]+?)['"]?\s*(?:#.*)?$/gm)) globs.push(m[1].trim());
  for (const g of globs) {
    if (g.startsWith('!')) continue;
    const parts = g.replace(/\/\*\*?$/, '').split('/');
    const star = /\*$/.test(g);
    const base = path.join(root, ...parts);
    if (star) { try { for (const e of fs.readdirSync(base, { withFileTypes: true })) if (e.isDirectory() && exists(path.join(base, e.name, 'package.json'))) dirs.push(path.join(base, e.name)); } catch {} }
    else if (exists(path.join(base, 'package.json'))) dirs.push(base);
  }
  // Sans déclaration de workspaces : sous-dossiers directs qui ont un package.json avec des tests
  if (dirs.length === 1) {
    for (const top of ['apps', 'packages', 'services', 'libs', 'frontend', 'backend', 'client', 'server', 'web', 'api']) {
      const b = path.join(root, top);
      if (exists(path.join(b, 'package.json'))) dirs.push(b);
      else { try { for (const e of fs.readdirSync(b, { withFileTypes: true })) if (e.isDirectory() && exists(path.join(b, e.name, 'package.json'))) dirs.push(path.join(b, e.name)); } catch {} }
    }
  }
  return [...new Set(dirs.map((d) => path.resolve(d)))];
}

const strList = (s) => [...String(s || '').matchAll(/['"`]([^'"`]+)['"`]/g)].map((m) => m[1]);
function findConfig(dir, names) { for (const n of names) { const p = path.join(dir, n); if (exists(p)) return p; } return null; }

// Lit (à la louche) un fichier de config Vitest/Vite : projets nommés, include/exclude
function parseVitestConfig(text) {
  const projects = [];
  const pIdx = text.search(/projects\s*:\s*\[/);
  if (pIdx >= 0) {
    const chunk = text.slice(pIdx);
    const names = [...chunk.matchAll(/name\s*:\s*['"`]([^'"`]+)['"`]/g)];
    names.forEach((m, i) => {
      const seg = chunk.slice(m.index, names[i + 1]?.index ?? chunk.length);
      projects.push({ name: m[1], include: strList(seg.match(/include\s*:\s*\[([^\]]*)\]/)?.[1]), exclude: strList(seg.match(/exclude\s*:\s*\[([^\]]*)\]/)?.[1]) });
    });
  }
  const testBlock = text.slice(Math.max(0, text.search(/\btest\s*:\s*\{/)));
  return {
    projects,
    include: strList(testBlock.match(/include\s*:\s*\[([^\]]*)\]/)?.[1]),
    exclude: strList(testBlock.match(/exclude\s*:\s*\[([^\]]*)\]/)?.[1]),
  };
}

function categoryOf(name) {
  if (/e2e|end.?to.?end|playwright|browser/i.test(name)) return 'e2e';
  if (/integ|api.?test|contract/i.test(name)) return 'integration';
  if (RULES_RE.test(name)) return 'rules';
  return 'unit';
}

async function generate(root) {
  const suites = [];
  const used = new Set();
  const uid = (s) => { let id = s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'suite'; let i = 2; const b = id; while (used.has(id)) id = `${b}-${i++}`; used.add(id); return id; };

  const pkgDirs = packageDirs(root);
  for (const dir of pkgDirs) {
    const pkg = readJson(path.join(dir, 'package.json')) || {};
    const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
    const cwd = rel(root, dir) || '';
    const label = cwd ? (pkg.name || cwd).replace(/^@[^/]+\//, '') : (pkg.name || path.basename(root));
    const script = pkg.scripts?.test || '';

    // Playwright
    const pwCfg = findConfig(dir, ['playwright.config.ts', 'playwright.config.js', 'playwright.config.mjs', 'playwright.config.mts']);
    let pwDir = null;
    if (pwCfg || deps['@playwright/test']) {
      const t = readText(pwCfg || '');
      pwDir = (t.match(/testDir\s*:\s*['"`]([^'"`]+)['"`]/)?.[1] || 'tests').replace(/^\.\//, '');
      if (pwCfg || exists(path.join(dir, pwDir))) {
        suites.push({ id: uid(`${label}-e2e`), name: `${label} — Playwright`, category: 'e2e', framework: 'playwright', cwd, include: [`${pwDir}/**/*.{spec,test}.{ts,js,mjs,cjs,tsx,jsx}`], exclude: [] });
      }
    }
    // Les sous-paquets d'un monorepo ont leurs propres suites : la racine les ignore
    const subPkgs = pkgDirs.filter((d) => d !== dir && d.toLowerCase().startsWith(dir.toLowerCase() + path.sep)).map((d) => `${rel(dir, d)}/**`);
    const pwExclude = [...(pwDir ? [`${pwDir}/**`] : []), ...subPkgs];

    // Vitest
    const vCfg = findConfig(dir, ['vitest.config.ts', 'vitest.config.mts', 'vitest.config.js', 'vitest.config.mjs', 'vite.config.ts', 'vite.config.mts', 'vite.config.js', 'vite.config.mjs']);
    const vText = readText(vCfg || '');
    const hasVitest = deps.vitest || /vitest/.test(script) || /vitest/.test(path.basename(vCfg || '')) || /\btest\s*:\s*\{/.test(vText);
    const base = [];
    if (hasVitest && (deps.vitest || /vitest/.test(script) || /vitest\.config/.test(vCfg || ''))) {
      const c = parseVitestConfig(vText);
      if (c.projects.length) {
        for (const p of c.projects) base.push({ name: `${label} — ${p.name}`, category: categoryOf(p.name), framework: 'vitest', cwd, args: ['--project', p.name], include: p.include.length ? p.include : [JS_TEST], exclude: [...p.exclude, ...pwExclude] });
      } else base.push({ name: label, category: cwd && RULES_PKG_RE.test(path.basename(dir)) ? 'rules' : 'unit', framework: 'vitest', cwd, include: c.include.length ? c.include : [JS_TEST], exclude: [...c.exclude, ...pwExclude] });
    } else if (deps.jest || /\bjest\b/.test(script)) {
      const jcfg = pkg.jest || {};
      base.push({ name: label, category: 'unit', framework: 'jest', cwd, include: jcfg.testMatch || [JS_TEST, '**/__tests__/**/*.{js,jsx,ts,tsx}'], exclude: pwExclude });
    } else if (/node\s+(--[\w-]+\s+)*--test/.test(script)) {
      base.push({ name: label, category: 'unit', framework: 'node', cwd, include: ['**/*.test.{js,mjs,cjs}', 'test/**/*.{js,mjs,cjs}', 'tests/**/*.{js,mjs,cjs}'], exclude: pwExclude });
    }

    // Répartit les fichiers : règles métier / intégration détectées par leur chemin
    for (const s of base) {
      const files = (await listFiles(root, s)).map((f) => rel(dir, f));
      const groups = { rules: [], integration: [] };
      if (s.category === 'unit') {
        for (const f of files) {
          if (RULES_RE.test(f)) groups.rules.push(f);
          else if (INTEG_RE.test(f)) groups.integration.push(f);
        }
      }
      const moved = [...groups.rules, ...groups.integration];
      if (files.length - moved.length > 0 || !moved.length) suites.push({ id: uid(s.name), ...s, exclude: [...s.exclude, ...moved] });
      for (const [cat, list] of Object.entries(groups)) {
        if (!list.length) continue;
        suites.push({ id: uid(`${s.name}-${cat}`), ...s, name: `${s.name} · ${CATEGORIES[cat].name.toLowerCase()}`, category: cat, include: [], exclude: [], files: list });
      }
    }
  }

  // Autres langages (racine uniquement)
  if (exists(path.join(root, 'pytest.ini')) || exists(path.join(root, 'conftest.py')) || /pytest/.test(readText(path.join(root, 'pyproject.toml')))) {
    suites.push({ id: uid('pytest'), name: 'pytest', category: 'unit', framework: 'pytest', cwd: '' });
  }
  if (exists(path.join(root, 'go.mod'))) suites.push({ id: uid('go'), name: 'Go', category: 'unit', framework: 'go', cwd: '' });
  if (exists(path.join(root, 'Cargo.toml'))) suites.push({ id: uid('cargo'), name: 'Cargo', category: 'unit', framework: 'cargo', cwd: '' });

  // Les intégrations nécessitent souvent des services (base de données…)
  for (const s of suites) if (s.category === 'integration') s.requires = s.requires || 'Peut nécessiter des services démarrés (base de données, Docker…)';
  // Ne garde que les suites qui contiennent des tests
  const kept = [];
  for (const s of suites) {
    if (['pytest', 'go', 'cargo'].includes(s.framework) || (await listFiles(root, s)).length) kept.push(s);
  }
  return { version: 2, generated: new Date().toISOString(), suites: kept };
}

async function listFiles(root, s) {
  const dir = path.join(root, s.cwd || '');
  if (s.files) return s.files.map((f) => path.join(dir, f)).filter(exists);
  const inc = matcher(s.include), exc = matcher(s.exclude);
  return walk(dir, (p) => inc(p) && !exc(p));
}

// ---------- Configuration ----------
function loadConfig(root) {
  const c = readJson(cfgPath(root));
  if (c?.suites) return { ...c, source: 'file' };
  if (c?.command) return { version: 1, source: 'legacy', legacy: true, suites: [{ id: 'custom', name: c.label || 'Commande personnalisée', category: 'other', framework: 'custom', cwd: '', command: c.command, junit: c.junit }] };
  return null;
}

async function writeGenerated(root) {
  const cfg = await generate(root);
  const p = cfgPath(root);
  const old = readJson(p);
  if (old && !old.suites) { try { fs.copyFileSync(p, path.join(root, Workspace.DIR, 'tests.legacy.json')); } catch {} }
  if (old?.suites) {
    // Conserve les réglages faits à la main (args, requires…) des suites qui existent toujours
    for (const s of cfg.suites) { const o = old.suites.find((x) => x.id === s.id); if (o) Object.assign(s, { ...s, ...pick(o, ['args', 'requires', 'env', 'command', 'name']) }); }
  }
  Workspace.writeJson(p, cfg);
  return cfg;
}
const pick = (o, keys) => Object.fromEntries(keys.filter((k) => o[k] !== undefined).map((k) => [k, o[k]]));

// ---------- Découverte ----------
function node(id, name, kind, extra = {}) { return { id, name, kind, children: kind === 'test' ? undefined : [], ...extra }; }

// Analyse statique d'un fichier de tests JS/TS (describe / it / test / test.describe)
function parseJsTests(text, prefix, name, file, suiteId) {
  const fileNode = node(prefix, name, 'file', { file, line: 1, suiteId });
  const stack = [{ n: fileNode, depth: -1, path: [] }];
  let depth = 0;
  const re = /\b(describe|suite|context|it|test)(?:\.(?:only|skip|todo|fixme|concurrent|serial|parallel|each\([^)]*\)))*\s*\(\s*(['"`])((?:\\.|(?!\2).)*)\2/g;
  text.split('\n').forEach((line, i) => {
    let m;
    re.lastIndex = 0;
    while ((m = re.exec(line))) {
      while (stack.length > 1 && depth <= stack[stack.length - 1].depth) stack.pop();
      const parent = stack[stack.length - 1];
      const nm = m[3].replace(/\\(.)/g, '$1');
      const p = [...parent.path, nm];
      const id = `${prefix}::${p.join(' > ')}`;
      if (/^(describe|suite|context)$/.test(m[1])) {
        const n = node(id, nm, 'suite', { file, line: i + 1, path: p, suiteId });
        parent.n.children.push(n);
        stack.push({ n, depth, path: p });
      } else parent.n.children.push(node(id, nm, 'test', { file, line: i + 1, path: p, suiteId, dynamic: /\$\{/.test(nm) }));
    }
    for (const ch of line.replace(/(['"`])(?:\\.|(?!\1).)*\1/g, '')) { if (ch === '{') depth++; else if (ch === '}') depth--; }
  });
  return fileNode;
}

async function discoverSuite(root, s) {
  const dir = path.join(root, s.cwd || '');
  if (['vitest', 'jest', 'playwright', 'node'].includes(s.framework)) {
    const files = (await listFiles(root, s)).sort();
    return files.map((f) => { const r = rel(dir, f); return parseJsTests(readText(f), `${s.id}::${r}`, r, f, s.id); });
  }
  if (s.framework === 'pytest') {
    const r = await sh(`${python(dir)} -m pytest --collect-only -q`, dir);
    const files = new Map();
    for (const line of r.stdout.split(/\r?\n/)) {
      if (!line.includes('::')) continue;
      const parts = line.trim().split('::');
      const fr = parts[0];
      if (!files.has(fr)) files.set(fr, node(`${s.id}::${fr}`, fr, 'file', { file: path.join(dir, fr), line: 1, suiteId: s.id }));
      let parent = files.get(fr);
      for (let i = 1; i < parts.length; i++) {
        const id = `${s.id}::${parts.slice(0, i + 1).join('::')}`;
        const last = i === parts.length - 1;
        let n = parent.children.find((c) => c.id === id);
        if (!n) { n = node(id, parts[i], last ? 'test' : 'suite', { file: path.join(dir, fr), suiteId: s.id, nodeid: parts.slice(0, i + 1).join('::') }); parent.children.push(n); }
        parent = n;
      }
    }
    return [...files.values()];
  }
  if (s.framework === 'go') {
    const r = await sh('go test -list . ./...', dir);
    let pending = [];
    const pkgs = [];
    for (const line of r.stdout.split(/\r?\n/)) {
      const ok = line.match(/^(ok|FAIL|\?)\s+(\S+)/);
      if (ok) {
        if (pending.length) { const pn = node(`${s.id}::${ok[2]}`, ok[2], 'file', { pkg: ok[2], suiteId: s.id }); pn.children = pending.map((t) => node(`${s.id}::${ok[2]}::${t}`, t, 'test', { pkg: ok[2], testName: t, suiteId: s.id })); pkgs.push(pn); }
        pending = [];
      } else if (/^(Test|Example|Fuzz)\w*/.test(line.trim())) pending.push(line.trim());
    }
    return pkgs;
  }
  if (s.framework === 'cargo') {
    const r = await sh('cargo test -- --list', dir, 300000);
    const mods = new Map();
    for (const line of r.stdout.split(/\r?\n/)) {
      const m = line.match(/^(.+): test$/);
      if (!m) continue;
      const parts = m[1].split('::');
      const mod = parts.length > 1 ? parts.slice(0, -1).join('::') : '(racine)';
      if (!mods.has(mod)) mods.set(mod, node(`${s.id}::mod:${mod}`, mod, 'file', { suiteId: s.id }));
      mods.get(mod).children.push(node(`${s.id}::${m[1]}`, parts[parts.length - 1], 'test', { testName: m[1], suiteId: s.id }));
    }
    return [...mods.values()];
  }
  return [];
}

async function discover(root) {
  let cfg = loadConfig(root);
  let generated = false;
  if (!cfg) { cfg = await generate(root); generated = true; }
  const cats = new Map();
  await Promise.all(cfg.suites.map(async (s) => {
    const cat = CATEGORIES[s.category] ? s.category : 'other';
    if (!cats.has(cat)) cats.set(cat, node(`cat:${cat}`, CATEGORIES[cat].name, 'category', { category: cat, icon: CATEGORIES[cat].icon, order: CATEGORIES[cat].order }));
    const sn = node(`suite:${s.id}`, s.name, 'suite-root', { suiteId: s.id, framework: s.framework, fwLabel: FW_LABEL[s.framework] || s.framework, cwd: s.cwd, requires: s.requires });
    try { sn.children = await discoverSuite(root, s); } catch (e) { sn.error = e.message; }
    cats.get(cat).children.push(sn);
  }));
  const tree = [...cats.values()].sort((a, b) => a.order - b.order);
  for (const c of tree) c.children.sort((a, b) => a.name.localeCompare(b.name));
  return {
    tree, suites: cfg.suites, legacy: !!cfg.legacy, generated, configured: cfg.source === 'file',
    frameworks: [...new Set(cfg.suites.map((s) => FW_LABEL[s.framework] || s.framework))],
  };
}

// ---------- Exécution ----------
function vitestCmd(root, dir, s, out, n) {
  const bin = localBin(dir, root, ['vitest/vitest.mjs']);
  let c = (bin ? `node ${q(bin)}` : 'npx vitest') + ` run --reporter=default --reporter=json --outputFile.json=${q(out)}`;
  for (const a of s.args || []) c += ` ${q(a)}`;
  if (n?.file) c += ` ${q(rel(dir, n.file))}`;
  else if (s.files) c += ' ' + s.files.map(q).join(' ');
  for (const e of s.exclude || []) c += ` --exclude ${q(e)}`;
  if (n?.path && n.kind !== 'file') c += ` -t ${q('^' + escRe(n.path.join(' ')) + (n.kind === 'test' ? '$' : ''))}`;
  return c;
}
function jestCmd(root, dir, s, out, n) {
  const bin = localBin(dir, root, ['jest/bin/jest.js']);
  let c = (bin ? `node ${q(bin)}` : 'npx jest') + ` --json --outputFile=${q(out)} --testLocationInResults`;
  for (const a of s.args || []) c += ` ${q(a)}`;
  if (n?.file) c += ` ${q(escRe(rel(dir, n.file)))}`;
  else if (s.files) c += ' ' + s.files.map((f) => q(escRe(f))).join(' ');
  if (n?.path && n.kind !== 'file') c += ` -t ${q('^' + escRe(n.path.join(' ')) + (n.kind === 'test' ? '$' : ''))}`;
  return c;
}
function playwrightCmd(root, dir, s, n) {
  const bin = localBin(dir, root, ['@playwright/test/cli.js', 'playwright/cli.js']);
  let c = (bin ? `node ${q(bin)}` : 'npx playwright') + ' test --reporter=list,json';
  for (const a of s.args || []) c += ` ${q(a)}`;
  if (n?.file) c += ` ${q(rel(dir, n.file).replace(/\\/g, '/') + (n.kind === 'test' && n.line && !n.dynamic ? `:${n.line}` : ''))}`;
  else if (s.files) c += ' ' + s.files.map(q).join(' ');
  if (n?.kind === 'suite' && n.path) c += ` -g ${q(n.path.join(' '))}`;
  return c;
}

function buildCommand(root, s, out, n) {
  const dir = path.join(root, s.cwd || '');
  switch (s.framework) {
    case 'vitest': return vitestCmd(root, dir, s, out, n);
    case 'jest': return jestCmd(root, dir, s, out, n);
    case 'playwright': return playwrightCmd(root, dir, s, n);
    case 'node': {
      let c = `node --test --test-reporter=spec --test-reporter-destination=stdout --test-reporter=junit --test-reporter-destination=${q(out)}`;
      if (n?.path && n.kind !== 'file') c += ` --test-name-pattern=${q('^' + escRe(n.name) + '$')}`;
      if (n?.file) c += ` ${q(n.file)}`;
      else if (s.resolvedFiles?.length) c += ' ' + s.resolvedFiles.map(q).join(' ');
      return c;
    }
    case 'pytest': return `${python(dir)} -m pytest -v --junitxml=${q(out)}` + (n?.nodeid ? ` ${q(n.nodeid)}` : n?.kind === 'file' ? ` ${q(n.name)}` : '');
    case 'go':
      if (!n) return 'go test -json ./...';
      if (n.kind === 'file') return `go test -json ${q(n.pkg)}`;
      return `go test -json -run ${q('^' + n.testName + '$')} ${q(n.pkg)}`;
    case 'cargo':
      if (!n) return 'cargo test --no-fail-fast';
      if (n.kind === 'test') return `cargo test --no-fail-fast ${q(n.testName)} -- --exact`;
      return `cargo test --no-fail-fast ${q(n.name + '::')}`;
    case 'custom': return s.command;
  }
  return null;
}

// scope : { all } | { category } | { suiteId } | { node: { suiteId, kind, file, path, name, line, … } }
async function run(root, scope, onOut, runId) {
  const cfg = loadConfig(root) || await generate(root);
  let suites = cfg.suites;
  if (scope.category) suites = suites.filter((s) => (CATEGORIES[s.category] ? s.category : 'other') === scope.category);
  if (scope.suiteId) suites = suites.filter((s) => s.id === scope.suiteId);
  if (scope.node?.suiteId) suites = suites.filter((s) => s.id === scope.node.suiteId);
  if (scope.suiteIds) suites = suites.filter((s) => scope.suiteIds.includes(s.id));
  const state = { stopped: false, child: null };
  runs.set(runId, state);
  const t0 = Date.now();
  const results = {};
  let code = 0;
  for (const s of suites) {
    if (state.stopped) break;
    const r = await runSuite(root, s, scope.node, onOut, state);
    Object.assign(results, r.results);
    if (r.code) code = r.code;
  }
  runs.delete(runId);
  return { code, duration: Date.now() - t0, results, stopped: state.stopped, suites: suites.map((s) => s.id) };
}

async function runSuite(root, s, n, onOut, state) {
  const dir = path.join(root, s.cwd || '');
  const isJson = ['vitest', 'jest', 'playwright'].includes(s.framework);
  const out = s.framework === 'custom' && s.junit ? path.resolve(root, s.junit)
    : path.join(os.tmpdir(), `robotconsole-tests-${process.pid}-${Date.now()}-${s.id}.${isJson ? 'json' : 'xml'}`);
  try { fs.unlinkSync(out); } catch {}
  // node --test sans liste prendrait tous les fichiers *.test.* du dossier (y compris ceux d'autres outils)
  if (s.framework === 'node') s = { ...s, resolvedFiles: (await listFiles(root, s)).map((f) => rel(dir, f)) };
  const cmd = buildCommand(root, s, out, n && n.kind !== 'suite-root' ? n : null);
  onOut(`\r\n\x1b[1;36m━━ ${s.name}\x1b[0m \x1b[90m(${FW_LABEL[s.framework] || s.framework}${s.cwd ? ' · ' + s.cwd : ''})\x1b[0m\r\n\x1b[90m$ ${cmd}\x1b[0m\r\n`);
  let stdout = '';
  const env = { ...process.env, FORCE_COLOR: '1', CI: '1', ...(s.env || {}) };
  delete env.NO_COLOR;
  if (s.framework === 'playwright') env.PLAYWRIGHT_JSON_OUTPUT_NAME = out;
  const code = await new Promise((resolve) => {
    const child = spawn(cmd, { cwd: dir, shell: true, windowsHide: true, env });
    state.child = child;
    const fwd = (d) => { const t = d.toString(); stdout += t; onOut(s.framework === 'go' ? goPretty(t) : t.replace(/\r?\n/g, '\r\n')); };
    child.stdout.on('data', fwd);
    child.stderr.on('data', (d) => onOut(d.toString().replace(/\r?\n/g, '\r\n')));
    child.on('close', (c) => resolve(c ?? 1));
    child.on('error', (e) => { onOut(`\r\n\x1b[31m${e.message}\x1b[0m\r\n`); resolve(1); });
  });
  state.child = null;
  let results = {};
  if (s.framework === 'vitest' || s.framework === 'jest') results = parseJestJson(dir, s.id, readJson(out));
  else if (s.framework === 'playwright') results = parsePlaywright(dir, s.id, readJson(out));
  else if (s.framework === 'go') results = prefix(s.id, parseGoJson(stdout));
  else if (s.framework === 'cargo') results = prefix(s.id, parseCargo(stdout));
  else results = parseJunit(root, s.id, readText(out));
  try { if (s.framework !== 'custom') fs.unlinkSync(out); } catch {}
  if (!Object.keys(results).length && code) results[`suite:${s.id}`] = { status: 'failed', message: 'La suite n\'a produit aucun résultat (voir la sortie).', duration: 0 };
  return { code, results };
}

function stop(runId) {
  const st = runs.get(runId);
  if (!st) return;
  st.stopped = true;
  const child = st.child;
  if (!child) return;
  if (process.platform === 'win32') execFile('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true }, () => {});
  else child.kill('SIGTERM');
}

// ---------- Lecture des résultats ----------
const strip = (s) => String(s || '').replace(/\x1b\[[0-9;]*m/g, '');
const mapStatus = (s) => (s === 'passed' || s === 'pass' || s === 'expected' ? 'passed' : ['failed', 'fail', 'timedOut', 'interrupted', 'unexpected'].includes(s) ? 'failed' : 'skipped');
const prefix = (id, r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [`${id}::${k}`, v]));

function parseJestJson(dir, sid, data) {
  const res = {};
  if (!data) return res;
  for (const f of data.testResults || []) {
    const fr = rel(dir, f.name);
    const asserts = f.assertionResults || [];
    if (f.status === 'failed' && !asserts.some((a) => a.status === 'failed')) res[`${sid}::${fr}`] = { status: 'failed', message: strip(f.message), duration: 0, file: f.name };
    for (const a of asserts) {
      const p = [...(a.ancestorTitles || []), a.title];
      res[`${sid}::${fr}::${p.join(' > ')}`] = { status: mapStatus(a.status), duration: a.duration || 0, message: strip((a.failureMessages || []).join('\n\n')), file: f.name, line: a.location?.line, path: p, name: a.title };
    }
  }
  return res;
}

function parsePlaywright(dir, sid, data) {
  const res = {};
  if (!data) return res;
  const rootDir = data.config?.rootDir || dir;
  const visit = (suite, titles, file) => {
    const f = suite.file ? path.resolve(rootDir, suite.file) : file;
    // Le premier niveau est le fichier lui-même : son titre n'entre pas dans le chemin du test
    const isFileLevel = suite.file && path.basename(suite.title || '') === path.basename(suite.file);
    const t = suite.title && !isFileLevel ? [...titles, suite.title] : titles;
    for (const spec of suite.specs || []) {
      const p = [...t, spec.title];
      const results = (spec.tests || []).flatMap((x) => x.results || []);
      const last = results[results.length - 1] || {};
      const statuses = (spec.tests || []).map((x) => x.status);
      const status = statuses.includes('unexpected') ? 'failed' : statuses.every((x) => x === 'skipped') ? 'skipped' : statuses.includes('flaky') || statuses.includes('expected') ? 'passed' : mapStatus(last.status);
      const errors = results.flatMap((r) => r.errors || (r.error ? [r.error] : []));
      res[`${sid}::${rel(dir, path.resolve(rootDir, spec.file || suite.file || ''))}::${p.join(' > ')}`] = {
        status, duration: results.reduce((a, r) => a + (r.duration || 0), 0), message: strip(errors.map((e) => e.stack || e.message).join('\n\n')),
        file: path.resolve(rootDir, spec.file || suite.file || ''), line: spec.line, path: p, name: spec.title, flaky: statuses.includes('flaky'),
      };
    }
    for (const sub of suite.suites || []) visit(sub, t, f);
  };
  for (const s of data.suites || []) visit(s, [], null);
  for (const e of data.errors || []) res[`suite:${sid}`] = { status: 'failed', message: strip(e.stack || e.message), duration: 0 };
  return res;
}

function parseGoJson(stdout) {
  const res = {}, outBy = {};
  for (const line of stdout.split(/\r?\n/)) {
    if (!line.startsWith('{')) continue;
    let e;
    try { e = JSON.parse(line); } catch { continue; }
    if (!e.Test) continue;
    const id = `${e.Package}::${e.Test.split('/')[0]}`;
    if (e.Action === 'output') outBy[id] = (outBy[id] || '') + e.Output;
    if (['pass', 'fail', 'skip'].includes(e.Action) && !e.Test.includes('/')) res[id] = { status: mapStatus(e.Action), duration: Math.round((e.Elapsed || 0) * 1000), message: e.Action === 'fail' ? outBy[id] : '' };
  }
  return res;
}
function goPretty(chunk) {
  return chunk.split(/\r?\n/).map((l) => { if (!l.startsWith('{')) return l; try { const e = JSON.parse(l); return e.Action === 'output' ? e.Output.replace(/\n$/, '') : null; } catch { return l; } }).filter((l) => l != null).join('\r\n') + '\r\n';
}
function parseCargo(stdout) {
  const res = {};
  for (const m of stdout.matchAll(/^test (\S+) \.\.\. (ok|FAILED|ignored)/gm)) res[m[1]] = { status: m[2] === 'ok' ? 'passed' : m[2] === 'FAILED' ? 'failed' : 'skipped', duration: 0, message: '' };
  for (const m of stdout.matchAll(/^---- (\S+) stdout ----\r?\n([\s\S]*?)(?=^---- |^failures:|^test result)/gm)) if (res[m[1]]) res[m[1]].message = m[2].trim();
  return res;
}

function attr(tag, name) {
  const m = tag.match(new RegExp(`\\b${name}="([^"]*)"`));
  return m ? unxml(m[1]) : '';
}
const unxml = (s) => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&apos;/g, "'").replace(/&#10;/g, '\n').replace(/&amp;/g, '&');
function parseJunit(root, sid, xml) {
  const res = {};
  for (const m of xml.matchAll(/<testcase\b([^>]*?)(\/>|>([\s\S]*?)<\/testcase>)/g)) {
    const tag = m[1], body = m[3] || '';
    const name = attr(tag, 'name'), classname = attr(tag, 'classname');
    const fail = body.match(/<(failure|error)\b([^>]*)>([\s\S]*?)<\/\1>|<(failure|error)\b([^>]*)\/>/);
    const r = {
      status: fail ? 'failed' : /<skipped/.test(body) ? 'skipped' : 'passed',
      duration: Math.round(parseFloat(attr(tag, 'time') || '0') * 1000),
      message: fail ? unxml(attr(fail[2] || fail[5] || '', 'message') + '\n' + (fail[3] || '')).trim() : '', name, classname,
    };
    const file = attr(tag, 'file');
    if (file) r.file = path.resolve(root, file);
    res[`${sid}::junit:${classname}::${name}`] = r;
  }
  return res;
}

// Modifie une suite dans tests.json (catégorie, nom…) ; génère le fichier s'il n'existe pas
async function updateSuite(root, suiteId, patch) {
  let cfg = readJson(cfgPath(root));
  if (!cfg?.suites) cfg = await writeGenerated(root);
  cfg.suites = cfg.suites.map((s) => (s.id === suiteId ? { ...s, ...patch } : s));
  Workspace.writeJson(cfgPath(root), cfg);
}

module.exports = { discover, generate, writeGenerated, updateSuite, run, stop, CATEGORIES };
