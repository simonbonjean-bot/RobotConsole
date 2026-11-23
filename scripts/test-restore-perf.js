if (!process.versions.electron) require('./electron-test')(__filename);
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const temp = process.env.ROBOTCONSOLE_TEST_TEMP;
if (!temp) throw new Error('Run with node scripts\\test-restore-perf.js');
app.setPath('userData', path.join(temp, 'profile'));
app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  let win;
  let status = 0;
  try {
    const renderer = path.join(__dirname, '..', 'renderer');
    const fixture = path.join(temp, 'fixture.html');
    fs.writeFileSync(fixture, `<base href="${pathToFileURL(renderer + path.sep).href}"><body></body>`);
    win = new BrowserWindow({ show: false });
    await win.loadFile(fixture);
    await win.webContents.executeJavaScript(fs.readFileSync(path.join(renderer, 'ui.js'), 'utf8'));
    const source = fs.readFileSync(path.join(renderer, 'app.js'), 'utf8');
    const extract = (start, end) => {
      const from = source.indexOf(start), to = source.indexOf(end, from);
      if (from < 0 || to < 0) throw new Error('Missing source boundary: ' + start);
      return source.slice(from, to);
    };
    const functions = extract('  function mountTab(', '  // ---------- Icônes d\'onglet') +
      extract('  async function closeTab(', '  // ---------- Types d\'onglets');
    const watch = extract('  api.onRemoteWatch(', '  api.onRemoteAction(');
    const result = await win.webContents.executeJavaScript(`(async () => {
      const assert = (ok, message) => { if (!ok) throw new Error(message); };
      const { h } = UI;
      const mounted = [], killed = [], detached = [], saved = [];
      const idle = [];
      window.requestIdleCallback = (fn) => idle.push(fn);
      let restoring = true, activeSpace = null, serial = 0;
      const nid = () => 't' + (++serial);
      const defaultShell = () => 'test-shell';
      const spaces = [];
      const kinds = Object.fromEntries(['terminal', 'explorer', 'editor'].map((kind) => [kind, {
        defaultTitle: () => kind,
        mount(tab, spec) { mounted.push(tab.id); tab.live = true; tab.ptyId ||= spec.sessionId; },
        serialize(tab) { assert(tab.live, 'Never serialize a deferred tool through its live serializer'); return { ...tab.spec }; },
        dispose(tab) { assert(tab.live, 'Never dispose an unmounted tool'); },
      }]));
      const TabKinds = kinds;
      const kindOf = (tab) => kinds[tab.kind];
      ${extract('  const serializeTab =', '  const byId =')}
      const api = { kill: (id) => killed.push(id), detachPty: (id) => detached.push(id) };
      const tabIconHtml = () => '';
      const makeTabDraggable = () => {};
      const renderCrewTabs = () => {};
      const updateTabsOverflow = () => {};
      const save = () => saved.push(true);
      const say = () => {};
      const activateTab = (tab) => { tab.space.activeTab = tab; if (!restoring) mountTab(tab); };
      const makeSpace = () => {
        const space = { tabs: [], tabsEl: h('div'), host: h('div'), empty: h('div') };
        document.body.append(space.tabsEl, space.host);
        spaces.push(space);
        return space;
      };
      ${functions}
      const visible = makeSpace(), hidden = makeSpace();
      const cold = openTab(hidden, { kind: 'explorer', root: 'folder' }, { defer: true });
      const terminal = openTab(hidden, { kind: 'terminal', sessionId: 'live-shell', cwd: 'cwd' }, { defer: true });
      const attachOnly = openTab(hidden, { kind: 'terminal', sessionId: 'service-shell', attachOnly: true }, { defer: true });
      const shown = openTab(visible, { kind: 'editor', file: 'file.txt' }, { defer: true });
      assert(!mounted.length, 'Creating deferred tabs never mounts the tools');
      assert(terminal.ptyId === 'live-shell', 'An unmounted terminal reserves its original session for garbage collection');
      assert(serializeTab(cold).root === 'folder' && serializeTab(terminal).sessionId === 'live-shell',
        'Saving before background mounting preserves every tool configuration and PTY');
      {
        const frames = [];
        const requestAnimationFrame = (fn) => frames.push(fn);
        ${extract('  function activateTab(', '  async function closeTab(')}
        activateTab(cold, false);
        activateTab(shown, false);
        assert(frames.length === 0, 'Selecting restored active tabs must not queue mounts for hidden spaces in the first frame');
        restoring = false;
        activateTab(shown, false);
        assert(frames.length === 1, 'Interactive tab activation still schedules mounting');
        restoring = true;
      }
      await closeTab(attachOnly, true);
      assert(detached.join() === 'service-shell' && !killed.length, 'Closing a deferred service view detaches without killing it');
      const removed = openTab(hidden, { kind: 'terminal', sessionId: 'removed-shell' }, { defer: true });
      mountTab(shown);
      mountRemainingTabs();
      assert(mounted.join() === shown.id, 'The visible tool mounts before any background work');
      await closeTab(removed, true);
      assert(killed.join() === 'removed-shell', 'Closing a deferred terminal kills only its own PTY');
      while (idle.length) idle.shift()();
      assert(mounted.join() === [shown.id, terminal.id, cold.id].join(),
        'Deferred terminals resume first; deleted tabs never mount; other tools follow in separate idle turns');
      mountTab(terminal);
      assert(mounted.filter((id) => id === terminal.id).length === 1, 'Activating while idle mounting is pending does not mount twice');
      assert(serializeTab(terminal).sessionId === 'live-shell', 'Session identity survives mounting');

      const snapshots = [], intervals = [];
      const remoteTimers = new Map();
      const findTab = (id) => ({ kind: id });
      const sendSnapshot = (id) => snapshots.push(id);
      const clearInterval = () => {};
      const setInterval = (fn, delay) => { intervals.push({ fn, delay }); return intervals.length; };
      let watchHandler;
      api.onRemoteWatch = (fn) => { watchHandler = fn; };
      ${watch}
      watchHandler('terminal', true);
      assert(snapshots.join() === 'terminal' && intervals.length === 0, 'A terminal snapshot is sent once, not every two seconds');
      watchHandler('explorer', true);
      assert(intervals.length === 1 && intervals[0].delay === 2000, 'Other tools retain their live preview refresh');
      watchHandler('terminal', true);
      assert(snapshots.filter((id) => id === 'terminal').length === 2, 'Reconnection explicitly requests a fresh terminal snapshot');
      return 'Deferred restoration, session preservation, cancellation and event-driven terminal snapshots passed';
    })()`);
    console.log(result);
  } catch (error) { console.error(error); status = 1; }
  finally {
    if (win && !win.isDestroyed()) win.destroy();
    app.exit(status);
  }
});
