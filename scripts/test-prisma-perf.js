const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { Query } = require('pg');

const filename = path.join(__dirname, '..', 'main', 'prisma.js');
const mainRequire = createRequire(filename);
const source = fs.readFileSync(filename, 'utf8');
const fields = [{ name: 'n', dataTypeID: 23, format: 'text' }];

// Rejoue les réponses du protocole avec la vraie classe Query de pg : un Execute
// borné suspend le portail, un lot simple va jusqu'à CommandComplete.
function harness(plans, failure) {
  const calls = [], requests = [], executed = [], closed = [];
  let released = 0, transferred = 0;
  const client = {
    release() { released++; },
    query(request) {
      if (typeof request === 'string') { calls.push(request); return Promise.resolve({}); }
      calls.push(request.text); requests.push(request);
      const plan = plans.shift();
      assert.ok(plan, `Unexpected query: ${request.text}`);
      const error = plan[0]?.error || failure;
      const connection = {
        stream: {},
        parsedStatements: {}, submittedNamedStatements: {},
        parse() {}, bind() {}, describe() {}, flush() {},
        close(portal) { closed.push(portal); },
        sync() { setImmediate(() => request.handleReadyForQuery(connection)); },
        execute({ rows }) {
          executed.push(rows);
          setImmediate(() => {
            if (error) { request.handleError(error, connection); return; }
            const r = plan[0];
            request.handleRowDescription({ fields: r.fields || fields });
            const count = Math.min(rows, r.count || 0);
            for (let i = 0; i < count; i++) {
              transferred++;
              request.handleDataRow({ fields: [String(i)] });
            }
            if ((r.count || 0) >= rows) request.handlePortalSuspended(connection);
            else request.handleCommandComplete({ text: `${r.command || 'SELECT'} ${r.count || 0}` }, connection);
          });
        },
        query() {
          setImmediate(() => {
            if (error) { request.handleError(error, connection); return; }
            for (const r of plan) {
              if (r.fields !== false) {
                request.handleRowDescription({ fields: r.fields || fields });
                for (let i = 0; i < (r.count || 0); i++) {
                  transferred++;
                  request.handleDataRow({ fields: [String(i)] });
                }
              }
              const command = r.command || 'SELECT';
              request.handleCommandComplete({ text: `${command} ${command === 'INSERT' ? '0 ' : ''}${r.count || 0}` }, connection);
            }
            request.handleReadyForQuery(connection);
          });
        },
      };
      assert.equal(request.submit(connection), null);
    },
  };
  class Pool {
    on() {}
    async connect() { return client; }
  }
  const context = {
    module: { exports: {} }, Buffer, Date, URL,
    require(name) { return name === 'pg' ? { Pool, Query } : mainRequire(name); },
  };
  vm.runInNewContext(source + '\nprojects.set("fixture|schema", { url: "postgresql://localhost/perf" });', context);
  return {
    api: context.module.exports, calls, requests, executed, closed,
    query: (sql, opts) => context.module.exports.query('fixture', 'schema', sql, opts),
    get released() { return released; }, get transferred() { return transferred; },
  };
}

test('Large reads fetch only 1001 rows, close the portal and return an unknown total', async () => {
  const h = harness([[{ count: 1000000 }]]);
  const r = await h.query('select generate_series(1, 1000000)');
  assert.equal(r.ok, true, r.error);
  assert.equal(r.command, 'SELECT');
  assert.equal(r.rowCount, null);
  assert.equal(r.rows.length, 1000);
  assert.equal(r.rows[999][0], 999);
  assert.equal(r.truncated, true);
  assert.equal(h.transferred, 1001);
  assert.deepEqual(h.executed, [1001]);
  assert.equal(h.closed.length, 1);
  assert.equal(h.closed[0].type, 'P');
  assert.equal(h.requests[0]._result.rows.length, 0, 'pg must not accumulate the full result');
  assert.equal(h.calls.at(-1), 'rollback');
  assert.equal(h.released, 1);
});

for (const count of [0, 3, 1000, 1001]) {
  test(`Read boundary: ${count} rows`, async () => {
    const h = harness([[{ count }]]);
    const r = await h.query('select n from numbers');
    assert.equal(r.ok, true);
    assert.equal(r.rows.length, Math.min(1000, count));
    assert.equal(r.truncated, count > 1000);
    assert.equal(r.rowCount, count >= 1001 ? null : count);
    assert.equal(r.columns[0].type, 'int4');
  });
}

test('Every read in a multi-statement batch is bounded; the last result wins', async () => {
  const h = harness([[{ count: 50000 }], [{ count: 2 }]]);
  const r = await h.query('select * from large_table; select 2; -- end');
  assert.equal(r.ok, true);
  assert.equal(r.rows.length, 2);
  assert.equal(r.rowCount, 2);
  assert.equal(r.truncated, false);
  assert.equal(h.transferred, 1003);
  assert.deepEqual(h.executed, [1001, 1001]);
  assert.equal(h.calls[0], 'begin read only');
  assert.equal(h.calls.at(-1), 'rollback');
});

test('SQL delimiters inside literals, quoted identifiers and nested comments are not split', async () => {
  const cases = [
    "select '; insert', 'it''s; fine'; select 2",
    'select $$; delete $$; select 2',
    'select $étiquette$; update $étiquette$; select 2',
    'select "semi;colon"; select 2',
    "select E'escaped\\'; delete'; select 2",
    '/* outer /* nested ; */ comment */ select 1; -- ; delete\nselect 2',
    'select 1; -- comment\rselect 2',
  ];
  for (const sql of cases) {
    const h = harness([[{ count: 1 }], [{ count: 2 }]]);
    const r = await h.query(sql);
    assert.equal(r.ok, true, sql);
    assert.equal(r.readOnly, true, sql);
    assert.equal(h.requests.length, 2, sql);
    assert.equal(r.rows.length, 2, sql);
    assert.ok(h.requests.every((q) => q.rows === 1001));
  }
});

