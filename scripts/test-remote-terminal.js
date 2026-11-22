// Run with: node scripts\test-remote-terminal.js
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
if (!process.versions.electron) {
  const { spawnSync } = require('node:child_process');
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'robotconsole-remote-tests-'));
  let status = 1;
  try {
    const result = spawnSync(require('electron'), [__filename], {
      stdio: 'inherit', env: { ...process.env, RC_REMOTE_TEST_PROFILE: temp },
    });
    if (result.error) throw result.error;
    status = result.status ?? 1;
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
  process.exit(status);
}
const { app, BrowserWindow } = require('electron');
const Remote = require('../main/remote');
const assert = require('node:assert/strict');

const temp = process.env.RC_REMOTE_TEST_PROFILE;
if (!temp) throw new Error('Run this test with node scripts\\test-remote-terminal.js');
app.setPath('userData', path.join(temp, 'profile'));
app.disableHardwareAcceleration();
app.on('window-all-closed', () => {});

const harness = `<script src="/test-serialize.js"></script><script>
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
  window.__desktop = new OriginalTerminal({ cols: 80, rows: 45, allowProposedApi: true });
  window.__serializer = new SerializeAddon.SerializeAddon();
  window.__desktop.loadAddon(window.__serializer);
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
    const messages = [];
    const remote = new Remote({ ptyHost: null, getWc: () => null });
    remote.onData('pty', 'before subscription');
    remote.clients.add({ readyState: 1, subs: new Set(['pty']), send: (raw) => messages.push(JSON.parse(raw)) });
    const seq = remote.onData('pty', 'after subscription');
    assert.equal(messages[0].seq, seq);
    assert.equal(seq, 2, 'Output boundaries also include data produced before a phone subscribes');
    server = http.createServer((req, res) => {
      if (req.url === '/test-serialize.js') {
        res.setHeader('Content-Type', 'text/javascript');
        res.end(fs.readFileSync(path.join(__dirname, '..', 'node_modules', '@xterm', 'addon-serialize', 'lib', 'addon-serialize.js')));
        return;
      }
      const entry = Remote.file(req.url);
      if (!entry) { res.writeHead(404); res.end(); return; }
      res.setHeader('Content-Type', entry.type);
      res.end(req.url === '/' ? entry.data.replace('<script src="/remote.js">', harness + '<script src="/remote.js">') : entry.data);
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    win = new BrowserWindow({ show: false, width: 360, height: 640, webPreferences: { partition: 'remote-terminal-tests' } });
    await win.loadURL(`http://127.0.0.1:${server.address().port}/#/r/robot/shell`);
    await win.webContents.executeJavaScript(`window.api = { onData() {}, onExit() {} }; void 0;`);
    await win.webContents.executeJavaScript(fs.readFileSync(path.join(__dirname, '..', 'renderer', 'terminal-tab.js'), 'utf8'));
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
      const desktop = window.__desktop;
      const desktopTab = { term: desktop, serializer: window.__serializer, ptyId: 'pty', outputSeq: 0 };
      const feed = async (data) => {
        desktopTab.outputSeq++;
        await new Promise((resolve) => desktop.write(data, resolve));
        receive({ t: 'data', id: 'pty', seq: desktopTab.outputSeq, data });
      };
      const snapshot = () => TabKinds.terminal.remoteSnapshot(desktopTab);
      const reply = async (result) => {
        result ||= await snapshot();
        const req = window.__sent.findLast((m) => m.t === 'action' && m.action === 'terminal-snapshot').req;
        receive({ t: 'actionResult', req, result });
        await settled();
      };
      const buffer = (t) => {
        const b = t.buffer.active;
        return JSON.stringify({ cursorX: b.cursorX, cursorY: b.cursorY, baseY: b.baseY, type: b.type,
          lines: Array.from({ length: b.length }, (_, i) => ({ text: b.getLine(i).translateToString(), wrapped: b.getLine(i).isWrapped })) });
      };
      receive({ t: 'robots', robots: [{
        key: 'robot', wcId: 1, name: 'Mobile', mode: 'control',
        tabs: [{ id: 'shell', title: 'Shell', kind: 'terminal', sessionId: 'pty', active: true }]
      }] });
      const terminal = window.__terminal;
      window.__sent = [];
      const old = '\\x1b[2J\\x1b[H' + 'x'.repeat(79) + 'OLD\\x1b[6n\\x1b[c';
      const latest = '\\r\\nNEW';
      receive({ t: 'attached', id: 'pty', found: true, cols: 20, rows: 10, data: 'TRUNCATED PTY HISTORY' });
      await feed(old);
      await feed(latest);
      const state = await snapshot();
      await feed('AFTER');
      await reply(state);
      assert(terminal.cols === 80 && terminal.rows === 45, 'Mirror restores PC geometry, not the PTY history dimensions');
      assert(buffer(terminal) === buffer(desktop), 'Snapshot boundary prevents duplicate output and preserves wrapped lines');
      assert(!window.__operations.some((o) => o[1] === 'TRUNCATED PTY HISTORY'), 'Incomplete PTY history is never replayed');
      assert(!window.__sent.some((m) => m.t === 'input'), 'Replaying historical terminal queries must not send replies to the live CLI');
      assert(!terminal.options.disableStdin, 'Keyboard input is enabled after synchronization');
      await feed('\\x1b[6n\\x1b[?6n\\x1b[c\\x1b[>c');
      await settled();
      assert(!window.__sent.some((m) => m.t === 'input'), 'The mirror must not duplicate cursor/capability replies already provided by the PC');

      window.__operations = [];
      await feed('\\r\\n' + 'LIVE1'.repeat(25));
      desktop.resize(40, 30);
      receive({ t: 'resized', id: 'pty', cols: 999, rows: 10 });
      const resized = await snapshot();
      await feed('\\x1b[2A\\r\\x1b[2K' + 'REDRAW '.repeat(12) + '\\r\\nLIVE2');
      await reply(resized);
      assert(terminal.cols === 40 && terminal.rows === 30 && buffer(terminal) === buffer(desktop),
        'CLI cursor redraws stay identical after resizing; host geometry never overrides the desktop');
      desktop.resize(100, 50);
      receive({ t: 'resized', id: 'pty', cols: 999, rows: 10 });
      await reply();
      assert(buffer(terminal) === buffer(desktop), 'Desktop reflow is mirrored without extra newlines');
      await feed('\\x1b[?1049h\\x1b[2J\\x1b[H\\x1b[32m' + '界 ── CLI '.repeat(18) + '\\x1b[0m\\r\\n\\x1b[1A\\x1b[15GREDRAW');
      document.querySelector('.termbar button:nth-of-type(4)').click();
      await reply();
      assert(buffer(terminal) === buffer(desktop) && terminal.buffer.active.type === 'alternate',
        'Full-screen CLI state, wide characters and cursor redraws survive resynchronization');
      await feed('\\x1b[?1049l');
      await settled();
      assert(buffer(terminal) === buffer(desktop), 'Returning to normal scrollback preserves PC line breaks');

      const scroll = document.querySelector('.termscroll');
      assert(scroll.scrollHeight > scroll.clientHeight, 'Large PC terminal remains vertically scrollable');
      assert(scroll.scrollWidth > scroll.clientWidth, 'Wide PC terminal remains horizontally scrollable');
      assert(scroll.scrollHeight - scroll.clientHeight - scroll.scrollTop <= 2, 'The bottom of the terminal is visible');
      assert(terminal.options.fontSize === 14, 'Mirror uses readable text instead of shrinking the desktop into the phone');
      document.querySelector('.termbar button:first-of-type').click();
      assert(terminal.options.fontSize === 13, 'Text size can be reduced');
      document.querySelector('.termbar button:nth-of-type(3)').click();
      assert(terminal.options.fontSize >= 12, 'Fit never makes mirror text unreadably small');
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
      await feed('\\r\\nBACKGROUND');
      await settled();
      assert(scroll.scrollTop === 0, 'New output does not interrupt reading older content');
      scroll.scrollTop = scroll.scrollHeight;
      scroll.dispatchEvent(new Event('scroll'));
      terminal.options.fontSize = 11;
      await frames();
      scroll.scrollTop = scroll.scrollHeight;
      scroll.dispatchEvent(new Event('scroll'));
      await feed('\\x1b[?2004h');
      await settled();
      window.__sent = [];
      input.value = 'hello';
      input.closest('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      await settled();
      const sent = window.__sent.filter((m) => m.t === 'input');
      assert(sent[0].data === '\\x1b[200~hello\\x1b[201~' && sent[1].data === '\\r', 'Draft input respects CLI bracketed paste mode before Enter');
      assert(input.value === '' && document.activeElement === input, 'Submitting retains keyboard focus');
      const composition = new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true, cancelable: true });
      input.dispatchEvent(composition);
      assert(composition.defaultPrevented, 'IME composition does not submit prematurely');
      const ctrl = [...document.querySelectorAll('.key')].find((b) => b.textContent === 'Ctrl');
      ctrl.click();
      input.value = 'c';
      input.closest('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      assert(window.__sent.at(-2).data === '\\x03', 'Ctrl shortcuts are sent raw, not bracketed paste');
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
      document.querySelector('.termbar button:nth-of-type(4)').click();
      await reply({ error: 'Snapshot unavailable' });
      input.value = 'keep this draft';
      input.closest('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      assert(input.value === 'keep this draft' && terminal.options.disableStdin,
        'Snapshot errors disable input explicitly without losing the draft');
      document.querySelector('.termbar button:nth-of-type(4)').click();
      await reply();
      assert(!terminal.options.disableStdin && buffer(terminal) === buffer(desktop), 'Resynchronization recovers from snapshot errors');

      const historyReply = (entries) => {
        const req = window.__sent.findLast((m) => m.t === 'speechHistory').req;
        receive({ t: 'actionResult', req, result: { entries } });
      };
      const speechEntry = (text, id = 'message') => ({ id, at: new Date().toISOString(), source: 'cli', text });
      document.querySelector('.speech-details > button').click();
      historyReply([speechEntry('Older activity')]);
      receive({ t: 'speech', wcId: 1, key: 'robot', entry: speechEntry('<img src=x> Done'), duration: 1000 });
      assert(document.querySelector('.speech-panel .robot-message').textContent === '<img src=x> Done' &&
        !document.querySelector('.speech-panel img'), 'Live activity messages are displayed as text');
      historyReply([speechEntry('Older activity', 'older'), speechEntry('<img src=x> Done')]);
      assert(document.querySelector('.speech-history .speech-entry div').textContent === '<img src=x> Done',
        'The selected robot history updates live with newest messages first');
      assert(window.__terminal === terminal && buffer(terminal) === buffer(desktop),
        'Speech updates do not recreate or modify the shared terminal');
      receive({ t: 'speech', wcId: 1, key: 'private', entry: speechEntry('Private message') });
      assert(!document.querySelector('.speech-panel').textContent.includes('Private message'), 'Messages from unknown robots are ignored');
      receive({ t: 'speechChanged', wcId: 1, key: 'robot' });
      historyReply([]);
      assert(!document.querySelector('.speech-entry'), 'History deletions are reflected on the shared page');

      receive({ t: 'data', id: 'pty', seq: ++desktopTab.outputSeq, data: 'PENDING' });
      receive({ t: 'robots', robots: [] });
      receive({ t: 'data', id: 'pty', data: 'AFTER CLOSE' });
      await frames();
      assert(!document.querySelector('.termwrap'), 'Closing the terminal disposes its view');
      location.hash = '';
      await frames();
      const shared = (key, workspace, wcId = 1) => ({
        key, workspace, wcId, name: key, mode: 'read', tabs: []
      });
      receive({ t: 'robots', robots: [
        shared('zeta', { root: 'z', name: 'Zeta' }),
        shared('legacy'),
        shared('alpha-first', { root: 'a', name: 'Alpha <img src=x>', svg: '<svg viewBox="0 0 48 60"><path id="workspace-bot" d="M0 0h48v60H0z"/></svg>' }),
        shared('alpha-second', { root: 'a', name: 'Alpha <img src=x>', svg: '<svg viewBox="0 0 48 60"><path id="workspace-bot" d="M0 0h48v60H0z"/></svg>' }, 2),
        shared('alpha-distinct', { root: 'b', name: 'Alpha <img src=x>' }),
        shared('unassigned', null)
      ] });
      const groups = [...document.querySelectorAll('.workspace-group')];
      assert(groups.length === 4, 'Robots are grouped by workspace root, not workspace name or window');
      assert(groups[0].querySelector('h2').textContent === 'Alpha <img src=x>' &&
        groups[2].querySelector('h2').textContent === 'Zeta', 'Workspaces are sorted alphabetically');
      assert(!document.querySelector('.workspace-title img'), 'Workspace names are rendered as text');
      assert(groups[0].querySelectorAll('.workspace-robot').length === 1 &&
        groups[0].querySelector('.workspace-robot #workspace-bot'), 'The workspace robot is displayed once beside its name');
      assert(!groups[1].querySelector('.workspace-robot') && !groups[3].querySelector('.workspace-robot'),
        'Legacy workspaces and unassigned robots do not display an unrelated robot');
      assert(groups[0].querySelectorAll('.rcard').length === 2 &&
        groups[3].querySelectorAll('.rcard').length === 2, 'Multiple windows merge and legacy robots remain visible without a workspace');
      receive({ t: 'speech', wcId: 1, key: 'alpha-first', entry: speechEntry('First message'), duration: 1000 });
      assert(groups[0].querySelector('.rcard .robot-message').textContent === 'First message',
        'Robot activity bubbles are also visible in the workspace list');
      await new Promise((resolve) => setTimeout(resolve, 600));
      receive({ t: 'speech', wcId: 1, key: 'alpha-first', entry: speechEntry('Replacement message'), duration: 1000 });
      await new Promise((resolve) => setTimeout(resolve, 500));
      assert(groups[0].querySelector('.rcard .robot-message').textContent === 'Replacement message',
        'An older bubble timer does not remove a newer activity message');
      groups[0].querySelector('.rcard').click();
      await frames();
      assert(location.hash === '#/r/alpha-first', 'Grouped robot cards preserve direct navigation');
      historyReply(Array.from({ length: 205 }, (_, i) => speechEntry('Activity ' + i, String(i))));
      assert(document.querySelectorAll('.speech-history .speech-entry').length === 205,
        'Complete history remains accessible even for robots with no tabs');
      await new Promise((resolve) => setTimeout(resolve, 550));
      assert(document.querySelector('.speech-panel .robot-message').classList.contains('hidden'),
        'Live messages expire without removing their history');
      document.querySelector('.speech-details > button').click();
      const historyReq = window.__sent.findLast((m) => m.t === 'speechHistory').req;
      receive({ t: 'actionResult', req: historyReq, result: { error: 'History unavailable' } });
      assert(document.querySelector('.speech-history.error').textContent === 'History unavailable',
        'History loading errors are displayed explicitly');
      location.hash = '';
      await frames();
      receive({ t: 'robots', robots: [shared('renamed', { root: 'a', name: 'Renamed', svg: '<svg><circle id="updated-bot" r="10"/></svg>' })] });
      assert(document.querySelectorAll('.workspace-group').length === 1 &&
        document.querySelector('.workspace-title').textContent === 'Renamed', 'List updates remove stale groups and refresh workspace names');
      assert(document.querySelector('.workspace-robot #updated-bot') && !document.querySelector('#workspace-bot'),
        'Workspace robot customization is refreshed with the shared list');
      receive({ t: 'robots', robots: [] });
      assert(!document.querySelector('.workspace-group') && document.querySelector('.empty'), 'An empty shared list keeps the existing empty state');
      assert(document.querySelector('.speech-panel').classList.contains('hidden'), 'Revoked sharing hides the robot history');
      const fileRobot = (mode) => ({
        key: 'files', wcId: 1, name: 'Files', mode,
        tabs: [{ id: 'explorer', kind: 'explorer', title: 'Files', active: true }]
      });
      const openFile = async (mode = 'control') => {
        receive({ t: 'robots', robots: [fileRobot(mode)] });
        location.hash = '#/r/files/explorer';
        await frames();
        receive({ t: 'snapshot', wcId: 1, tabId: 'explorer', snap: {
          sections: [{ items: [{ id: 'C:\\\\project\\\\notes.txt', label: 'notes.txt', tap: { id: 'view', read: true } }] }]
        } });
        document.querySelector('#view .item').click();
        const req = window.__sent.findLast((m) => m.t === 'action').req;
        receive({ t: 'actionResult', req, result: {
          title: 'notes.txt', text: 'original\\r\\n',
          edit: { file: 'C:\\\\project\\\\notes.txt', original: 'original\\r\\n', mtime: 1 }
        } });
        await frames();
      };
      await openFile();
      let fileInput = document.querySelector('.file-editor');
      const fileSave = document.querySelector('.sheet .btn');
      assert(fileInput && fileSave.disabled, 'Text files open in an editor with Save disabled until modified');
      fileInput.value = '<script>draft</script>\\n';
      fileInput.dispatchEvent(new Event('input'));
      receive({ t: 'snapshot', wcId: 1, tabId: 'explorer', snap: { summary: 'updated directory' } });
      assert(document.querySelector('.file-editor') === fileInput && fileInput.value === '<script>draft</script>\\n',
        'Periodic snapshots never replace the editor or its unsaved draft');
      fileSave.click();
      let saveReq = window.__sent.findLast((m) => m.t === 'action');
      assert(saveReq.action === 'save' && saveReq.args.original === 'original\\r\\n' &&
        saveReq.args.content === '<script>draft</script>\\r\\n' && saveReq.args.mtime === 1,
        'Save sends exact content and its conflict baseline to the originating tab');
      assert(fileSave.disabled && fileInput.readOnly, 'Saving prevents duplicate submissions and concurrent draft edits');
      receive({ t: 'actionResult', req: saveReq.req, result: { error: 'File changed' } });
      await frames();
      assert(!fileSave.disabled && !fileInput.readOnly && fileInput.value === '<script>draft</script>\\n',
        'Save failures retain the editable draft');
      fileSave.click();
      saveReq = window.__sent.findLast((m) => m.t === 'action');
      receive({ t: 'actionResult', req: saveReq.req, result: { mtime: 2 } });
      await frames();
      assert(fileSave.disabled, 'Successful save marks the draft as saved');
      fileInput.value = '';
      fileInput.dispatchEvent(new Event('input'));
      fileSave.click();
      saveReq = window.__sent.findLast((m) => m.t === 'action');
      assert(saveReq.args.content === '' && saveReq.args.mtime === 2 &&
        saveReq.args.original === '<script>draft</script>\\r\\n', 'Saving an empty file uses the latest saved baseline');
      receive({ t: 'actionResult', req: saveReq.req, result: { mtime: 3 } });
      await frames();
      fileInput.value = 'keep draft';
      fileInput.dispatchEvent(new Event('input'));
      const nativeConfirm = window.confirm;
      window.confirm = () => false;
      history.back();
      await new Promise((resolve) => setTimeout(resolve, 50));
      await frames();
      assert(document.querySelector('.file-editor') === fileInput, 'Cancelling close preserves unsaved edits');
      window.confirm = () => true;
      history.back();
      await new Promise((resolve) => setTimeout(resolve, 50));
      await frames();
      window.confirm = nativeConfirm;
      assert(!document.querySelector('.sheet'), 'Confirmed discard closes the file editor');
      await openFile('read');
      assert(!document.querySelector('.file-editor') && document.querySelector('.sheet pre').textContent === 'original\\r\\n',
        'Read-only robots show text without edit or save controls');
      history.back();
      await new Promise((resolve) => setTimeout(resolve, 50));
      await frames();
      await openFile();
      fileInput = document.querySelector('.file-editor');
      fileInput.value = 'revoked draft';
      fileInput.dispatchEvent(new Event('input'));
      receive({ t: 'robots', robots: [fileRobot('read')] });
      const beforeSave = window.__sent.filter((m) => m.t === 'action' && m.action === 'save').length;
      document.querySelector('.sheet .btn').click();
      assert(window.__sent.filter((m) => m.t === 'action' && m.action === 'save').length === beforeSave,
        'Revoked control cannot submit an open editor draft');
      return 'Exact PC/mirror wrapping, cursor redraws, snapshot boundaries, mobile viewport and CLI input passed';
    })()`);
    console.log(result);
  } catch (error) {
    console.error(error);
    exitCode = 1;
  } finally {
    win?.destroy();
    if (server) {
      server.closeAllConnections();
      server.close();
    }
    app.exit(exitCode);
  }
}).catch((error) => {
  console.error(error);
  app.exit(1);
});
