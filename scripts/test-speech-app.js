const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');

if (!process.versions.electron) {
  const { spawnSync } = require('node:child_process');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'robotconsole-speech-app-'));
  let status = 1;
  try {
    fs.writeFileSync(path.join(root, 'settings.json'), JSON.stringify({ showSplash: false, robotVoice: false }));
    fs.writeFileSync(path.join(root, 'state.json'), JSON.stringify({
      version: 2, spaces: [
        { rid: 'robotone', seed: 'test-one', name: 'One', tabs: [] },
        { rid: 'robottwo', seed: 'test-two', name: 'Two', tabs: [] },
      ],
    }));
    fs.writeFileSync(path.join(root, 'speech-history.jsonl'), Array.from({ length: 205 }, (_, i) =>
      JSON.stringify({ at: new Date().toISOString(), rid: 'robotone', name: 'One', source: 'cli',
        text: i === 0 ? '<img src=x onerror="window.__unsafe=true">' : `Older message ${i}` })).join('\n') + '\n');
    const env = { ...process.env, ROBOTCONSOLE_USERDATA: root, ROBOTCONSOLE_NO_SPLASH: '1', RC_SPEECH_APP_TEST: '1' };
    delete env.ELECTRON_RUN_AS_NODE;
    const result = spawnSync(require('electron'), [__filename], { stdio: 'inherit', env, timeout: 45000 });
    if (result.error) throw result.error;
    status = result.status ?? 1;
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
  process.exit(status);
}

if (!process.env.RC_SPEECH_APP_TEST) throw new Error('Run with node scripts\\test-speech-app.js');
const { app, BrowserWindow } = require('electron');
const PtyClient = require('../main/ptyclient');
const sent = [];
// Aucun shell ni hôte détaché n'est lancé par ce test d'intégration IPC.
PtyClient.prototype.send = async function (message) { sent.push(message); };
const { request } = require('../bin/robot-say.js');
const { pipeFor } = require('../main/speech');
app.disableHardwareAcceleration();
require('../main');