test('Writes require confirmation, and RETURNING executes completely without accumulation', async () => {
  const h = harness([[{ command: 'INSERT', count: 5000 }]]);
  const sql = 'insert into numbers select * from generate_series(1, 5000) returning n';
  assert.equal((await h.query(sql)).needsConfirm, true);
  assert.equal(h.calls.length, 0);
  const r = await h.query(sql, { allowWrite: true });
  assert.equal(r.ok, true);
  assert.equal(r.command, 'INSERT');
  assert.equal(r.rowCount, 5000);
  assert.equal(r.rows.length, 1000);
  assert.equal(r.truncated, true);
  assert.equal(h.transferred, 5000);
  assert.equal(h.requests[0].requiresPreparation(), false);
  assert.equal(h.requests[0]._result.rows.length, 0);
  assert.deepEqual(h.calls, ['begin', sql, 'commit']);
});

test('Mixed batches and explicit transaction text remain intact and complete', async () => {
  const sql = 'begin; select * from numbers; update numbers set n = 2; commit';
  const h = harness([[
    { command: 'BEGIN', fields: false }, { count: 4000 },
    { command: 'UPDATE', fields: false, count: 50 }, { command: 'COMMIT', fields: false },
  ]]);
  const r = await h.query(sql, { allowWrite: true });
  assert.equal(r.ok, true);
  assert.equal(r.command, 'SELECT');
  assert.equal(r.rowCount, 4000);
  assert.equal(r.rows.length, 1000);
  assert.equal(r.truncated, true);
  assert.equal(h.requests.length, 1);
  assert.equal(h.requests[0].text, sql);
  assert.equal(h.transferred, 4000);
  assert.equal(h.calls.at(-1), 'commit');
});

test('An empty last result replaces earlier rows without keeping their truncation flag', async () => {
  const h = harness([[{ count: 2000 }, { count: 0 }, { command: 'COMMIT', fields: false }]]);
  const r = await h.query('select * from numbers; select 1 where false; commit', { allowWrite: true });
  assert.equal(r.ok, true);
  assert.equal(r.rowCount, 0);
  assert.equal(r.rows.length, 0);
  assert.equal(r.truncated, false);
});

test('Command-only writes retain their affected-row count', async () => {
  const h = harness([[{ command: 'UPDATE', fields: false, count: 3000 }]]);
  const r = await h.query('update numbers set n = 0', { allowWrite: true });
  assert.equal(r.command, 'UPDATE');
  assert.equal(r.rowCount, 3000);
  assert.equal(r.columns.length, 0);
  assert.equal(r.rows.length, 0);
  assert.equal(r.truncated, false);
});

test('Data-changing CTEs and writes after CR-only comments still require confirmation', async () => {
  const h = harness([]);
  for (const sql of [
    'with changed as (delete from numbers returning *) select * from changed',
    'select 1; -- comment\rdelete from numbers',
  ]) {
    assert.equal((await h.query(sql)).needsConfirm, true, sql);
  }
  assert.equal(h.calls.length, 0);
});

test('Ambiguous backslash strings use the intact simple-protocol fallback', async () => {
  const sql = "select 'a\\b'";
  const h = harness([[{ count: 2000 }]]);
  const r = await h.query(sql);
  assert.equal(r.ok, true);
  assert.equal(r.rows.length, 1000);
  assert.equal(r.truncated, true);
  assert.equal(h.requests[0].text, sql);
  assert.equal(h.requests[0].requiresPreparation(), false);
});

test('Read and write errors roll back, preserve error information and release the client', async () => {
  for (const sql of ['select broken', 'delete from broken']) {
    const error = Object.assign(new Error('broken'), { code: '42601', position: '8', detail: 'detail' });
    const h = harness([[{ count: 0 }]], error);
    const r = await h.query(sql, { allowWrite: true });
    assert.equal(r.ok, false);
    assert.equal(r.code, '42601');
    assert.equal(r.position, 8);
    assert.equal(r.detail, 'detail');
    assert.equal(h.calls.at(-1), 'rollback');
    assert.equal(h.released, 1);
  }
});

test('Failure in a later read rolls back the batch and does not poison the next query', async () => {
  const error = Object.assign(new Error('later failure'), { code: '42P01' });
  const h = harness([[{ count: 10000 }], [{ error }], [{ count: 1 }]]);
  const failed = await h.query('select * from large_table; select * from missing_table');
  assert.equal(failed.ok, false);
  assert.equal(failed.code, '42P01');
  assert.equal(h.calls.at(-1), 'rollback');
  assert.equal(h.released, 1);
  const next = await h.query('select 1');
  assert.equal(next.ok, true);
  assert.equal(next.rows.length, 1);
  assert.equal(next.truncated, false);
  assert.equal(h.released, 2);
});

test('Errors in split reads retain positions in the original SQL, counting Unicode characters', async () => {
  const prefix = "select '😀';";
  const error = Object.assign(new Error('syntax error'), { code: '42601', position: '8' });
  const h = harness([[{ count: 1 }], [{ error }]]);
  const r = await h.query(prefix + ' select broken');
  assert.equal(r.ok, false);
  assert.equal(r.position, Array.from(prefix).length + 8);
});
