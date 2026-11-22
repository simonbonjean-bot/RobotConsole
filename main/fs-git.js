// RobotConsole — accès fichiers et Git pour les onglets Explorateur
const { ipcMain, dialog, shell, BrowserWindow } = require('electron');
const { execFile } = require('child_process');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');

const IMAGE_EXT = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.bmp': 'image/bmp' };
const IMAGE_MAX = 15 * 1024 * 1024;

function git(cwd, args) {
  return new Promise((resolve) => {
    execFile('git', args, { cwd, windowsHide: true, maxBuffer: 32 * 1024 * 1024 }, (err, stdout) => {
      resolve(err ? null : stdout);
    });
  });
}

async function list(dir, { showHidden } = {}) {
  const ents = await fsp.readdir(dir, { withFileTypes: true });
  const out = [];
  for (const e of ents) {
    if (e.name === '.git') continue;
    if (!showHidden && e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name);
    let isDir = e.isDirectory();
    let size = 0, mtime = 0;
    try {
      const st = await fsp.stat(p);
      isDir = st.isDirectory();
      size = st.size; mtime = st.mtimeMs;
    } catch { /* lien cassé, fichier verrouillé… */ }
    out.push({ name: e.name, path: p, isDir, size, mtime });
  }
  out.sort((a, b) => (b.isDir - a.isDir) || a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
  return out;
}

async function read(file, maxBytes = 1024 * 1024) {
  const st = await fsp.stat(file);
  const ext = path.extname(file).toLowerCase();
  const base = { size: st.size, mtime: st.mtimeMs };
  if (IMAGE_EXT[ext] && st.size <= IMAGE_MAX) {
    const buf = await fsp.readFile(file);
    return { ...base, kind: 'image', dataUrl: `data:${IMAGE_EXT[ext]};base64,${buf.toString('base64')}` };
  }
  const fh = await fsp.open(file, 'r');
  try {
    const len = Math.min(st.size, maxBytes);
    const buf = Buffer.alloc(len);
    await fh.read(buf, 0, len, 0);
    if (buf.subarray(0, 8192).includes(0)) return { ...base, kind: 'binary' };
    return { ...base, kind: 'text', content: buf.toString('utf8'), truncated: st.size > maxBytes };
  } finally {
    await fh.close();
  }
}

async function status(dir) {
  const top = await git(dir, ['rev-parse', '--show-toplevel']);
  if (!top) return { isRepo: false };
  const repoRoot = path.resolve(top.trim());
  const out = await git(repoRoot, ['status', '--porcelain=v1', '-b', '-z', '--untracked-files=all']);
  if (out == null) return { isRepo: false };
  const parts = out.split('\0');
  let branch = '', ahead = 0, behind = 0;
  const files = {};
  for (let i = 0; i < parts.length; i++) {
    const rec = parts[i];
    if (!rec) continue;
    if (rec.startsWith('## ')) {
      const head = rec.slice(3);
      const m = head.match(/^(?:No commits yet on |Initial commit on )?([^.\s]+)/);
      branch = m ? m[1] : head;
      ahead = +(head.match(/ahead (\d+)/)?.[1] || 0);
      behind = +(head.match(/behind (\d+)/)?.[1] || 0);
      continue;
    }
    const x = rec[0], y = rec[1];
    const rel = rec.slice(3);
    let code;
    if (x === '?' && y === '?') code = 'U';
    else if (x === 'U' || y === 'U' || (x === 'A' && y === 'A') || (x === 'D' && y === 'D')) code = 'C';
    else if (x === 'R' || y === 'R') { code = 'R'; i++; } // le chemin d'origine suit
    else if (x === 'A') code = 'A';
    else if (x === 'D' || y === 'D') code = 'D';
    else code = 'M';
    files[path.join(repoRoot, rel)] = { code, staged: x !== ' ' && x !== '?' };
  }
  return { isRepo: true, repoRoot, branch, ahead, behind, files };
}

async function diff(repoRoot, file, code) {
  if (code === 'U') {
    try { return { untracked: true, content: await fsp.readFile(file, 'utf8') }; } catch { return { untracked: true, content: '' }; }
  }
  let out = await git(repoRoot, ['diff', '--no-color', 'HEAD', '--', file]);
  if (!out) out = await git(repoRoot, ['diff', '--no-color', '--cached', '--', file]); // dépôt sans commit
  return { content: out || '' };
}

// ---------- Surveillance ----------
const watchers = new Map();
// opts.name : surveille un seul fichier de « root » (dossier parent, non récursif) — résiste aux
// enregistrements par renommage (fichier temporaire puis remplacement) que font beaucoup d'éditeurs.
function watch(id, root, wc, opts = {}) {
  unwatch(id);
  let timer = null;
  const only = opts.name ? String(opts.name).toLowerCase() : null;
  try {
    const w = fs.watch(root, { recursive: !only }, (_ev, name) => {
      if (only && (!name || String(name).toLowerCase() !== only)) return;
      // Dans .git, seuls HEAD et refs/ comptent (commit, changement de branche) :
      // on ignore index, objets, verrous… que « git status » touche lui-même.
      if (name && /(^|[\\/])\.git([\\/]|$)/.test(name) && !/\.git[\\/](HEAD|refs[\\/])/.test(name)) return;
      if (name && /(^|[\\/])node_modules[\\/]/.test(name)) return;
      clearTimeout(timer);
      timer = setTimeout(() => { if (!wc.isDestroyed()) wc.send('fs:changed', id); }, 300);
    });
    w.on('error', () => unwatch(id));
    watchers.set(id, w);
  } catch { /* dossier inaccessible */ }
}
function unwatch(id) {
  const w = watchers.get(id);
  if (w) { try { w.close(); } catch {} watchers.delete(id); }
}

function register() {
  ipcMain.handle('fs:list', (_e, dir, opts) => list(dir, opts));
  ipcMain.handle('fs:read', (_e, file, max) => read(file, max));
  ipcMain.handle('fs:exists', (_e, p) => fs.existsSync(p));
  ipcMain.handle('fs:pickFolder', async (e, start) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    const r = await dialog.showOpenDialog(win, { title: require('./i18n').t('Choisir un dossier'), defaultPath: start, properties: ['openDirectory'] });
    return r.canceled ? null : r.filePaths[0];
  });
  ipcMain.handle('git:status', (_e, dir) => status(dir));
  ipcMain.handle('git:diff', (_e, repoRoot, file, code) => diff(repoRoot, file, code));
  ipcMain.on('fs:watch', (e, id, root, opts) => watch(id, root, e.sender, opts || {}));
  ipcMain.on('fs:unwatch', (_e, id) => unwatch(id));
  // Opérations sur les fichiers (menu contextuel, éditeur)
  ipcMain.handle('fs:readText', async (_e, file) => {
    const st = await fsp.stat(file);
    if (st.size > 20 * 1024 * 1024) throw new Error('Fichier trop gros pour être édité (> 20 Mo)');
    const buf = await fsp.readFile(file);
    if (buf.subarray(0, 8192).includes(0)) throw new Error('Fichier binaire : édition impossible');
    return { content: buf.toString('utf8'), mtime: st.mtimeMs };
  });
  ipcMain.handle('fs:writeText', async (_e, file, content) => {
    await fsp.writeFile(file, content, 'utf8');
    return (await fsp.stat(file)).mtimeMs;
  });
  ipcMain.handle('fs:createFile', async (_e, file) => {
    await fsp.mkdir(path.dirname(file), { recursive: true });
    const fh = await fsp.open(file, 'wx'); // échoue si le fichier existe
    await fh.close();
  });
  ipcMain.handle('fs:mkdir', (_e, dir) => fsp.mkdir(dir, { recursive: false }));
  ipcMain.handle('fs:rename', async (_e, from, to) => {
    if (fs.existsSync(to) && from.toLowerCase() !== to.toLowerCase()) throw new Error('Un élément porte déjà ce nom');
    await fsp.rename(from, to);
  });
  ipcMain.handle('fs:trash', (_e, p) => shell.trashItem(p));
  ipcMain.handle('fs:copy', async (_e, from, toDir) => {
    const base = path.basename(from);
    const ext = path.extname(base);
    const stem = fs.statSync(from).isDirectory() ? base : base.slice(0, base.length - ext.length);
    const suffix = fs.statSync(from).isDirectory() ? '' : ext;
    let dest = path.join(toDir, base);
    for (let i = 1; fs.existsSync(dest); i++) dest = path.join(toDir, `${stem} - copie${i > 1 ? ' ' + i : ''}${suffix}`);
    await fsp.cp(from, dest, { recursive: true, errorOnExist: true });
    return dest;
  });
  ipcMain.handle('fs:move', async (_e, from, toDir) => {
    const dest = path.join(toDir, path.basename(from));
    if (fs.existsSync(dest)) throw new Error('Un élément du même nom existe déjà dans la destination');
    try { await fsp.rename(from, dest); } catch (e) {
      if (e.code !== 'EXDEV') throw e;
      await fsp.cp(from, dest, { recursive: true }); await fsp.rm(from, { recursive: true });
    }
    return dest;
  });
  ipcMain.handle('git:stage', (_e, repo, file) => git(repo, ['add', '--', file]));
  ipcMain.handle('git:unstage', (_e, repo, file) => git(repo, ['restore', '--staged', '--', file]));
  ipcMain.handle('git:discard', async (_e, repo, file, code) => {
    if (code === 'U') return shell.trashItem(file);
    return git(repo, ['restore', '--source=HEAD', '--staged', '--worktree', '--', file]);
  });

  ipcMain.on('shell:openPath', (_e, p) => shell.openPath(p));
  ipcMain.on('shell:showItem', (_e, p) => shell.showItemInFolder(p));
}

function closeAll() {
  for (const id of [...watchers.keys()]) unwatch(id);
}

module.exports = { register, closeAll };
