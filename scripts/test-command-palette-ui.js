if (!process.versions.electron) require('./electron-test')(__filename);
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');
const temp = process.env.ROBOTCONSOLE_TEST_TEMP;
if (!temp) throw new Error('Run with node scripts/test-command-palette-ui.js');
const profile = path.join(temp, 'profile'), workspace = path.join(temp, 'Project'), other = path.join(temp, 'Other');
for (const folder of [profile, path.join(workspace, '.robot'), path.join(other, '.robot'), path.join(temp, 'session')]) fs.mkdirSync(folder, { recursive: true });
fs.writeFileSync(path.join(workspace, 'palette-target.txt'), 'Current workspace file');
fs.writeFileSync(path.join(other, 'elsewhere.txt'), 'Another workspace file');
fs.writeFileSync(path.join(profile, 'recent.json'), JSON.stringify([workspace, other]));
fs.writeFileSync(path.join(workspace, '.robot', 'state.json'), JSON.stringify({
  version: 3, active: 0, activeScreen: 0,
  screens: [{ name: 'Development' }, { name: 'Destination' }],
  spaces: [
    { name: 'Source robot', screen: 0, tabs: [{ kind: 'terminal', cwd: workspace }] },
    { name: 'Parked robot', screen: 0, parked: true, tabs: [{ kind: 'terminal', cwd: workspace }] },
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
      window.paletteAssert = (value, message) => { if (!value) throw new Error(message); };
      window.paletteNotices = [];
      const toast = UI.toast;
      UI.toast = (message, options) => { paletteNotices.push(message); return toast(message, options); };
      window.paletteWait = async (check) => {
        const deadline = Date.now() + 7000;
        while (Date.now() < deadline) { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 25)); }
        throw new Error('Palette UI timed out: ' + check.toString() + ' | ' + JSON.stringify({
          screen: CAI.currentScreen.name, active: CAI.activeSpace?.name,
          tabs: CAI.spaces.map(space => ({ name: space.name, screen: space.screenId, tabs: space.tabs.map(tab => tab.title) })),
          notices: paletteNotices.concat([...document.querySelectorAll('.palette-status')].map(node => node.textContent)),
        }));
      };
      await paletteWait(() => CAI.activeSpace?.activeTab?.term && !document.querySelector('#boot'));
      window.paletteSource = CAI.activeSpace;
      window.paletteTerminal = paletteSource.activeTab;
      window.paletteKey = (key) => document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
      window.paletteFind = (value) => {
        const input = document.querySelector('.palette-input');
        input.value = value; input.dispatchEvent(new Event('input', { bubbles: true }));
      };
      window.paletteOpen = () => {
        if (CommandPalette.isOpen) CommandPalette.close(false);
        CommandPalette.toggle();
        paletteAssert(CommandPalette.isOpen, 'Palette did not open');
      };
      window.palettePick = async (label) => {
        const row = [...document.querySelectorAll('.palette-row')].find(row => row.querySelector('.palette-label').textContent === label);
        paletteAssert(row, 'Missing palette item: ' + label);
        row.click();
        await new Promise(resolve => setTimeout(resolve, 30));
      };
    })()`);
    const writesBefore = messages.filter((message) => message.t === 'write').length;
    win.focus();
    win.webContents.focus();
    await new Promise((resolve) => setTimeout(resolve, 100));
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Space', modifiers: ['control', 'shift'] });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Space', modifiers: ['control', 'shift'] });
    await win.webContents.executeJavaScript(`(async () => {
      await paletteWait(() => CommandPalette.isOpen);
      const card = document.querySelector('.command-palette').getBoundingClientRect();
      const pane = paletteTerminal.pane.getBoundingClientRect();
      paletteAssert(Math.abs((card.left + card.right - pane.left - pane.right) / 2) < 2, 'Palette is not horizontally centered in its tab');
      paletteAssert(Math.abs((card.top + card.bottom - pane.top - pane.bottom) / 2) < 2, 'Palette is not vertically centered in its tab');
      paletteAssert(document.activeElement.classList.contains('palette-input'), 'Search field did not receive focus');
      paletteKey('ArrowDown');
      paletteAssert(document.querySelector('[aria-selected="true"] .palette-label').textContent === 'Déplacer l’onglet actif', 'ArrowDown selection failed');
      paletteKey('ArrowUp'); paletteKey('Enter');
      await paletteWait(() => document.querySelectorAll('.palette-crumb').length === 2);
      paletteAssert(document.querySelector('.palette-row .palette-category').textContent === 'Type d’onglet', 'Action types are not distinguished');
      paletteKey('ArrowLeft');
      paletteAssert(document.querySelectorAll('.palette-crumb').length === 1, 'Back did not restore root');
      paletteKey('Escape');
      paletteAssert(!CommandPalette.isOpen, 'Escape did not close');
      paletteAssert(paletteTerminal.term.element.contains(document.activeElement), 'Escape did not restore terminal focus');
    })()`);
    assert.equal(messages.filter((message) => message.t === 'write').length, writesBefore, 'Shortcut wrote data to the PTY');
    await win.webContents.executeJavaScript(`(async () => {
      paletteOpen();
      await palettePick('Changer de zone');
      paletteAssert(document.querySelector('.palette-zone .palette-icon svg'), 'Zone did not render its real robot');
      await palettePick('Parked robot');
      await paletteWait(() => CAI.activeSpace.name === 'Parked robot');
      paletteAssert(!CAI.activeSpace.parked, 'Navigation did not unpark destination');
      CAI.revealTab(paletteTerminal); await paletteWait(() => CAI.activeSpace === paletteSource && paletteTerminal.term.element.contains(document.activeElement));
      paletteTerminal.icon = '🚀';
      paletteOpen(); await palettePick('Changer d’onglet');
      paletteAssert(document.querySelector('.palette-icon').textContent.includes('🚀'), 'Customized tab emoji was not used');
      CommandPalette.close();
      paletteOpen(); await palettePick('Déplacer l’onglet actif'); await palettePick('Vers un écran'); await palettePick('Destination');
      const pty = paletteTerminal.ptyId;
      await palettePick('Nouvelle zone dans cet écran');
      await paletteWait(() => CAI.currentScreen.name === 'Destination' && CAI.activeSpace.activeTab === paletteTerminal);
      paletteAssert(paletteTerminal.ptyId === pty && paletteTerminal.space !== paletteSource, 'Move recreated terminal or used source zone');
      paletteAssert(!paletteSource.tabs.includes(paletteTerminal), 'Source still contains moved terminal');
      await paletteWait(async () => (await api.loadState()).spaces.some(space => space.screen === 1 && space.tabs.some(tab => tab.sessionId === pty)));
      window.paletteDestination = CAI.activeSpace;
      paletteOpen(); await palettePick('Rechercher un fichier'); paletteFind('palette-target');
      await paletteWait(() => document.querySelector('.palette-row .palette-label')?.textContent === 'palette-target.txt');
      paletteKey('Enter');
      await paletteWait(() => CAI.activeSpace.activeTab?.kind === 'editor' && CAI.activeSpace.activeTab.ctl);
      window.paletteEditorTab = CAI.activeSpace.activeTab;
      paletteAssert(CAI.activeSpace === paletteDestination, 'File did not open in original destination');
      paletteOpen(); await palettePick('Rechercher dans un autre workspace'); await palettePick('Other'); paletteFind('elsewhere');
      await paletteWait(() => document.querySelector('.palette-row .palette-label')?.textContent === 'elsewhere.txt');
      paletteKey('Enter');
      await paletteWait(() => CAI.activeSpace.activeTab?.file?.endsWith('elsewhere.txt'));
      paletteAssert(CAI.activeSpace === paletteDestination && CAI.ws.name === 'Project', 'External file changed zone or workspace');
      paletteOpen(); await palettePick('Rechercher un fichier'); paletteFind('palette-target');
      await paletteWait(() => document.querySelector('.palette-row .palette-label')?.textContent === 'palette-target.txt');
      paletteKey('Enter'); await paletteWait(() => CAI.activeSpace.activeTab === paletteEditorTab);
      paletteAssert(CAI.spaces.flatMap(space => space.tabs).filter(tab => tab.file === paletteEditorTab.file).length === 1, 'Existing editor file was duplicated');
      const controller = paletteEditorTab.ctl;
      controller.editor.getModel().setValue('Unsaved palette edits');
      paletteOpen(); await palettePick('Déplacer l’onglet actif'); await palettePick('Vers une zone'); await palettePick('Source robot');
      await paletteWait(() => CAI.activeSpace === paletteSource && CAI.activeSpace.activeTab === paletteEditorTab);
      paletteAssert(paletteEditorTab.ctl === controller && controller.dirty && controller.editor.getValue() === 'Unsaved palette edits', 'Editor move discarded its live controller or unsaved edits');
      paletteOpen(); CAI.revealSpace(paletteSource);
      CAI.revealSpace(paletteDestination); await paletteWait(() => !CommandPalette.isOpen);
      CAI.revealTab(paletteTerminal);
      await paletteWait(() => CAI.activeSpace.activeTab === paletteTerminal);
      paletteOpen(); await palettePick('Ouvrir un onglet'); await palettePick('Navigateur');
      await paletteWait(() => CAI.activeSpace.activeTab?.kind === 'browser' && CAI.activeSpace.activeTab.browser);
      window.paletteBrowserTab = CAI.activeSpace.activeTab;
      await paletteWait(() => !paletteBrowserTab.pane.querySelectorAll('.icon-btn')[2].disabled);
    })()`);
    const guestId = await win.webContents.executeJavaScript('paletteBrowserTab.browser.getWebContentsId()');
    const guest = require('electron').webContents.fromId(guestId);
    guest.focus();
    guest.sendInputEvent({ type: 'keyDown', keyCode: 'Space', modifiers: ['control', 'shift'] });
    guest.sendInputEvent({ type: 'keyUp', keyCode: 'Space', modifiers: ['control', 'shift'] });
    await win.webContents.executeJavaScript(`(async () => {
      await paletteWait(() => CommandPalette.isOpen);
      paletteKey('Escape');
      CAI.revealTab(paletteEditorTab); await paletteWait(() => CAI.activeSpace.activeTab === paletteEditorTab);
      paletteEditorTab.ctl.editor.focus();
    })()`);
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Space', modifiers: ['control', 'shift'] });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Space', modifiers: ['control', 'shift'] });
    await win.webContents.executeJavaScript(`(async () => {
      await paletteWait(() => CommandPalette.isOpen);
      paletteAssert(document.activeElement.classList.contains('palette-input'), 'Monaco retained shortcut focus');
      paletteKey('Escape');
      CAI.revealTab(paletteTerminal); await paletteWait(() => CAI.activeSpace.activeTab === paletteTerminal);
      PromptEditor.open(paletteTerminal);
      await paletteWait(() => document.querySelector('.prompt-overlay'));
      paletteOpen();
      paletteAssert(CommandPalette.isOpen, 'Palette does not coexist with prompt editor');
      paletteKey('Escape');
      PromptEditor.closeFor(paletteTerminal);
      paletteOpen(); await palettePick('Ouvrir un onglet');
      paletteFind('Terminal');
      const input = document.querySelector('.palette-input');
      input.setSelectionRange(2, 2); paletteKey('ArrowRight');
      paletteAssert(CommandPalette.isOpen && document.querySelectorAll('.palette-crumb').length === 2, 'Right arrow inside query unexpectedly executed an action');
      paletteFind(''); paletteKey('ArrowLeft');
      paletteAssert(document.querySelectorAll('.palette-crumb').length === 1, 'Empty-query left arrow did not return');
      paletteKey('Escape');

      const zoneCount = CAI.spaces.length, screenCount = CAI.screens.length;
      const originalScreen = CAI.currentScreen.id, originalSpace = CAI.activeSpace;
      paletteOpen(); await palettePick('Changer de zone');
      paletteFind('Nouvelle zone');
      paletteAssert(CAI.spaces.length === zoneCount, 'Browsing zone creation created a zone prematurely');
      paletteKey('Escape');
      paletteAssert(CAI.spaces.length === zoneCount, 'Canceling zone creation changed the layout');
      paletteOpen(); await palettePick('Changer de zone'); paletteFind('Nouvelle zone'); paletteKey('Enter');
      await paletteWait(() => CAI.spaces.length === zoneCount + 1 && CAI.activeSpace !== originalSpace);
      paletteAssert(CAI.activeSpace.screenId === originalScreen && !CAI.activeSpace.tabs.length, 'New zone was not empty and selected in the original screen');
      paletteAssert(originalSpace.tabs.includes(paletteTerminal), 'Creating a zone moved the original tab');
      paletteOpen(); await palettePick('Changer d’écran'); paletteFind('Nouvel écran');
      paletteAssert(CAI.screens.length === screenCount, 'Browsing screen creation created a screen prematurely');
      paletteKey('Escape');
      paletteOpen(); await palettePick('Changer d’écran'); paletteFind('Nouvel écran'); paletteKey('Enter');
      await paletteWait(() => CAI.screens.length === screenCount + 1 && CAI.currentScreen.id !== originalScreen);
      paletteAssert(!CAI.activeSpace && !CAI.spaces.some(space => space.screenId === CAI.currentScreen.id), 'New screen was not empty and selected');
      const createdScreen = CAI.currentScreen;
      paletteOpen(); await palettePick('Changer de zone'); paletteFind('Nouvelle zone'); paletteKey('Enter');
      await paletteWait(() => CAI.activeSpace?.screenId === createdScreen.id);
      await paletteWait(async () => {
        const saved = await api.loadState();
        return saved.screens.length === screenCount + 1 && saved.screens[saved.activeScreen].name === createdScreen.name &&
          saved.spaces.some(space => space.screen === saved.activeScreen && !space.tabs.length);
      });
    })()`);
    console.log('Command palette UI: centering, keyboard, robots, icons, move, files, Monaco, browser and prompt checks passed');
  } catch (error) {
    console.error(error); status = 1;
  } finally {
    BrowserWindow.getAllWindows().forEach((win) => win.destroy());
    app.exit(status);
  }
});
