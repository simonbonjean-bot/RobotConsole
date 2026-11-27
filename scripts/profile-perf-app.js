const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const http = require('node:http');
const { performance } = require('node:perf_hooks');
if (!process.versions.electron) throw new Error('Run node scripts\\profile-perf.js instead');
const { app, BrowserWindow, ipcMain } = require('electron');
const { WebSocketServer } = require('ws');
const source = process.env.RC_PERF_SOURCE, profile = process.env.RC_PERF_PROFILE, fixture = process.env.RC_PERF_FIXTURE;
if (!source || !profile || !fixture) throw new Error('Missing isolated profiling environment');
const load = (file) => require(path.join(source, 'main', file));
const tree = path.join(fixture, 'tree');
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const round = (value) => +value.toFixed(2);
const result = {};
let stage = 'startup', ptyClient, remote, mobile;
const sent = [];
const gitCounts = { total: 0, status: 0, running: 0, peak: 0 };
const childProcess = require('node:child_process'), execFile = childProcess.execFile;
childProcess.execFile = function (file, args, ...rest) {
  const child = execFile.call(this, file, args, ...rest);
  if (file === 'git') {
    gitCounts.total++;
    if (args[0] === 'status') gitCounts.status++;
    gitCounts.peak = Math.max(gitCounts.peak, ++gitCounts.running);
    child.once('close', () => { gitCounts.running--; });
  }
  return child;
};

process.env.ROBOTCONSOLE_USERDATA = profile;
process.env.ROBOTCONSOLE_NO_SPLASH = '1';
require('node:os').homedir = () => path.join(fixture, 'home');
app.setPath('sessionData', path.join(profile, 'chromium'));
fs.mkdirSync(path.join(profile, 'chromium'));
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
const state = { version: 2, active: 0, spaces: Array.from({ length: 4 }, (_, n) => ({
  name: `Space ${n}`, seed: `perf-${n}`, rid: `perf000${n}`, activeTab: 1, remote: 'control', voice: false, sound: false,
  tabs: [
    { kind: 'explorer', root: tree, view: 'tree' },
    { kind: 'terminal', cwd: tree },
    { kind: 'terminal', cwd: tree },
    { kind: 'explorer', root: tree, view: 'tree' },
    { kind: 'terminal', cwd: tree },
  ],
})) };
fs.writeFileSync(path.join(profile, 'state.json'), JSON.stringify(state));
fs.copyFileSync(path.join(fixture, 'speech-history.jsonl'), path.join(profile, 'speech-history.jsonl'));
fs.writeFileSync(path.join(profile, 'settings.json'), JSON.stringify({
  showSplash: false, language: 'fr', robotVoice: false, robotSounds: false, gpuRendering: false,
  scrollback: 10000, cursorBlink: false,
  remote: { enabled: true, token: 'temporary-performance-fixture', port: 7777 },
}));
const PtyClient = load('ptyclient');
PtyClient.prototype.send = async function (message) { ptyClient = this; sent.push(message); };
PtyClient.prototype.sessions = async () => [];
PtyClient.prototype.attach = async () => ({ found: true, data: '', cols: 80, rows: 24, alive: true });
load('subscriptions').Subscriptions.prototype.read = async () => [];

// Use the actual remote protocol and UI, but never listen on the LAN.
load('remote').prototype.start = async function ({ token }) {
  await this.stop();
  remote = this;
  this.token = token;
  this.server = http.createServer((req, res) => {
    const end = res.end;
    res.end = function (data, ...args) {
      if (res.statusCode === 200 && data && String(data).includes('<script src="/remote.js">')) {
        data = String(data).replace('<script src="/remote.js">', `<script>
          const OriginalTerminal = window.Terminal;
          window.Terminal = class extends OriginalTerminal {
            constructor(options) { super(options); window.__perfTerminal = this; }
          };
          window.__perfDelays = [];
          let previous = performance.now();
          setInterval(() => {
            const now = performance.now();
            window.__perfDelays.push(Math.max(0, now - previous - 10));
            previous = now;
          }, 10);
        </script><script src="/remote.js">`);
      }
      return end.call(this, data, ...args);
    };
    this._http(req, res);
  });
  this.wss = new WebSocketServer({ noServer: true });
  this.server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname !== '/ws' || !this._authorized(req, url)) { socket.destroy(); return; }
    this.wss.handleUpgrade(req, socket, head, (ws) => this._connection(ws));
  });
  await new Promise((resolve, reject) => {
    this.server.once('error', reject);
    this.server.listen(0, '127.0.0.1', resolve);
  });
  this.port = this.server.address().port;
};

