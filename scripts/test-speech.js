const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { Speech } = require('../main/speech');
const { parse, request } = require('../bin/robot-say.js');
const { voiceCommand } = require('../main/speech-voice');
const { install } = require('./install-robot-skill');

function fixture(t, deliver = async () => {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'robotconsole-speech-test-'));
  const speech = new Speech({ userData: root, deliver });
  t.after(() => { speech.stop(); fs.rmSync(root, { recursive: true, force: true }); });
  return { speech, root };
}

test('CLI parses literal messages, options and inherited terminal identity', () => {
  const message = parse(['--robot', 'r1', "C'est terminé"], { ROBOTCONSOLE_SESSION: 'p1' }, process.cwd());
  assert.equal(message.text, "C'est terminé");
  assert.equal(message.session, 'p1');
  assert.equal(message.robot, 'r1');
  assert.equal(parse(['--', '--literal'], {}).text, '--literal');
  for (const args of [[], [' '], ['x'.repeat(4001)], ['--robot'], ['--unknown'], ['--list', '--history'], ['--history', 'text']]) {
    assert.throws(() => parse(args, {}));
  }
});

test('terminal identity follows a tab moved between robots and windows', async (t) => {
  const calls = [];
  const { speech, root } = fixture(t, async (target, text) => calls.push([target.rid, text]));
  speech.publish(1, [{ rid: 'r1', name: 'One', sessions: ['p1'], roots: [root] }]);
  await speech.handle({ action: 'say', session: 'p1', text: 'First' });
  speech.publish(1, [{ rid: 'r1', name: 'One', sessions: [], roots: [root] }]);
  speech.publish(2, [{ rid: 'r2', name: 'Two', sessions: ['p1'], roots: [root] }]);
  await speech.handle({ action: 'say', session: 'p1', text: 'Moved' });
  assert.deepEqual(calls, [['r1', 'First'], ['r2', 'Moved']]);
  speech.dropWindow(2);
  await assert.rejects(speech.handle({ action: 'say', session: 'p1', cwd: root, text: 'Closed' }), /Aucun robot/);
});

test('external terminals require an unambiguous directory or explicit robot', (t) => {
  const { speech, root } = fixture(t);
  speech.publish(1, [
    { rid: 'r1', name: 'Same', sessions: [], roots: [root] },
    { rid: 'r2', name: 'Same', sessions: [], roots: [root] },
  ]);
  assert.throws(() => speech.target({ cwd: path.join(root, 'child') }), /Plusieurs robots/);
  assert.throws(() => speech.target({ robot: 'Same' }), /Plusieurs robots/);
  assert.equal(speech.target({ robot: 'r2' }).rid, 'r2');
  speech.publish(1, [{ rid: 'r1', name: 'One', sessions: [], roots: [root] }]);
  assert.equal(speech.target({ cwd: path.join(root, 'child') }).rid, 'r1');
  assert.throws(() => speech.target({ cwd: root + '-sibling' }), /Aucun robot/);
});

test('history preserves Unicode, source, timestamps and robot separation across restart', (t) => {
  const { speech, root } = fixture(t);
  speech.record({ rid: 'r1', name: 'One', text: "C'est terminé 🤖\nSuite", source: 'cli' });
  speech.record({ rid: 'r2', name: 'Two', text: 'Other' });
  const restored = new Speech({ userData: root });
  const history = restored.history('r1');
  assert.equal(history.length, 1);
  assert.equal(history[0].text, "C'est terminé 🤖\nSuite");
  assert.equal(history[0].source, 'cli');
  assert.ok(Number.isFinite(Date.parse(history[0].at)));
  assert.throws(() => restored.record({ text: ' ' }), /Message vide/);
  fs.appendFileSync(speech.historyFile, 'invalid\n');
  assert.throws(() => restored.history('r1'), SyntaxError, 'Damaged history must not be silently replaced');
});

test('local transport acknowledges only after delivery and reports errors', async (t) => {
  const { speech, root } = fixture(t, async (target, text) => {
    if (text === 'fail') throw new Error('Persistence failed');
    speech.record({ ...target, text, source: 'cli' });
  });
  speech.publish(1, [{ rid: 'r1', name: 'One', sessions: ['p1'], roots: [root] }]);
  await speech.start();
  assert.deepEqual(await request(speech.pipe, { action: 'list' }), [{ rid: 'r1', name: 'One' }]);
  await request(speech.pipe, { action: 'say', session: 'p1', text: "C'est terminé" });
  const history = await request(speech.pipe, { action: 'history', session: 'p1' });
  assert.equal(history[0].text, "C'est terminé");
  await assert.rejects(request(speech.pipe, { action: 'say', session: 'p1', text: 'fail' }), /Persistence failed/);
  await assert.rejects(request(speech.pipe, { action: 'say', session: 'p1', text: '' }), /Message vide/);
  await assert.rejects(request(speech.pipe, { action: 'say', session: 'unknown', text: 'No' }), /Aucun robot/);
});

