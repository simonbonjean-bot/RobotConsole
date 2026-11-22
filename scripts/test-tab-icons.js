// Run with: node_modules\.bin\electron scripts\test-tab-icons.js
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'robotconsole-tab-icons-'));
app.setPath('userData', path.join(temp, 'profile'));
app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  let win;
  let exitCode = 0;
  try {
    const renderer = path.join(__dirname, '..', 'renderer');
    const fixture = path.join(temp, 'fixture.html');
    fs.writeFileSync(fixture, `<base href="${pathToFileURL(renderer + path.sep).href}">
      <link rel="stylesheet" href="styles.css">
      <link rel="stylesheet" href="ui2.css">
      <link rel="stylesheet" href="screens.css">
      <button id="anchor">Choose</button>`);
    win = new BrowserWindow({ show: false, width: 900, height: 700, webPreferences: { partition: 'tab-icon-tests' } });
    await win.loadFile(fixture);
    for (const file of ['ui.js', 'tool-icons-data.js', 'tool-icons.js', 'emoji-data.js', 'emoji-picker.js']) {
      await win.webContents.executeJavaScript(fs.readFileSync(path.join(renderer, file), 'utf8'));
    }
    await win.webContents.executeJavaScript(`
      window.Settings = { data: { tabModels: [], zoneModels: [], screenModels: [] } };
      window.CAI = { ws: null };
      window.TabKinds = { terminal: { serialize: () => ({ cwd: 'C:\\\\project', commands: [] }) } };
      void 0;
    `);
    await win.webContents.executeJavaScript(fs.readFileSync(path.join(renderer, 'tab-models.js'), 'utf8'));
    const result = await win.webContents.executeJavaScript(`(async () => {
      const assert = (condition, message) => { if (!condition) throw new Error(message); };
      const anchor = document.querySelector('#anchor');
      let picked;
      const open = () => { picked = undefined; TabModels.pickIcon(anchor, (icon) => { picked = icon; }, true); };
      const tools = () => document.querySelector('.emj-modes button:last-child').click();
      const query = (value) => {
        const input = document.querySelector('.emj-search');
        input.value = value;
        input.dispatchEvent(new Event('input'));
        return input;
      };
      const cells = () => [...document.querySelectorAll('.emj-cell')];

      open();
      assert(cells().some((b) => b.dataset.icon === '🚀'), 'Existing emojis remain available');
      document.querySelector('[data-icon="🚀"]').click();
      assert(picked === '🚀' && !document.querySelector('.emj'), 'Emoji selection closes the picker');
      open();
      tools();
      assert(cells().length === ToolIcons.all.length, 'The entire robot icon catalogue is available');
      assert(document.querySelector('.emj-cats').classList.contains('hidden'), 'Emoji categories hidden in icon mode');
      const category = ToolIcons.cats[0];
      document.querySelector('.emj-tool-cats button:nth-child(2)').click();
      assert(cells().length === ToolIcons.search('', category.id).length, 'Icon categories use the robot catalogue');
      document.querySelector('.emj-tool-cats button').click();
      const input = query('docker');
      assert(cells().length === ToolIcons.search('docker', '').length, 'Icon search uses the robot search');
      const expected = cells()[0].dataset.icon;
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      assert(picked === expected, 'Enter selects a searched icon');

      open();
      tools();
      query('no-such-icon-123456');
      assert(cells().length === 0 && document.querySelector('.emj-grid').textContent.includes('Aucune icône'), 'Empty icon results are explicit');
      query('');
      const svgCell = cells().find((b) => b.querySelector('svg'));
      const svgIcon = svgCell.dataset.icon;
      svgCell.querySelector('path').dispatchEvent(new MouseEvent('click', { bubbles: true }));
      assert(picked === svgIcon, 'Clicking nested SVG content selects the icon');

      open();
      const recentCell = document.querySelector('.emj-sec[data-key="recent"] .emj-cell');
      assert(recentCell.dataset.icon === svgIcon && recentCell.querySelector('svg'), 'Recent icons retain their rendering');
      tools();
      document.querySelector('.emj-none').click();
      assert(picked === null, 'None resets the icon');
      open();
      tools();
      query('docker');
      document.querySelector('.emj-modes button').click();
      assert(cells().every((b) => !b.dataset.icon.startsWith('tool:')), 'Switching back searches emojis');
      query('');
      assert(cells().some((b) => b.dataset.icon === '🚀'), 'Switching back restores emojis');
      query('rocket').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      assert(!document.querySelector('.emj'), 'Escape closes the picker');

      EmojiPicker.open(anchor, { onPick: () => {} });
      assert(!document.querySelector('.emj-modes'), 'Unrelated emoji pickers remain emoji-only');
      assert(cells().every((b) => !b.dataset.icon.startsWith('tool:')), 'Icon recents do not leak into emoji-only pickers');
      EmojiPicker.close();

      const icon = 'tool:' + ToolIcons.all.find((it) => it.src).id;
      const tab = { title: 'Dev', kind: 'terminal', icon, model: { icon: '🚀' } };
      const model = TabModels.tabToModel(tab);
      assert(model.icon === icon, 'Saving a tab as a model preserves the manual icon');
      const restored = JSON.parse(JSON.stringify(TabModels.specFor(model)));
      assert(restored.model.icon === icon, 'Opening a persisted model retains the icon');
      Settings.data.tabModels = [model];
      UI.menu(TabModels.menuItems(null), anchor);
      assert(document.querySelector('.ctx-ico .tm-tool img'), 'Model menus render catalogue icons');
      UI.closeMenus();
      assert(TabModels.iconHtml('🚀').includes('🚀'), 'Existing emoji rendering is preserved');
      assert(TabModels.iconHtml('>_').includes('kind-term'), 'Default terminal rendering is preserved');
      assert(TabModels.iconHtml('tool:missing').includes('tool:missing'), 'Unknown icons remain visible');
      const preview = UI.h('span', 'tab-icon', TabModels.iconHtml(icon));
      document.body.appendChild(preview);
      const img = preview.querySelector('img');
      await new Promise((resolve, reject) => {
        if (img.complete) return img.naturalWidth ? resolve() : reject(new Error('Icon image failed to load'));
        img.onload = resolve;
        img.onerror = () => reject(new Error('Icon image failed to load'));
      });
      assert(img.getBoundingClientRect().width === 18, 'Tab icon respects tab sizing');
      return 'Tab icon selection, search, categories, persistence and rendering passed';
    })()`);
    console.log(result);
  } catch (error) {
    console.error(error);
    exitCode = 1;
  } finally {
    win?.destroy();
    app.exit(exitCode);
  }
}).catch((error) => {
  console.error(error);
  app.exit(1);
});

process.on('exit', () => fs.rmSync(temp, { recursive: true, force: true }));