const started = performance.now();
const watchdog = setTimeout(() => { console.error('Profiling timed out:', stage); app.exit(1); }, 170000);
watchdog.unref();
app.on('web-contents-created', (_event, contents) => {
  contents.setBackgroundThrottling(false);
  contents.on('console-message', (event) => {
    if (event.level === 'error') console.error('[renderer]', event.message);
  });
});
require(path.join(source, 'main.js'));

async function wait(check, label, timeout = 60000) {
  const deadline = performance.now() + timeout;
  while (performance.now() < deadline) {
    if (await check()) return;
    await delay(25);
  }
  throw new Error(`Timed out: ${label}`);
}

function memory() {
  const metrics = app.getAppMetrics();
  return {
    mainHeapMiB: process.memoryUsage().heapUsed / 1024 ** 2,
    appWorkingSetMiB: metrics.reduce((sum, entry) => sum + entry.memory.workingSetSize / 1024, 0),
  };
}

async function measure(operation) {
  const before = memory(), peak = { ...before };
  const sample = () => {
    const current = memory();
    for (const key of Object.keys(peak)) peak[key] = Math.max(peak[key], current[key]);
  };
  const timer = setInterval(sample, 50), start = performance.now();
  try {
    const value = await operation();
    sample();
    return { elapsedMs: round(performance.now() - start), before: Object.fromEntries(Object.entries(before).map(([k, v]) => [k, round(v)])),
      peak: Object.fromEntries(Object.entries(peak).map(([k, v]) => [k, round(v)])), value };
  } finally { clearInterval(timer); }
}

async function idleCpu(ms = 5000) {
  const initial = new Map(app.getAppMetrics().map((entry) => [entry.pid, entry.cpu.cumulativeCPUUsage]));
  for (const value of initial.values()) assert.equal(typeof value, 'number', 'Cumulative CPU time must be supported');
  const start = performance.now();
  await delay(ms);
  const cpuSeconds = app.getAppMetrics().reduce((sum, entry) => {
    assert.ok(initial.has(entry.pid), 'CPU measurement requires a stable process set');
    return sum + entry.cpu.cumulativeCPUUsage - initial.get(entry.pid);
  }, 0);
  return { oneCorePercent: round(cpuSeconds / ((performance.now() - start) / 1000) * 100), durationMs: round(performance.now() - start) };
}

