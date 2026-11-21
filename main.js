// RobotConsole — processus principal Electron
// Fenêtres (une par workspace), service des terminaux, workspaces, tests, Docker, services.
const I18n = require('./main/i18n');
const { app, BrowserWindow, ipcMain, clipboard, shell, dialog, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const PtyClient = require('./main/ptyclient');
const fsGit = require('./main/fs-git');
const Workspace = require('./main/workspace');
const Services = require('./main/services');
const Tests = require('./main/tests');
const Docker = require('./main/docker');
const Prisma = require('./main/prisma');
const Graphify = require('./main/graphify');

const APP_NAME = 'RobotConsole';
const APP_ID = 'RobotConsole.App';
const ICON_ICO = path.join(__dirname, 'build', process.platform === 'win32' ? 'icon.ico' : 'icon.png');

// ---------- Nom de l'application et dossier de données ----------
app.setName(APP_NAME);
const userData = process.env.ROBOTCONSOLE_USERDATA || path.join(app.getPath('appData'), APP_NAME);
app.setPath('userData', userData);
(function migrate() {
  // Reprend l'état et les réglages de l'ancienne version « Console AI »
  const old = path.join(app.getPath('appData'), 'console-ai');
  if (process.env.ROBOTCONSOLE_USERDATA || !fs.existsSync(old)) return;
  fs.mkdirSync(userData, { recursive: true });
  for (const f of ['state.json', 'settings.json']) {
    const dst = path.join(userData, f);
    if (!fs.existsSync(dst) && fs.existsSync(path.join(old, f))) fs.copyFileSync(path.join(old, f), dst);
  }
})();
if (process.platform === 'win32') app.setAppUserModelId(APP_ID);

const exists = (p) => { try { return fs.existsSync(p); } catch { return false; } };
const readJson = (p, d) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return d; } };
const writeJson = (p, v) => { try { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, JSON.stringify(v, null, 2)); } catch {} };
const dataFile = (n) => path.join(app.getPath('userData'), n);

