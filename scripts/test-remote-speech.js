const { test } = require('node:test');
const assert = require('node:assert/strict');
const Remote = require('../main/remote');

function harness(getSpeechHistory = () => []) {
  const messages = [];
  const remote = new Remote({ ptyHost: null, getWc: () => null, getSpeechHistory });
  const socket = { readyState: 1, subs: new Set(), send: (raw) => messages.push(JSON.parse(raw)) };
  remote.clients.add(socket);
  remote.publish(1, [
    { key: 'read', mode: 'read', tabs: [] },
    { key: 'control', mode: 'control', tabs: [] },
    { key: 'private', mode: 'off', tabs: [] },
  ]);
  messages.length = 0;
  return { remote, socket, messages };
}

test('Live speech is restricted to robots shared by the sending window', () => {
  const { remote, messages } = harness();
  remote.speech(1, { rid: 'private', text: 'Secret' }, 2000);
  remote.speech(2, { rid: 'read', text: 'Wrong window' }, 2000);
  assert.equal(messages.length, 0);
  for (const rid of ['read', 'control']) remote.speech(1, { rid, text: 'Done' }, 3500);
  assert.deepEqual(messages.map((m) => [m.key, m.entry.text, m.duration]), [
    ['read', 'Done', 3500], ['control', 'Done', 3500],
  ]);
  remote.publish(1, []);
  messages.length = 0;
  remote.speech(1, { rid: 'read', text: 'Revoked' }, 2000);
  assert.equal(messages.length, 0);
});

test('Paginated history is scoped to an authorized robot, including robots without tabs', async () => {
  const requested = [];
  const entries = Array.from({ length: 205 }, (_, i) => ({ rid: 'read', text: `Message ${i}` }));
  const { remote, socket, messages } = harness((rid, options) => { requested.push([rid, options]); return { entries, nextCursor: 'older' }; });
  await remote._handle(socket, { t: 'speechHistory', wcId: 1, key: 'read', cursor: 'previous', limit: 50, req: 1 });
  assert.deepEqual(messages[0].result.entries, entries);
  assert.equal(messages[0].result.nextCursor, 'older');
  for (const [wcId, key] of [[1, 'private'], [2, 'read'], [1, 'missing']]) {
    await remote._handle(socket, { t: 'speechHistory', wcId, key, req: 2 });
    assert.ok(messages.at(-1).result.error);
    assert.equal(messages.at(-1).result.entries, undefined);
  }
  assert.deepEqual(requested, [['read', { cursor: 'previous', limit: 50 }]]);
});

test('History cannot be delivered after sharing is revoked while reading', async () => {
  let resolve;
  const { remote, socket, messages } = harness(() => new Promise((r) => { resolve = r; }));
  const reading = remote._handle(socket, { t: 'speechHistory', wcId: 1, key: 'read', req: 1 });
  remote.dropWindow(1);
  resolve([{ text: 'No longer shared' }]);
  await reading;
  assert.ok(messages.at(-1).result.error);
  assert.equal(messages.at(-1).result.entries, undefined);
});

test('History failures are reported and deletions only notify shared robots', async (t) => {
  const { remote, socket, messages } = harness(() => { throw new Error('Disk unreadable'); });
  const errors = [];
  t.mock.method(console, 'error', (...args) => errors.push(args));
  await remote._handle(socket, { t: 'speechHistory', wcId: 1, key: 'read', req: 1 });
  assert.equal(messages[0].result.error, 'Disk unreadable');
  assert.equal(errors.length, 1);
  messages.length = 0;
  remote.speechChanged('private');
  assert.equal(messages.length, 0);
  remote.speechChanged('read');
  assert.deepEqual(messages, [{ t: 'speechChanged', wcId: 1, key: 'read' }]);
});
