// Run with: node_modules\.bin\electron scripts\test-remote-terminal.js
const { app, BrowserWindow } = require('electron');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Remote = require('../main/remote');

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'robotconsole-remote-tests-'));
app.setPath('userData', path.join(temp, 'profile'));
app.disableHardwareAcceleration();

const harness = `<script>
  window.__sent = [];
  window.__pendingWrites = 0;
  window.__operations = [];
  window.__viewport = new EventTarget();
  window.__viewport.height = innerHeight;
  Object.defineProperty(window, 'visualViewport', { value: window.__viewport });
  window.RCTransport = () => {
    const socket = { readyState: 1, send: (raw) => {
      const m = JSON.parse(raw);
      window.__sent.push(m);
    } };
    window.__receive = (m) => socket.onmessage({ data: JSON.stringify(m) });
    setTimeout(() => socket.onopen(), 0);
    return socket;
  };
  const OriginalTerminal = window.Terminal;
  window.Terminal = class extends OriginalTerminal {
    constructor(options) { super(options); window.__terminal = this; }
    resize(cols, rows) { window.__operations.push(['resize', cols, rows]); super.resize(cols, rows); }
    write(data, callback) {
      window.__pendingWrites++;
      super.write(data, () => {
        window.__operations.push(['write', data, this.cols, this.rows]);
        window.__pendingWrites--;
        callback?.();
      });
    }
  };
  window.WebglAddon = undefined;
</script>`;

