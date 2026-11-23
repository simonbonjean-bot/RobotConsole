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
const testHome = path.join(process.env.ROBOTCONSOLE_USERDATA, 'skill-home');
const testProject = path.join(process.env.ROBOTCONSOLE_USERDATA, 'skill-project');
fs.mkdirSync(testHome);
fs.mkdirSync(testProject);
os.homedir = () => testHome;
const PtyClient = require('../main/ptyclient');
const sent = [];
// Aucun shell ni hôte détaché n'est lancé par ce test d'intégration IPC.
PtyClient.prototype.send = async function (message) { sent.push(message); };
const { request } = require('../bin/robot-say.js');
const { pipeFor } = require('../main/speech');
const voices = [];
const selectedVoices = [];
require('../main/speech-voice').SpeechVoice.prototype.listVoices = async function () {
  return { supported: true, voices: [
    { id: 'Test French', name: 'Test French', language: 'fr-FR' },
    { id: 'Test English', name: 'Test English', language: 'en-US' },
  ] };
};
require('../main/speech-voice').SpeechVoice.prototype.speak = async function (text, volume, allowed, voiceName) {
  if (!allowed()) return { cancelled: true };
  voices.push(text);
  selectedVoices.push(voiceName);
};
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
    await win.webContents.executeJavaScript(`Settings.open('robot-skill'); void 0;`);
    const waitForSkillButtons = async () => win.webContents.executeJavaScript(`(async () => {
      for (let i = 0; i < 100; i++) {
        if (!document.querySelector('#set-robot-skill .skill-actions button').disabled) return true;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      return false;
    })()`);
    assert.equal(await waitForSkillButtons(), true);
    assert.equal(await win.webContents.executeJavaScript(`document.querySelectorAll('#set-robot-skill .skill-actions button')[1].disabled`), true, 'Workspace install is disabled when no workspace is open');
    const skillState = await win.webContents.executeJavaScript(`api.skillStatus()`);
    assert.ok(skillState.user.every((file) => file.path.startsWith(testHome)), 'The test never installs into the real home directory');
    await win.webContents.executeJavaScript(`document.querySelector('#set-robot-skill .skill-actions button').click(); void 0;`);
    assert.equal(await waitForSkillButtons(), true);
    const source = fs.readFileSync(path.join(__dirname, '..', 'skills', 'robot-say', 'SKILL.md'));
    const installedFiles = ['.claude', '.agents'].map((folder) => path.join(testHome, folder, 'skills', 'robot-say', 'SKILL.md'));
    for (const file of installedFiles) assert.ok(fs.readFileSync(file).equals(source));
    fs.writeFileSync(installedFiles[0], 'User customization');
    const waitForSkillConfirmation = async () => win.webContents.executeJavaScript(`(async () => {
      for (let i = 0; i < 100; i++) {
        if (document.querySelector('.dlg-actions .danger-btn')) return true;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      return false;
    })()`);
    await win.webContents.executeJavaScript(`document.querySelector('#set-robot-skill .skill-actions button').click(); void 0;`);
    assert.equal(await waitForSkillConfirmation(), true);
    await win.webContents.executeJavaScript(`document.querySelector('.dlg-actions .tb-btn').click(); void 0;`);
    assert.equal(await waitForSkillButtons(), true);
    assert.equal(fs.readFileSync(installedFiles[0], 'utf8'), 'User customization', 'Cancelling replacement preserves custom instructions');
    await win.webContents.executeJavaScript(`document.querySelector('#set-robot-skill .skill-actions button').click(); void 0;`);
    assert.equal(await waitForSkillConfirmation(), true);
    await win.webContents.executeJavaScript(`document.querySelector('.dlg-actions .danger-btn').click(); void 0;`);
    assert.equal(await waitForSkillButtons(), true);
    assert.ok(fs.readFileSync(installedFiles[0]).equals(source), 'Confirmed replacement updates the skill');
    require('electron').dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [testProject] });
    await win.webContents.executeJavaScript(`document.querySelectorAll('#set-robot-skill .skill-actions button')[2].click(); void 0;`);
    assert.equal(await waitForSkillButtons(), true);
    for (const folder of ['.claude', '.agents']) {
      assert.ok(fs.readFileSync(path.join(testProject, folder, 'skills', 'robot-say', 'SKILL.md')).equals(source), 'Folder selection installs without requiring an npm script in the project');
    }
    await win.webContents.executeJavaScript(`Settings.close(); Settings.set({ robotVoice: true }); CAI.spaces[0].robotEl.click(); document.querySelector('.rp-voice-button').click(); void 0;`);
    assert.equal(await win.webContents.executeJavaScript(`document.querySelector('.rp-voice-consent').checked`), false, 'Robots require individual consent even when global voice is enabled');
    const selected = await win.webContents.executeJavaScript(`(async () => {
      for (let i = 0; i < 100 && document.querySelector('.rp-voice-select').disabled; i++) await new Promise((resolve) => setTimeout(resolve, 20));
      const select = document.querySelector('.rp-voice-select');
      const values = [...select.options].map((option) => option.value);
      select.value = 'Test French';
      select.dispatchEvent(new Event('change', { bubbles: true }));
      return { values, consent: CAI.spaces[0].voice };
    })()`);
    assert.deepEqual(selected.values, ['', 'Test French', 'Test English'], 'The menu lists system voices and a default choice');
    assert.equal(selected.consent, false, 'Selecting a voice never grants permission to speak');
    if (process.platform === 'win32') {
      const opened = [];
      require('electron').shell.openExternal = async (url) => { opened.push(url); };
      await win.webContents.executeJavaScript(`document.querySelector('.rp-add-voices').click(); void 0;`);
      assert.deepEqual(opened, ['ms-settings:speech'], 'The add-voices link opens the fixed Windows speech settings page');
    }
    await win.webContents.executeJavaScript(`document.querySelector('.rp-refresh-voices').click(); void 0;`);
    const refreshedVoice = await win.webContents.executeJavaScript(`(async () => {
      for (let i = 0; i < 100 && document.querySelector('.rp-voice-select').disabled; i++) await new Promise((resolve) => setTimeout(resolve, 20));
      return document.querySelector('.rp-voice-select').value;
    })()`);
    assert.equal(refreshedVoice, 'Test French', 'Refreshing voices preserves the robot selection');
    await assert.rejects(win.webContents.executeJavaScript(`api.speechVoice('Not approved', 0, 'robotone')`), /non autorisée/);
    await win.webContents.executeJavaScript(`document.querySelector('.rp-voice-consent').click(); void 0;`);
    await request(pipe, { action: 'say', robot: 'robotone', text: 'Approved speech' });
    assert.ok(voices.includes('Approved speech'));
    assert.equal(selectedVoices.at(-1), 'Test French', 'The chosen robot voice reaches the speech engine');
    await request(pipe, { action: 'say', robot: 'robottwo', text: 'Other robot stays silent' });
    assert.ok(!voices.includes('Other robot stays silent'));
    await win.webContents.executeJavaScript(`Settings.set({ robotVoice: false }); void 0;`);
    await request(pipe, { action: 'say', robot: 'robotone', text: 'Globally disabled' });
    assert.ok(!voices.includes('Globally disabled'));
    const savedVoice = await win.webContents.executeJavaScript(`(async () => {
      await new Promise((resolve) => setTimeout(resolve, 400));
      return (await api.loadState()).spaces.map((space) => ({ allowed: space.voice === true, name: space.voiceName || '' }));
    })()`);
    assert.deepEqual(savedVoice, [{ allowed: true, name: 'Test French' }, { allowed: false, name: '' }], 'Individual permissions and voice choices are saved independently');
    const missingVoice = await win.webContents.executeJavaScript(`(async () => {
      CAI.spaces[0].voiceName = 'Removed voice';
      CAI.spaces[0].robotEl.click();
      document.querySelector('.rp-voice-button').click();
      for (let i = 0; i < 100 && document.querySelector('.rp-voice-select').disabled; i++) await new Promise((resolve) => setTimeout(resolve, 20));
      const select = document.querySelector('.rp-voice-select');
      return { value: select.value, disabled: select.selectedOptions[0].disabled };
    })()`);
    assert.deepEqual(missingVoice, { value: 'Removed voice', disabled: true }, 'A missing saved voice is shown explicitly instead of silently switching');
    console.log('Speech app: IPC, complete live history, individual deletion and confirmed clear passed.');
    console.log('Skill settings: user/folder installs and protected custom copies passed.');
    console.log('Robot voice: consent, voice selection, missing voices and persistence passed.');
  } catch (error) { console.error(error); status = 1; }
  finally { app.exit(status); }
});
