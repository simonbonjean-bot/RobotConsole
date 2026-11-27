if (!process.versions.electron) require('./electron-test')(__filename);
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');
const temp = process.env.ROBOTCONSOLE_TEST_TEMP;
if (!temp) throw new Error('Run with node scripts/test-shortcuts-ui.js');
const profile = path.join(temp, 'profile'), workspace = path.join(temp, 'Alpha'), other = path.join(temp, 'Beta');
for (const folder of [profile, path.join(workspace, '.robot'), path.join(other, '.robot'), path.join(temp, 'session')]) fs.mkdirSync(folder, { recursive: true });
fs.writeFileSync(path.join(profile, 'recent.json'), JSON.stringify([workspace, other]));
fs.writeFileSync(path.join(workspace, '.robot', 'state.json'), JSON.stringify({
  version: 3, active: 0, activeScreen: 0,
  screens: [{ name: 'First' }, { name: 'Second' }, { name: 'Empty' }],
  spaces: [
    { name: 'One', screen: 0, tabs: [{ kind: 'terminal', cwd: workspace }, { kind: 'terminal', cwd: workspace }] },
    { name: 'Other screen', screen: 1, tabs: [{ kind: 'terminal', cwd: workspace }] },
    { name: 'Parked', screen: 0, parked: true, tabs: [{ kind: 'terminal', cwd: workspace }] },
    { name: 'Two', screen: 0, tabs: [{ kind: 'terminal', cwd: workspace }] },
  ],
}));
process.env.ROBOTCONSOLE_USERDATA = profile;
process.env.ROBOTCONSOLE_NO_SPLASH = '1';
app.setPath('sessionData', path.join(temp, 'session'));
fs.writeFileSync(path.join(profile, 'settings.json'), JSON.stringify({ showSplash: false, language: 'fr', robotVoice: false }));
fs.writeFileSync(path.join(profile, 'windows.json'), JSON.stringify([{ ws: workspace, winId: 'main' }]));
const messages = [];
const PtyClient = require('../main/ptyclient');
PtyClient.prototype.send = async (message) => { messages.push(message); };
PtyClient.prototype.sessions = async () => [];
require('../main/subscriptions').Subscriptions.prototype.read = async () => [];
app.disableHardwareAcceleration();
require('../main');

