const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { Speech } = require('../main/speech');
const { parse, request } = require('../bin/robot-say.js');
const { SpeechVoice, voiceCommand } = require('../main/speech-voice');
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

test('history preserves Unicode, source, timestamps and robot separation across restart', async (t) => {
  const { speech, root } = fixture(t);
  await speech.record({ rid: 'r1', name: 'One', text: "C'est terminé 🤖\nSuite", source: 'cli' });
  await speech.record({ rid: 'r2', name: 'Two', text: 'Other' });
  const restored = new Speech({ userData: root });
  const history = await restored.history('r1');
  assert.equal(history.length, 1);
  assert.equal(history[0].text, "C'est terminé 🤖\nSuite");
  assert.equal(history[0].source, 'cli');
  assert.ok(Number.isFinite(Date.parse(history[0].at)));
  assert.throws(() => restored.record({ text: ' ' }), /Message vide/);
  fs.appendFileSync(speech.historyFile, 'invalid\n');
  await assert.rejects(restored.history('r1'), SyntaxError, 'Damaged history must not be silently replaced');
});

test('local transport acknowledges only after delivery and reports errors', async (t) => {
  const { speech, root } = fixture(t, async (target, text) => {
    if (text === 'fail') throw new Error('Persistence failed');
    await speech.record({ ...target, text, source: 'cli' });
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

test('explicit complete history includes all messages while CLI history remains bounded', async (t) => {
  const { speech } = fixture(t);
  for (let i = 0; i < 205; i++) await speech.record({ rid: 'r1', name: 'One', text: `Message ${i}` });
  const recent = await speech.history('r1');
  const all = await speech.history('r1', null);
  assert.equal(recent.length, 200);
  assert.equal(recent[0].text, 'Message 5');
  assert.equal(all.length, 205);
  assert.equal(all[0].text, 'Message 0');
});

test('deleting one duplicate or all messages persists and preserves other robots', async (t) => {
  const { speech, root } = fixture(t);
  const first = await speech.record({ rid: 'r1', text: 'Same' });
  const second = await speech.record({ rid: 'r1', text: 'Same' });
  await speech.record({ rid: 'r2', text: 'Other' });
  assert.notEqual(first.id, second.id);
  assert.equal(await speech.remove('r1', first.id), 1);
  const restored = new Speech({ userData: root });
  assert.deepEqual((await restored.history('r1')).map((entry) => entry.id), [second.id]);
  await assert.rejects(speech.remove('r2', second.id), /introuvable/);
  assert.equal(await speech.remove('r1'), 1);
  assert.equal((await restored.history('r1')).length, 0);
  assert.equal((await restored.history('r2'))[0].text, 'Other');
  assert.throws(() => speech.remove('', null), /invalide/);
});

test('legacy messages receive stable unique IDs before deletion', async (t) => {
  const { speech, root } = fixture(t);
  const legacy = { at: new Date().toISOString(), rid: 'r1', text: 'Same', source: 'cli' };
  fs.writeFileSync(speech.historyFile, JSON.stringify(legacy) + '\n' + JSON.stringify(legacy) + '\n');
  const migrated = await speech.history('r1');
  assert.notEqual(migrated[0].id, migrated[1].id);
  assert.deepEqual(await new Speech({ userData: root }).history('r1'), migrated);
  await speech.remove('r1', migrated[0].id);
  assert.equal((await speech.history('r1'))[0].id, migrated[1].id);
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

test('eSpeak sends UTF-8 through stdin and restricts voice arguments', () => {
  const text = "C'est terminé; $(Get-Process) 🤖";
  const command = voiceCommand(text, 70, 'win32', 'espeak:fr+robosoft');
  assert.match(command.file, /espeak-ng\.exe$/);
  assert.ok(command.args.includes('--stdin'));
  assert.ok(!command.args.includes(text));
  assert.deepEqual(command.args.slice(-7), ['-b', '1', '-v', 'fr+robosoft', '-a', '70', '--stdin']);
  assert.ok(voiceCommand(text, 70, 'win32', "Legacy Windows voice").args.includes('fr'));
  assert.throws(() => voiceCommand(text, 70, 'win32', 'espeak:--help'), /indisponible/);
});

test('voice list contains selectable eSpeak presets', { skip: process.platform !== 'win32' || !fs.existsSync(voiceCommand('', 70, 'win32').file) }, async () => {
  const list = await new SpeechVoice().listVoices();
  assert.equal(list.supported, true);
  assert.ok(list.voices.length >= 4);
  for (const voice of list.voices) {
    assert.ok(voiceCommand('Bonjour', 50, 'win32', voice.id).args.includes(voice.id.slice(7)));
  }
});

test('installed eSpeak generates distinct French robot timbres', { skip: process.platform !== 'win32' || !fs.existsSync(voiceCommand('', 70, 'win32').file) }, async (t) => {
  const { root } = fixture(t);
  const list = await new SpeechVoice().listVoices();
  const audio = [];
  for (const voice of list.voices) {
    const command = voiceCommand('Bonjour, écoutons ce robot.', 70, 'win32', voice.id);
    const output = path.join(root, `${audio.length}.wav`);
    const result = spawnSync(command.file, [...command.args, '-w', output], {
      input: 'Bonjour, écoutons ce robot.', encoding: 'utf8', windowsHide: true, timeout: 15000,
    });
    assert.equal(result.status, 0, result.stderr || String(result.error));
    const wav = fs.readFileSync(output);
    assert.equal(wav.toString('ascii', 0, 4), 'RIFF');
    assert.ok(wav.length > 1000);
    if (voice.language === 'fr') audio.push(wav.toString('base64'));
  }
  assert.equal(new Set(audio).size, 4, 'French timbres must produce different audio');
});

test('revoking speech permission stops playback and cancels queued messages', async () => {
  const { EventEmitter } = require('node:events');
  const children = [];
  const voice = new SpeechVoice({ spawnProcess: () => {
    const child = new EventEmitter();
    child.stderr = new EventEmitter();
    child.stdin = new (require('node:stream').PassThrough)();
    child.kill = () => child.emit('close', null);
    children.push(child);
    return child;
  } });
  let allowed = true;
  const first = voice.speak('First', 70, () => allowed);
  const second = voice.speak('Queued', 70, () => allowed);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(children.length, 1);
  if (process.platform === 'win32') assert.equal(children[0].stdin.read().toString('utf8'), 'First');
  allowed = false;
  voice.recheck();
  assert.deepEqual(await first, { cancelled: true });
  assert.deepEqual(await second, { cancelled: true });
  assert.equal(children.length, 1, 'Revoked queued speech never launches a voice process');
  const otherRobot = voice.speak('Other robot', 70, () => true);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(children.length, 2);
  children[1].emit('close', 0);
  await otherRobot;
  voice.stop();
});

test('skill installer supports all three assistants and refuses conflicting files', (t) => {
  const { root } = fixture(t);
  const targets = install(root);
  assert.equal(targets.length, 2);
  assert.ok(fs.readFileSync(targets[0]).equals(fs.readFileSync(targets[1])));
  fs.writeFileSync(targets[1], 'user changes');
  assert.throws(() => install(root), (error) => {
    assert.equal(error.code, 'SKILL_CONFLICT');
    assert.deepEqual(error.files, [targets[1]]);
    return true;
  });
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