// ---------- Shells disponibles ----------
function detectShells() {
  const sys32 = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32');
  const pf = process.env.ProgramFiles || 'C:\\Program Files';
  const list = [];
  if (process.platform !== 'win32') {
    list.push({ id: 'default', label: 'Shell', file: process.env.SHELL || '/bin/bash', args: ['-l'] });
    return list;
  }
  const pwsh = [path.join(pf, 'PowerShell', '7', 'pwsh.exe'), path.join(pf, 'PowerShell', '7-preview', 'pwsh.exe')].find(exists);
  if (pwsh) list.push({ id: 'pwsh', label: 'PowerShell 7', file: pwsh, args: ['-NoLogo'] });
  const ps = path.join(sys32, 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  if (exists(ps)) list.push({ id: 'powershell', label: 'Windows PowerShell', file: ps, args: ['-NoLogo'] });
  const cmd = path.join(sys32, 'cmd.exe');
  if (exists(cmd)) list.push({ id: 'cmd', label: 'Invite de commandes', file: cmd, args: [] });
  const gitBash = [path.join(pf, 'Git', 'bin', 'bash.exe'), path.join(process.env['ProgramFiles(x86)'] || '', 'Git', 'bin', 'bash.exe')].find(exists);
  if (gitBash) list.push({ id: 'gitbash', label: 'Git Bash', file: gitBash, args: ['--login', '-i'] });
  const wsl = path.join(sys32, 'wsl.exe');
  if (exists(wsl)) list.push({ id: 'wsl', label: 'WSL', file: wsl, args: [] });
  return list;
}
const SHELLS = detectShells();

// ---------- Fenêtres ----------
// Une fenêtre « principale » par workspace (winId = 'main'), plus des fenêtres secondaires
// (espaces sortis de la fenêtre principale), chacune avec son propre fichier d'état.
const windows = new Map(); // webContents.id -> { win, ws, winId }
let quitting = false;

function windowsFile() { return dataFile('windows.json'); }
function rememberWindows() {
  const list = [...windows.values()].map(({ win, ws, winId }) => ({ ws, winId, bounds: win.isDestroyed() ? undefined : win.getNormalBounds(), maximized: !win.isDestroyed() && win.isMaximized() }));
  writeJson(windowsFile(), list);
}
const sameWs = (a, b) => (a || '').toLowerCase() === (b || '').toLowerCase();
function statePath(ws, winId = 'main') {
  const name = winId === 'main' ? 'state.json' : `state-${winId}.json`;
  return ws ? Workspace.file(ws, name) : dataFile(name);
}

function recent() { return readJson(dataFile('recent.json'), []).filter((p) => exists(path.join(p, Workspace.DIR))); }
function addRecent(ws) {
  if (!ws) return;
  const list = [ws, ...recent().filter((p) => p.toLowerCase() !== ws.toLowerCase())].slice(0, 12);
  writeJson(dataFile('recent.json'), list);
}

function findWindow(ws, winId = 'main') {
  for (const w of windows.values()) if (sameWs(w.ws, ws) && w.winId === winId) return w;
  return null;
}

function createWindow({ ws = null, winId = 'main', bounds, maximized, initialState } = {}) {
  const existing = findWindow(ws, winId);
  if (existing) { existing.win.show(); existing.win.focus(); return existing.win; }
  if (initialState) writeJson(statePath(ws, winId), initialState);
  if (ws) { Workspace.ensure(ws); addRecent(ws); }

  // Décale les nouvelles fenêtres pour qu'elles ne se superposent pas exactement
  if (!bounds && windows.size) {
    const last = [...windows.values()].pop().win.getBounds();
    bounds = { ...last, x: last.x + 32, y: last.y + 32 };
  }
  if (bounds && !screen.getAllDisplays().some((d) => bounds.x < d.bounds.x + d.bounds.width && bounds.x + 100 > d.bounds.x && bounds.y < d.bounds.y + d.bounds.height && bounds.y + 50 > d.bounds.y)) bounds = undefined;

  const win = new BrowserWindow({
    width: 1400, height: 900, ...(bounds || {}),
    minWidth: 760, minHeight: 480,
    backgroundColor: '#0e1117',
    title: ws ? `${Workspace.load(ws).name} — ${APP_NAME}` : APP_NAME,
    icon: ICON_ICO,
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#0e1117', symbolColor: '#c9d1d9', height: 58 },
    show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, webviewTag: true },
  });
  const entry = { win, ws, winId };
  windows.set(win.webContents.id, entry);
  if (maximized) win.maximize();
  win.once('ready-to-show', () => win.show());

  if (process.platform === 'win32') {
    win.setAppDetails({
      appId: APP_ID, appIconPath: ICON_ICO, appIconIndex: 0,
      relaunchCommand: `"${process.execPath}" "${__dirname}"`, relaunchDisplayName: APP_NAME,
    });
  }
  win.removeMenu();
  win.webContents.on('will-attach-webview', (event, prefs, params) => {
    if (params.src !== 'about:blank' && !/^https?:\/\//i.test(params.src)) { event.preventDefault(); return; }
    delete prefs.preload;
    Object.assign(prefs, { nodeIntegration: false, nodeIntegrationInSubFrames: false, contextIsolation: true, sandbox: true, webSecurity: true });
  });
  win.webContents.on('did-attach-webview', (_event, guest) => {
    guest.setWindowOpenHandler(() => ({ action: 'deny' }));
    const guard = (event, url) => { if (url !== 'about:blank' && !/^https?:\/\//i.test(url)) event.preventDefault(); };
    guest.on('will-navigate', guard);
    guest.on('will-redirect', guard);
    guest.session.setPermissionRequestHandler((_wc, _permission, respond) => respond(false));
    guest.session.setPermissionCheckHandler(() => false);
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type === 'keyDown' && input.key === 'F12') win.webContents.toggleDevTools();
  });

  const wcId = win.webContents.id;
  win.on('close', (ev) => {
    // Fenêtre secondaire fermée par l'utilisateur : on lui demande quoi faire de ses espaces
    if (winId !== 'main' && !quitting && !entry.closeOk) {
      ev.preventDefault();
      win.webContents.send('win:closeRequest');
      return;
    }
    // La dernière fenêtre fermée (ou la fermeture de l'app) reste dans la liste à rouvrir
    if (!quitting && windows.size > 1) { windows.delete(wcId); rememberWindows(); }
    else rememberWindows();
  });
  win.on('closed', () => { windows.delete(wcId); unsubscribeAll(wcId); });
  win.on('resized', rememberWindows);
  win.on('moved', rememberWindows);
  rememberWindows();
  return win;
}

const ctxOf = (e) => windows.get(e.sender.id) || { ws: null };

// ---------- Service des terminaux ----------
const ptyHost = new PtyClient(app.getPath('userData'));
const owners = new Map(); // sessionId -> Set(webContents)
function own(id, wc) {
  if (!owners.has(id)) owners.set(id, new Set());
  owners.get(id).add(wc);
}
function unsubscribeAll(wcId) {
  for (const set of owners.values()) for (const wc of set) if (wc.isDestroyed() || wc.id === wcId) set.delete(wc);
}
const outBuf = new Map();
let outTimer = null;
function sendTo(id, channel, ...args) {
  for (const wc of owners.get(id) || []) if (!wc.isDestroyed()) wc.send(channel, id, ...args);
}
ptyHost.onData = (id, data) => {
  outBuf.set(id, (outBuf.get(id) || '') + data);
  if (!outTimer) outTimer = setTimeout(() => {
    outTimer = null;
    for (const [k, v] of outBuf) sendTo(k, 'pty:data', v);
    outBuf.clear();
  }, 8);
};
ptyHost.onExit = (id, code) => {
  const pending = outBuf.get(id);
  if (pending) { sendTo(id, 'pty:data', pending); outBuf.delete(id); }
  sendTo(id, 'pty:exit', code);
  services.onExit(id, code);
};

ipcMain.handle('shells:list', () => SHELLS.map(({ id, label }) => ({ id, label })));
ipcMain.handle('pty:create', async (e, { id, shellId, cols, rows, cwd, init, scope }) => {
  const def = SHELLS.find((s) => s.id === shellId) || SHELLS[0];
  own(id, e.sender);
  await ptyHost.send({
    t: 'create', id, scope: scope || '', shellId: def.id, file: def.file, args: def.args,
    cols: Math.max(2, cols | 0), rows: Math.max(2, rows | 0),
    cwd: cwd && exists(cwd) ? cwd : (ctxOf(e).ws || os.homedir()),
    env: { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor' },
    init: init || [],
  });
  return { shellId: def.id, label: def.label };
});
ipcMain.handle('pty:attach', (e, { id, cols, rows }) => { own(id, e.sender); return ptyHost.attach(id, cols, rows); });
ipcMain.on('pty:detach', (e, id) => owners.get(id)?.delete(e.sender));
// Nettoyage des terminaux orphelins : on garde aussi ceux des autres fenêtres du même workspace
function sessionsOfState(file) {
  const st = readJson(file, null);
  return (st?.spaces || []).flatMap((sp) => (sp.tabs || []).map((t) => t.sessionId).filter(Boolean));
}
ipcMain.on('pty:gc', (e, scope, keep) => {
  const me = ctxOf(e);
  const all = new Set(keep || []);
  for (const w of windows.values()) {
    if (w.win.webContents.id === e.sender.id || !sameWs(w.ws, me.ws)) continue;
    for (const id of sessionsOfState(statePath(w.ws, w.winId))) all.add(id);
  }
  for (const [id, set] of owners) for (const wc of set) if (wc.id !== e.sender.id && !wc.isDestroyed()) all.add(id);
  // Fenêtres secondaires mémorisées mais pas encore rouvertes
  for (const w of readJson(windowsFile(), [])) if (sameWs(w.ws, me.ws) && w.winId && w.winId !== me.winId) for (const id of sessionsOfState(statePath(w.ws, w.winId))) all.add(id);
  ptyHost.send({ t: 'gc', scope: scope || '', keep: [...all] }).catch(() => {});
});
ipcMain.on('pty:write', (_e, id, data) => { ptyHost.send({ t: 'write', id, data }).catch(() => {}); });
ipcMain.on('pty:resize', (_e, id, cols, rows) => { ptyHost.send({ t: 'resize', id, cols, rows }).catch(() => {}); });
ipcMain.on('pty:kill', (_e, id) => { owners.delete(id); ptyHost.send({ t: 'kill', id }).catch(() => {}); });

// ---------- Presse-papiers ----------
ipcMain.handle('clip:read', () => clipboard.readText());
ipcMain.on('clip:write', (_e, text) => clipboard.writeText(String(text)));

// ---------- Contexte de la fenêtre, état, réglages ----------
ipcMain.handle('win:context', (e) => {
  const { ws, winId } = ctxOf(e);
  return { winId: winId || 'main', ws: ws ? Workspace.load(ws) : null, recent: recent().map((p) => ({ root: p, ...pick(Workspace.load(p), ['name', 'seed']) })), home: os.homedir(), appName: APP_NAME };
});
const pick = (o, keys) => Object.fromEntries(keys.map((k) => [k, o[k]]));
const statePathFor = (e) => { const { ws, winId } = ctxOf(e); return statePath(ws, winId || 'main'); };
ipcMain.handle('state:load', (e) => readJson(statePathFor(e), null));
ipcMain.on('state:save', (e, state) => { if (!ctxOf(e).closed) writeJson(statePathFor(e), state); });
ipcMain.handle('settings:load', () => readJson(dataFile('settings.json'), null));
ipcMain.on('settings:save', (_e, s) => writeJson(dataFile('settings.json'), s));
ipcMain.handle('app:home', () => os.homedir());
ipcMain.on('app:titlebar', (e, color, symbolColor) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  try { win?.setTitleBarOverlay({ color, symbolColor }); win?.setBackgroundColor(color); } catch {}
});

// ---------- Workspaces ----------
ipcMain.handle('ws:pick', async (e) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  const r = await dialog.showOpenDialog(win, { title: I18n.t('Ouvrir un dossier comme workspace'), properties: ['openDirectory', 'createDirectory'] });
  return r.canceled ? null : r.filePaths[0];
});
ipcMain.on('ws:open', (_e, root) => { if (root) createWindow({ ws: root }); });
ipcMain.on('win:new', () => createWindow({ ws: null }));
// ---------- Fenêtres secondaires : sortir, déplacer, renvoyer des espaces ----------
const newWinId = () => 'w' + Math.random().toString(36).slice(2, 8);
function boundsAt(x, y) {
  if (x == null) return undefined;
  return { x: Math.round(x), y: Math.round(y), width: 1100, height: 720 };
}
function sendSpaces(target, state) {
  target.win.webContents.send('win:receive', state);
  target.win.show();
  target.win.focus();
}
ipcMain.on('win:detachSpace', (e, state, at) => {
  if (!state?.spaces?.length) return;
  createWindow({ ws: ctxOf(e).ws, winId: newWinId(), initialState: state, bounds: boundsAt(at?.x, at?.y) });
});
ipcMain.handle('win:list', (e) => {
  const me = ctxOf(e);
  return [...windows.values()].filter((w) => sameWs(w.ws, me.ws) && w.win.webContents.id !== e.sender.id)
    .map((w) => ({ wcId: w.win.webContents.id, winId: w.winId, title: w.winId === 'main' ? 'Fenêtre principale' : `Fenêtre ${w.winId.slice(1, 4).toUpperCase()}` }));
});
const spaceDrags = new Map();
ipcMain.on('win:beginSpaceDrag', (e, token, state) => {
  spaceDrags.set(e.sender.id, { token, state });
});
ipcMain.on('win:endSpaceDrag', (e) => spaceDrags.delete(e.sender.id));
ipcMain.handle('win:acceptSpaceDrag', (e, token) => {
  for (const [sourceId, drag] of spaceDrags) {
    if (drag.token !== token || sourceId === e.sender.id) continue;
    const source = windows.get(sourceId);
    if (!source || !sameWs(source.ws, ctxOf(e).ws)) return null;
    spaceDrags.delete(sourceId);
    source.win.webContents.send('win:spaceMoved', token);
    return drag.state;
  }
  return null;
});
ipcMain.on('win:sendSpaces', (e, wcId, state) => {
  const t = windows.get(wcId);
  if (t) sendSpaces(t, state);
});
// Espace lâché hors de la fenêtre : dans une autre fenêtre du workspace s'il y en a une sous le pointeur, sinon nouvelle fenêtre
ipcMain.handle('win:dropSpace', (e, state, sx, sy) => {
  const me = ctxOf(e);
  for (const w of windows.values()) {
    if (w.win.webContents.id === e.sender.id || !sameWs(w.ws, me.ws) || w.win.isMinimized()) continue;
    const b = w.win.getBounds();
    if (sx >= b.x && sx <= b.x + b.width && sy >= b.y && sy <= b.y + b.height) { sendSpaces(w, state); return 'moved'; }
  }
  createWindow({ ws: me.ws, winId: newWinId(), initialState: state, bounds: boundsAt(sx - 120, sy - 20) });
  return 'detached';
});
// Fermeture d'une fenêtre secondaire : ses espaces repartent (ou non) dans la fenêtre principale
ipcMain.on('win:closeNow', (e, returnState) => {
  const me = ctxOf(e);
  if (!me.win) return;
  if (returnState?.spaces?.length) {
    const main = findWindow(me.ws, 'main');
    if (main) sendSpaces(main, returnState);
    else {
      const st = readJson(statePath(me.ws, 'main'), null) || { version: 2, spaces: [] };
      st.pendingSpaces = [...(st.pendingSpaces || []), returnState];
      writeJson(statePath(me.ws, 'main'), st);
      createWindow({ ws: me.ws });
    }
  }
  me.closed = true;
  try { fs.unlinkSync(statePath(me.ws, me.winId)); } catch {}
  me.closeOk = true;
  windows.delete(e.sender.id);
  rememberWindows();
  me.win.close();
});
ipcMain.handle('ws:update', (e, patch) => {
  const { ws, win } = ctxOf(e);
  if (!ws) return null;
  const cfg = Workspace.update(ws, patch);
  win?.setTitle(`${cfg.name} — ${APP_NAME}`);
  return cfg;
});
ipcMain.on('ws:close', (e) => {
  const entry = ctxOf(e);
  if (!entry.win) return;
  if (!findWindow(null)) createWindow({ ws: null });
  else findWindow(null).win.focus();
  entry.win.close();
});
ipcMain.on('ws:reveal', (e) => { const { ws } = ctxOf(e); if (ws) shell.openPath(Workspace.robotDir(ws)); });

// ---------- Services du workspace ----------
const services = new Services({ ptyHost, shells: SHELLS });
ipcMain.handle('svc:open', (e, root) => services.open(root, e.sender));
ipcMain.handle('svc:start', (e, root, id) => services.start(root, id).then((sid) => { if (sid) own(sid, e.sender); return sid; }));
ipcMain.handle('svc:stop', (_e, root, id) => services.stop(root, id));
ipcMain.handle('svc:restart', (e, root, id) => services.restart(root, id).then((sid) => { if (sid) own(sid, e.sender); return sid; }));
ipcMain.handle('svc:save', (_e, root, defs) => services.saveDefs(root, defs));
ipcMain.handle('svc:reload', (_e, root) => services.reload(root));
ipcMain.handle('svc:suggest', (_e, root) => services.suggestions(root));

// ---------- Tests ----------
ipcMain.handle('tests:discover', (_e, root) => Tests.discover(root));
ipcMain.handle('tests:run', (e, root, scope, runId) => Tests.run(root, scope, (chunk) => { if (!e.sender.isDestroyed()) e.sender.send('tests:out', runId, chunk); }, runId));
ipcMain.on('tests:stop', (_e, runId) => Tests.stop(runId));
ipcMain.handle('tests:generate', (_e, root) => Tests.writeGenerated(root));
ipcMain.handle('tests:updateSuite', (_e, root, id, patch) => Tests.updateSuite(root, id, patch));
ipcMain.handle('tests:categories', () => Tests.CATEGORIES);

// ---------- Docker ----------
ipcMain.handle('docker:status', (_e, root, opts) => Docker.status(root, opts));
ipcMain.handle('docker:action', (_e, root, opts) => Docker.action(root, opts));
ipcMain.handle('docker:execCommand', (_e, root, opts) => Docker.execCommand(root, opts));
ipcMain.on('docker:logs', (e, id, root, opts) => Docker.startLogs(id, root, opts,
  (d) => { if (!e.sender.isDestroyed()) e.sender.send('docker:logs', id, d); },
  () => { if (!e.sender.isDestroyed()) e.sender.send('docker:logsEnd', id); }));
ipcMain.on('docker:stopLogs', (_e, id) => Docker.stopLogs(id));

// ---------- Graphify ----------
ipcMain.handle('graphify:version', (_e, force) => Graphify.version(force));
ipcMain.handle('graphify:status', (_e, root) => Graphify.status(root));
ipcMain.handle('graphify:serve', (_e, root) => Graphify.serve(root));
ipcMain.on('graphify:run', (e, id, root, mode) => Graphify.run(id, root, mode,
  (d) => { if (!e.sender.isDestroyed()) e.sender.send('graphify:out', id, d); },
  (r) => { if (!e.sender.isDestroyed()) e.sender.send('graphify:end', id, r); }));
ipcMain.on('graphify:stop', (_e, id) => Graphify.stop(id));

// ---------- Prisma / base de données ----------
ipcMain.handle('prisma:info', (_e, root, id) => Prisma.info(root, id));
ipcMain.handle('prisma:ping', (_e, root, id) => Prisma.ping(root, id));
ipcMain.handle('prisma:tables', (_e, root, id) => Prisma.tables(root, id));
ipcMain.handle('prisma:rows', (_e, root, id, opts) => Prisma.rows(root, id, opts));
ipcMain.handle('prisma:query', (_e, root, id, sql, opts) => Prisma.query(root, id, sql, opts));
ipcMain.handle('prisma:migrations', (_e, root, id) => Prisma.migrations(root, id));
ipcMain.handle('prisma:migrationSql', (_e, file) => Prisma.migrationSql(file));
ipcMain.handle('prisma:close', (_e, root, id) => Prisma.close(root, id));
ipcMain.handle('prisma:diagramLoad', (_e, root, id) => Prisma.diagramLoad(root, id));
ipcMain.handle('prisma:diagramSave', (_e, root, id, data) => Prisma.diagramSave(root, id, data));
ipcMain.handle('prisma:diagramSaveImage', (_e, root, dataUrl) => Prisma.diagramSaveImage(root, dataUrl));

fsGit.register();

// ---------- Démarrage ----------
const single = app.requestSingleInstanceLock();
if (!single) app.quit();
app.on('second-instance', () => {
  const w = splash || [...windows.values()][0]?.win;
  if (w) { if (w.isMinimized()) w.restore(); w.focus(); }
});

// ---------- Écran de démarrage : workspaces connus, nouveau workspace, infos ----------
let splash = null;
const savedSession = () => readJson(windowsFile(), []).filter((w) => !w.ws || exists(w.ws));
function restoreSession() {
  const saved = savedSession();
  if (!saved.length) return createWindow({ ws: null });
  return saved.map((w) => createWindow(w))[0];
}
function wsInfo(root) {
  const cfg = Workspace.load(root);
  let used = 0;
  for (const f of ['state.json', 'workspace.json']) { try { used = Math.max(used, fs.statSync(Workspace.file(root, f)).mtimeMs); } catch {} }
  return { root, name: cfg.name, seed: cfg.seed, robot: cfg.robot, used };
}
function createSplash() {
  splash = new BrowserWindow({
    width: 980, height: 620, minWidth: 760, minHeight: 500, center: true, frame: false, resizable: true,
    backgroundColor: '#0e1117', icon: ICON_ICO, title: APP_NAME, show: false,
    webPreferences: { preload: path.join(__dirname, 'splash-preload.js'), contextIsolation: true, nodeIntegration: false },
  });
  splash.removeMenu();
  splash.once('ready-to-show', () => splash.show());
  splash.on('closed', () => { splash = null; });
  splash.loadFile(path.join(__dirname, 'renderer', 'splash.html'));
}
// Ouvre la fenêtre choisie, puis ferme l'écran de démarrage (dans cet ordre pour ne pas quitter l'application)
// La fenêtre apparaît dès son premier rendu (avec son écran de chargement) : on ferme l'écran de démarrage à ce moment-là.
function leaveSplash(open) {
  const close = () => { if (splash && !splash.isDestroyed()) splash.close(); };
  const win = open();
  if (!win || win.isDestroyed() || win.isVisible()) return close();
  win.once('show', close);
  win.once('closed', close);
  setTimeout(close, 10000);
}
ipcMain.handle('splash:info', () => {
  const session = savedSession();
  const settings = readJson(dataFile('settings.json'), {}) || {};
  const pkg = readJson(path.join(__dirname, 'package.json'), {});
  return {
    appName: APP_NAME, version: app.getVersion(), description: pkg.description || '',
    versions: { electron: process.versions.electron, chrome: process.versions.chrome, node: process.versions.node },
    platform: `${os.type()} ${os.release()} · ${process.arch}`,
    dataDir: userData, theme: settings.theme || 'minuit', showSplash: settings.showSplash !== false, language: settings.language || 'auto',
    recent: recent().map(wsInfo),
    session: session.map((w) => ({ name: w.ws ? Workspace.load(w.ws).name : 'Sans workspace', secondary: w.winId && w.winId !== 'main' })),
  };
});
ipcMain.on('splash:open', (_e, root) => { if (root && exists(root)) leaveSplash(() => createWindow({ ws: root })); });
ipcMain.on('splash:blank', () => leaveSplash(() => createWindow({ ws: null })));
ipcMain.on('splash:restore', () => leaveSplash(restoreSession));
ipcMain.handle('splash:pick', async (_e, mode) => {
  const r = await dialog.showOpenDialog(splash, {
    title: I18n.t(mode === 'new' ? 'Choisir ou créer le dossier du nouveau workspace' : 'Ouvrir un dossier comme workspace'),
    buttonLabel: I18n.t(mode === 'new' ? 'Créer le workspace ici' : 'Ouvrir'),
    properties: ['openDirectory', 'createDirectory'],
  });
  if (r.canceled || !r.filePaths[0]) return null;
  const root = r.filePaths[0];
  return { root, isWorkspace: Workspace.isWorkspace(root), name: path.basename(root) };
});
ipcMain.handle('splash:create', (_e, root, name) => {
  if (!root || !exists(root)) return false;
  const already = Workspace.isWorkspace(root);
  Workspace.ensure(root);
  if (!already && name && name.trim()) Workspace.update(root, { name: name.trim() });
  leaveSplash(() => createWindow({ ws: root }));
  return true;
});
ipcMain.on('splash:forget', (_e, root) => writeJson(dataFile('recent.json'), recent().filter((p) => p.toLowerCase() !== String(root).toLowerCase())));
ipcMain.on('splash:reveal', (_e, root) => { if (root && exists(root)) shell.openPath(root); });
ipcMain.on('splash:setShow', (_e, show) => {
  const s = readJson(dataFile('settings.json'), {}) || {};
  writeJson(dataFile('settings.json'), { ...s, showSplash: !!show });
});
ipcMain.on('splash:quit', () => { if (splash && !splash.isDestroyed()) splash.close(); });
ipcMain.on('splash:minimize', () => splash?.minimize());

app.whenReady().then(() => {
  const settings = readJson(dataFile('settings.json'), {}) || {};
  if (settings.showSplash === false || process.env.ROBOTCONSOLE_NO_SPLASH) restoreSession();
  else createSplash();
});
app.on('before-quit', () => { quitting = true; if (windows.size) rememberWindows(); Prisma.closeAll(); Graphify.stopAll(); });
app.on('window-all-closed', () => app.quit());
