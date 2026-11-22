// Run with: node --test scripts\test-remote-editor.js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function setup() {
  const file = 'C:\\project\\notes.txt';
  const state = { content: 'hello\r\n', mtime: 1, kind: 'text', writes: [] };
  const api = {
    onFsChanged() {},
    async readFile(p, max) {
      assert.equal(p, file);
      const size = Buffer.byteLength(state.content);
      return { kind: state.kind, size, mtime: state.mtime, content: state.content.slice(0, max), truncated: size > max };
    },
    async writeText(p, content) {
      state.writes.push({ p, content });
      state.content = content;
      return ++state.mtime;
    },
  };
  const context = vm.createContext({ window: { api }, TextEncoder });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'renderer', 'editor.js'), 'utf8'), context);
  context.Editor = context.window.Editor;
  context.Settings = { data: {} };
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'renderer', 'explorer-tab.js'), 'utf8'), context);
  return { file, state, api, editor: context.Editor, kinds: context.window.TabKinds };
}

test('remote text editing persists Unicode, CRLF and empty files', async () => {
  for (const content of ['bonjour é\r\n', '']) {
    const { editor, state, file } = setup();
    const opened = await editor.remoteFile(file);
    const result = await editor.remoteSave(file, { ...opened.edit, content });
    assert.equal(result.error, undefined);
    assert.equal(state.content, content);
    assert.equal(result.mtime, 2);
    assert.equal(state.writes.length, 1);
  }
});

test('changed files are not overwritten even when timestamps match', async () => {
  const { editor, state, file } = setup();
  const opened = await editor.remoteFile(file);
  state.content = 'another device';
  assert.ok((await editor.remoteSave(file, { ...opened.edit, content: 'draft' })).error);
  assert.equal(state.writes.length, 0);
});

test('stale timestamps and invalid save requests cannot write', async () => {
  const { editor, state, file } = setup();
  const opened = await editor.remoteFile(file);
  state.mtime++;
  for (const args of [{ ...opened.edit, content: 'draft' }, {}, { content: 'draft', original: 'hello\r\n', mtime: '1' }]) {
    assert.ok((await editor.remoteSave(file, args)).error);
  }
  assert.equal(state.writes.length, 0);
});

test('binary and large text files remain non-editable without shrinking previews', async () => {
  const { editor, state, file } = setup();
  state.kind = 'binary';
  assert.ok((await editor.remoteFile(file)).error);
  state.kind = 'text';
  state.content = 'a'.repeat(65 * 1024);
  const opened = await editor.remoteFile(file);
  assert.equal(opened.edit, null);
  assert.equal(opened.text, state.content);
  assert.ok((await editor.remoteSave(file, { original: 'hello\r\n', mtime: 1, content: state.content })).error);
  assert.equal(state.writes.length, 0);
});

test('concurrent saves cannot overwrite each other', async () => {
  const { editor, state, file, api } = setup();
  const opened = await editor.remoteFile(file);
  const write = api.writeText;
  let finish;
  api.writeText = async (...args) => {
    await new Promise((resolve) => { finish = resolve; });
    return write(...args);
  };
  const args = { ...opened.edit, content: 'first' };
  const saving = editor.remoteSave(file, args);
  await Promise.resolve();
  assert.ok((await editor.remoteSave(file, { ...args, content: 'second' })).error);
  finish();
  await saving;
  assert.equal(state.content, 'first');
  assert.equal(state.writes.length, 1);
});

test('write errors propagate and release the save lock for retry', async () => {
  const { editor, file, api } = setup();
  const opened = await editor.remoteFile(file);
  const write = api.writeText;
  api.writeText = async () => { throw new Error('Permission denied'); };
  const args = { ...opened.edit, content: 'draft' };
  await assert.rejects(editor.remoteSave(file, args), /Permission denied/);
  api.writeText = write;
  assert.equal((await editor.remoteSave(file, args)).error, undefined);
});

test('editor tabs have a preview and only save their own file', async () => {
  const { kinds, file, state } = setup();
  const tab = { file };
  const snapshot = await kinds.editor.remoteSnapshot(tab);
  assert.equal(snapshot.text, state.content);
  const opened = await kinds.editor.remoteAction(tab, 'view');
  assert.ok(opened.edit);
  assert.ok((await kinds.editor.remoteAction(tab, 'save', { ...opened.edit, item: 'C:\\other.txt', content: 'draft' })).error);
  assert.equal(state.writes.length, 0);
  assert.ok(!kinds.editor.remoteReadActions.includes('save'));
});

test('explorer editing respects root boundaries and read-only action lists', async () => {
  const { kinds, file, state } = setup();
  const tab = { ex: { root: 'C:\\project' } };
  const opened = await kinds.explorer.remoteAction(tab, 'view', { item: file });
  assert.ok(opened.edit);
  for (const item of ['C:\\outside\\notes.txt', 'C:\\project\\..\\outside.txt']) {
    assert.ok((await kinds.explorer.remoteAction(tab, 'save', { ...opened.edit, item, content: 'draft' })).error);
  }
  assert.equal(state.writes.length, 0);
  const result = await kinds.explorer.remoteAction(tab, 'save', { ...opened.edit, item: file, content: 'draft' });
  assert.equal(result.error, undefined);
  assert.equal(state.content, 'draft');
  assert.ok(!kinds.explorer.remoteReadActions.includes('save'));
});
