// Synthetic long-session benchmark; no live shell or conversation is accessed.
if (!process.versions.electron) require('./electron-test')(__filename, process.argv.slice(2));
const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { performance } = require('node:perf_hooks');
const { pathToFileURL } = require('node:url');
const { execFileSync } = require('node:child_process');

const temp = process.env.ROBOTCONSOLE_TEST_TEMP;
if (!temp) throw new Error('Run with node scripts\\test-terminal-latency.js');
app.setPath('userData', path.join(temp, 'profile'));
const sessionData = path.join(temp, 'session');
fs.mkdirSync(sessionData, { recursive: true });
app.setPath('sessionData', sessionData);
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
if (!process.argv.includes('--gpu')) app.disableHardwareAcceleration();

function measureHistory(source) {
  const chunked = source.includes('function segment(');
  const from = source.indexOf(chunked ? 'function segment(' : 'function record('), to = source.indexOf('function resize(', from);
  assert.ok(from >= 0 && to > from);
  const context = vm.createContext({ MAX_BUFFER: 400 * 1024 });
  vm.runInContext(source.slice(from, to) + '; this.recordOutput = record;' +
    (chunked ? 'this.makeSegment = segment;' : ''), context);
  const samples = [];
  for (const size of [0, 400 * 1024]) {
    const session = { segs: [chunked ? context.makeSegment(100, 30) : { cols: 100, rows: 30, data: '' }], size: 0 };
    context.recordOutput(session, 'x'.repeat(size));
    const chunk = '\x1b[2K\r' + 'Reply '.repeat(40);
    const start = performance.now();
    for (let i = 0; i < 2000; i++) context.recordOutput(session, chunk);
    samples.push({ initialCharacters: size, chunks: 2000, elapsedMs: +(performance.now() - start).toFixed(2) });
    assert.ok(session.size <= 400 * 1024);
  }
  return samples;
}

