const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { createRequire } = require('node:module');
const vm = require('node:vm');
const { createFileSearch, scorePath, LIMITS } = require('../main/file-search');
const exec = promisify(execFile);
const filename = path.join(__dirname, '..', 'main', 'file-search.js');

async function fixture(t) {
  // Keep fixtures in the project, without searching the enclosing repository.
  const base = await fs.mkdtemp(path.join(__dirname, 'file-search-fixture-'));
  const previous = process.env.GIT_CEILING_DIRECTORIES;
  process.env.GIT_CEILING_DIRECTORIES = base;
  t.after(async () => {
    if (previous === undefined) delete process.env.GIT_CEILING_DIRECTORIES;
    else process.env.GIT_CEILING_DIRECTORIES = previous;
    await fs.rm(base, { recursive: true, force: true });
  });
  const root = path.join(base, 'workspace');
  await fs.mkdir(root);
  const write = async (relative, content = '') => {
    const file = path.join(root, relative);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, content);
  };
  const git = (...args) => exec('git', ['-C', root, ...args], { windowsHide: true });
  const service = createFileSearch({ getRoots: () => [root] });
  return { base, root, write, git, service, search: (options = {}) =>
    service.search(1, { root, query: '', requestId: 1, ...options }) };
}

async function mockedFactory(overrides) {
  const source = await fs.readFile(filename, 'utf8'), realRequire = createRequire(filename);
  const context = {
    module: { exports: {} }, process, Buffer, AbortController, setTimeout, clearTimeout,
    require: (name) => overrides[name] || realRequire(name),
  };
  vm.runInNewContext(source, context, { filename });
  return context.module.exports.createFileSearch;
}

function childProcess() {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  let closed = false;
  child.finish = (code = 0, output = '', error = '') => {
    if (closed) return;
    closed = true;
    child.stdout.end(output);
    child.stderr.end(error);
    setImmediate(() => child.emit('close', code));
  };
  child.kill = () => { child.killed = true; child.finish(143); return true; };
  return child;
}

test('Git lists tracked/untracked NUL paths, excludes ignored/dependencies, and widens explicitly', async (t) => {
  const f = await fixture(t);
  await f.git('init', '--quiet');
  const oddName = process.platform === 'win32' ? 'unicode name.txt' : 'unicode\nname.txt';
  await f.write('.gitignore', 'ignored/\n*.secret\n');
  await f.write('src/Café file.js');
  await f.write(oddName);
  await f.write('visible.txt');
  await f.write('tracked.secret');
  await f.write('untracked.secret');
  await f.write('ignored/file.txt');
  await f.write('node_modules/pkg/index.js');
  await f.write('vendor/lib.js');
  await f.git('add', '--', '.gitignore', 'src', oddName, 'visible.txt');
  await f.git('add', '-f', '--', 'tracked.secret', 'node_modules');
  const normal = await f.search();
  assert.equal(normal.partial, false);
  assert.deepEqual(normal.warnings, []);
  assert.deepEqual(normal.files.map((file) => file.relative).sort(), [
    '.gitignore', path.join('src', 'Café file.js'), 'tracked.secret', oddName, 'visible.txt',
  ].sort());
  const wide = await f.search({ includeIgnored: true });
  assert.equal(wide.partial, false);
  assert.ok(wide.files.some((file) => file.relative === 'untracked.secret'));
  assert.ok(wide.files.some((file) => file.relative === path.join('ignored', 'file.txt')));
  assert.ok(wide.files.some((file) => file.relative === path.join('node_modules', 'pkg', 'index.js')));
  assert.ok(wide.files.some((file) => file.relative === path.join('vendor', 'lib.js')));
  assert.ok(wide.files.every((file) => !file.relative.split(path.sep).includes('.git')));
  const found = await f.search({ query: 'CAFE JS' });
  assert.deepEqual(found.files.map((file) => file.relative), [path.join('src', 'Café file.js')]);
  assert.ok(found.files.every((file) => file.path === path.join(f.root, file.relative)));
});

test('Non-Git traversal keeps hidden files, widens dependencies and reports nested repositories', async (t) => {
  const f = await fixture(t);
  await f.write('.hidden');
  await f.write('.gitignore', 'ignored.txt\n');
  await f.write('ignored.txt');
  await f.write('src/read me.md');
  await f.write('.venv/lib/file.py');
  await f.write('node_modules/package.js');
  await fs.mkdir(path.join(f.root, 'nested'));
  await exec('git', ['-C', path.join(f.root, 'nested'), 'init', '--quiet']);
  await f.write('nested/hidden-from-parent.txt');
  const normal = await f.search();
  assert.deepEqual(normal.files.map((file) => file.relative).sort(), [
    '.hidden', '.gitignore', 'ignored.txt', path.join('src', 'read me.md'),
  ].sort());
  assert.equal(normal.partial, true);
  assert.match(normal.warnings.join('\n'), /Nested repositories/);
  const wide = await f.search({ includeIgnored: true });
  assert.ok(wide.files.some((file) => file.relative === path.join('.venv', 'lib', 'file.py')));
  assert.ok(wide.files.some((file) => file.relative === path.join('node_modules', 'package.js')));
  assert.ok(wide.files.every((file) => !file.relative.startsWith(`nested${path.sep}`)));
});