app.whenReady().then(async () => {
  let status = 0;
  try {
    const win = BrowserWindow.getAllWindows()[0];
    win.webContents.setBackgroundThrottling(false);
    if (win.webContents.isLoading()) await new Promise((resolve) => win.webContents.once('did-finish-load', resolve));
    await win.webContents.executeJavaScript(`(async () => {
      window.check = (value, message) => { if (!value) throw new Error(message); };
      window.waitFor = async (check) => {
        const deadline = Date.now() + 8000;
        while (Date.now() < deadline) { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 25)); }
        throw new Error('Timed out: ' + check.toString());
      };
      window.key = (code, options = {}) => {
        const keys = { ArrowLeft: 'ArrowLeft', ArrowRight: 'ArrowRight', ArrowUp: 'ArrowUp', ArrowDown: 'ArrowDown', Escape: 'Escape', Tab: 'Tab' };
        document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { code, key: keys[code] || code.replace('Key', ''), bubbles: true, cancelable: true, ...options }));
      };
      await waitFor(() => CAI.activeSpace?.activeTab?.term && !document.querySelector('#boot'));
      window.source = CAI.activeSpace;
      window.firstTab = source.activeTab;
      key('ArrowRight', { ctrlKey: true, altKey: true });
      check(CAI.activeSpace === source && source.activeTab !== firstTab, 'Tab shortcut left current zone');
      key('ArrowLeft', { ctrlKey: true, altKey: true });
      check(source.activeTab === firstTab, 'Previous tab failed');
      key('ArrowLeft', { ctrlKey: true, shiftKey: true });
      check(CAI.activeSpace.name === 'Two' && CAI.currentScreen.name === 'First', 'Zones did not wrap inside current screen');
      key('ArrowRight', { ctrlKey: true, shiftKey: true });
      check(CAI.activeSpace === source && CAI.spaces.find(s => s.name === 'Parked').parked, 'Navigation unparked or crossed screens');
      key('ArrowRight', { ctrlKey: true, shiftKey: true, altKey: true });
      check(CAI.currentScreen.name === 'Second', 'Next screen failed');
      key('ArrowRight', { ctrlKey: true, shiftKey: true, altKey: true });
      check(CAI.currentScreen.name === 'Empty' && !CAI.activeSpace, 'Empty screen navigation failed');
      key('ArrowRight', { ctrlKey: true, shiftKey: true });
      check(!CAI.activeSpace && CAI.currentScreen.name === 'Empty', 'Empty screen selected foreign zone');
      key('ArrowRight', { ctrlKey: true, shiftKey: true, altKey: true });
      check(CAI.currentScreen.name === 'First', 'Screen wrap failed');
      Settings.open('shortcuts');
      check(document.querySelector('[role="tab"][aria-selected="true"]').dataset.tab === 'shortcuts', 'Shortcut deep link failed');
      check(document.querySelectorAll('.settings-panel:not([hidden])').length === 1, 'Multiple settings panels visible');
      for (const tab of document.querySelectorAll('.settings-tab')) {
        check(tab.querySelector('.settings-tab-icon')?.getAttribute('aria-hidden') === 'true' &&
          tab.querySelector('.settings-tab-label')?.textContent.trim(), 'Settings tab lost its label or exposes a decorative icon');
      }
      document.querySelector('#settings-tab-appearance .settings-tab-icon').click();
      check(document.querySelector('.settings-panel:not([hidden])').id === 'settings-panel-appearance', 'Clicking a settings icon did not select its tab');
      Settings.open('prompt-ai');
      check(document.querySelector('[role="tab"][aria-selected="true"]').dataset.tab === 'prompt-ai', 'Prompt AI deep link failed');
      check(document.querySelectorAll('.settings-panel:not([hidden])').length === 1, 'Prompt AI tab left other categories visible');
      const aiPanel = document.querySelector('#settings-panel-prompt-ai');
      await waitFor(() => aiPanel.querySelector('.prompt-assistant-config').getAttribute('aria-busy') === 'false');
      const aiField = name => aiPanel.querySelector('[data-prompt-field="' + name + '"]');
      check(aiField('apiKey').type === 'password' && aiField('apiKey').value === '', 'Settings exposed an API key');
      aiField('provider').value = 'api';
      aiField('model').value = 'test-model';
      aiField('instructions').value = '';
      aiPanel.querySelector('.prompt-save-assistant').click();
      await waitFor(() => aiPanel.querySelector('.prompt-error').textContent.includes('instructions IA'));
      aiField('instructions').value = 'Instructions partagées du prompt injecteur';
      aiPanel.querySelector('.prompt-save-assistant').click();
      await waitFor(() => aiPanel.querySelector('.prompt-assistant-config-status').textContent === 'Configuration IA enregistrée');
      const savedAI = await api.promptAssistantSettings();
      check(savedAI.provider === 'api' && savedAI.model === 'test-model' && savedAI.instructions === aiField('instructions').value, 'Prompt AI settings did not persist');
      check(!Object.hasOwn(Settings.data, 'apiKey') && !Object.hasOwn(Settings.data, 'encryptedKey'), 'AI credentials leaked into general settings');
      Settings.close();
      Settings.open('prompt-ai');
      await waitFor(() => document.querySelector('#set-prompt-ai .prompt-assistant-config').getAttribute('aria-busy') === 'false');
      check(document.querySelector('#set-prompt-ai [data-prompt-field="model"]').value === 'test-model', 'Reopening settings lost AI configuration');
      Settings.close();
      CAI.activateTab(firstTab, true);
      PromptEditor.open(firstTab);
      await waitFor(() => firstTab.pane.querySelector('.prompt-card').getAttribute('aria-busy') === 'false');
      check(firstTab.pane.querySelector('[data-prompt-field="instructions"]').value === savedAI.instructions, 'Prompt editor does not share settings configuration');
      firstTab.pane.querySelector('.prompt-open-settings').click();
      await waitFor(() => Settings.isOpen);
      check(document.querySelector('[role="tab"][aria-selected="true"]').dataset.tab === 'prompt-ai', 'Prompt editor link did not open AI settings');
      Settings.close();
      PromptEditor.closeFor(firstTab);
      Settings.open('shortcuts');
      const edit = document.querySelector('[data-action="tabNext"]');
      edit.click();
      key('ArrowLeft', { ctrlKey: true, shiftKey: true });
      check(edit.dataset.recording && document.querySelector('.shortcut-status').textContent.includes('Déjà utilisé'), 'Conflict was not reported');
      check(CAI.activeSpace.name === 'One', 'Recording shortcut navigated the app');
      key('Escape');
      check(Settings.isOpen && !edit.dataset.recording, 'Escape did not cancel recording only');
      edit.click(); key('KeyJ', { ctrlKey: true });
      check(Settings.data.shortcuts.tabNext[0] === 'Ctrl+KeyJ', 'Binding did not save');
      check(document.querySelector('[data-global-shortcut="tabNext"]').textContent.includes('Ctrl+J'), 'Help did not update');
      key('KeyJ', { ctrlKey: true });
      check(source.activeTab === firstTab, 'Shortcut ran inside settings');
      document.querySelector('[data-tab="appearance"]').click();
      document.querySelector('[data-tab="appearance"]').focus();
      check(document.querySelector('.settings-panel:not([hidden])').id === 'settings-panel-appearance', 'Appearance tab failed');
      key('ArrowRight');
      check(document.querySelector('[aria-selected="true"]').dataset.tab === 'terminal', 'Keyboard settings tabs failed');
      Settings.open('robots');
      check(!document.querySelector('#set-robots').closest('.settings-panel').hidden, 'Robots deep link hidden');
      Settings.open('favorites');
      check(!document.querySelector('#set-favorites').closest('.settings-panel').hidden, 'Favorites deep link hidden');
      Settings.open('shortcuts');
      document.querySelector('.settings-head .tb-btn').click();
      check(document.querySelectorAll('.settings-panel:not([hidden])').length === 1 && document.querySelector('.settings-panel:not([hidden])').id === 'settings-panel-shortcuts', 'Reset lost settings category');
      check(document.querySelector('#settings-panel-robots #set-robots') && document.querySelector('#settings-panel-explorer #set-favorites'), 'Reset misplaced grouped sections');
      const again = document.querySelector('[data-action="tabNext"]');
      again.closest('.shortcut-controls').children[1].click();
      check(Settings.data.shortcuts.tabNext.length === 0, 'Disabling shortcut failed');
      Settings.set({ shortcuts: { ...Settings.data.shortcuts, tabPrevious: ['Ctrl+Alt+ArrowRight'] } });
      again.closest('.shortcut-controls').children[2].click();
      check(Settings.data.shortcuts.tabNext.length === 0 && document.querySelector('.shortcut-status').textContent.includes('Déjà utilisé'), 'Restoring default accepted conflicting shortcut');
      Settings.set({ shortcuts: { tabNext: [] } });
      again.closest('.shortcut-controls').children[2].click();
      check(!Object.hasOwn(Settings.data.shortcuts, 'tabNext'), 'Individual reset failed');
      again.click(); key('KeyJ', { ctrlKey: true });
      await waitFor(async () => (await api.loadSettings()).shortcuts?.tabNext?.[0] === 'Ctrl+KeyJ');
      Settings.close();
      CAI.activateTab(firstTab, true);
      key('ArrowRight', { ctrlKey: true, altKey: true });
      check(source.activeTab === firstTab, 'Old default still active after remapping');
      key('KeyJ', { ctrlKey: true });
      check(source.activeTab !== firstTab, 'New shortcut failed');
      await Settings.load();
      check(Settings.data.shortcuts.tabNext[0] === 'Ctrl+KeyJ', 'Binding was not persistent');
      CAI.activateTab(firstTab, true);
    })()`);
    const before = messages.filter((message) => message.t === 'write').length;
    win.focus(); win.webContents.focus();
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'J', modifiers: ['control'] });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'J', modifiers: ['control'] });
    await win.webContents.executeJavaScript('waitFor(() => source.activeTab !== firstTab)');
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Left', modifiers: ['control', 'alt'] });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Left', modifiers: ['control', 'alt'] });
    await win.webContents.executeJavaScript('waitFor(() => source.activeTab === firstTab)');
    assert.equal(messages.filter((message) => message.t === 'write').length, before, 'Shortcut leaked to PTY');
    await win.webContents.executeJavaScript(`(async () => {
      CAI.openKind(source, 'browser');
      await waitFor(() => CAI.activeSpace.activeTab?.browser);
      window.browserTab = source.activeTab;
      await waitFor(() => !browserTab.pane.querySelectorAll('.icon-btn')[2].disabled);
    })()`);
    const guestId = await win.webContents.executeJavaScript('browserTab.browser.getWebContentsId()');
    const guest = require('electron').webContents.fromId(guestId);
    guest.focus();
    guest.sendInputEvent({ type: 'keyDown', keyCode: 'J', modifiers: ['control'] });
    guest.sendInputEvent({ type: 'keyUp', keyCode: 'J', modifiers: ['control'] });
    await win.webContents.executeJavaScript('waitFor(() => source.activeTab !== browserTab)');
    await win.webContents.executeJavaScript(`key('ArrowDown', { ctrlKey: true, altKey: true })`);
    const deadline = Date.now() + 8000;
    while (BrowserWindow.getAllWindows().length < 2 && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 25));
    assert.equal(BrowserWindow.getAllWindows().length, 2, 'Workspace navigation did not open destination');
    const destination = BrowserWindow.getAllWindows().find((candidate) => candidate !== win);
    if (destination.webContents.isLoading()) await new Promise((resolve) => destination.webContents.once('did-finish-load', resolve));
    await destination.webContents.executeJavaScript(`(async () => {
      const deadline = Date.now() + 8000;
      while (!window.CAI?.ws && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 25));
      if (CAI.ws.name !== 'Beta') throw new Error('Wrong workspace destination');
      Settings.open('robots');
      api.navigateWorkspace(-1);
    })()`);
    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.equal(BrowserWindow.getAllWindows().length, 2, 'Returning to workspace duplicated its window');
    assert.equal(await win.webContents.executeJavaScript('source.tabs.includes(firstTab)'), true, 'Workspace navigation discarded source session');
    await win.webContents.executeJavaScript(`Settings.set({ shortcuts: { tabNext: ['Ctrl+KeyK'] } })`);
    await destination.webContents.executeJavaScript(`(async () => {
      const deadline = Date.now() + 8000;
      while (Settings.data.shortcuts.tabNext?.[0] !== 'Ctrl+KeyK' && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 25));
      if (Settings.data.shortcuts.tabNext?.[0] !== 'Ctrl+KeyK') throw new Error('Shortcuts did not synchronize between workspace windows');
      if (document.querySelector('[role="tab"][aria-selected="true"]').dataset.tab !== 'robots') throw new Error('Shortcut synchronization changed settings category');
      Settings.close();
    })()`);
    console.log('Shortcuts UI: navigation, scoped zones, settings tabs, recording, conflicts, persistence, PTY, browser and workspaces passed');
  } catch (error) {
    console.error(error); status = 1;
  } finally {
    for (const win of BrowserWindow.getAllWindows()) if (!win.isDestroyed()) win.destroy();
    app.exit(status);
  }
});
