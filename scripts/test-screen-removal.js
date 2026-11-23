// Run with: node scripts/test-screen-removal.js
if (!process.versions.electron) require('./electron-test')(__filename);
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

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
    fs.writeFileSync(fixture, '<!doctype html><html><body></body></html>');
    win = new BrowserWindow({ show: false, webPreferences: { partition: 'screen-removal-tests' } });
    await win.loadFile(fixture);
    for (const file of ['ui.js', 'i18n-en.js', 'i18n.js']) {
      await win.webContents.executeJavaScript(fs.readFileSync(path.join(renderer, file), 'utf8'));
    }
    const source = fs.readFileSync(path.join(renderer, 'app.js'), 'utf8');
    const extract = (start, end) => {
      const from = source.indexOf(start);
      const to = source.indexOf(end, from);
      if (from < 0 || to < 0) throw new Error(`Missing function boundary: ${start}`);
      return source.slice(from, to);
    };
    const functions = extract('  async function canCloseSpace(', '  // Retire un espace') +
      extract('  async function removeScreen(', '  function screenMenu(');
    const result = await win.webContents.executeJavaScript(`(async () => {
      const assert = (condition, message) => { if (!condition) throw new Error(message); };
      const { esc } = UI;
      I18n.setLang('fr');
      let screens, spaces, activeScreenId, activeSpace, maximized, closed, saved, checks, renders;
      const Layout = { remove() {} };
      const kindOf = (tab) => ({
        canClose: async () => { checks.push(tab.id); return !tab.refuse; },
      });
      const closeTab = (tab) => {
        closed.push(tab.id);
        tab.space.tabs.splice(tab.space.tabs.indexOf(tab), 1);
      };
      const renderLayout = () => { renders++; };
      const renderCrew = () => {};
      const nearestVisible = () => spaces.find((sp) => sp.screenId === activeScreenId && !sp.parked);
      const setActiveSpace = (sp) => { activeSpace = sp; };
      const placeSpace = () => {};
      const openTab = () => {};
      const save = () => {
        saved = { screens: screens.map((sc) => sc.id), spaces: spaces.map((sp) => ({ id: sp.id, screenId: sp.screenId })) };
      };
      const switchScreen = (id) => { activeScreenId = id; activeSpace = null; };
      const moveSpaceToScreen = (sp, id) => { sp.screenId = id; };
      const createSpace = () => {
        const sp = { id: 'replacement', screenId: activeScreenId, tabs: [] };
        spaces.push(sp);
        return sp;
      };
      ${functions}
      const reset = (active = 'a') => {
        screens = [{ id: 'a', name: '<Zone & écran>' }, { id: 'b', name: 'Deux' }, { id: 'c', name: 'Trois' }];
        spaces = ['a', 'a', 'b'].map((screenId, i) => {
          const sp = { id: 'z' + i, screenId, parked: i === 1, el: document.createElement('div'), crewEl: document.createElement('div') };
          sp.tabs = [{ id: 't' + i, space: sp }];
          return sp;
        });
        activeScreenId = active;
        activeSpace = null;
        maximized = null;
        closed = [];
        checks = [];
        saved = null;
        renders = 0;
      };
      const click = (text) => {
        const button = [...document.querySelectorAll('.dlg-actions button')].find((b) => b.textContent === text);
        assert(button, 'Dialog button exists: ' + text);
        button.click();
      };
      const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

      reset();
      let pending = removeScreen(screens[0]);
      assert(document.querySelector('.dlg-msg b').textContent === screens[0].name, 'Screen name is safely escaped');
      click('Annuler');
      await pending;
      assert(screens.length === 3 && spaces.length === 3 && !saved && !closed.length, 'Cancelling does not change state');

      reset();
      pending = removeScreen(screens[0]);
      click('Déplacer vers un autre écran…');
      await tick();
      let select = document.querySelector('.dlg select');
      assert(select && select.options.length === 2, 'Destination selector excludes deleted screen');
      assert(select.value === 'b', 'Adjacent screen is selected by default');
      select.value = 'c';
      click("Déplacer et supprimer l'écran");
      await pending;
      assert(screens.map((sc) => sc.id).join() === 'b,c' && activeScreenId === 'c', 'Selected destination replaces active screen');
      assert(spaces[0].screenId === 'c' && spaces[1].screenId === 'c' && spaces[1].parked, 'All zones move, including parked zones');
      assert(!closed.length && !checks.length && spaces[0].tabs.length === 1, 'Moving preserves running tabs');
      assert(saved.spaces.every((sp) => saved.screens.includes(sp.screenId)), 'Saved zones have valid screens');

      reset('b');
      pending = removeScreen(screens[0]);
      click('Déplacer vers un autre écran…');
      await tick();
      document.querySelector('.dlg').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await pending;
      assert(screens.length === 3 && spaces[0].screenId === 'a' && !saved, 'Cancelling destination leaves screen intact');

      reset('c');
      pending = removeScreen(screens[0]);
      click('Tout fermer');
      await pending;
      assert(screens.length === 2 && spaces.length === 1 && activeScreenId === 'c', 'Closing an inactive screen preserves active screen');
      assert(closed.join() === 't0,t1' && checks.join() === 't0,t1', 'Every tab is checked once and disposed, including parked zones');
      assert(saved.spaces.every((sp) => saved.screens.includes(sp.screenId)), 'Closed zones are removed from saved state');

      reset();
      spaces[1].tabs[0].refuse = true;
      pending = removeScreen(screens[0]);
      click('Tout fermer');
      await pending;
      assert(screens.length === 3 && spaces.length === 3 && !closed.length && !saved && activeScreenId === 'a',
        'Unsaved-tab cancellation preserves every zone and the current screen');

      reset();
      spaces = spaces.slice(0, 2);
      pending = removeScreen(screens[0]);
      click('Tout fermer');
      await pending;
      assert(screens.length === 2 && activeScreenId === 'b' && spaces.length === 1 && spaces[0].screenId === 'b',
        'Closing all zones creates replacement on a surviving screen');
      assert(closed.length === 2 && saved.spaces.every((sp) => saved.screens.includes(sp.screenId)), 'No orphan zone is persisted');

      reset('b');
      await removeScreen(screens[2]);
      assert(screens.length === 2 && !document.querySelector('.dlg') && activeScreenId === 'b', 'Empty screen needs no zone choice');
      screens = screens.slice(0, 1);
      await removeScreen(screens[0]);
      assert(screens.length === 1 && !document.querySelector('.dlg'), 'Last screen cannot be deleted');

      const inputDialog = UI.prompt('Nom', 'Original');
      const input = document.querySelector('.dlg input');
      input.value = 'Nouveau';
      click('OK');
      assert(await inputDialog === 'Nouveau', 'Existing text-input dialogs still work');
      const confirmDialog = UI.confirm('Confirmer', 'Message');
      click('OK');
      assert(await confirmDialog === true, 'Existing confirmations still work');

      I18n.setLang('en');
      reset();
      pending = removeScreen(screens[0]);
      await tick();
      assert(document.querySelector('.dlg-msg').textContent.includes('What should happen to the 2 zone(s)'),
        'Dynamic confirmation message is translated');
      click('Move to another screen…');
      await tick();
      select = document.querySelector('.dlg select');
      assert(document.querySelector('.dlg h3').textContent === 'Destination screen', 'Destination dialog is translated');
      click('Cancel');
      await pending;
      return 'Screen removal: choices, destination, cancellation, closure, persistence and translations passed';
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