test('Git workspace subdirectory stays scoped and does not traverse nested repositories', async (t) => {
  const f = await fixture(t);
  await f.git('init', '--quiet');
  await f.write('outside.txt');
  await f.write('src/inside.txt');
  await fs.mkdir(path.join(f.root, 'src', 'nested'));
  await exec('git', ['-C', path.join(f.root, 'src', 'nested'), 'init', '--quiet']);
  await f.write('src/nested/file.txt');
  const root = path.join(f.root, 'src');
  const service = createFileSearch({ getRoots: () => [root] });
  const result = await service.search(1, { root, requestId: 'sub', query: '' });
  assert.deepEqual(result.files.map((file) => file.relative), ['inside.txt']);
  assert.equal(result.partial, true);
  assert.match(result.warnings.join('\n'), /Nested repositories/);
});

test('Roots must match authorized canonical directories, not their children or another sender', async (t) => {
  const f = await fixture(t);
  await f.write('child/file.txt');
  await fs.mkdir(path.join(f.base, 'other'));
  await assert.rejects(f.search({ root: path.join(f.root, 'child') }), /not authorized/);
  await assert.rejects(f.search({ root: path.join(f.base, 'other') }), /not authorized/);
  await assert.rejects(f.search({ root: '.' }), /Invalid/);
  await assert.rejects(f.search({ includeIgnored: 'yes' }), /Invalid/);
  await assert.rejects(f.search({ query: null }), /Invalid/);
  await assert.rejects(f.search({ requestId: {} }), /Invalid/);
  const scoped = createFileSearch({ getRoots: (sender) => sender === 1 ? [f.root] : [] });
  await assert.rejects(scoped.search(2, { root: f.root, query: '', requestId: 1 }), /not authorized/);
  assert.equal((await f.search({ root: path.join(f.root, 'child', '..') })).files.length, 1);
});

test('Symlinks/junctions neither escape nor loop; canonical root aliases are accepted', async (t) => {
  const f = await fixture(t);
  await f.write('inside.txt');
  const outside = path.join(f.base, 'outside');
  await fs.mkdir(outside);
  await fs.writeFile(path.join(outside, 'secret.txt'), '');
  await fs.symlink(outside, path.join(f.root, 'escape'), process.platform === 'win32' ? 'junction' : 'dir');
  await fs.symlink(f.root, path.join(f.root, 'loop'), process.platform === 'win32' ? 'junction' : 'dir');
  const alias = path.join(f.base, 'alias');
  await fs.symlink(f.root, alias, process.platform === 'win32' ? 'junction' : 'dir');
  const result = await f.search({ root: alias, includeIgnored: true });
  assert.deepEqual(result.files.map((file) => file.relative), ['inside.txt']);
  assert.equal(result.partial, false);
  await f.git('init', '--quiet');
  await f.git('add', '--', 'inside.txt');
  const gitResult = await f.search({ includeIgnored: true });
  assert.deepEqual(gitResult.files.map((file) => file.relative), ['inside.txt']);
});

test('Fuzzy path/name ranking normalizes accents, case, separators and all simple terms', () => {
  assert.ok(scorePath('src/CaféMenu.js', 'cafe') > scorePath('src/crafter.js', 'cafe'));
  assert.notEqual(scorePath('src/CaféMenu.js', 'cmj'), null);
  assert.notEqual(scorePath('src/CaféMenu.js', 'SRC\\CAFE js'), null);
  assert.equal(scorePath('src/CaféMenu.js', 'missing js'), null);
});

test('Result truncation is explicit and sorted top matches survive the cap', async (t) => {
  const f = await fixture(t);
  await Promise.all(Array.from({ length: LIMITS.results + 3 }, (_, i) => f.write(`file-${i}.txt`)));
  const result = await f.search({ query: 'file' });
  assert.equal(result.files.length, LIMITS.results);
  assert.equal(result.partial, true);
  assert.match(result.warnings.join('\n'), /Results limited to 100/);
  const refined = await f.search({ query: 'file-102.txt' });
  assert.equal(refined.files[0].relative, 'file-102.txt');
  assert.equal(refined.partial, false);
});