test('menu history includes all messages while CLI history remains bounded', (t) => {
  const { speech } = fixture(t);
  for (let i = 0; i < 205; i++) speech.record({ rid: 'r1', name: 'One', text: `Message ${i}` });
  const recent = speech.history('r1');
  const all = speech.history('r1', null);
  assert.equal(recent.length, 200);
  assert.equal(recent[0].text, 'Message 5');
  assert.equal(all.length, 205);
  assert.equal(all[0].text, 'Message 0');
});

test('deleting one duplicate or all messages persists and preserves other robots', (t) => {
  const { speech, root } = fixture(t);
  const first = speech.record({ rid: 'r1', text: 'Same' });
  const second = speech.record({ rid: 'r1', text: 'Same' });
  speech.record({ rid: 'r2', text: 'Other' });
  assert.notEqual(first.id, second.id);
  assert.equal(speech.remove('r1', first.id), 1);
  const restored = new Speech({ userData: root });
  assert.deepEqual(restored.history('r1').map((entry) => entry.id), [second.id]);
  assert.throws(() => speech.remove('r2', second.id), /introuvable/);
  assert.equal(speech.remove('r1'), 1);
  assert.equal(restored.history('r1').length, 0);
  assert.equal(restored.history('r2')[0].text, 'Other');
  assert.throws(() => speech.remove('', null), /invalide/);
});

test('legacy messages receive stable unique IDs before deletion', (t) => {
  const { speech, root } = fixture(t);
  const legacy = { at: new Date().toISOString(), rid: 'r1', text: 'Same', source: 'cli' };
  fs.writeFileSync(speech.historyFile, JSON.stringify(legacy) + '\n' + JSON.stringify(legacy) + '\n');
  const migrated = speech.history('r1');
  assert.notEqual(migrated[0].id, migrated[1].id);
  assert.deepEqual(new Speech({ userData: root }).history('r1'), migrated);
  speech.remove('r1', migrated[0].id);
  assert.equal(speech.history('r1')[0].id, migrated[1].id);
});

test('CLI subprocess connects with environment and returns nonzero for failures', async (t) => {
  const { speech, root } = fixture(t, async (target, text) => speech.record({ ...target, text, source: 'cli' }));
  speech.publish(1, [{ rid: 'r1', name: 'One', sessions: ['p1'], roots: [root] }]);
  await speech.start();
  const { spawn } = require('node:child_process');
  const cli = (args) => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(__dirname, '..', 'bin', 'robot-say.js'), ...args],
      { env: { ...process.env, ROBOTCONSOLE_SPEECH_PIPE: speech.pipe, ROBOTCONSOLE_SESSION: 'p1' } });
    let stdout = '', stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.once('error', reject);
    child.once('close', (code) => resolve({ code, stdout, stderr }));
  });
  assert.equal((await cli(["C'est terminé"])).code, 0);
  const history = await cli(['--history']);
  assert.equal(history.code, 0);
  assert.match(history.stdout, /C'est terminé/);
  const failure = await cli(['--robot', 'missing', 'No']);
  assert.equal(failure.code, 1);
  assert.match(failure.stderr, /Aucun robot/);
});

test('Windows voice treats quotes and shell operators as text, not code', () => {
  const text = "C'est terminé; $(Get-Process) \"🤖\"";
  const command = voiceCommand(text, 70, 'win32');
  const script = Buffer.from(command.args.at(-1), 'base64').toString('utf16le');
  assert.ok(!script.includes(text));
  assert.ok(script.includes(Buffer.from(text, 'utf8').toString('base64')));
  assert.match(script, /Volume = 70/);
});

test('skill installer supports all three assistants and refuses conflicting files', (t) => {
  const { root } = fixture(t);
  const targets = install(root);
  assert.equal(targets.length, 2);
  assert.ok(fs.readFileSync(targets[0]).equals(fs.readFileSync(targets[1])));
  fs.writeFileSync(targets[1], 'user changes');
  assert.throws(() => install(root), /Skill existant différent/);
  assert.equal(fs.readFileSync(targets[1], 'utf8'), 'user changes');
  install(root, true);
  assert.ok(fs.readFileSync(targets[0]).equals(fs.readFileSync(targets[1])));
});

test('command reports a closed app instead of claiming delivery', (t) => {
  const { root } = fixture(t);
  const result = spawnSync(process.execPath, [path.join(__dirname, '..', 'bin', 'robot-say.js'), 'hello'],
    { encoding: 'utf8', env: { ...process.env, ROBOTCONSOLE_USERDATA: root, ROBOTCONSOLE_SPEECH_PIPE: '', ROBOTCONSOLE_SESSION: '' } });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /fermé|profil/);
});
