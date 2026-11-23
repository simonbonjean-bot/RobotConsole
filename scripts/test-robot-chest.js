const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const context = { window: {} };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../renderer/robot.js'), 'utf8'), context);
const { Robot } = context.window;
const details = new Set();
for (const chest of Object.keys(Robot.OPTIONS.chest.values)) {
  for (const bodyW of [30, 60]) {
    const traits = { chest, bodyW, tool: 'none' };
    const head = Robot.generate('chest-test', { traits }).svg;
    const full = Robot.generate('chest-test', { traits, legs: true }).svg;
    const detail = (svg) => svg.match(/<g class="an an-chest[^\"]*">([\s\S]*?)<\/g>/)?.[1];
    assert.ok(detail(head), `${chest} is drawn in head mode`);
    assert.equal(detail(head), detail(full), `${chest} uses the same detail in both modes`);
    assert.ok(head.includes('translate(50 91) scale(.65) translate(-50 -101)'), 'Detail fits the short bust');
    details.add(detail(head));
    const still = Robot.generate('chest-test', { traits: { ...traits, anim_chest: false } }).svg;
    assert.ok(!still.includes('an-chest'), 'Disabling chest animation works in head mode');
  }
}
assert.equal(details.size, Object.keys(Robot.OPTIONS.chest.values).length, 'Every chest motif remains distinct');
assert.ok(!Robot.LEGS_KEYS.has('chest'), 'Choosing a chest keeps the studio in head mode');
console.log('Robot chest: all 10 motifs, both sizes and animation settings passed.');