test('Cancellation is sender/request scoped, newest wins, and disposal invalidates pending work', async (t) => {
  const f = await fixture(t);
  await f.write('file.txt');
  const gates = [];
  const service = createFileSearch({ getRoots: () => new Promise((resolve) => gates.push(resolve)) });
  const options = (requestId) => ({ root: f.root, query: '', requestId });
  const old = service.search(1, options('old'));
  const other = service.search(2, options('other'));
  assert.equal(service.cancel(1, 'wrong'), false);
  const newest = service.search(1, options('new'));
  gates.splice(0).forEach((release) => release([f.root]));
  assert.match((await old).warnings[0], /cancelled/);
  assert.equal((await other).partial, false);
  assert.equal((await newest).partial, false);
  const cancelled = service.search(1, options('cancel'));
  assert.equal(service.cancel(2, 'cancel'), false);
  assert.equal(service.cancel(1, 'cancel'), true);
  gates.shift()([f.root]);
  assert.deepEqual((await cancelled).files, []);
  const disposed = service.search(1, options('dispose'));
  service.disposeSender(1);
  gates.shift()([f.root]);
  assert.match((await disposed).warnings[0], /cancelled/);
  assert.equal(service.cancel(1, 'dispose'), false);
});

test('Cancellation terminates a running Git listing and yields a cancelled response', async (t) => {
  const f = await fixture(t);
  let started;
  const listingStarted = new Promise((resolve) => { started = resolve; });
  let listing;
  const factory = await mockedFactory({ 'node:child_process': { spawn(_command, args) {
    const child = childProcess();
    if (args.includes('rev-parse')) setImmediate(() => child.finish(0, 'true\n'));
    else { listing = child; started(); }
    return child;
  } } });
  const service = factory({ getRoots: () => [f.root] });
  const response = service.search(1, { root: f.root, query: '', requestId: 42 });
  await listingStarted;
  assert.equal(service.cancel(1, 42), true);
  const result = await response;
  assert.equal(listing.killed, true);
  assert.equal(result.partial, true);
  assert.match(result.warnings[0], /cancelled/);
});

test('Git failures are not silently replaced by traversal (corrupt index, bare repo and missing executable)', async (t) => {
  const f = await fixture(t);
  await f.git('init', '--quiet');
  await f.write('file.txt');
  await fs.writeFile(path.join(f.root, '.git', 'index'), 'corrupt index');
  await assert.rejects(f.search(), /Git file search failed/);
  const bare = path.join(f.base, 'bare');
  await exec('git', ['init', '--bare', '--quiet', bare]);
  const service = createFileSearch({ getRoots: () => [bare] });
  await assert.rejects(service.search(1, { root: bare, query: '', requestId: 1 }), /bare repository/);
  const factory = await mockedFactory({ 'node:child_process': { spawn() {
    const child = childProcess();
    setImmediate(() => { child.emit('error', new Error('ENOENT git')); child.finish(1); });
    return child;
  } } });
  await assert.rejects(factory({ getRoots: () => [f.root] }).search(1,
    { root: f.root, query: '', requestId: 1 }), /Cannot start Git/);
});

test('Git scan/output bounds are explicit; malformed or outside paths never leak files', async (t) => {
  const f = await fixture(t);
  await f.write('visible.txt');
  let listingOutput;
  const factory = await mockedFactory({ 'node:child_process': { spawn(_command, args) {
    const child = childProcess();
    setImmediate(() => child.finish(0, args.includes('rev-parse') ? 'true\n' : listingOutput));
    return child;
  } } });
  const service = factory({ getRoots: () => [f.root] });
  const options = { root: f.root, query: '', requestId: 1 };
  listingOutput = Array.from({ length: LIMITS.entries + 1 }, () => 'node_modules/excluded\0').join('');
  const capped = await service.search(1, options);
  assert.equal(capped.partial, true);
  assert.match(capped.warnings.join('\n'), /Scan limited/);
  listingOutput = 'x'.repeat(LIMITS.outputBytes + 1);
  const outputCapped = await service.search(1, options);
  assert.match(outputCapped.warnings.join('\n'), /Git output limited/);
  listingOutput = `..${path.sep}outside.txt\0visible.txt\0`;
  const safe = await service.search(1, options);
  assert.deepEqual(Array.from(safe.files, (file) => file.relative), ['visible.txt']);
  assert.match(safe.warnings.join('\n'), /outside/);
  listingOutput = 'visible.txt';
  await assert.rejects(service.search(1, options), /incomplete NUL-delimited/);
});

test('Non-Git directory access errors produce partial results and visible warnings', async (t) => {
  const f = await fixture(t);
  await f.write('visible.txt');
  await f.write('locked/file.txt');
  const factory = await mockedFactory({ 'node:fs/promises': {
    ...fs,
    async opendir(directory) {
      if (path.basename(directory) === 'locked') throw Object.assign(new Error('access denied'), { code: 'EACCES' });
      return fs.opendir(directory);
    },
  } });
  const result = await factory({ getRoots: () => [f.root] }).search(1, { root: f.root, query: '', requestId: 1 });
  assert.deepEqual(Array.from(result.files, (file) => file.relative), ['visible.txt']);
  assert.equal(result.partial, true);
  assert.match(result.warnings.join('\n'), /locked: EACCES/);
});