app.whenReady().then(async () => {
  let status = 0;
  try {
    const win = BrowserWindow.getAllWindows()[0];
    assert.ok(win);
    const js = (code) => win.webContents.executeJavaScript(code);
    await wait(() => js(`!!window.CAI?.activeSpace?.activeTab?.ptyId &&
      (!document.getElementById('boot') || document.getElementById('boot').classList.contains('done'))`), 'first usable terminal');
    const firstUsableMs = performance.now() - started;
    const writes = sent.filter((m) => m.t === 'write').length;
    await js(`(() => {
      const tab = CAI.activeSpace.activeTab;
      tab.term.focus();
      tab.term.textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'x', code: 'KeyX', keyCode: 88, which: 88, bubbles: true }));
    })()`);
    await wait(() => sent.filter((m) => m.t === 'write').length > writes, 'first terminal input');
    const firstInputMs = performance.now() - started;
    await wait(() => js(`CAI.spaces.flatMap((s) => s.tabs).every((t) => t.term || t.ex)`), 'all tools mounted');
    assert.equal(await js('CAI.spaces.flatMap((s) => s.tabs).length'), 20);
    result.restore = { firstUsableMs: round(firstUsableMs), firstInputMs: round(firstInputMs), allMountedMs: round(performance.now() - started), tabs: 20 };
    // Do not count the old renderer's still-running hidden directory loads as idle CPU.
    await wait(async () => gitCounts.running === 0 && await js(`CAI.spaces.flatMap((s) => s.tabs).filter((t) => t.ex).every((t) =>
      'refreshNeeded' in t.ex ? !t.ex.refreshing : t.ex.tree.querySelectorAll('.ex-row').length === 3000)`), 'startup work settled');
    result.restore.startupSettledMs = round(performance.now() - started);
    await delay(1500);
    await js('CAI.spaces.forEach((s) => s.clearSpeech?.()); void 0;');
    assert.equal(await js('CAI.spaces.flatMap((s) => s.tabs).filter((t) => t.ex && t.pane.offsetParent).length'), 0);

    stage = 'idle with hidden explorers';
    result.idleHidden = await idleCpu();
    stage = 'folder opening';
    const folderStart = performance.now();
    await js('CAI.spaces.forEach((s) => CAI.activateTab(s.tabs[0], false)); void 0;');
    await wait(() => js(`CAI.spaces.every((s) => s.tabs[0].ex.tree.querySelectorAll('.ex-row').length >= 3000)`), 'folder rows');
    result.folder = { openMs: round(performance.now() - folderStart), rowsPerExplorer: await js("CAI.spaces[0].tabs[0].ex.tree.querySelectorAll('.ex-row').length") };
    result.folder.listMs = [];
    for (let n = 0; n < 3; n++) {
      const start = performance.now();
      const count = await js(`api.listDir(${JSON.stringify(tree)}).then((entries) => entries.length)`);
      assert.equal(count, 3000);
      result.folder.listMs.push(round(performance.now() - start));
    }
    await delay(1500);
    await js('CAI.spaces.forEach((s) => s.clearSpeech?.()); void 0;');
    assert.equal(await js('CAI.spaces.flatMap((s) => s.tabs).filter((t) => t.ex && t.pane.offsetParent).length'), 4);
    stage = 'idle with visible explorers';
    result.idleVisible = await idleCpu();

    stage = 'filesystem burst';
    const initialGit = { ...gitCounts };
    gitCounts.peak = gitCounts.running;
    const burstStart = performance.now();
    const changed = path.join(tree, 'file-0000.txt');
    for (let n = 0; n < 40; n++) {
      fs.appendFileSync(changed, `burst ${n}\n`);
      await delay(10);
    }
    await wait(() => js(`CAI.spaces.every((s) => Object.keys(s.tabs[0].ex.git?.files || {}).some((p) => p.endsWith('file-0000.txt')))`), 'visible Git updates');
    await wait(() => gitCounts.running === 0, 'Git commands drained');
    await delay(600);
    result.burst = {
      elapsedMs: round(performance.now() - burstStart), changes: 40, gitCommands: gitCounts.total - initialGit.total,
      gitStatusCommands: gitCounts.status - initialGit.status, peakConcurrentGit: gitCounts.peak,
      hiddenExplorersUpdated: await js(`CAI.spaces.filter((s) => Object.keys(s.tabs[3].ex.git?.files || {}).some((p) => p.endsWith('file-0000.txt'))).length`),
    };
    fs.writeFileSync(changed, 'fixture 0\n' + 'x'.repeat(128));
    await delay(1000);

    stage = 'terminal burst';
    await js(`CAI.spaces.forEach((s) => CAI.activateTab(s.tabs[1], false));
      window.__perfTab = CAI.spaces[0].tabs[1];
      __perfTab.term.reset(); __perfTab.term.resize(100, 30);
      window.__perfDelays = []; window.__perfPrevious = performance.now();
      window.__perfTimer = setInterval(() => {
        const now = performance.now(); __perfDelays.push(Math.max(0, now - __perfPrevious - 10)); __perfPrevious = now;
      }, 10);
      void 0;`);
    await delay(100);
    const pid = await js('__perfTab.ptyId');
    const output = Array.from({ length: 8000 }, (_, n) => `PERF-LINE-${String(n).padStart(5, '0')}\r\n`).join('');
    result.terminal = await measure(async () => {
      ptyClient.onData(pid, output);
      ptyClient.onFlush?.(pid);
      await wait(() => js(`Array.from({ length: __perfTab.term.buffer.active.length }, (_, i) =>
        __perfTab.term.buffer.active.getLine(i).translateToString(true)).includes('PERF-LINE-07999')`), 'terminal output');
      return js(`(() => {
        clearInterval(__perfTimer);
        const lines = Array.from({ length: __perfTab.term.buffer.active.length }, (_, i) => __perfTab.term.buffer.active.getLine(i).translateToString(true))
          .filter((s) => s.startsWith('PERF-LINE-'));
        if (lines.length !== 8000 || lines.some((s, i) => s !== 'PERF-LINE-' + String(i).padStart(5, '0'))) throw new Error('Lost, duplicated or reordered terminal lines');
        const delays = __perfDelays.slice().sort((a, b) => a - b);
        if (!delays.length) throw new Error('Missing responsiveness samples');
        return { exactLines: lines.length, heartbeatMaxMs: Math.max(...delays), heartbeatP95Ms: delays[Math.ceil(delays.length * .95) - 1], heartbeatSamples: delays.length };
      })()`);
    });

    stage = 'speech history';
    const historyCounts = [];
    result.speech = await measure(async () => {
      for (let n = 0; n < 5; n++) {
        const entries = await js(`(async () => {
          const page = await api.speechHistory('perf0000');
          return Array.isArray(page) ? page : page.entries;
        })()`);
        assert.ok(entries.length > 0);
        if (load('speech').Speech.prototype.historyPage) assert.ok(entries.length <= 200);
        const fixtureEntries = entries.filter((entry) => entry.source === 'fixture');
        assert.ok(fixtureEntries.length > 0, 'The recent fixture history must be present alongside automatic robot messages');
        assert.equal(fixtureEntries.at(-1).id, 'message-99996');
        historyCounts.push(entries.length);
      }
      return { reads: 5, entriesPerRead: historyCounts };
    });

    stage = 'local mobile sharing';
    await wait(() => remote?.running && remote._list().length === 4, 'published robots');
    const tabId = await js('__perfTab.id');
    mobile = new BrowserWindow({ show: true, width: 400, height: 700, webPreferences: { partition: 'perf-mobile', backgroundThrottling: false } });
    const mjs = (code) => mobile.webContents.executeJavaScript(code);
    result.mobile = await measure(async () => {
      await mobile.loadURL(`http://127.0.0.1:${remote.port}/?k=${remote.token}#/r/perf0000/${tabId}`);
      await wait(() => mjs(`!!window.__perfTerminal && !!document.querySelector('.speech-entry')`), 'mobile terminal and history');
      await wait(() => mjs(`Array.from({ length: __perfTerminal.buffer.active.length }, (_, i) =>
        __perfTerminal.buffer.active.getLine(i).translateToString(true)).some((s) => s.includes('PERF-LINE-07999'))`), 'mobile snapshot');
      const incrementalStart = performance.now();
      ptyClient.onData(pid, 'MOBILE-INCREMENTAL\r\n');
      ptyClient.onFlush?.(pid);
      await wait(() => mjs(`Array.from({ length: __perfTerminal.buffer.active.length }, (_, i) =>
        __perfTerminal.buffer.active.getLine(i).translateToString(true)).includes('MOBILE-INCREMENTAL')`), 'mobile incremental output');
      const incrementalMs = performance.now() - incrementalStart;
      const counts = await mjs(`(() => {
        const lines = Array.from({ length: __perfTerminal.buffer.active.length }, (_, i) => __perfTerminal.buffer.active.getLine(i).translateToString(true));
        const retained = lines.filter((line) => line.startsWith('PERF-LINE-'));
        if (retained.some((line, i) => line !== 'PERF-LINE-' + String(8000 - retained.length + i).padStart(5, '0'))) throw new Error('Lost or duplicated mobile snapshot lines');
        const incremental = lines.filter((line) => line === 'MOBILE-INCREMENTAL').length;
        if (incremental !== 1) throw new Error('Duplicated incremental output');
        return { retainedLines: retained.length, incremental };
      })()`);
      const responsive = await mjs(`(() => {
        const delays = __perfDelays.slice().sort((a, b) => a - b);
        if (!delays.length) throw new Error('Missing mobile responsiveness samples');
        return { historyEntries: document.querySelectorAll('.speech-entry').length, heartbeatMaxMs: Math.max(...delays),
          heartbeatP95Ms: delays[Math.ceil(delays.length * .95) - 1], heartbeatSamples: delays.length };
      })()`);
      return { ...responsive, ...counts, incrementalMs: round(incrementalMs) };
    });
    const snapshots = { count: 0 };
    const snapshot = remote.snapshot;
    remote.snapshot = function (...args) { snapshots.count++; return snapshot.apply(this, args); };
    await delay(4500);
    result.mobile.periodicSnapshotsIn4500Ms = snapshots.count;
    result.memory = Object.fromEntries(Object.entries(memory()).map(([k, v]) => [k, round(v)]));
    fs.writeFileSync(path.join(profile, 'result.json'), JSON.stringify(result, null, 2));
  } catch (error) {
    console.error('Profiling failed:', stage, error);
    console.error('Partial results:', JSON.stringify(result));
    console.error('PTY messages:', sent.length);
    for (const win of BrowserWindow.getAllWindows()) {
      console.error('Window:', win.webContents.getURL());
      console.error(await win.webContents.executeJavaScript(`JSON.stringify({
        boot: document.getElementById('boot')?.className,
        step: document.getElementById('boot-step')?.textContent,
        mobileTerminal: !!window.__perfTerminal,
        speechEntries: document.querySelectorAll('.speech-entry').length,
        body: document.body.textContent.slice(0, 300),
        spaces: window.CAI?.spaces.map((s) => ({ active: s.activeTab?.kind, tabs: s.tabs.map((t) => ({ kind: t.kind, ptyId: t.ptyId, mounted: !!(t.term || t.ex) })) })),
      })`).catch((diagnosticError) => String(diagnosticError)));
    }
    status = 1;
  }
  finally {
    clearTimeout(watchdog);
    if (mobile && !mobile.isDestroyed()) mobile.destroy();
    for (const win of BrowserWindow.getAllWindows()) win.destroy();
    if (remote) {
      for (const ws of remote.clients) ws.terminate();
      await remote.stop();
    }
    load('fs-git').closeAll?.();
    app.exit(status);
  }
});
