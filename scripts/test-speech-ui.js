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
    await win.loadURL('data:text/html,<html><body><div id="crew" style="height:48px;align-items:center"><div id="crew-item" style="display:flex;align-items:center"><span id="crew-face">Crew</span></div></div><div id="zone" style="position:absolute;top:120px;left:20px"><span id="robot">Robot</span><div id="tabs" style="display:flex;margin-left:150px;width:400px"><span id="tab-one" style="width:150px">One</span><span id="tab-two" style="width:150px">Two</span></div></div></body></html>');
    await win.webContents.insertCSS(fs.readFileSync(path.join(__dirname, '..', 'renderer', 'styles.css'), 'utf8'));
    for (const file of ['ui.js', 'i18n-en.js', 'i18n.js']) {
      await win.webContents.executeJavaScript(fs.readFileSync(path.join(__dirname, '..', 'renderer', file), 'utf8'));
    }
    const appSource = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'app.js'), 'utf8');
    const speechCode = appSource.slice(appSource.indexOf('  function publishSpeech()'), appSource.indexOf('  function talk(space)'));
    const modelsSource = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'tab-models.js'), 'utf8');
    const iconCode = modelsSource.slice(modelsSource.indexOf('  function iconHtml('), modelsSource.indexOf('  // Spécification'));
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
        onRobotOpenFile: () => {},
        speechResult: (id, error) => { window.__results.push({ id, error }); }
      };
      const { h, esc } = UI;
      const ToolIcons = { get: () => null };
      ${iconCode}
      const TabModels = { iconHtml };
      const KIND_TEXT = { terminal: '>_' };
      const revealTab = (tab) => { window.__revealed = tab.ptyId; };
      const Settings = { data: { robotBubbles: true, robotVoice: false, robotVolume: 70 } };
      const ctx = { ws: { root: 'D:\\\\project' } };
      const spaces = [{
        rid: 'r1', name: 'One', tabs: [
          { id: 't1', title: 'Build', icon: '🧪', kind: 'terminal', ptyId: 'p1', cwd: 'D:\\\\project', el: document.getElementById('tab-one') },
          { id: 't2', title: 'Deploy', kind: 'terminal', ptyId: 'p2', cwd: 'D:\\\\project', el: document.getElementById('tab-two') }
        ],
        el: document.getElementById('zone'), tabsEl: document.getElementById('tabs'),
        robotEl: document.getElementById('robot'), crewFace: document.getElementById('crew-face'), crewEl: document.getElementById('crew-item')
      }];
      spaces[0].activeTab = spaces[0].tabs[1];
      ${speechCode}
      window.__settings = Settings; window.__spaces = spaces; window.__say = say;
      window.__history = speechHistory; window.__publish = publishSpeech;
      I18n.setLang('en');
    `);
    const result = await win.webContents.executeJavaScript(`(async () => {
      const check = (ok, message) => { if (!ok) throw new Error(message); };
      await window.__receive(1, 'r1', "C'est fait ✓", 'p1');
      await new Promise((resolve) => setTimeout(resolve, 240));
      check(document.querySelector('.bubble').textContent === "OneC'est fait ✓", 'CLI message is never translated and identifies its robot');
      check(document.querySelectorAll('.bubble:not([hidden])').length === 2, 'Message appears in both zone and robot bar');
      check(document.querySelectorAll('.speaking').length === 2, 'Both robots stay highlighted');
      check(window.__records[0].source === 'cli', 'CLI source is saved');
      check(window.__records[0].tab.title === 'Build' && window.__records[0].tab.icon === '🧪' && window.__records[0].tab.session === 'p1', 'Message records its originating tab rather than the active tab');
      check(window.__records[0].duration >= 6000, 'Speech remains visible for at least six seconds');
      check(!window.__results[0].error, 'Delivery acknowledged');
      check(window.__voices.length === 0, 'Voice is disabled by default');
      document.querySelectorAll('.bubble').forEach((bubble) => bubble.getAnimations().forEach((animation) => animation.finish()));
      const tab = document.getElementById('tab-one').getBoundingClientRect();
      const zoneBubble = document.querySelector('.bubble-zone').getBoundingClientRect();
      check(Math.abs(zoneBubble.left - tab.left - 2) < 1 && Math.abs(zoneBubble.top - tab.bottom - 8) < 1, 'Zone message is anchored below the originating inactive tab');
      const bar = document.getElementById('crew').getBoundingClientRect();
      const crewBubble = document.querySelector('.bubble-crew').getBoundingClientRect();
      check(document.querySelector('.bubble-crew').parentElement === document.body, 'Crew message floats outside the robot bar item');
      check(crewBubble.top >= bar.bottom + 8, 'Crew message is below and outside the robot bar');
      check(getComputedStyle(document.querySelector('.bubble-crew')).position === 'fixed' && getComputedStyle(document.querySelector('.bubble-crew')).overflow === 'visible', 'The floating bubble is not clipped by the robot bar and leaves its pointer visible');
      check(getComputedStyle(document.querySelector('.bubble-crew'), '::before').display !== 'none', 'Crew bubble retains its speech pointer');
      document.getElementById('tab-one').style.display = 'none';
      await new Promise((resolve) => setTimeout(resolve, 120));
      check(document.querySelector('.bubble-zone').hidden && !document.querySelector('.bubble-crew').hidden, 'A hidden originating tab leaves its robot bar message visible');
      document.getElementById('tab-one').style.display = '';
      await new Promise((resolve) => setTimeout(resolve, 120));
      check(!document.querySelector('.bubble-zone').hidden, 'The message returns when the originating tab is visible');
      check(getComputedStyle(document.querySelector('.bubble-crew')).pointerEvents !== 'none', 'Bubbles accept pointer clicks');
      document.querySelector('.bubble-crew').click();
      check(!document.querySelector('.bubble') && !document.querySelector('.speaking'), 'Clicking the crew bubble dismisses both displays and highlights');
      check(window.__records.length === 1, 'Dismissing a bubble preserves its history');
      await window.__say(window.__spaces[0], "C'est fait ✓");
      check(window.__records[1].text === 'Done ✓', 'Application messages use displayed language');
      check(document.querySelectorAll('.bubble').length === 2, 'A new message appears after dismissal');
      check(Math.abs(parseFloat(document.querySelector('.bubble-zone').style.left) - document.getElementById('tab-two').getBoundingClientRect().left - 2) < 1, 'Application messages use the active tab');
      const minis = document.createElement('div');
      minis.style.display = 'flex';
      const mini = document.createElement('button');
      mini.textContent = 'Mini';
      minis.appendChild(mini);
      document.getElementById('crew').appendChild(minis);
      window.__spaces[0].crewMini = mini;
      window.__spaces[0].crewEl.remove();
      await new Promise((resolve) => setTimeout(resolve, 120));
      check(document.querySelector('.bubble-crew').parentElement === document.body && !document.querySelector('.bubble-crew').hidden, 'Folding a screen preserves the floating bubble');
      check(Math.abs(parseFloat(document.querySelector('.bubble-crew').style.left) - mini.getBoundingClientRect().left - 2) < 1, 'The floating bubble follows the folded robot miniature');
      document.getElementById('crew').appendChild(window.__spaces[0].crewEl);
      await new Promise((resolve) => setTimeout(resolve, 120));
      check(Math.abs(parseFloat(document.querySelector('.bubble-crew').style.left) - window.__spaces[0].crewFace.getBoundingClientRect().left - 2) < 1, 'Unfolding reanchors the floating bubble to its robot');
      minis.remove();
      window.__spaces[0].crewMini = null;
      document.querySelector('.bubble-zone .bubble-name').click();
      check(!document.querySelector('.bubble') && !document.querySelector('.speaking'), 'Clicking the robot name inside the zone bubble also dismisses the message');
      check(window.__records.length === 2, 'Clicking the zone bubble preserves history');
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
      window.__records.push({ rid: 'r1', text: '<img src=x onerror="window.__unsafe=true">', source: 'cli',
        tab: { id: 'closed', session: 'closed-session', title: '<img src=x onerror="window.__unsafe=true">', icon: '<img src=x>' } });
      const dialog = window.__history(window.__spaces[0]);
      await new Promise((resolve) => setTimeout(resolve, 30));
      check(!document.querySelector('.speech-history img'), 'History escapes message HTML');
      check(document.querySelector('.speech-tab[disabled]').textContent.includes('<img'), 'Closed tab metadata is displayed safely without a clickable destination');
      check(document.querySelector('.speech-tab:not([disabled])').textContent.includes('Deploy'), 'History displays the originating tab title');
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
      window.__spaces[0].tabs[1].id = 'restored-t2';
      document.querySelector('.speech-tab:not([disabled]) span:last-child').click();
      await dialog;
      check(window.__revealed === 'p2' && !document.querySelector('.dlg-overlay'), 'Clicking a history tab resolves its session after restore and closes the dialog');
      window.__spaces[0].el.style.display = '';
      window.__spaces[0].activeTab = null;
      await window.__say(window.__spaces[0], 'Timer check', 1);
      check(Math.abs(parseFloat(document.querySelector('.bubble-zone').style.left) - document.getElementById('tabs').getBoundingClientRect().left - 2) < 1, 'Messages without a tab use the zone tab strip');
      window.__spaces[0].activeTab = window.__spaces[0].tabs[1];
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
