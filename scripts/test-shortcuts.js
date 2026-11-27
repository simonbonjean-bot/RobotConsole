const test = require('node:test');
const assert = require('node:assert/strict');
const Shortcuts = require('../shared/shortcuts');
const key = (code, modifiers = {}) => ({ code, ...modifiers });

test('navigation distinguishes tabs, zones, screens and workspaces', () => {
  assert.equal(Shortcuts.match(key('ArrowRight', { ctrlKey: true, altKey: true })), 'tabNext');
  assert.equal(Shortcuts.match(key('ArrowLeft', { ctrlKey: true, shiftKey: true })), 'zonePrevious');
  assert.equal(Shortcuts.match(key('ArrowRight', { ctrlKey: true, shiftKey: true, altKey: true })), 'screenNext');
  assert.equal(Shortcuts.match(key('ArrowUp', { ctrlKey: true, altKey: true })), 'workspacePrevious');
  assert.equal(Shortcuts.match(key('Tab', { ctrlKey: true, shiftKey: true })), 'tabPrevious');
  assert.equal(Shortcuts.match(key('ArrowRight', { ctrlKey: true })), null);
});

test('overrides replace all aliases, can disable actions and restore defaults', () => {
  const override = { tabNext: ['Ctrl+KeyJ'] };
  assert.equal(Shortcuts.match(key('KeyJ', { ctrlKey: true }), override), 'tabNext');
  assert.equal(Shortcuts.match(key('Tab', { ctrlKey: true }), override), null);
  assert.equal(Shortcuts.match(key('Tab', { ctrlKey: true }), { tabNext: [] }), null);
  assert.equal(Shortcuts.match(key('Tab', { ctrlKey: true }), {}), 'tabNext');
  assert.equal(Shortcuts.match(key('Tab', { ctrlKey: true }), { tabNext: null }), 'tabNext');
});

test('conflicts account for modifier ordering, aliases and platform', () => {
  assert.equal(Shortcuts.conflict('tabPrevious', ['Alt+Ctrl+ArrowRight']).id, 'tabNext');
  assert.equal(Shortcuts.conflict('tabPrevious', ['Ctrl+Tab']).id, 'tabNext');
  assert.equal(Shortcuts.conflict('tabPrevious', ['Meta+Alt+ArrowRight'], {}, true).id, 'tabNext');
  assert.equal(Shortcuts.conflict('tabNext', ['Ctrl+Tab']), null);
  for (const isMac of [false, true]) {
    const signatures = Shortcuts.actions.flatMap((a) => a.defaults.map((b) => Shortcuts.signature(b, isMac)));
    assert.equal(new Set(signatures).size, signatures.length, 'Default bindings conflict');
  }
});

test('capturing rejects reserved, composing and AltGraph input', () => {
  for (const code of ['Fn', 'F12', 'Escape', 'KeyA', 'ControlLeft']) assert.equal(Shortcuts.fromEvent(key(code)), null);
  assert.equal(Shortcuts.fromEvent(key('F6')), 'F6');
  assert.equal(Shortcuts.fromEvent(key('KeyA', { ctrlKey: true, isComposing: true })), null);
  assert.equal(Shortcuts.fromEvent(key('KeyA', { ctrlKey: true, altKey: true, getModifierState: () => true })), null);
  assert.equal(Shortcuts.valid('Ctrl+Ctrl+KeyA'), false);
  assert.equal(Shortcuts.valid('Primary+Ctrl+KeyA'), false);
  assert.equal(Shortcuts.match(key('Tab', { ctrlKey: true }), { tabNext: ['invalid', 'Ctrl+Tab'] }), 'tabNext');
});

test('Mac primary and physical codes work without stealing alternate modifiers', () => {
  assert.equal(Shortcuts.match(key('ArrowRight', { metaKey: true, altKey: true }), {}, true), 'tabNext');
  assert.equal(Shortcuts.match(key('ArrowRight', { ctrlKey: true, altKey: true }), {}, true), 'tabNext');
  assert.equal(Shortcuts.match(key('ArrowRight', { metaKey: true, altKey: true }), {}, false), null);
  assert.equal(Shortcuts.match(key('Digit2', { key: 'é', altKey: true })), 'zone2');
  assert.equal(Shortcuts.match(key('Digit2', { altKey: true, shiftKey: true })), null);
});
