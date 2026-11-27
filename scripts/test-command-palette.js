const { test } = require('node:test');
const assert = require('node:assert/strict');
const model = require('../shared/command-palette');

test('palette matches accents, case, paths and partial names with stable ordering', () => {
  const items = [
    { label: 'Écran Dev', detail: 'Robot API' },
    { label: 'Écran Dev', detail: 'Robot Web' },
    { label: 'fichier.js', detail: 'apps\\backend\\fichier.js' },
  ];
  assert.deepEqual(model.filter(items, 'ECRAN'), items.slice(0, 2));
  assert.deepEqual(model.filter(items, 'ecran web'), [items[1]]);
  assert.deepEqual(model.filter(items, 'bcknd fichier'), [items[2]]);
  assert.deepEqual(model.filter(items, 'apps/backend'), [items[2]]);
  assert.deepEqual(model.filter(items, 'absent'), []);
});

test('palette wraps selection and recognizes only its reserved shortcut', () => {
  assert.equal(model.selection(0, -1, 3), 2);
  assert.equal(model.selection(2, 1, 3), 0);
  assert.equal(model.selection(0, 1, 0), 0);
  assert.equal(model.shortcut({ code: 'Space', ctrlKey: true, shiftKey: true }), true);
  assert.equal(model.shortcut({ code: 'Space', ctrlKey: true }), false);
  assert.equal(model.shortcut({ code: 'Space', metaKey: true, shiftKey: true }, true), true);
  assert.equal(model.shortcut({ code: 'Space', ctrlKey: true, shiftKey: true, altKey: true }), false);
});