app.whenReady().then(async () => {
  let status = 0;
  try {
    const win = BrowserWindow.getAllWindows()[0];
    assert.ok(win);
    if (win.webContents.isLoading()) await new Promise((resolve) => win.webContents.once('did-finish-load', resolve));
    const ready = await win.webContents.executeJavaScript(`(async () => {
      for (let i = 0; i < 100; i++) {
        if (window.CAI?.spaces.length === 2 && CAI.activeSpace) return true;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      return false;
    })()`);
    assert.equal(ready, true, 'Application restores both robots');
    await win.webContents.executeJavaScript(`CAI.openTab(CAI.spaces[0], { kind: 'terminal' }); void 0;`);
    const created = sent.find((message) => message.t === 'create');
    assert.ok(created, 'Terminal creation reaches the main process');
    assert.equal(created.env.ROBOTCONSOLE_SESSION, created.id);
    assert.equal(created.env.ROBOTCONSOLE_USERDATA, process.env.ROBOTCONSOLE_USERDATA);
    assert.equal(Object.keys(created.env).filter((key) => key.toUpperCase() === 'PATH').length, 1);
    assert.equal(created.env.PATH.split(path.delimiter)[0], path.join(__dirname, '..', 'bin'));
    // Le renderer publie la nouvelle session après le retour de createPty.
    await win.webContents.executeJavaScript(`new Promise((resolve) => setTimeout(resolve, 100))`);
    const pipe = pipeFor(process.env.ROBOTCONSOLE_USERDATA);
    assert.equal(created.env.ROBOTCONSOLE_SPEECH_PIPE, pipe);
    const first = await request(pipe, { action: 'say', session: created.id, text: "C'est terminé" });
    assert.equal(first.rid, 'robotone');
    await win.webContents.executeJavaScript(`CAI.moveTab(CAI.spaces[0].tabs[0], CAI.spaces[1]); void 0;`);
    const moved = await request(pipe, { action: 'say', session: created.id, text: 'Moved tab' });
    assert.equal(moved.rid, 'robottwo');
    const history = await request(pipe, { action: 'history', robot: 'robottwo' });
    assert.equal(history.at(-1).text, 'Moved tab');
    assert.equal(history.at(-1).source, 'cli');
    assert.ok(fs.existsSync(path.join(process.env.ROBOTCONSOLE_USERDATA, 'speech-history.jsonl')));
    await win.webContents.executeJavaScript(`CAI.spaces[0].robotEl.click(); void 0;`);
    const panel = await win.webContents.executeJavaScript(`(async () => {
      for (let i = 0; i < 100 && document.querySelectorAll('.rp-speech-list .speech-entry').length !== 206; i++) {
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      const left = document.querySelector('.rp-controls').getBoundingClientRect();
      const right = document.querySelector('.rp-speech').getBoundingClientRect();
      return {
        count: document.querySelectorAll('.rp-speech-list .speech-entry').length,
        rightOfControls: right.left >= left.right,
        oldestPresent: document.querySelector('.rp-speech-list').textContent.includes('Older message 1'),
        htmlEscaped: !document.querySelector('.rp-speech-list img'),
        newest: document.querySelector('.rp-speech-list .speech-entry div').textContent,
      };
    })()`);
    assert.equal(panel.count, 206, 'The click menu shows more than 200 messages');
    assert.equal(panel.rightOfControls, true, 'Messages are displayed to the right of robot controls');
    assert.equal(panel.oldestPresent, true);
    assert.equal(panel.htmlEscaped, true);
    assert.equal(panel.newest, "C'est terminé");
    await request(pipe, { action: 'say', robot: 'robotone', text: 'Live menu update' });
    const updated = await win.webContents.executeJavaScript(`(async () => {
      for (let i = 0; i < 100; i++) {
        if (document.querySelector('.rp-speech-list .speech-entry div')?.textContent === 'Live menu update') return true;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      return false;
    })()`);
    assert.equal(updated, true, 'An open menu updates after a new message');
    await win.webContents.executeJavaScript(`CAI.spaces[1].robotEl.click(); void 0;`);
    const otherRobot = await win.webContents.executeJavaScript(`(async () => {
      for (let i = 0; i < 100 && !document.querySelector('.rp-speech-list .speech-entry'); i++) {
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      return document.querySelector('.rp-speech-list').textContent;
    })()`);
    assert.ok(otherRobot.includes('Moved tab'));
    assert.ok(!otherRobot.includes('Older message'), 'The panel is scoped to the clicked robot');
    const deletedId = await win.webContents.executeJavaScript(`(() => {
      const button = document.querySelector('.rp-speech-list .speech-delete');
      const id = button.dataset.messageId;
      button.click();
      return id;
    })()`);
    const waitForEmpty = async () => win.webContents.executeJavaScript(`(async () => {
      for (let i = 0; i < 100; i++) {
        if (!document.querySelector('.rp-speech-list .speech-entry') && document.querySelector('.speech-clear').disabled) return true;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      return false;
    })()`);
    const removedFromPanel = await win.webContents.executeJavaScript(`(async () => {
      for (let i = 0; i < 100; i++) {
        if (![...document.querySelectorAll('.rp-speech-list .speech-delete')].some((button) => button.dataset.messageId === ${JSON.stringify(deletedId)})) return true;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      return false;
    })()`);
    assert.equal(removedFromPanel, true, 'Deleting one message refreshes the panel');
    assert.ok((await request(pipe, { action: 'history', robot: 'robottwo' })).every((entry) => entry.id !== deletedId));
    await win.webContents.executeJavaScript(`CAI.spaces[0].robotEl.click(); void 0;`);
    await win.webContents.executeJavaScript(`(async () => {
      for (let i = 0; i < 100 && document.querySelector('.speech-clear').disabled; i++) await new Promise((resolve) => setTimeout(resolve, 20));
      document.querySelector('.speech-clear').click();
      document.querySelector('.dlg-actions .tb-btn').click();
    })()`);
    assert.equal((await win.webContents.executeJavaScript(`api.speechHistory('robotone')`)).length, 207, 'Cancelling clear preserves messages');
    await win.webContents.executeJavaScript(`
      document.querySelector('.speech-clear').click();
      const confirm = document.querySelector('.dlg-actions .danger-btn');
      confirm.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      confirm.click();
      void 0;
    `);
    assert.equal(await waitForEmpty(), true, 'Deleting all messages empties the panel');
    assert.equal(await win.webContents.executeJavaScript(`document.querySelector('.robot-picker').classList.contains('hidden')`), false, 'Confirmation keeps the robot menu open');
    assert.equal((await request(pipe, { action: 'history', robot: 'robotone' })).length, 0);
    console.log('Speech app: IPC, complete live history, individual deletion and confirmed clear passed.');
  } catch (error) { console.error(error); status = 1; }
  finally { app.exit(status); }
});
