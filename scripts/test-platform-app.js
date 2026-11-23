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
process.env.ROBOTCONSOLE_USERDATA = profile;
process.env.ROBOTCONSOLE_NO_SPLASH = '1';
fs.writeFileSync(path.join(profile, 'settings.json'), JSON.stringify({ showSplash: false, language: 'fr', robotVoice: false }));
fs.writeFileSync(path.join(profile, 'windows.json'), JSON.stringify([{ ws: workspace, winId: 'main' }]));
const messages = [];
const PtyClient = require('../main/ptyclient');
PtyClient.prototype.send = async (message) => { messages.push(message); };
PtyClient.prototype.sessions = async () => [];
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
    console.log('Platform app: native paths, nested file creation, rename safety, styling and keyboard shortcuts passed.');
  } catch (error) {
    console.error(error);
    status = 1;
  } finally { app.exit(status); }
}).catch((error) => { console.error(error); app.exit(1); });
