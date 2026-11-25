if (!process.versions.electron) require('./electron-test')(__filename);
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');
const temp = process.env.ROBOTCONSOLE_TEST_TEMP;
if (!temp) throw new Error('Run with node scripts/test-platform-app.js');
const profile = path.join(temp, 'profile');
const workspace = path.join(temp, 'Work space');
fs.mkdirSync(profile);
fs.mkdirSync(workspace);
const sessionData = path.join(temp, 'session');
fs.mkdirSync(sessionData);
app.setPath('sessionData', sessionData);
fs.mkdirSync(path.join(workspace, '.robot'));
fs.writeFileSync(path.join(workspace, '.robot', 'state.json'), JSON.stringify({
  version: 3, active: 0, activeScreen: 0, screens: [{ name: 'Écran 1' }],
  spaces: [{ name: 'Restored robot', activeTab: 1, tabs: [{ kind: 'subscriptions' }, { kind: 'terminal' }] }],
}));
process.env.ROBOTCONSOLE_USERDATA = profile;
process.env.ROBOTCONSOLE_NO_SPLASH = '1';
fs.writeFileSync(path.join(profile, 'settings.json'), JSON.stringify({ showSplash: false, language: 'fr', robotVoice: false }));
fs.writeFileSync(path.join(profile, 'windows.json'), JSON.stringify([{ ws: workspace, winId: 'main' }]));
const messages = [];
const PtyClient = require('../main/ptyclient');
PtyClient.prototype.send = async (message) => { messages.push(message); };
PtyClient.prototype.sessions = async () => [];
require('../main/subscriptions').Subscriptions.prototype.read = async () => [
  { id: 'copilot', name: 'GitHub Copilot', status: 'ok', quotas: [{ label: 'Premium', usedPercent: 25 }], source: 'test' },
];
app.disableHardwareAcceleration();
require('../main');

