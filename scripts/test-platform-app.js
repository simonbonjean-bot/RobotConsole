if (!process.versions.electron) require('./electron-test')(__filename);
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow, dialog, Menu } = require('electron');
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
let promptSessions = false;
const PtyClient = require('../main/ptyclient');
PtyClient.prototype.send = async (message) => { messages.push(message); };
PtyClient.prototype.sessions = async () => promptSessions
  ? messages.filter((message) => message.t === 'create').map((message) => ({ id: message.id, alive: true }))
  : [];
require('../main/subscriptions').Subscriptions.prototype.read = async () => [
  { id: 'copilot', name: 'GitHub Copilot', status: 'ok', quotas: [{ label: 'Premium', usedPercent: 25 }], source: 'test' },
];
require('../main/prompt-assistant').PromptAssistant.prototype.improve = async (text) => {
  assert.equal(text, 'Un objectif\nDes contraintes');
  return 'Objectif précis\n\nContraintes explicites';
};
app.disableHardwareAcceleration();
require('../main');

app.whenReady().then(async () => {
  let status = 0;
  try {
    const win = BrowserWindow.getAllWindows()[0];
    assert.ok(win);
    win.webContents.setBackgroundThrottling(false);
    if (win.webContents.isLoading()) await new Promise((resolve) => win.webContents.once('did-finish-load', resolve));
    const result = await win.webContents.executeJavaScript(`(async () => {
      const wait = async (check) => {
        const deadline = Date.now() + 5000;
        while (Date.now() < deadline) {
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
    const document = path.join(workspace, 'document avec espaces.md');
    fs.writeFileSync(document, 'Texte de référence\n<script>not executable</script>');
    const largeDocument = path.join(workspace, 'large.txt');
    const binaryDocument = path.join(workspace, 'binary.bin');
    const pdfDocument = path.join(workspace, 'document.pdf');
    const svgDocument = path.join(workspace, 'source.svg');
    fs.writeFileSync(largeDocument, 'x'.repeat(32769));
    fs.writeFileSync(binaryDocument, Buffer.from([0, 1, 2]));
    fs.writeFileSync(pdfDocument, '%PDF-1.7');
    fs.writeFileSync(svgDocument, '<svg></svg>');
    await win.webContents.executeJavaScript(`(async () => {
      for (const file of ${JSON.stringify([largeDocument, binaryDocument, pdfDocument])}) {
        let rejected = false;
        try { await api.readPromptDocument(file); } catch { rejected = true; }
        if (!rejected) throw new Error('Non-text or oversized prompt document was accepted');
      }
      if ((await api.readPromptDocument(${JSON.stringify(svgDocument)})) !== '<svg></svg>') throw new Error('SVG source text was not accepted');
    })()`);
    const originalPick = dialog.showOpenDialog;
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [document] });
    promptSessions = true;
    const writesBeforePrompt = messages.filter((message) => message.t === 'write').length;
    let promptResult;
    try {
      promptResult = await win.webContents.executeJavaScript(`(async () => {
        const wait = async (check) => {
          const deadline = Date.now() + 5000;
          while (Date.now() < deadline) {
            if (await check()) return;
            await new Promise((resolve) => setTimeout(resolve, 25));
          }
          throw new Error('Prompt editor timed out');
        };
        const pointFor = (element) => {
          if (!element) return null;
          element.scrollIntoView({ block: 'nearest', inline: 'nearest' });
          const bounds = element.getBoundingClientRect();
          if (!bounds.width || !bounds.height) return null;
          const y = bounds.top + bounds.height / 2;
          for (const x of [bounds.left + bounds.width / 2, bounds.left + 3, bounds.right - 3]) {
            if (element.contains(document.elementFromPoint(x, y))) return { x, y };
          }
          return null;
        };
        const reachable = (element) => !!pointFor(element);
        const click = (element) => {
          if (!reachable(element)) {
            const bounds = element?.getBoundingClientRect();
            const covering = bounds && document.elementFromPoint(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2);
            throw new Error('Prompt control is obscured: ' + element?.className + ' by ' + covering?.className);
          }
          element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
          if (element.matches('button, input, textarea, select')) element.focus();
          element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
          element.click();
        };
        const terminal = CAI.activeSpace.tabs.find((tab) => tab.kind === 'terminal');
        CAI.activateTab(terminal, true);
        await wait(() => terminal.term && terminal.ptyId);
        await new Promise((resolve) => terminal.term.write('\\x1b[?2004h', resolve));
        terminal.space.promptBtn.click();
        const ready = () => document.querySelector('.prompt-card')?.getAttribute('aria-busy') === 'false';
        await wait(ready);
        const input = document.querySelector('.prompt-input');
        if (!input.spellcheck || document.activeElement !== input) throw new Error('Prompt spelling or initial focus is missing');
        if (input.closest('.tab-pane') !== terminal.pane || input.closest('[aria-modal="true"]')) throw new Error('Prompt editor is not scoped to its terminal tab');
        const contextEvent = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
        input.dispatchEvent(contextEvent);
        if (contextEvent.defaultPrevented) throw new Error('Terminal context menu intercepted the prompt spellchecker');
        click(terminal.pane.querySelector('.prompt-open-files'));
        await wait(() => ready() && document.querySelector('.ctx-menu'));
        if (!reachable(document.querySelector('.ctx-menu .ctx-item'))) throw new Error('Open-file menu is hidden behind the prompt');
        UI.closeMenus();
        input.value = 'Brouillon du premier onglet';
        input.dispatchEvent(new Event('input'));
        const otherTerminal = await CAI.openKind(null, 'terminal');
        await wait(() => otherTerminal.term);
        click(otherTerminal.space.promptBtn);
        const otherPanel = otherTerminal.pane.querySelector('.prompt-overlay');
        const otherReady = () => otherPanel.querySelector('.prompt-card').getAttribute('aria-busy') === 'false';
        await wait(otherReady);
        const otherInput = otherPanel.querySelector('.prompt-input');
        otherInput.value = 'Brouillon de l’autre zone';
        otherInput.dispatchEvent(new Event('input'));
        if (input.value !== 'Brouillon du premier onglet' || !terminal.pane.contains(input)) throw new Error('Opening another zone replaced the first editor');
        const sibling = CAI.openTab(terminal.space, { kind: 'terminal' });
        await wait(() => sibling.term);
        click(terminal.space.promptBtn);
        await wait(() => sibling.pane.querySelector('.prompt-card')?.getAttribute('aria-busy') === 'false');
        if (input.offsetParent || otherInput.value !== 'Brouillon de l’autre zone') throw new Error('Switching tabs did not hide the previous editor or preserve the other zone');
        const headings = [...document.querySelectorAll('.prompt-card h3')].map((heading) => heading.id);
        if (headings.length !== 3 || new Set(headings).size !== 3) throw new Error('Independent prompt editors have duplicate accessibility IDs');
        click(terminal.el);
        await wait(() => document.activeElement === input);
        if (document.activeElement !== input || input.value !== 'Brouillon du premier onglet') throw new Error('Returning to a tab did not restore its prompt and focus');
        await CAI.closeTab(sibling, true);
        input.value = '/fi';
        input.dispatchEvent(new Event('input'));
        if (document.querySelector('.prompt-commands').hidden) throw new Error('Local slash menu did not open');
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        await wait(() => ready() && document.querySelector('.prompt-document'));
        if (input.value) throw new Error('Local slash command leaked into prompt text');
        if (document.querySelector('.prompt-document-path').textContent !== ${JSON.stringify(document)}) throw new Error('Document reference lost its exact path');
        const mode = document.querySelector('.prompt-document-mode');
        mode.value = 'content';
        mode.dispatchEvent(new Event('change'));
        input.value = 'Analyse ce document.\\nExplique les changements.';
        input.dispatchEvent(new Event('input'));
        document.querySelector('.prompt-show-preview').click();
        await wait(() => ready() && !document.querySelector('.prompt-preview').hidden);
        if (!document.querySelector('.prompt-preview').textContent.includes('<script>not executable</script>')) throw new Error('Document text preview is missing');
        click(terminal.pane.querySelector('.prompt-favorite'));
        await wait(() => document.querySelector('.dlg-input'));
        if (!terminal.pane.contains(document.querySelector('.dlg-input')) || !reachable(document.querySelector('.dlg-actions .primary'))) throw new Error('Favorite dialog is hidden or blocks the entire window');
        click(otherTerminal.el);
        await wait(() => document.activeElement === otherInput);
        if (document.activeElement !== otherInput) throw new Error('Another zone is not accessible while a prompt dialog is open');
        click(terminal.el);
        document.querySelector('.dlg-input').value = 'Analyse personnelle';
        click(document.querySelector('.dlg-actions .primary'));
        click(otherTerminal.el);
        await wait(() => ready() && document.querySelector('.prompt-entry'));
        await wait(() => document.activeElement === otherInput);
        if (document.querySelector('.prompt-entry strong').textContent !== 'Analyse personnelle') throw new Error('Favorite was not saved');
        if (document.activeElement !== otherInput) throw new Error('A background prompt operation stole focus from another zone');
        await CAI.closeTab(otherTerminal, true);
        click(otherTerminal.space.head.querySelector('.icon-btn.danger'));
        click(terminal.el);
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true }));
        await wait(() => !document.querySelector('.prompt-overlay'));
        const library = await api.listPrompts();
        if (library.history.length !== 1 || library.favorites.length !== 1 || library.history[0].documents[0].mode !== 'content') throw new Error('Prompt history or favorites did not persist');
        terminal.space.promptBtn.click();
        await wait(ready);
        document.querySelector('[data-kind="favorites"]').click();
        await wait(() => ready() && document.querySelector('.prompt-reuse'));
        document.querySelector('.prompt-reuse').click();
        await wait(() => ready() && document.querySelector('.prompt-input').value.includes('Analyse ce document.'));
        if (!document.querySelector('.prompt-document')) throw new Error('Favorite did not restore document references');
        document.querySelector('.prompt-insert').click();
        await wait(() => !document.querySelector('.prompt-overlay'));
        window.checkPromptLayout = async () => {
          terminal.space.promptBtn.click();
          await wait(ready);
          const card = document.querySelector('.prompt-card').getBoundingClientRect();
          const pane = terminal.pane.getBoundingClientRect();
          if (card.left < pane.left || card.top < pane.top || card.right > pane.right || card.bottom > pane.bottom ||
              !reachable(document.querySelector('.prompt-send'))) throw new Error('Prompt controls overflow their terminal tab or cannot be reached');
          const input = document.querySelector('.prompt-input');
          input.value = '/compact';
          input.dispatchEvent(new Event('input'));
          if (!document.querySelector('.prompt-commands').hidden) throw new Error('Unknown CLI command was intercepted');
          input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
          terminal.space.promptBtn.click();
          await wait(ready);
          if (document.querySelector('.prompt-input').value !== '/compact') throw new Error('Unsent draft was lost');
          click(document.querySelector('.prompt-send'));
          await wait(() => ready() && document.querySelector('.prompt-error').textContent.includes('terminal est fermé'));
          if (document.querySelector('.prompt-input').value !== '/compact') throw new Error('Failed send discarded the draft');
          await new Promise((resolve) => terminal.term.write('\\x1b[?2004l', resolve));
          const multiline = document.querySelector('.prompt-input');
          multiline.value = 'Première ligne\\nDeuxième ligne';
          multiline.dispatchEvent(new Event('input'));
          click(document.querySelector('.prompt-send'));
          await wait(() => document.querySelector('.dlg-actions'));
          click(document.querySelector('.dlg-actions button:first-child'));
          await wait(ready);
          if (multiline.value !== 'Première ligne\\nDeuxième ligne') throw new Error('Canceling unsafe multiline paste discarded the draft');
          await new Promise((resolve) => terminal.term.write('\\x1b[?2004h', resolve));
          document.querySelector('.prompt-input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
          const closing = CAI.openTab(terminal.space, { kind: 'terminal' });
          await wait(() => closing.term);
          click(terminal.space.promptBtn);
          await wait(ready);
          const closingInput = closing.pane.querySelector('.prompt-input');
          closingInput.value = 'Prompt\\nà annuler';
          closingInput.dispatchEvent(new Event('input'));
          click(closing.pane.querySelector('.prompt-send'));
          await wait(() => closing.pane.querySelector('.dlg-actions'));
          const title = closing.el.querySelector('.title');
          const point = pointFor(title);
          if (!point) throw new Error('Tab header is blocked by its prompt confirmation');
          title.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: point.x, clientY: point.y }));
          const closeItem = [...document.querySelectorAll('.ctx-menu .ctx-item')].find((button) => button.querySelector('.ctx-label')?.textContent === 'Fermer');
          click(closeItem);
          await wait(() => !terminal.space.tabs.includes(closing) && !document.querySelector('.dlg-overlay'));
          if (document.querySelector('.prompt-overlay')) throw new Error('Closing a tab leaked its prompt editor or confirmation');
          CAI.activateTab(terminal, true);
        };
        return { terminalId: terminal.ptyId };
      })()`);
    } finally { dialog.showOpenDialog = originalPick; }
    const promptWrites = messages.filter((message) => message.t === 'write').slice(writesBeforePrompt);
    assert.equal(promptWrites.length, 2, 'Reusing a favorite must not send anything until requested');
    assert.equal(promptWrites[0].id, promptResult.terminalId);
    assert.ok(promptWrites[0].data.startsWith('\x1b[200~Analyse ce document.\n'));
    assert.ok(promptWrites[0].data.includes(document));
    assert.ok(promptWrites[0].data.includes('Texte de référence'));
    assert.ok(promptWrites[0].data.endsWith('\x1b[201~\r'), 'Send validates exactly once after pasting');
    assert.ok(promptWrites[1].data.endsWith('\x1b[201~'), 'Insert must not validate');
    assert.ok(fs.existsSync(path.join(profile, 'prompts.json')));
    assert.equal(fs.existsSync(path.join(workspace, '.robot', 'prompts.json')), false);
    assert.equal(win.webContents.session.spellCheckerEnabled, true);
    const originalMenu = Menu.buildFromTemplate;
    const originalAddWord = win.webContents.session.addWordToSpellCheckerDictionary;
    const originalErrorBox = dialog.showErrorBox;
    let spellingMenu;
    let dictionaryError;
    Menu.buildFromTemplate = (items) => ({ popup: () => { spellingMenu = items; } });
    win.webContents.session.addWordToSpellCheckerDictionary = () => false;
    dialog.showErrorBox = (_title, message) => { dictionaryError = message; };
    try {
      win.webContents.emit('context-menu', {}, {
        isEditable: true, spellcheckEnabled: true, dictionarySuggestions: ['bonjour'], misspelledWord: 'bonjor',
      });
      assert.equal(spellingMenu[0].label, 'bonjour');
      assert.ok(spellingMenu.some((item) => item.label === 'Ajouter au dictionnaire'));
      spellingMenu.find((item) => item.label === 'Ajouter au dictionnaire').click();
      assert.equal(dictionaryError, 'Ajout au dictionnaire impossible');
    } finally {
      Menu.buildFromTemplate = originalMenu;
      win.webContents.session.addWordToSpellCheckerDictionary = originalAddWord;
      dialog.showErrorBox = originalErrorBox;
    }
    promptSessions = false;
    console.log('Checking prompt layout and canceled sends');
    win.setContentSize(760, 480);
    await win.webContents.executeJavaScript('window.checkPromptLayout()');
    console.log('Checking status layout and workspace switching');
    assert.equal(messages.filter((message) => message.t === 'write').length, writesBeforePrompt + 2, 'Failed or canceled sends must not write to the terminal');
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
    win.show();
    win.focus();
    console.log('Checking service descriptions, AI proposals and persistent drafts');
    await win.webContents.executeJavaScript(`(async () => {
      const wait = async (check) => {
        for (let i = 0; i < 200; i++) {
          if (await check()) return;
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
        throw new Error('Draft/service test timed out');
      };
      await api.svcSave(CAI.ws.root, [{ id: 'description-test', name: 'Service test', command: 'echo test', description: 'Description <script>texte</script>\\nDeuxième ligne' }]);
      const services = await CAI.openKind(null, 'services');
      await wait(() => services.pane.querySelector('.sv-description'));
      const description = services.pane.querySelector('.sv-description');
      if (description.textContent !== 'Description <script>texte</script>\\nDeuxième ligne' || description.querySelector('script')) throw new Error('Service description is missing or unsafe');
      services.pane.querySelector('[title="Modifier"]').click();
      const descriptionInput = document.querySelector('.svc-dlg textarea');
      if (descriptionInput.value !== description.textContent) throw new Error('Service form lost description');
      descriptionInput.value = 'Description modifiée\\nDeux lignes';
      [...document.querySelectorAll('.svc-dlg button')].find((button) => button.textContent === 'Enregistrer').click();
      await wait(() => !document.querySelector('.svc-dlg'));
      if ((await api.svcOpen(CAI.ws.root)).defs[0].description !== 'Description modifiée\\nDeux lignes') throw new Error('Service edit did not retain description');
      await CAI.closeTab(services, true);
      const terminal = CAI.spaces.flatMap((space) => space.tabs).find((tab) => tab.kind === 'terminal');
      CAI.activateTab(terminal, true);
      PromptEditor.open(terminal);
      const ready = () => terminal.pane.querySelector('.prompt-card')?.getAttribute('aria-busy') === 'false';
      await wait(ready);
      const panel = terminal.pane;
      const input = panel.querySelector('.prompt-input');
      input.value = 'Un objectif\\nDes contraintes';
      input.dispatchEvent(new Event('input'));
      await wait(async () => (await api.listPrompts()).drafts.some((entry) => entry.id === terminal.promptDraftId && entry.text === input.value));
      panel.querySelector('.prompt-assistant').open = true;
      panel.querySelector('.prompt-save-assistant').click();
      await wait(ready);
      panel.querySelector('.prompt-improve').click();
      await wait(() => panel.querySelector('.dlg-actions .primary'));
      panel.querySelector('.dlg-actions .primary').click();
      await wait(() => ready() && !panel.querySelector('.prompt-proposal-box').hidden);
      if (input.value !== 'Un objectif\\nDes contraintes') throw new Error('AI overwrote prompt without explicit application');
      panel.querySelector('.prompt-apply-proposal').click();
      await wait(() => ready() && input.value === 'Objectif précis\\n\\nContraintes explicites');
      if (!(await api.listPrompts()).drafts.some((entry) => entry.text === 'Un objectif\\nDes contraintes')) throw new Error('AI application lost original draft');
      panel.querySelector('.prompt-new-draft').click();
      await wait(() => ready() && input.value === '');
      if (!(await api.listPrompts()).drafts.some((entry) => entry.text === 'Objectif précis\\n\\nContraintes explicites')) throw new Error('New draft lost previous draft');
      input.value = 'Brouillon avant rechargement\\n\\nLigne finale';
      input.dispatchEvent(new Event('input'));
      panel.querySelector('.prompt-close').click();
      terminal.promptDraft.documents = [{ path: ${JSON.stringify(document)}, mode: 'content' }];
      PromptEditor.open(terminal);
      await wait(ready);
      terminal.pane.querySelector('.prompt-input').value = 'Brouillon avant rechargement\\n\\nLigne finale';
      terminal.pane.querySelector('.prompt-input').dispatchEvent(new Event('input'));
      window.reloadDraftId = terminal.promptDraftId;
    })()`);
    const reloadDraftId = await win.webContents.executeJavaScript('window.reloadDraftId');
    console.log('Checking draft restoration after reload');
    const reload = new Promise((resolve) => win.webContents.once('did-finish-load', resolve));
    win.reload();
    await reload;
    await wait(() => win.webContents.executeJavaScript('!!window.CAI?.activeSpace'));
    const restored = await win.webContents.executeJavaScript(`(async () => {
      const terminal = CAI.spaces.flatMap((space) => space.tabs).find((tab) => tab.spec?.promptDraftId === ${JSON.stringify(reloadDraftId)} || tab.promptDraftId === ${JSON.stringify(reloadDraftId)});
      if (!terminal) throw new Error('Draft identity was not persisted with its terminal');
      CAI.activateTab(terminal, true);
      PromptEditor.open(terminal);
      for (let i = 0; i < 200 && terminal.pane.querySelector('.prompt-card').getAttribute('aria-busy') !== 'false'; i++) await new Promise((resolve) => setTimeout(resolve, 25));
      if (terminal.pane.querySelector('.prompt-document-path')?.textContent !== ${JSON.stringify(document)}) throw new Error('Reload lost draft document references');
      return terminal.pane.querySelector('.prompt-input').value;
    })()`);
    assert.equal(restored, 'Brouillon avant rechargement\n\nLigne finale');
    assert.equal(messages.filter((message) => message.t === 'write').length, writesBeforePrompt + 2, 'AI and autosave must not write to a terminal');
    console.log('Platform app: per-tab prompt panels, reachable dialogs, independent drafts/focus, send/insert/failure/cancel, robot icons, paths, status bar, workspace switching and shortcuts passed.');
  } catch (error) {
    console.error(error);
    status = 1;
  } finally { app.exit(status); }
}).catch((error) => { console.error(error); app.exit(1); });