app.whenReady().then(async () => {
  let win, server;
  let exitCode = 0;
  try {
    server = http.createServer((req, res) => {
      const entry = Remote.file(req.url);
      if (!entry) { res.writeHead(404); res.end(); return; }
      res.setHeader('Content-Type', entry.type);
      res.end(req.url === '/' ? entry.data.replace('<script src="/remote.js">', harness + '<script src="/remote.js">') : entry.data);
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    win = new BrowserWindow({ show: false, width: 360, height: 640, webPreferences: { partition: 'remote-terminal-tests' } });
    await win.loadURL(`http://127.0.0.1:${server.address().port}/#/r/robot/shell`);
    const result = await win.webContents.executeJavaScript(`(async () => {
      const assert = (ok, message) => { if (!ok) throw new Error(message); };
      const frames = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const settled = async () => {
        const deadline = Date.now() + 3000;
        while (window.__pendingWrites) {
          if (Date.now() > deadline) throw new Error('Terminal writes did not finish');
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        await frames();
      };
      const receive = window.__receive;
      receive({ t: 'robots', robots: [{
        key: 'robot', wcId: 1, name: 'Mobile', mode: 'control',
        tabs: [{ id: 'shell', title: 'Shell', kind: 'terminal', sessionId: 'pty', active: true }]
      }] });
      const terminal = window.__terminal;
      const old = '\\x1b[2J\\x1b[H' + 'x'.repeat(79) + 'OLD';
      const latest = '\\r\\nNEW';
      receive({ t: 'attached', id: 'pty', found: true, cols: 80, rows: 45,
        segs: [{ cols: 80, rows: 45, data: old }] });
      receive({ t: 'data', id: 'pty', data: latest });
      receive({ t: 'resized', id: 'pty', cols: 40, rows: 30 });
      receive({ t: 'data', id: 'pty', data: 'AFTER' });
      await settled();
      let ops = window.__operations;
      const oldIndex = ops.findIndex((o) => o[0] === 'write' && o[1] === old);
      const liveIndex = ops.findIndex((o) => o[0] === 'write' && o[1] === latest);
      const resizeIndex = ops.findIndex((o) => o[0] === 'resize' && o[1] === 40);
      const afterIndex = ops.findIndex((o) => o[0] === 'write' && o[1] === 'AFTER');
      assert(oldIndex < liveIndex && liveIndex < resizeIndex && resizeIndex < afterIndex, 'Replay and live output retain protocol order');
      assert(ops[liveIndex][2] === 80 && ops[afterIndex][2] === 40, 'Text is parsed at the dimensions at which it was produced');

      window.__operations = [];
      receive({ t: 'data', id: 'pty', data: 'LIVE1' });
      receive({ t: 'resized', id: 'pty', cols: 100, rows: 50 });
      receive({ t: 'data', id: 'pty', data: 'LIVE2' });
      await settled();
      ops = window.__operations;
      assert(ops[0][0] === 'write' && ops[0][2] === 40 && ops[1][0] === 'resize' && ops[2][2] === 100, 'Live resizes wait for asynchronous writes');

      const scroll = document.querySelector('.termscroll');
      assert(scroll.scrollHeight > scroll.clientHeight, 'Large PC terminal remains vertically scrollable');
      assert(scroll.scrollWidth > scroll.clientWidth, 'Wide PC terminal remains horizontally scrollable');
      assert(scroll.scrollHeight - scroll.clientHeight - scroll.scrollTop <= 2, 'The bottom of the terminal is visible');
      assert(terminal.options.fontSize >= 9, 'Automatic sizing keeps text readable');
      const input = document.querySelector('.inputbar input');
      input.focus();
      window.__viewport.height = 340;
      window.__viewport.dispatchEvent(new Event('resize'));
      await settled();
      const bar = document.querySelector('.inputbar').getBoundingClientRect();
      assert(document.body.getBoundingClientRect().height === 340 && bar.bottom <= 341, 'Keyboard viewport keeps input controls visible');
      assert(terminal.cols === 100 && terminal.rows === 50, 'Keyboard does not resize the PC terminal');

      scroll.scrollTop = 0;
      scroll.dispatchEvent(new Event('scroll'));
      receive({ t: 'data', id: 'pty', data: '\\r\\nBACKGROUND' });
      await settled();
      assert(scroll.scrollTop === 0, 'New output does not interrupt reading older content');
      scroll.scrollTop = scroll.scrollHeight;
      scroll.dispatchEvent(new Event('scroll'));
      terminal.options.fontSize = 11;
      await frames();
      scroll.scrollTop = scroll.scrollHeight;
      scroll.dispatchEvent(new Event('scroll'));
      receive({ t: 'data', id: 'pty', data: '\\x1b[?2004h' });
      await settled();
      window.__sent = [];
      input.value = 'hello';
      input.closest('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      await settled();
      const sent = window.__sent.filter((m) => m.t === 'input');
      assert(sent[0].data === '\\x1b[200~hello\\x1b[201~' && sent[1].data === '\\r', 'Draft input respects CLI bracketed paste mode before Enter');
      assert(input.value === '' && document.activeElement === input, 'Submitting retains keyboard focus');
      const arrow = [...document.querySelectorAll('.key')].find((b) => b.textContent === '↑');
      const event = new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerType: 'touch' });
      arrow.dispatchEvent(event);
      assert(event.defaultPrevented, 'Touch keys retain keyboard focus');
      arrow.click();
      assert(window.__sent.at(-1).data === '\\x1b[A', 'Arrow keys send terminal sequences');
      const multiline = [...document.querySelectorAll('.key')].find((b) => b.textContent === '⇧⏎');
      multiline.click();
      assert(window.__sent.at(-1).data === '\\x1b\\r', 'Shift Enter matches desktop CLI input');
      assert(!window.__sent.some((m) => m.t === 'resize'), 'Mobile viewing never resizes the shared PTY');

      receive({ t: 'robots', robots: [] });
      receive({ t: 'data', id: 'pty', data: 'AFTER CLOSE' });
      await frames();
      assert(!document.querySelector('.termwrap'), 'Closing the terminal disposes its view');
      return 'Remote terminal ordering, mobile viewport, scrolling and CLI input passed (DOM renderer)';
    })()`);
    console.log(result);
  } catch (error) {
    console.error(error);
    exitCode = 1;
  } finally {
    win?.destroy();
    if (server) await new Promise((resolve) => server.close(resolve));
    app.exit(exitCode);
  }
}).catch((error) => {
  console.error(error);
  app.exit(1);
});

process.on('exit', () => fs.rmSync(temp, { recursive: true, force: true }));
