const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');

if (!process.versions.electron) {
  const { spawnSync } = require('node:child_process');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'robotconsole-speech-ui-'));
  let status = 1;
  try {
    const env = { ...process.env, RC_SPEECH_TEST_PROFILE: root };
    delete env.ELECTRON_RUN_AS_NODE;
    const result = spawnSync(require('electron'), [__filename], { stdio: 'inherit', env, timeout: 60000 });
    if (result.error) throw result.error;
    status = result.status ?? 1;
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
  process.exit(status);
}

const { app, BrowserWindow } = require('electron');
if (!process.env.RC_SPEECH_TEST_PROFILE) throw new Error('Run with node scripts\\test-speech-ui.js');
app.setPath('userData', process.env.RC_SPEECH_TEST_PROFILE);
app.disableHardwareAcceleration();
app.on('window-all-closed', () => {});
app.whenReady().then(async () => {
  let win, status = 0;
  try {
    win = new BrowserWindow({ show: false, width: 800, height: 600, webPreferences: { backgroundThrottling: false } });
    await win.loadURL('data:text/html,<html><body><div id="zone"><span id="robot">Robot</span></div><div id="crew">Crew</div></body></html>');
    for (const file of ['ui.js', 'i18n-en.js', 'i18n.js']) {
      await win.webContents.executeJavaScript(fs.readFileSync(path.join(__dirname, '..', 'renderer', file), 'utf8'));
    }
    const appSource = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'app.js'), 'utf8');
    const speechCode = appSource.slice(appSource.indexOf('  function publishSpeech()'), appSource.indexOf('  function talk(space)'));
    await win.webContents.executeJavaScript(`
      window.__records = []; window.__voices = []; window.__published = []; window.__results = [];
      window.__recordError = false;
      const api = {
        speechPublish: (robots) => { window.__published = robots; },
        speechRecord: async (entry) => {
          if (window.__recordError) throw new Error('Disk full');
          window.__records.push(entry); return entry;
        },
        speechVoice: async (...args) => { window.__voices.push(args); },
        speechHistory: async (rid, { cursor } = {}) => {
          if (window.__historyError) throw new Error('Disk unavailable');
          const records = window.__records.filter((entry) => entry.rid === rid);
          const end = cursor === null || cursor === undefined ? records.length : Number(cursor);
          const start = Math.max(0, end - 3);
          return { entries: records.slice(start, end).map((entry) => ({ ...entry, at: new Date().toISOString() })), nextCursor: start ? String(start) : null };
        },
        onSpeech: (callback) => { window.__receive = callback; },
        speechResult: (id, error) => { window.__results.push({ id, error }); }
      };
      const { h, esc } = UI;
      const Settings = { data: { robotBubbles: true, robotVoice: false, robotVolume: 70 } };
      const ctx = { ws: { root: 'D:\\\\project' } };
      const spaces = [{
        rid: 'r1', name: 'One', tabs: [{ ptyId: 'p1', cwd: 'D:\\\\project' }],
        el: document.getElementById('zone'), robotEl: document.getElementById('robot'), crewFace: document.getElementById('crew'), crewEl: document.getElementById('crew')
      }];
      ${speechCode}
      window.__settings = Settings; window.__spaces = spaces; window.__say = say;
      window.__history = speechHistory; window.__publish = publishSpeech;
      I18n.setLang('en');
    `);
    const result = await win.webContents.executeJavaScript(`(async () => {
      const check = (ok, message) => { if (!ok) throw new Error(message); };
      await window.__receive(1, 'r1', "C'est fait ✓");
      await new Promise((resolve) => setTimeout(resolve, 30));
      check(document.querySelector('.bubble').textContent === "OneC'est fait ✓", 'CLI message is never translated and identifies its robot');
      check(document.querySelectorAll('.bubble:not([hidden])').length === 2, 'Message appears in both zone and robot bar');
      check(document.querySelectorAll('.speaking').length === 2, 'Both robots stay highlighted');
      check(window.__records[0].source === 'cli', 'CLI source is saved');
      check(window.__records[0].duration >= 6000, 'Speech remains visible for at least six seconds');
      check(!window.__results[0].error, 'Delivery acknowledged');
      check(window.__voices.length === 0, 'Voice is disabled by default');
      await window.__say(window.__spaces[0], "C'est fait ✓");
      check(window.__records[1].text === 'Done ✓', 'Application messages use displayed language');
      check(document.querySelectorAll('.bubble').length === 2, 'A new message replaces both previous bubbles');
      window.__settings.data.robotBubbles = false;
      await window.__receive(2, 'r1', 'Saved without bubbles');
      check(window.__records.at(-1).text === 'Saved without bubbles', 'Disabled bubbles still save history');
      check(!document.querySelector('.bubble'), 'Disabled bubbles remove the previous message');
      check(document.querySelectorAll('.speaking').length === 2, 'Speaker remains identifiable with bubbles disabled');
      window.__settings.data.robotBubbles = true;
      window.__spaces[0].el.style.display = 'none';
      await window.__receive(3, 'r1', 'Hidden robot');
      check(document.querySelector('.bubble-crew').textContent === 'OneHidden robot' && document.querySelector('.bubble-zone').hidden, 'Hidden robot still shows a crew bubble');
      window.__settings.data.robotVoice = true;
      await window.__receive(44, 'r1', 'Not approved');
      check(window.__voices.length === 0, 'Global voice does not grant permission to a robot');
      window.__spaces[0].voice = true;
      await window.__receive(4, 'r1', 'Speak');
      check(window.__voices[0][0] === 'Speak' && window.__voices[0][1] === 70 && window.__voices[0][2] === 'r1', 'Approved voice receives message, volume and robot identity');
      window.__recordError = true;
      await window.__receive(5, 'r1', 'Cannot save');
      check(window.__results.at(-1).error.includes('Disk full'), 'Persistence failure is not acknowledged as success');
      window.__recordError = false;
      await window.__receive(6, 'missing', 'No robot');
      check(!!window.__results.at(-1).error, 'Stale robot target fails explicitly');
      window.__records.push({ rid: 'r1', text: '<img src=x onerror="window.__unsafe=true">', source: 'cli' });
      const dialog = window.__history(window.__spaces[0]);
      await new Promise((resolve) => setTimeout(resolve, 30));
      check(!document.querySelector('.speech-history img'), 'History escapes message HTML');
      check(document.querySelectorAll('.speech-history .speech-entry').length === 3, 'History initially shows one bounded page');
      document.querySelector('.speech-older').click();
      await new Promise((resolve) => setTimeout(resolve, 30));
      check(document.querySelectorAll('.speech-history .speech-entry').length === 6, 'Older messages load on demand');
      check(document.querySelector('.speech-history').textContent.includes('Hidden robot'), 'History includes hidden robot messages');
      window.__historyError = true;
      document.querySelector('.speech-older').click();
      await new Promise((resolve) => setTimeout(resolve, 30));
      check(document.querySelector('.speech-history-status').textContent.includes('Disk unavailable'), 'Pagination errors are visible');
      check(document.querySelectorAll('.speech-history .speech-entry').length === 6, 'Errors preserve already loaded messages');
      window.__historyError = false;
      document.querySelector('.speech-older').click();
      await new Promise((resolve) => setTimeout(resolve, 30));
      check(document.querySelector('.speech-older').hidden, 'Pagination finishes and retry succeeds');
      document.querySelector('.dlg-actions .primary').click();
      await dialog;
      window.__spaces[0].el.style.display = '';
      await window.__say(window.__spaces[0], 'Timer check', 1);
      await new Promise((resolve) => setTimeout(resolve, 5600));
      check(document.querySelectorAll('.bubble:not(.fade)').length === 2 && document.querySelectorAll('.speaking').length === 2, 'Message and enlargement persist together');
      await window.__say(window.__spaces[0], 'Replacement', 1);
      await new Promise((resolve) => setTimeout(resolve, 850));
      check(document.querySelectorAll('.bubble:not(.fade)').length === 2 && document.querySelectorAll('.speaking').length === 2, 'Previous timers cannot clear a newer message');
      await new Promise((resolve) => setTimeout(resolve, 5600));
      check(!document.querySelector('.bubble') && !document.querySelector('.speaking'), 'Speech and enlargement are cleaned up together');
      return { records: window.__records.length, results: window.__results.length };
    })()`);
    assert.equal(result.results, 7);
    console.log('Speech UI: bubbles, history, localization, optional voice and failure reporting passed.');
  } catch (error) { console.error(error); status = 1; }
  finally { win?.destroy(); app.exit(status); }
});
