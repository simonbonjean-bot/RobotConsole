const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { Subscriptions, copilotQuotas, codexQuotas, claudeQuotas, readCodex } = require('../main/subscriptions');
const { capture } = require('../bin/claude-usage');

async function fixture(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'robotconsole-subscriptions-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return dir;
}

if (process.argv.includes('--live')) {
  (async () => {
    const service = new Subscriptions({ userData: path.join(os.tmpdir(), 'robotconsole-subscriptions-live') });
    const result = await service.read(true);
    for (const p of result) console.log(`${p.id}: ${p.status}, ${p.quotas.length} quotas${p.status === 'error' ? ` (${p.message})` : ''}`);
    if (result.some((p) => p.id !== 'claude' && p.status !== 'ok')) process.exitCode = 1;
  })().catch((e) => { console.error(e.message); process.exitCode = 1; });
} else {
  test('Copilot preserves unavailable quantities and unlimited entitlements', () => {
    const quotas = copilotQuotas({ quotaSnapshots: {
      premium_interactions: { entitlementRequests: 300, usedRequests: 60, remainingPercentage: 80, resetDate: '2026-12-01T00:00:00Z' },
      chat: { entitlementRequests: -1, remainingPercentage: 0 },
      missing: { entitlementRequests: null, usedRequests: null, remainingPercentage: null },
      zero: { entitlementRequests: 0, usedRequests: 0, remainingPercentage: 100 },
    } });
    assert.equal(quotas[0].usedPercent, 20);
    assert.equal(quotas[0].resetAt, '2026-12-01T00:00:00.000Z');
    assert.equal(quotas[1].unlimited, true);
    assert.equal(quotas[1].usedPercent, null);
    assert.equal(quotas[2].used, null);
    assert.equal(quotas[2].usedPercent, null);
    assert.equal(quotas[3].limit, 0);
    assert.throws(() => copilotQuotas({}), /invalide/);
  });

  test('Codex reads multiple quota windows without duplicating the legacy snapshot', () => {
    const q = { planType: 'plus', primary: { usedPercent: 25, windowDurationMins: 300, resetsAt: 1800000000 }, secondary: { usedPercent: null, windowDurationMins: 10080, resetsAt: null } };
    const result = codexQuotas({ rateLimits: q, rateLimitsByLimitId: { codex: q, review: { primary: { usedPercent: 70 } } } });
    assert.equal(result.plan, 'plus');
    assert.equal(result.quotas.length, 3);
    assert.equal(result.quotas[0].usedPercent, 25);
    assert.match(result.quotas[0].label, /5 h/);
    assert.equal(result.quotas[1].usedPercent, null);
    assert.equal(result.quotas[1].resetAt, null);
    assert.equal(codexQuotas({ rateLimits: q }).quotas.length, 2);
    assert.throws(() => codexQuotas({}), /aucun quota/);
  });

  test('Claude bridge captures quotas only, not session content or credentials', async (t) => {
    const dir = await fixture(t);
    const output = path.join(dir, 'claude-usage.json');
    const source = {
      session_id: 'private-session', apiKey: 'not-a-real-secret', transcript_path: 'private-path',
      rate_limits: { five_hour: { used_percentage: 0, resets_at: 1800000000 }, seven_day: { used_percentage: null } },
    };
    assert.equal(claudeQuotas(source)[0].usedPercent, 0);
    capture(source, output);
    const raw = await fs.readFile(output, 'utf8');
    assert.doesNotMatch(raw, /private|apiKey|secret|transcript/);
    const service = new Subscriptions({ userData: dir });
    assert.equal((await service.readClaude()).status, 'ok');
    const data = JSON.parse(raw);
    data.updatedAt = '2020-01-01T00:00:00Z';
    await fs.writeFile(output, JSON.stringify(data));
    const stale = await service.readClaude();
    assert.equal(stale.status, 'stale');
    assert.equal(stale.quotas[0].usedPercent, 0);
    assert.equal(stale.quotas[0].resetAt, '2027-01-15T08:00:00.000Z');
    capture({}, output);
    assert.equal((await service.readClaude()).status, 'unavailable');
  });

  test('Claude install backs up settings and refuses to replace an existing status line', async (t) => {
    const dir = await fixture(t);
    const claudeDir = path.join(dir, '.claude');
    const service = new Subscriptions({ userData: dir, claudeDir });
    assert.equal((await service.readClaude()).status, 'unavailable');
    await fs.mkdir(claudeDir);
    const file = path.join(claudeDir, 'settings.json');
    await fs.writeFile(file, JSON.stringify({ permissions: { allow: ['Read'] } }));
    await service.installClaude();
    const installed = JSON.parse(await fs.readFile(file, 'utf8'));
    assert.equal(installed.statusLine.command, service.claudeCommand());
    assert.deepEqual(installed.permissions, { allow: ['Read'] });
    assert.deepEqual(JSON.parse(await fs.readFile(`${file}.robotconsole-backup`, 'utf8')), { permissions: { allow: ['Read'] } });
    await service.installClaude();
    await fs.writeFile(file, JSON.stringify({ statusLine: { command: 'my-existing-script' } }));
    await assert.rejects(service.installClaude(), /existe déjà/);
    assert.equal(JSON.parse(await fs.readFile(file, 'utf8')).statusLine.command, 'my-existing-script');
  });

  test('Provider errors are isolated, private SDK errors redacted, and concurrent reads deduplicated', async (t) => {
    const dir = await fixture(t);
    let calls = 0;
    const service = new Subscriptions({
      userData: dir,
      copilot: async () => { calls++; throw new Error('private credential'); },
      codex: async () => ({ rateLimits: { primary: { usedPercent: 5 } } }),
    });
    const [a, b] = await Promise.all([service.read(), service.read(true)]);
    assert.strictEqual(a, b);
    assert.equal(calls, 1);
    assert.equal(a[0].status, 'error');
    assert.doesNotMatch(a[0].message, /private credential/);
    assert.equal(a[1].status, 'ok');
    assert.equal(a[2].status, 'unavailable');
    await service.read();
    assert.equal(calls, 1);
    await service.read(true);
    assert.equal(calls, 2);
  });

  test('Codex RPC initializes then reads quota without starting an inference thread', async (t) => {
    const dir = await fixture(t);
    const fake = path.join(dir, 'codex.js');
    await fs.writeFile(fake, `
      const rl = require('node:readline').createInterface({input: process.stdin});
      let initialized = false;
      rl.on('line', line => {
        const m = JSON.parse(line);
        if (m.method === 'initialize') console.log(JSON.stringify({id:m.id,result:{}}));
        else if (m.method === 'initialized') initialized = true;
        else if (m.method === 'account/rateLimits/read' && initialized) console.log(JSON.stringify({id:m.id,result:{rateLimits:{primary:{usedPercent:12}}}}));
        else process.exit(1);
      });
    `);
    const result = await readCodex({ file: process.execPath, args: [fake] }, 3000);
    assert.equal(result.rateLimits.primary.usedPercent, 12);
    const idle = path.join(dir, 'idle.js');
    await fs.writeFile(idle, 'process.stdin.resume();');
    await assert.rejects(readCodex({ file: process.execPath, args: [idle] }, 100), /dépassé/);
  });
}
