const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../renderer/app.js'), 'utf8');
for (const name of ['tabEl', 'chip']) {
  const handlers = {};
  const tab = {};
  const closed = [];
  let activated = 0;
  const start = source.indexOf(`${name}.addEventListener('mousedown'`);
  const end = source.indexOf(`${name}.addEventListener('contextmenu'`, start);
  assert(start >= 0 && end > start, `${name} mouse handlers exist`);
  vm.runInNewContext(source.slice(start, end), {
    [name]: { addEventListener: (type, handler) => { handlers[type] = handler; } },
    tab, t: tab,
    activateTab: () => activated++,
    closeTab: (value) => closed.push(value),
    hideTip() {},
  });
  for (const button of [0, 1, 2]) {
    const event = {
      button, prevented: false, stopped: false,
      preventDefault() { this.prevented = true; },
      stopPropagation() { this.stopped = true; },
    };
    handlers.mousedown(event);
    assert.equal(event.prevented, button === 1, `${name}: only middle press prevents autoscroll`);
    handlers.auxclick(event);
    assert.equal(closed.length, button >= 1 ? 1 : 0, `${name}: only middle click closes`);
    if (name === 'chip') assert.equal(event.stopped, button === 1);
  }
  assert.equal(closed[0], tab, `${name}: closes the clicked tab`);
  assert.equal(activated, name === 'tabEl' ? 1 : 0, 'Only left click activates');
}
console.log('Tab middle click: tab headers and robot icons passed');
