const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Speech } = require('../main/speech');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(process.cwd(), '.speech-perf-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return new Speech({ userData: root });
}

function write(speech, entries, separator = '\n') {
  fs.writeFileSync(speech.historyFile, entries.map((entry) => JSON.stringify(entry)).join(separator) + separator);
}

test('large logs read only an asynchronous bounded tail and leave the file untouched', async (t) => {
  const speech = fixture(t);
  const line = JSON.stringify({ id: 'old', rid: 'r', text: 'Old '.repeat(100) }) + '\n';
  fs.writeFileSync(speech.historyFile, line.repeat(30000));
  fs.appendFileSync(speech.historyFile, Array.from({ length: 205 }, (_, i) =>
    JSON.stringify({ id: `m${i}`, rid: 'r', text: `Message ${i} 🤖` }) + '\n').join(''));
  const before = fs.statSync(speech.historyFile);
  t.mock.method(fs, 'readFileSync', () => { throw new Error('Synchronous history read'); });
  t.mock.method(fs.promises, 'readFile', () => { throw new Error('Whole-file history read'); });
  let bytes = 0;
  const open = fs.promises.open.bind(fs.promises);
  t.mock.method(fs.promises, 'open', async (...args) => {
    const handle = await open(...args);
    const read = handle.read.bind(handle);
    handle.read = async (...readArgs) => {
      const result = await read(...readArgs);
      bytes += result.bytesRead;
      return result;
    };
    return handle;
  });
  let ticked = false;
  setImmediate(() => { ticked = true; });
  const page = await speech.historyPage('r');
  assert.equal(ticked, true, 'History yields to the event loop');
  assert.equal(page.entries.length, 100);
  assert.equal(page.entries[0].id, 'm105');
  assert.equal(page.entries.at(-1).text, 'Message 204 🤖');
  assert.ok(page.nextCursor);
  assert.ok(bytes <= 128 * 1024, `Read ${bytes} bytes for the initial page`);
  assert.equal(fs.statSync(speech.historyFile).size, before.size);
  assert.equal(fs.statSync(speech.historyFile).mtimeMs, before.mtimeMs);
});

test('pages retain chronological ordering, UTF-8 boundaries and every legacy ID across restart and deletion', async (t) => {
  const speech = fixture(t);
  const entries = Array.from({ length: 410 }, (_, i) => ({
    rid: i % 3 === 0 ? 'other' : 'r', text: `${i}: 🤖é漢字\n`.repeat(50), source: 'cli',
  }));
  write(speech, entries, '\r\n');
  const original = fs.readFileSync(speech.historyFile);
  let cursor = null, collected = [], pages = 0;
  do {
    const page = await speech.historyPage('r', { cursor, limit: 17 });
    assert.ok(page.entries.length <= 17);
    collected.unshift(...page.entries);
    cursor = page.nextCursor;
    pages++;
  } while (cursor);
  assert.ok(pages > 10);
  assert.deepEqual(collected.map((entry) => entry.text), entries.filter((entry) => entry.rid === 'r').map((entry) => entry.text));
  assert.equal(new Set(collected.map((entry) => entry.id)).size, collected.length);
  assert.deepEqual(fs.readFileSync(speech.historyFile), original, 'Reading legacy entries does not rewrite or truncate history');
  const restored = new Speech({ userData: path.dirname(speech.historyFile) });
  assert.deepEqual(await restored.history('r', null), collected);
  const stale = (await speech.historyPage('r', { limit: 1 })).nextCursor;
  await speech.remove('r', collected[0].id);
  await assert.rejects(speech.historyPage('r', { cursor: stale }), /modifié/);
  assert.deepEqual((await speech.history('r', null)).map((entry) => entry.id), collected.slice(1).map((entry) => entry.id));
  assert.equal((await speech.history('other', null)).length, entries.filter((entry) => entry.rid === 'other').length);
});

test('sparse robots have a scan budget, can continue through empty pages and preserve append cursors', async (t) => {
  const speech = fixture(t);
  write(speech, [{ rid: 'r', text: 'Oldest' }, ...Array.from({ length: 1500 }, (_, i) =>
    ({ id: `other-${i}`, rid: 'other', text: 'é'.repeat(500) })), { rid: 'r', text: 'Newest' }]);
  const first = await speech.historyPage('r');
  assert.deepEqual(first.entries.map((entry) => entry.text), ['Newest']);
  assert.ok(first.nextCursor);
  await speech.record({ rid: 'r', text: 'Appended' });
  let cursor = first.nextCursor, older = [], emptyPages = 0;
  while (cursor) {
    const page = await speech.historyPage('r', { cursor });
    if (!page.entries.length) emptyPages++;
    older.unshift(...page.entries);
    cursor = page.nextCursor;
  }
  assert.ok(emptyPages > 0);
  assert.deepEqual(older.map((entry) => entry.text), ['Oldest']);
  assert.equal((await speech.historyPage('r')).entries.at(-1).text, 'Appended');
});

test('invalid cursors, limits and damaged JSON report errors without losing history', async (t) => {
  const speech = fixture(t);
  assert.deepEqual(await speech.historyPage('r'), { entries: [], nextCursor: null });
  await speech.record({ rid: 'r', text: 'Keep' });
  await speech.record({ rid: 'r', text: 'Keep too' });
  const { nextCursor } = await speech.historyPage('r', { limit: 1 });
  for (const options of [{ limit: 0 }, { limit: 201 }, { limit: '100' }, { cursor: 3 }, { cursor: 'bad' }]) {
    await assert.rejects(speech.historyPage('r', options), /invalide/);
  }
  await assert.rejects(speech.historyPage('other', { cursor: nextCursor }), /invalide/);
  fs.appendFileSync(speech.historyFile, 'broken\n');
  const damaged = fs.readFileSync(speech.historyFile);
  await assert.rejects(speech.historyPage('r'), SyntaxError);
  await assert.rejects(speech.remove('r'), SyntaxError);
  assert.deepEqual(fs.readFileSync(speech.historyFile), damaged);
  assert.deepEqual(fs.readdirSync(path.dirname(speech.historyFile)), ['speech-history.jsonl']);
});

test('concurrent appends, reads and deletions serialize without losing records', async (t) => {
  const speech = fixture(t);
  await speech.record({ rid: 'r', text: 'Delete' });
  const operations = [];
  operations.push(speech.remove('r'));
  for (let i = 0; i < 50; i++) operations.push(speech.record({ rid: 'r', text: `Keep ${i}` }));
  operations.push(speech.historyPage('r'));
  const results = await Promise.all(operations);
  assert.equal(results[0], 1);
  assert.equal(results.at(-1).entries.length, 50);
  assert.deepEqual((await speech.history('r')).map((entry) => entry.text), Array.from({ length: 50 }, (_, i) => `Keep ${i}`));
});

test('unterminated legacy logs keep their last message and stable IDs when appended', async (t) => {
  const speech = fixture(t);
  fs.writeFileSync(speech.historyFile, JSON.stringify({ rid: 'r', text: 'Legacy 🤖' }));
  const before = await speech.historyPage('r');
  await speech.record({ rid: 'r', text: 'New' });
  const after = await speech.historyPage('r');
  assert.deepEqual(after.entries.map((entry) => entry.text), ['Legacy 🤖', 'New']);
  assert.equal(after.entries[0].id, before.entries[0].id);
  await speech.remove('r', before.entries[0].id);
  assert.deepEqual((await speech.history('r')).map((entry) => entry.text), ['New']);
});
