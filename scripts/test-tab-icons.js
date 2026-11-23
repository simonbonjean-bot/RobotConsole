// Run with: node scripts/test-tab-icons.js
if (!process.versions.electron) require('./electron-test')(__filename);
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const temp = process.env.ROBOTCONSOLE_TEST_TEMP;
if (!temp) throw new Error('Run this test with Node so the parent can clean up the Chromium profile.');
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
    for (const file of ['../shared/platform.js', 'ui.js', 'tool-icons-data.js', 'tool-icons.js', 'emoji-data.js', 'emoji-picker.js', 'model-presets.js']) {
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
      const assertSearchSize = (minWidth) => {
        const input = document.querySelector('.emj-search');
        const rect = input.getBoundingClientRect();
        assert(rect.width >= minWidth, 'Search input leaves enough room for typed text');
        assert(rect.height >= 30, 'Search input has a readable height');
        const none = document.querySelector('.emj-none');
        if (none) {
          const button = none.getBoundingClientRect();
          assert(rect.right <= button.left && button.right <= document.querySelector('.emj-top').getBoundingClientRect().right + 1,
            'Search input and None button fit without overlap or overflow');
        }
      };

      open();
      assertSearchSize(250);
      assert(cells().some((b) => b.dataset.icon === '🚀'), 'Existing emojis remain available');
      document.querySelector('[data-icon="🚀"]').click();
      assert(picked === '🚀' && !document.querySelector('.emj'), 'Emoji selection closes the picker');
      open();
      tools();
      assertSearchSize(250);
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
      assertSearchSize(340);
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
      const presetMenu = document.querySelector('.ctx-menu');
      assert(presetMenu.getBoundingClientRect().bottom <= innerHeight, 'Large preset menus stay inside the window');
      presetMenu.querySelector('.ctx-item:last-child').focus();
      assert(presetMenu.scrollTop > 0, 'Last preset menu action remains reachable by keyboard');
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
      const presetTabs = TabModels.all('tab').filter((m) => m.builtin);
      assert(presetTabs.filter((m) => m.commands).length === 25, 'AI clients have launch presets');
      for (const type of ['tab', 'zone', 'screen']) {
        const models = TabModels.all(type).filter((m) => m.builtin);
        assert(models.length > 0 && new Set(models.map((m) => m.id)).size === models.length, 'Preset IDs are unique per category');
        for (const m of models) {
          assert(ToolIcons.get(m.icon.slice(5)), 'Every preset has an available icon: ' + m.name);
          const nestedTabs = type === 'tab' ? [m] : type === 'zone' ? m.tabs : m.zones.flatMap((z) => z.tabs);
          for (const t of nestedTabs) {
            assert(ToolIcons.get(t.icon.slice(5)), 'Nested tab icon resolves: ' + t.name);
            assert(TabModels.specFor(t).model.icon === t.icon, 'Opening a nested preset preserves its icon');
          }
          if (type === 'screen') {
            const leaves = (n) => n.t === 'leaf' ? [n.i] : n.children.flatMap(leaves);
            assert(leaves(m.layout).join(',') === m.zones.map((_, i) => i).join(','), 'Screen layout includes each zone exactly once');
          }
        }
      }
      const untouched = TabModels.all('zone').find((m) => m.builtin);
      untouched.tabs[0].commands = 'changed';
      assert(TabModels.find(untouched.id, 'zone').tabs[0].commands === 'claude', 'Preset reads are isolated deep copies');
      const saved = { id: 'custom-tab', kind: 'terminal', name: 'My preset', icon: '🚀', commands: 'echo custom' };
      Settings.data.tabModels = [saved];
      assert(TabModels.all()[0] === saved, 'Custom models remain ahead of built-ins');
      assert(Settings.data.tabModels.length === 1, 'Built-ins do not overwrite or populate stored settings');
      CAI.ws = { name: 'Project', root: 'C:\\\\project', tabModels: [{ ...saved, id: 'workspace-tab' }] };
      assert(TabModels.all()[0].fromWs, 'Workspace models keep precedence');
      assert(TabModels.specFor(presetTabs[0]).cwd === CAI.ws.root, 'AI presets launch at workspace root');
      assert(TabModels.specFor({ ...presetTabs[0], dir: 'apps/api' }).cwd === 'C:\\\\project\\\\apps\\\\api', 'Customized relative paths resolve against workspace');
      CAI.ws = null;
      CAI.shells = [];
      Settings.set = (patch) => Object.assign(Settings.data, patch);
      let opened;
      CAI.openKind = (space, kind, spec) => { opened = { space, kind, spec }; };
      CAI.openZoneModel = (model, space) => { opened = { model, space }; };
      CAI.openScreenModel = (model) => { opened = { model }; };
      const menuPreset = TabModels.menuItems(null).find((m) => m.label === 'Claude Code');
      menuPreset.action();
      assert(opened.spec.commands === 'claude' && opened.spec.model.icon === 'tool:dv:claudecode', 'AI menu launches the client with its logo');
      TabModels.zoneMenuItems(null).find((m) => m.label === 'Équipe IA').action();
      assert(opened.model.tabs.length === 3, 'Zone menu opens the complete preset');
      TabModels.screenMenuItems().find((m) => m.label === 'Studio multi-agents').action();
      assert(opened.model.zones.length === 2 && opened.model.layout.dir === 'row', 'Screen menu passes its zones and layout');
      const clickText = (text) => {
        const button = [...document.querySelectorAll('.tm-overlay button')].find((b) => b.textContent.includes(text));
        assert(button, 'Manager button exists: ' + text);
        button.click();
      };
      TabModels.openManager(null, 'tab');
      assert(document.querySelectorAll('.tm-item.ro').length === presetTabs.length, 'Presets are discoverable in the manager');
      const claudeCard = document.querySelector('[data-id="preset-tab-claude"]');
      assert(claudeCard.querySelector('pre').textContent === 'claude', 'CLI startup command is visible before opening');
      claudeCard.querySelector('button:last-child').click();
      await new Promise((resolve) => setTimeout(resolve, 0));
      const custom = Settings.data.tabModels.at(-1);
      assert(custom.name === 'Claude Code' && custom.commands === 'claude' && !custom.builtin, 'Personalizing persists an editable custom model');
      assert(custom.id !== 'preset-tab-claude' && document.querySelector('[data-id="' + custom.id + '"] .tm-name').value === 'Claude Code', 'Personalization opens the new custom model');
      document.querySelector('.tm-overlay .settings-head .icon-btn').click();
      TabModels.openManager('preset-screen-agents', 'screen');
      document.querySelector('[data-id="preset-screen-agents"] button:last-child').click();
      await new Promise((resolve) => setTimeout(resolve, 0));
      const screenCopy = Settings.data.screenModels.at(-1);
      assert(screenCopy.zones[0].tabs[0].id !== ModelPresets.screen[1].zones[0].tabs[0].id, 'Screen personalization gives nested tabs fresh IDs');
      screenCopy.zones[0].tabs[0].commands = 'modified';
      assert(ModelPresets.screen[1].zones[0].tabs[0].commands === 'claude', 'Screen personalization cannot mutate built-ins');
      document.querySelector('.tm-overlay .settings-head .icon-btn').click();
      TabModels.openManager('preset-zone-coding', 'zone');
      document.querySelector('[data-id="preset-zone-coding"] .tm-row button').click();
      assert(opened.model.tabs[0].commands === 'claude' && !document.querySelector('.tm-overlay'), 'Manager opens zone presets and closes');
      for (const [type, id, menu] of [
        ['tab', 'preset-tab-claude', () => TabModels.menuItems(null)],
        ['zone', 'preset-zone-coding', () => TabModels.zoneMenuItems(null)],
        ['screen', 'preset-screen-agents', () => TabModels.screenMenuItems()],
      ]) {
        const preset = TabModels.find(id, type);
        TabModels.openManager(id, type);
        let check = document.querySelector('[data-id="' + id + '"] input[type="checkbox"]');
        assert(check.checked, 'Presets are displayed by default');
        check.click();
        assert(Settings.data.hiddenPresetIds.includes(id), 'Unchecking persists the hidden preset');
        assert(!TabModels.all(type).some((m) => m.id === id), 'Hidden presets are excluded from suggestions');
        assert(!menu().some((m) => m.label === preset.name && m.hint?.includes('preset')), 'Hidden presets are excluded from launch menus');
        assert(document.querySelector('[data-id="' + id + '"]'), 'Hidden presets remain in the catalogue');
        assert(TabModels.find(id, type)?.builtin, 'Hidden presets remain addressable by ID');
        if (type === 'tab') {
          assert(TabModels.all().includes(custom), 'Hiding a preset does not hide its customized copy');
          assert(TabModels.find('preset-zone-coding', 'zone').tabs[0].commands === 'claude', 'Hiding a tab preset leaves composed zones unchanged');
        }
        Settings.data = JSON.parse(JSON.stringify(Settings.data));
        document.querySelector('.tm-overlay .settings-head .icon-btn').click();
        TabModels.openManager(id, type);
        check = document.querySelector('[data-id="' + id + '"] input[type="checkbox"]');
        assert(!check.checked, 'Saved visibility survives reopening the manager');
        check.click();
        assert(!Settings.data.hiddenPresetIds.includes(id) && TabModels.all(type).some((m) => m.id === id), 'Rechecking restores the preset');
        assert(menu().some((m) => m.label === preset.name && m.hint?.includes('preset')), 'Rechecking restores launch menu entries');
        document.querySelector('.tm-overlay .settings-head .icon-btn').click();
      }
      return 'Tab icons and model presets: search, persistence, layouts, launch menus and customization passed';
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
