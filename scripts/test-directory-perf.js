const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');

const filename = path.join(__dirname, '..', 'main', 'fs-git.js');
const mainRequire = createRequire(filename);
const source = fs.readFileSync(filename, 'utf8');
const entry = (name, dir = false) => ({ name, isDirectory: () => dir });

function harness(entries, stat, readdir = async () => entries) {
  const handlers = new Map(), stats = [];
  let active = 0, maxActive = 0;
  const context = {
    module: { exports: {} }, setTimeout, clearTimeout,
    require(name) {
      if (name === 'electron') return { ipcMain: { handle: (name, fn) => handlers.set(name, fn), on() {} } };
      if (name === 'fs') return {
        promises: {
          async readdir(dir, opts) { assert.equal(opts.withFileTypes, true); return readdir(dir, opts); },
          async stat(file) {
            stats.push(file); active++; maxActive = Math.max(maxActive, active);
            try {
              await new Promise((resolve) => setImmediate(resolve));
              return await stat(file);
            } finally { active--; }
          },
        },
      };
      return mainRequire(name);
    },
  };
  vm.runInNewContext(source, context);
  context.module.exports.register();
  return {
    list: (opts, dir = path.resolve('directory-fixture')) => handlers.get('fs:list')(null, dir, opts),
    stats, get maxActive() { return maxActive; },
  };
}

test('File sizes remain available with bounded parallelism, without stats for ordinary directories', async () => {
  const entries = Array.from({ length: 100 }, (_, i) => entry(`file${99 - i}`));
  entries.push(entry('folder10', true), entry('folder2', true));
  const h = harness(entries, async () => ({ size: 42, isDirectory: () => false }));
  const rows = await h.list();
  assert.equal(rows.length, 102);
  assert.ok(h.maxActive > 1, 'Stats must no longer run serially');
  assert.ok(h.maxActive <= 16, 'Stats must not flood the filesystem');
  assert.equal(h.stats.length, 100);
  assert.deepEqual(Array.from(rows.slice(0, 4), (r) => r.name), ['folder2', 'folder10', 'file0', 'file1']);
  assert.equal(rows[0].size, 0);
  assert.ok(rows.slice(2).every((r) => r.size === 42));
  assert.ok(rows.every((r) => r.path === path.join(path.resolve('directory-fixture'), r.name)));
  assert.ok(rows.every((r) => !('mtime' in r)), 'No consumer uses directory-list mtimes');
});

test('Directory links and junctions are followed, file links keep their size, broken links remain visible', async () => {
  const entries = [
    entry('dir-link'), entry('file-link'), entry('broken-link'), entry('locked-file'),
    entry('ordinary-dir', true),
  ];
  const h = harness(entries, async (file) => {
    const name = path.basename(file);
    if (name === 'broken-link' || name === 'locked-file') throw new Error('inaccessible');
    return { size: 123, isDirectory: () => name === 'dir-link' };
  });
  const rows = await h.list();
  const byName = Object.fromEntries(rows.map((r) => [r.name, r]));
  assert.equal(byName['dir-link'].isDir, true);
  assert.equal(byName['ordinary-dir'].isDir, true);
  assert.equal(byName['file-link'].isDir, false);
  assert.equal(byName['file-link'].size, 123);
  assert.equal(byName['broken-link'].isDir, false);
  assert.equal(byName['broken-link'].size, 0);
  assert.equal(byName['locked-file'].size, 0);
  assert.equal(h.stats.length, 4);
});

test('Hidden entries are filtered before stat; .git is always excluded', async () => {
  const entries = [entry('.git'), entry('.hidden'), entry('visible'), entry('.directory', true)];
  const h = harness(entries, async () => ({ size: 12, isDirectory: () => false }));
  assert.deepEqual(Array.from(await h.list(), (r) => r.name), ['visible']);
  assert.equal(h.stats.length, 1);
  const all = await h.list({ showHidden: true });
  assert.deepEqual(Array.from(all, (r) => r.name), ['.directory', '.hidden', 'visible']);
  assert.equal(h.stats.length, 3);
});

test('Empty and directory-only listings do not request metadata', async () => {
  for (const entries of [[], [entry('folder', true)]]) {
    const h = harness(entries, () => { throw new Error('Unexpected stat'); });
    assert.equal((await h.list()).length, entries.length);
    assert.equal(h.stats.length, 0);
  }
});

test('Directory read failures propagate to the caller', async () => {
  const error = Object.assign(new Error('Access denied'), { code: 'EACCES' });
  const h = harness([], () => {}, async () => { throw error; });
  await assert.rejects(h.list(), (err) => err === error);
});

test('Real filesystem directory links remain navigable without reading ordinary directory metadata', async (t) => {
  const dir = path.resolve('scripts', `.directory-perf-${require('node:crypto').randomUUID()}`);
  fs.mkdirSync(dir);
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const target = path.join(dir, 'target');
  fs.mkdirSync(target);
  fs.writeFileSync(path.join(dir, 'file.txt'), 'hello');
  fs.symlinkSync(target, path.join(dir, 'directory-link'), process.platform === 'win32' ? 'junction' : 'dir');
  const h = harness([], (file) => fs.promises.stat(file), (dir, opts) => fs.promises.readdir(dir, opts));
  const rows = await h.list({}, dir);
  const byName = Object.fromEntries(rows.map((r) => [r.name, r]));
  assert.equal(byName['directory-link'].isDir, true);
  assert.equal(byName.target.isDir, true);
  assert.equal(byName['file.txt'].size, 5);
  assert.equal(h.stats.length, 2);
});
