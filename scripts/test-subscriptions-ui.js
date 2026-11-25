// Run with: node scripts\test-subscriptions-ui.js
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { Subscriptions } = require('../main/subscriptions');

if (!process.versions.electron) {
  // Chromium holds its profile open until exit; the parent owns cleanup.
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'robotconsole-subscriptions-ui-'));
  try {
    const env = { ...process.env, ROBOTCONSOLE_SUBSCRIPT_TEST_TEMP: temp };
    delete env.ELECTRON_RUN_AS_NODE;
    const result = require('node:child_process').spawnSync(require('electron'), [__filename, ...process.argv.slice(2)], {
      env,
      stdio: 'inherit', timeout: 90000,
    });
    if (result.error) throw result.error;
    process.exitCode = result.status ?? 1;
  } finally {
    fs.rmSync(temp, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
} else {
const temp = process.env.ROBOTCONSOLE_SUBSCRIPT_TEST_TEMP;
if (!temp) throw new Error('Run this test with Node so its parent can clean up the Chromium profile.');
app.setPath('userData', path.join(temp, 'profile'));
const sessionData = path.join(temp, 'session');
fs.mkdirSync(sessionData, { recursive: true });
app.setPath('sessionData', sessionData);
app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  let win;
  let exitCode = 0;
  try {
    // Verify SDK subprocess hosting under Electron, without any inference calls.
    const service = new Subscriptions({ userData: temp });
    if (process.argv.includes('--live')) {
      const providers = await service.read(true);
      for (const p of providers) console.log(`Electron ${p.id}: ${p.status}, ${p.quotas.length} quotas`);
      if (providers.some((p) => p.id !== 'claude' && p.status !== 'ok')) throw new Error('Live Electron quota lookup failed');
    }
    const renderer = path.join(__dirname, '..', 'renderer');
    const fixture = path.join(temp, 'fixture.html');
    fs.writeFileSync(fixture, `<base href="${pathToFileURL(renderer + path.sep).href}">
      <link rel="stylesheet" href="styles.css"><link rel="stylesheet" href="tools.css">
      <link rel="stylesheet" href="subscriptions.css"><link rel="stylesheet" href="status-bar.css">
      <main id="spaces"></main><div id="pane" class="tab-pane active"></div>`);
    win = new BrowserWindow({ show: false, width: 1000, height: 700, webPreferences: { backgroundThrottling: false } });
    await win.loadFile(fixture);
    for (const file of ['ui.js', 'i18n-en.js', 'i18n.js', 'model-presets.js']) {
      await win.webContents.executeJavaScript(fs.readFileSync(path.join(renderer, file), 'utf8'));
    }
    await win.webContents.executeJavaScript(`
      I18n.setLang('fr');
      window.reads = 0; window.installs = 0; window.failRead = false;
      window.providers = [
        {id:'copilot',name:'GitHub Copilot',status:'ok',source:'SDK',updatedAt:null,quotas:[
          {id:'premium',label:'Premium',usedPercent:25,resetAt:'2026-12-01T00:00:00Z'},
          {id:'chat',label:'Chat',unlimited:true,usedPercent:null},
          {id:'unknown',label:'Unknown',usedPercent:null,used:null,limit:null}
        ]},
        {id:'codex',name:'<img src=x onerror=alert(1)>',status:'error',source:'RPC',updatedAt:null,message:'<b>Error</b>',quotas:[]},
        {id:'claude',name:'Claude',status:'unavailable',source:'statusLine',updatedAt:null,message:'Activate',command:'node connector',quotas:[]}
      ];
      window.api = {
        subscriptionsRead: async () => { reads++; if(failRead) throw new Error('Read failed'); return providers; },
        subscriptionsClaudeInstall: async () => { installs++; return {message:'Enabled'}; },
        writeClipboard: () => {}
      };
      void 0;
    `);
    await win.webContents.executeJavaScript(fs.readFileSync(path.join(renderer, 'model-usage.js'), 'utf8'));
    await win.webContents.executeJavaScript(fs.readFileSync(path.join(renderer, 'status-bar.js'), 'utf8'));
    const result = await win.webContents.executeJavaScript(`(async () => {
      const assert = (value, message) => { if (!value) throw new Error(message); };
      const tick = () => new Promise(resolve => setTimeout(resolve, 20));
      const tab = window.tab = {pane:document.querySelector('#pane')};
      const kind = ModelUsage;
      kind.mount(tab, {});
      await tick();
      assert(document.querySelectorAll('.subscription-card').length === 3, 'All provider cards render');
      assert(!document.querySelector('img'), 'Provider names are safely escaped');
      assert(document.querySelectorAll('progress').length === 1 && document.querySelector('progress').value === 25, 'Only known bounded quotas show progress');
      assert(document.body.textContent.includes('Illimité') && document.body.textContent.includes('Consommation non communiquée'), 'Unlimited and missing data are distinct');
      assert(Object.keys(kind.serialize(tab)).length === 0, 'No account data or credentials are serialized');
      assert(!ModelPresets.tab.some(m => m.kind === 'subscriptions'), 'Model usage is no longer offered as a tab preset');
      assert(!window.TabKinds?.subscriptions, 'Model usage does not register a tab kind');
      const install = [...document.querySelectorAll('button')].find(b => b.textContent === 'Activer le connecteur Claude');
      install.click();
      await tick();
      assert(installs === 0, 'Claude settings are not changed without confirmation');
      [...document.querySelectorAll('.dlg-actions button')].find(b => b.textContent === 'Annuler').click();
      await tick();
      assert(installs === 0, 'Cancelling preserves Claude settings');
      install.click();
      await tick();
      [...document.querySelectorAll('.dlg-actions button')].find(b => b.textContent === 'Activer').click();
      await tick();
      assert(installs === 1, 'Explicit confirmation activates Claude connector');
      const before = reads;
      document.querySelector('.tool-bar button').click();
      await tick();
      assert(reads === before + 1, 'Refresh button reads connectors again');
      const remote = kind.remoteSnapshot(tab);
      assert(remote.sections.length === 3 && !JSON.stringify(remote).includes('node connector'), 'Remote summary does not expose installation commands');
      failRead = true;
      assert((await kind.remoteAction(tab, 'refresh')).error, 'Remote refresh errors are not reported as success');
      failRead = false;
      I18n.setLang('en');
      await tick();
      assert(document.body.textContent.includes('Model usage') && document.body.textContent.includes('Unlimited'), 'New labels translate');
      let resolve;
      api.subscriptionsRead = () => new Promise(r => resolve = r);
      kind.activate(tab);
      kind.dispose(tab);
      resolve([]);
      await tick();
      assert(document.querySelectorAll('.subscription-card').length === 3, 'Disposed tab ignores pending results');
      tab.pane.remove();
      I18n.setLang('fr');
      api.subscriptionsRead = async () => { reads++; return providers; };
      document.body.insertAdjacentHTML('beforeend', '<footer id="status-bar"><button id="status-sessions"></button><button id="status-usage"></button></footer><section id="status-panel" hidden></section>');
      const terminal = { ptyId: 'local', title: '<script>terminal</script>', space: { name: 'Robot' } };
      window.CAI = { spaces: [{ tabs: [terminal] }], revealTerminal: (tab) => { window.revealed = tab; } };
      let sessions = [
        { id:'local', alive:true, attachedWindows:1, shellId:'pwsh', pid:123, started:Date.now(), scope:'term:local' },
        { id:'other', alive:true, attachedWindows:1, shellId:'bash', pid:124, started:Date.now(), scope:'term:other' },
        { id:'background', alive:true, attachedWindows:0, shellId:'pwsh', pid:125, started:Date.now(), scope:'term:other' },
        { id:'ended', alive:false, attachedWindows:0, shellId:'pwsh', pid:126, started:Date.now()-1000, ended:Date.now() },
      ];
      let failSessions = false, failStop = false;
      const stopped = [];
      api.listPtySessions = async () => { if (failSessions) throw new Error('Session list failed'); return sessions; };
      api.terminatePtySession = async (id) => {
        if (failStop) throw new Error('Stop failed');
        stopped.push(id); sessions = sessions.filter((s) => s.id !== id);
      };
      StatusBar.mount();
      await tick();
      assert(document.querySelector('#spaces').getBoundingClientRect().bottom <= document.querySelector('#status-bar').getBoundingClientRect().top + 1,
        'Workspace content does not overlap the status bar: ' + JSON.stringify({
          spaces: document.querySelector('#spaces').getBoundingClientRect().toJSON(),
          bar: document.querySelector('#status-bar').getBoundingClientRect().toJSON(),
        }));
      assert(document.querySelector('#status-sessions').textContent === 'Sessions : 3', 'Status bar counts running sessions only: ' + document.querySelector('#status-sessions').textContent);
      assert(document.querySelector('#status-usage').textContent.includes('25 %'), 'Usage summary shows quota consumption');
      assert(!document.querySelector('#status-usage img'), 'Compact usage safely renders provider names');
      document.querySelector('#status-sessions').click();
      await tick();
      assert(!document.querySelector('#status-panel').hidden && document.querySelectorAll('.session-row').length === 4, 'Session panel lists every scope and ended session');
      assert(document.querySelector('#status-panel').textContent.includes('Liée à une autre fenêtre') && document.querySelector('#status-panel').textContent.includes('En arrière-plan'), 'Session attachment status is explicit');
      assert(!document.querySelector('.session-row script'), 'Terminal labels are text, not markup');
      document.querySelector('[data-session="local"] button').click();
      assert(revealed === terminal && document.querySelector('#status-panel').hidden, 'Show reveals the correct terminal and closes the panel');
      StatusBar.open('sessions');
      await tick();
      document.querySelector('[data-session="other"] button').click();
      await tick();
      assert(stopped.length === 0, 'Stopping always requires confirmation');
      [...document.querySelectorAll('.dlg-actions button')].find((b) => b.textContent === 'Annuler').click();
      await tick();
      assert(stopped.length === 0, 'Cancelling never kills a session');
      document.querySelector('[data-session="other"] button').click();
      await tick();
      [...document.querySelectorAll('.dlg-actions button')].find((b) => b.textContent === 'Arrêter').click();
      await tick();
      assert(stopped.join() === 'other' && !document.querySelector('[data-session="other"]'), 'Confirmed stop targets one session and reloads the list');
      assert(document.querySelector('#status-sessions').textContent === 'Sessions : 2', 'Session badge updates after termination');
      failStop = true;
      document.querySelector('[data-session="background"] button').click();
      await tick();
      [...document.querySelectorAll('.dlg-actions button')].find((b) => b.textContent === 'Arrêter').click();
      await tick();
      assert(document.body.textContent.includes('Stop failed') && !document.querySelector('[data-session="background"] button').disabled, 'Stop errors are visible and retryable');
      failStop = false;
      document.querySelector('[data-session="ended"] button').click();
      await tick();
      [...document.querySelectorAll('.dlg-actions button')].find((b) => b.textContent === 'Retirer').click();
      await tick();
      assert(stopped.join() === 'other,ended', 'Ended histories can be explicitly removed');
      failSessions = true;
      document.querySelector('.status-sessions-pane .tool-bar button').click();
      await tick();
      assert(document.querySelector('#status-sessions').textContent.includes('erreur') && document.querySelector('.sessions-list').textContent.includes('Session list failed'), 'List failures never appear as an empty successful list');
      document.querySelector('#status-usage').click();
      await tick();
      assert(document.querySelectorAll('.subscription-card').length === 3 && !document.querySelector('.status-usage-pane').hidden, 'Model usage details live in the status panel');
      document.querySelector('#status-panel').dispatchEvent(new KeyboardEvent('keydown', { key:'Escape', bubbles:true }));
      assert(document.querySelector('#status-panel').hidden && document.activeElement.id === 'status-usage', 'Escape closes the panel and restores keyboard focus');
      StatusBar.dispose();
      return 'Model usage and status bar: quotas, connectors, session list, confirmation, termination, errors and keyboard checks passed';
    })()`);
    console.log(result);
  } catch (e) {
    console.error(e.stack || e);
    exitCode = 1;
  } finally {
    if (win && !win.isDestroyed()) win.destroy();
    app.exit(exitCode);
  }
});
}