app.whenReady().then(async () => {
  let status = 0;
  try {
    const win = BrowserWindow.getAllWindows()[0];
    assert.ok(win);
    if (win.webContents.isLoading()) await new Promise((resolve) => win.webContents.once('did-finish-load', resolve));
    const result = await win.webContents.executeJavaScript(`(async () => {
      const wait = async (check) => {
        for (let i = 0; i < 200; i++) {
          if (await check()) return;
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
        throw new Error('Platform UI timed out');
      };
      await wait(() => window.CAI?.activeSpace);
      await wait(() => document.querySelector('#status-usage')?.textContent.includes('25 %'));
      if (CAI.spaces.some((space) => space.tabs.some((tab) => tab.kind === 'subscriptions'))) throw new Error('Legacy usage tab was restored');
      if (CAI.activeSpace.activeTab?.kind !== 'terminal') throw new Error('Removing the legacy usage tab changed the selected terminal');
      if (TabModels.all().some((model) => model.kind === 'subscriptions')) throw new Error('Legacy usage tab is still offered as a model');
      document.querySelector('#status-sessions').click();
      await wait(() => !document.querySelector('#status-panel').hidden);
      if (!document.querySelector('.sessions-list').textContent.includes('Aucune session')) throw new Error('Session list IPC did not load');
      document.querySelector('#status-usage').click();
      await wait(() => !document.querySelector('.status-usage-pane').hidden);
      if (!document.querySelector('.subscription-card')) throw new Error('Usage panel did not render provider details');
      document.querySelector('.status-dismiss').click();
      const robotSpace = CAI.activeSpace;
      robotSpace.robotEl.click();
      document.querySelector('.rp-slot-tool').click();
      const iconCategory = (label) => {
        const category = [...document.querySelectorAll('.rp-cat')].find((button) => button.textContent === label);
        if (!category) throw new Error('Missing robot icon category: ' + label);
        category.click();
      };
      const searchIcons = (query) => {
        const input = document.querySelector('.rp-tool-search');
        input.value = query;
        input.dispatchEvent(new Event('input'));
      };
      iconCategory('Emojis');
      searchIcons('fusée');
      const rocket = ToolIcons.search('fusée', 'emoji').find((icon) => icon.emoji === '🚀');
      const emojiButton = document.querySelector('.rp-tool[data-id="' + rocket.id + '"]');
      if (!emojiButton) throw new Error('French emoji search did not populate the robot icon picker');
      emojiButton.click();
      if (robotSpace.bot.tool !== rocket.id || robotSpace.robotEl.querySelector('.tool text')?.textContent !== '🚀') {
        throw new Error('Emoji selection was not applied to the robot');
      }
      await wait(async () => (await api.loadState()).spaces.some((space) => space.traits?.tool === rocket.id));
      searchIcons('');
      iconCategory('Symboles');
      searchIcons('flèche');
      const symbolButton = document.querySelector('.rp-tool[data-id="lu:arrow-up"]');
      if (!symbolButton) throw new Error('Symbol search did not populate the robot icon picker');
      symbolButton.click();
      if (robotSpace.bot.tool !== 'lu:arrow-up') throw new Error('Symbol selection was not applied to the robot');
      const picker = document.querySelector('.robot-picker');
      picker.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      robotSpace.robotEl.click();
      if (!document.querySelector('.rp-tool.on[data-id="lu:arrow-up"]')) throw new Error('Reopening the picker lost the selected symbol');
      picker.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      window.checkStatusLayout = async () => {
        const terminal = CAI.activeSpace.tabs.find((tab) => tab.kind === 'terminal');
        CAI.activateTab(terminal, true);
        const frames = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        await frames();
        for (const style of ['classic', 'compact', 'dock', 'labels', 'flat']) {
          Settings.set({ crewStyle: style });
          await frames();
          await new Promise((resolve) => terminal.term.write('\\x1b[' + terminal.term.rows + ';1HLAST-LINE', resolve));
          await frames();
          const bar = document.querySelector('#status-bar').getBoundingClientRect();
          const spaces = document.querySelector('#spaces').getBoundingClientRect();
          const screen = terminal.term.element.querySelector('.xterm-screen').getBoundingClientRect();
          if (spaces.bottom > bar.top + 1 || screen.bottom > bar.top + 1) {
            throw new Error('Status bar overlaps the workspace or terminal last row in ' + style);
          }
          const lastRow = document.elementFromPoint(screen.left + 5, screen.bottom - screen.height / terminal.term.rows / 2);
          if (!terminal.term.element.contains(lastRow) || terminal.term.buffer.active.cursorY !== terminal.term.rows - 1) {
            throw new Error('Terminal last row is obscured or not accessible in ' + style);
          }
        }
        Settings.set({ crewStyle: 'classic' });
        await frames();
      };
      await window.checkStatusLayout();
      if (document.documentElement.dataset.platform !== api.platform) throw new Error('Missing native platform styling');
      const root = ${JSON.stringify(workspace)};
      const tab = CAI.openTab(CAI.activeSpace, { kind: 'explorer', root });
      tab.pane.querySelector('[title="Nouveau fichier"]').click();
      await wait(() => document.querySelector('.dlg-input'));
      document.querySelector('.dlg-input').value = 'sub folder/hello.txt';
      document.querySelector('.dlg-actions .primary').click();
      const created = Platform.joinPath(root, 'sub folder', 'hello.txt');
      await wait(() => api.exists(created));
      const upper = Platform.joinPath(root, 'Mixed.txt');
      const lower = Platform.joinPath(root, 'mixed.txt');
      const existing = Platform.joinPath(root, 'existing.txt');
      await api.createFile(upper);
      await api.writeText(upper, 'keep');
      await api.createFile(existing);
      await api.rename(upper, lower);
      let collisionRejected = false;
      try { await api.rename(lower, existing); } catch { collisionRejected = true; }
      if (!collisionRejected) throw new Error('Rename overwrote an existing file');
      window.dispatchEvent(new KeyboardEvent('keydown', {
        code: 'KeyT', key: 'T', shiftKey: true,
        ctrlKey: api.platform !== 'darwin', metaKey: api.platform === 'darwin', bubbles: true,
      }));
      await wait(() => CAI.activeSpace.tabs.some((item) => item.kind === 'terminal'));
      return { created, lower, platform: api.platform };
    })()`);
    assert.equal(result.platform, process.platform);
    assert.ok(fs.existsSync(path.join(workspace, 'sub folder', 'hello.txt')));
    assert.ok(fs.readdirSync(workspace).includes('mixed.txt'));
    assert.equal(fs.readFileSync(result.lower, 'utf8'), 'keep');
    assert.ok(messages.some((message) => message.t === 'create' && message.cwd === workspace));
    win.setContentSize(760, 480);
    await win.webContents.executeJavaScript('window.checkStatusLayout()');
    const otherWorkspace = path.join(temp, 'Other workspace');
    fs.mkdirSync(otherWorkspace);
    await win.webContents.executeJavaScript(`api.openWorkspace(${JSON.stringify(otherWorkspace)})`);
    const wait = async (check) => {
      for (let i = 0; i < 200; i++) {
        if (await check()) return;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      throw new Error('Workspace switch timed out');
    };
    let other;
    await wait(() => {
      other = BrowserWindow.getAllWindows().find((window) => window !== win);
      return other;
    });
    if (other.webContents.isLoading()) await new Promise((resolve) => other.webContents.once('did-finish-load', resolve));
    await other.webContents.executeJavaScript(`new Promise((resolve) => {
      const ready = () => window.CAI?.activeSpace ? resolve() : setTimeout(ready, 25);
      ready();
    })`);
    other.hide();
    assert.equal(other.isVisible(), false);
    const windowCount = BrowserWindow.getAllWindows().length;
    await win.webContents.executeJavaScript(`(async () => {
      const entries = await api.listOpenWorkspaces();
      if (entries.length !== 2 || !entries.find((entry) => entry.root === ${JSON.stringify(workspace)})?.current) {
        throw new Error('Open workspace list or current workspace marker is wrong');
      }
      if ((await api.listWindows()).length) throw new Error('Workspace switcher changed the same-workspace window list');
      document.querySelector('#ws-badge').click();
      for (let i = 0; i < 200 && !document.querySelector('.ctx-menu'); i++) await new Promise((resolve) => setTimeout(resolve, 25));
      const labels = [...document.querySelectorAll('.ctx-menu .ctx-label')];
      if (!labels.some((label) => label.textContent === 'Renommer le workspace…') ||
          !labels.some((label) => label.textContent === 'Ouvrir un autre workspace…')) {
        throw new Error('Workspace switcher removed an existing menu action');
      }
      const target = labels.find((label) => label.textContent === 'Other workspace');
      if (!target) throw new Error('Open workspace is missing from the badge menu');
      target.closest('button').click();
    })()`);
    await wait(() => other.isVisible());
    assert.equal(BrowserWindow.getAllWindows().length, windowCount, 'Switching must reuse the existing window');
    assert.equal(await win.webContents.executeJavaScript('CAI.ws.root'), workspace, 'Switching does not replace the source workspace');
    console.log('Platform app: robot emoji/symbol selection and persistence, paths, status bar/last terminal row, workspace switching and shortcuts passed.');
  } catch (error) {
    console.error(error);
    status = 1;
  } finally { app.exit(status); }
}).catch((error) => { console.error(error); app.exit(1); });