app.whenReady().then(async () => {
  let win, status = 0;
  try {
    const root = path.join(__dirname, '..');
    const url = (file) => pathToFileURL(path.join(root, ...file)).href;
    const fixture = path.join(temp, 'terminal-latency.html');
    fs.writeFileSync(fixture, `<!doctype html><meta charset="utf-8">
      <link rel="stylesheet" href="${url(['node_modules', '@xterm', 'xterm', 'css', 'xterm.css'])}">
      <style>body { margin: 0; background: #111; } #terminal { width: 950px; height: 550px; }</style>
      <div id="terminal"></div>
      ${[
        ['xterm', 'xterm.js'], ['addon-fit', 'addon-fit.js'], ['addon-search', 'addon-search.js'],
        ['addon-serialize', 'addon-serialize.js'], ['addon-web-links', 'addon-web-links.js'],
        ['addon-webgl', 'addon-webgl.js'],
      ].map(([pkg, file]) => `<script src="${url(['node_modules', '@xterm', pkg, 'lib', file])}"></script>`).join('')}`);
    win = new BrowserWindow({
      show: true, width: 1000, height: 600,
      webPreferences: { backgroundThrottling: false },
    });
    win.webContents.on('console-message', (event) => {
      const message = event.message;
      if (message.startsWith('benchmark:')) console.log(message);
    });
    await win.loadFile(fixture);
    const source = fs.readFileSync(path.join(root, 'renderer', 'terminal-tab.js'), 'utf8');
    await win.webContents.executeJavaScript(`
      window.handlers = {};
      window.api = {
        onData(fn) { handlers.data = fn; }, onExit() {}, onPtyDisconnect() {},
        async createPty() { return { shellId: 'benchmark' }; },
        ackData() {}, resize() {}, kill() {},
        write(id, data) { window.inputReceived?.(data); },
      };
      window.Settings = { data: {
        fontFamily: 'monospace', fontSize: 14, lineHeight: 1,
        cursorBlink: true, cursorStyle: 'block', scrollback: 8000,
        gpuRendering: ${process.argv.includes('--gpu')},
      } };
      window.Themes = { terminal: () => ({ background: '#111111' }) };
      window.I18n = { t: (s) => s };
      window.CAI = { save() {}, talk() {}, markUnread() {}, setAutoTitle() {} };
      window.Platform = { primary: (e) => e.ctrlKey };
      ${source}
      window.tab = {
        pane: document.getElementById('terminal'), el: document.createElement('div'),
        space: { bot: {}, robotEl: document.createElement('div'), tabs: [] },
      };
      tab.space.tabs.push(tab);
      TabKinds.terminal.mount(tab, { shellId: 'benchmark' });
      tab.term.focus();
    `);
    const results = await win.webContents.executeJavaScript(`(async () => {
      const write = (data) => new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Terminal parsing exceeded 5 seconds')), 5000);
        handlers.data(tab.ptyId, data, ++tab.outputSeq, tab.outputSeq);
        tab.term.write('', () => { clearTimeout(timeout); resolve(); });
      });
      const frames = () => new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Terminal frames exceeded 5 seconds')), 5000);
        requestAnimationFrame(() => requestAnimationFrame(() => { clearTimeout(timeout); resolve(); }));
      });
      const percentile = (values, p) => +values.slice().sort((a, b) => a - b)[Math.ceil(values.length * p) - 1].toFixed(2);
      const results = [];
      await write('x'.repeat(16 * 1024 - 1) + '\\x1b[31mRED\\x1b[0m');
      const redLine = tab.term.buffer.active.getLine(tab.term.buffer.active.baseY + tab.term.buffer.active.cursorY);
      const redCell = redLine.getCell(tab.term.buffer.active.cursorX - 3);
      if (redCell.getChars() !== 'R' || redCell.getFgColor() !== 1) throw new Error('ANSI sequence split across chunks was corrupted');
      tab.term.reset();
      await write('x'.repeat(16 * 1024 - 1) + '\\u{1F642}');
      const unicodeLine = tab.term.buffer.active.getLine(tab.term.buffer.active.baseY + tab.term.buffer.active.cursorY);
      if (!unicodeLine.translateToString(true).endsWith('\\u{1F642}')) {
        throw new Error('Unicode character split across chunks was corrupted');
      }
      for (const historyLines of [100, 8000, ${process.argv.includes('--large') ? 50000 : 20000}]) {
        Settings.data.scrollback = historyLines;
        TabKinds.terminal.applySettings(tab, ['scrollback']);
        tab.term.reset();
        const line = 'Assistant: synthetic conversation with code and explanations '.repeat(2) + '\\r\\n';
        const fillStarted = performance.now();
        for (let n = 0; n < historyLines; n += 1000) await write(line.repeat(Math.min(1000, historyLines - n)));
        await frames();
        const fillMs = performance.now() - fillStarted;
        console.log('benchmark: filled ' + historyLines + ' lines in ' + fillMs.toFixed(2) + ' ms');
        for (const mode of ['line-edit', 'screen-redraw', 'transcript-redraw']) {
          const parse = [], paint = [], key = [];
          for (let n = 0; n < (mode === 'transcript-redraw' ? 5 : 20); n++) {
            tab.term.focus();
            const data = mode === 'line-edit' ? '\\r\\x1b[2K> ' + 'x'.repeat(n + 1) :
              mode === 'transcript-redraw' ? '\\x1b[H' + line.repeat(historyLines) :
                '\\x1b[H' + Array.from({ length: tab.term.rows }, (_, row) => '\\x1b[2KAssistant row ' + row + ' ' + n).join('\\r\\n');
            const started = performance.now();
            const parsing = write(data);
            const keyboard = new Promise((resolve, reject) => {
              setTimeout(() => {
                let received = false;
                window.inputReceived = () => { received = true; key.push(performance.now() - started); resolve(); };
                tab.term.textarea.dispatchEvent(new KeyboardEvent('keydown', {
                  key: 'x', code: 'KeyX', keyCode: 88, which: 88, bubbles: true,
                }));
                if (!received) reject(new Error('Keyboard event did not reach the terminal input handler'));
              }, 0);
            });
            await parsing;
            parse.push(performance.now() - started);
            await keyboard;
            await frames();
            paint.push(performance.now() - started);
          }
          results.push({
            historyLines, retainedLines: tab.term.buffer.active.length,
            renderer: tab.gpu ? 'webgl' : 'dom', mode, samples: key.length, fillMs: +fillMs.toFixed(2),
            keyP95Ms: percentile(key, .95), parseP95Ms: percentile(parse, .95),
            settledP95Ms: percentile(paint, .95), settledMaxMs: +Math.max(...paint).toFixed(2),
          });
        }
      }
      TabKinds.terminal.dispose(tab);
      return results;
    })()`);
    console.log(JSON.stringify({
      scope: 'Synthetic PTY history and real local xterm renderer; no CLI, live PTY, robot animation or remote sharing',
      metrics: 'key: scheduled keyboard event to input handler during output; parse: complete output parsing; settled: parsing plus two animation frames',
      hostHistory: measureHistory(fs.readFileSync(path.join(root, 'main', 'ptyhost.js'), 'utf8')),
      ...(process.argv.includes('--compare-history') ? {
        hostHistoryHEAD: measureHistory(execFileSync('git', ['--no-pager', 'show', 'HEAD:main/ptyhost.js'], { cwd: root, encoding: 'utf8' })),
      } : {}),
      terminal: results,
    }, null, 2));
  } catch (error) { console.error(error); status = 1; }
  finally {
    if (win && !win.isDestroyed()) win.destroy();
    app.exit(status);
  }
});
