const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createHash } = require('node:crypto');
const { execFileSync, spawnSync } = require('node:child_process');

const root = path.join(__dirname, '..');
const options = Object.fromEntries(process.argv.slice(2).map((arg) => {
  const match = /^--(before|samples|output)=(.+)$/.exec(arg);
  if (!match) throw new Error('Usage: node scripts\\profile-perf.js [--before=0ceeedc^] [--samples=3] [--output=report.json]');
  return match.slice(1);
}));
const samples = Number(options.samples || 3);
if (!Number.isInteger(samples) || samples < 1 || samples > 10) throw new Error('samples must be between 1 and 10');
const git = (...args) => execFileSync('git', ['--no-pager', ...args], { cwd: root, encoding: 'utf8', windowsHide: true });
const before = git('rev-parse', '--verify', '--end-of-options', `${options.before || '0ceeedc^'}^{commit}`).trim();
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'robotconsole-profile-perf-'));
const report = {
  at: new Date().toISOString(),
  platform: `${process.platform} ${os.release()} ${process.arch}`,
  electron: require('electron/package.json').version,
  before,
  after: { head: git('rev-parse', 'HEAD').trim(), dirty: !!git('status', '--porcelain').trim() },
  scope: 'Temporary 4-space/20-tab app, synthetic terminal output, real Git and local HTTP/WebSocket mobile UI; no live CLI or PostgreSQL',
  metrics: {
    cpu: 'Sum of Electron process cumulative CPU deltas over 5 seconds, expressed as percent of one logical core (can exceed 100%)',
    memory: '50 ms sampled sum of Electron working sets in MiB (shared pages may be counted more than once); mainHeapMiB is the main-process JS heap only',
    restore: 'Child script start to restored selected terminal ready; firstInput also confirms a synthetic key reached the mocked PTY client',
    folder: 'First explorer activation to 3000 rendered rows; listMs measures three real directory reads through IPC',
    terminal: '8000 uniquely numbered lines injected at PtyClient.onData, through the actual main IPC and xterm; ordered content asserted',
    responsiveness: '10 ms renderer heartbeat delay, not hardware keyboard-to-screen latency; maximum and P95 include sample counts',
    mobile: 'Actual mobile UI over authenticated loopback HTTP/WebSocket; initial history/snapshot and one exact incremental marker',
  },
  fixture: { spaces: 4, tabs: 20, files: 2500, directories: 500, speechMessages: 100000, terminalLines: 8000 },
  runs: [],
};

function run(label, source, iteration) {
  const profile = path.join(temp, `${label}-${iteration}`);
  fs.mkdirSync(profile);
  const stdoutFile = path.join(profile, 'stdout.log'), stderrFile = path.join(profile, 'stderr.log');
  const stdout = fs.openSync(stdoutFile, 'w'), stderr = fs.openSync(stderrFile, 'w');
  const env = { ...process.env, RC_PERF_SOURCE: source, RC_PERF_PROFILE: profile, RC_PERF_FIXTURE: path.join(temp, 'fixture') };
  delete env.ELECTRON_RUN_AS_NODE;
  let result;
  try {
    result = spawnSync(require('electron'), [path.join(__dirname, 'profile-perf-app.js')], {
      env, stdio: ['ignore', stdout, stderr], timeout: 180000,
    });
  } finally { fs.closeSync(stdout); fs.closeSync(stderr); }
  const diagnostics = `${fs.readFileSync(stdoutFile, 'utf8')}\n${fs.readFileSync(stderrFile, 'utf8')}`;
  if (result.error || result.status !== 0) throw new Error(`${label} sample ${iteration}: ${result.error?.message || result.status}\n${diagnostics}`);
  const measured = JSON.parse(fs.readFileSync(path.join(profile, 'result.json'), 'utf8'));
  report.runs.push({ label, iteration, ...measured });
  console.log(`${label} ${iteration}: first usable ${measured.restore.firstUsableMs} ms, folder ${measured.folder.openMs} ms, burst ${measured.burst.gitStatusCommands} git status`);
}

try {
  const snapshot = path.join(temp, 'before'), archive = path.join(temp, 'before.tar');
  fs.mkdirSync(snapshot);
  git('archive', '--format=tar', `--output=${archive}`, before);
  execFileSync('tar', ['-xf', archive, '-C', snapshot], { windowsHide: true });
  fs.symlinkSync(path.join(root, 'node_modules'), path.join(snapshot, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
  const after = path.join(temp, 'after');
  fs.mkdirSync(after);
  const files = git('ls-files', '--cached', '--others', '--exclude-standard', '-z').split('\0').filter(Boolean)
    .filter((file) => /^(main\/|renderer\/|shared\/|bin\/|build\/|scripts\/|main\.js$|preload\.js$|splash-preload\.js$|package(?:-lock)?\.json$)/.test(file));
  const fingerprint = createHash('sha256');
  for (const file of files) {
    const from = path.join(root, ...file.split('/'));
    if (!fs.existsSync(from)) continue;
    const to = path.join(after, ...file.split('/')), content = fs.readFileSync(from);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.writeFileSync(to, content, { mode: fs.statSync(from).mode });
    fingerprint.update(file).update('\0').update(content).update('\0');
  }
  report.after.snapshotSha256 = fingerprint.digest('hex');
  // Freeze the worktree too: concurrent edits must not change later samples.
  fs.symlinkSync(path.join(root, 'node_modules'), path.join(after, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');

  const fixture = path.join(temp, 'fixture'), tree = path.join(fixture, 'tree'), home = path.join(fixture, 'home');
  fs.mkdirSync(tree, { recursive: true });
  fs.mkdirSync(home);
  const hooks = path.join(fixture, 'hooks');
  fs.mkdirSync(hooks);
  const fixtureGit = (...args) => execFileSync('git', [
    '-c', `core.hooksPath=${hooks}`, '-c', 'commit.gpgsign=false', ...args,
  ], { cwd: tree, windowsHide: true, stdio: 'pipe' });
  fixtureGit('-c', `init.templateDir=${hooks}`, 'init', '--quiet');
  for (let i = 0; i < 2500; i++) fs.writeFileSync(path.join(tree, `file-${String(i).padStart(4, '0')}.txt`), `fixture ${i}\n` + 'x'.repeat(128));
  for (let i = 0; i < 500; i++) {
    const dir = path.join(tree, `folder-${String(i).padStart(4, '0')}`);
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, 'entry.txt'), 'fixture\n');
  }
  fixtureGit('add', '.');
  fixtureGit('-c', 'user.name=Performance fixture', '-c', 'user.email=perf@example.invalid', 'commit', '--quiet', '-m', 'Temporary fixture');
  const speechFile = path.join(fixture, 'speech-history.jsonl');
  const fd = fs.openSync(speechFile, 'w');
  try {
    for (let start = 0; start < 100000; start += 1000) {
      fs.writeSync(fd, Array.from({ length: 1000 }, (_, offset) => {
        const n = start + offset;
        return JSON.stringify({ id: `message-${n}`, at: '2026-01-01T00:00:00.000Z', rid: `perf000${n % 4}`, name: `Space ${n % 4}`, text: `Message ${n} ${'x'.repeat(256)}`, source: 'fixture' }) + '\n';
      }).join(''));
    }
  } finally { fs.closeSync(fd); }
  report.fixture.speechBytes = fs.statSync(speechFile).size;
  for (let iteration = 1; iteration <= samples; iteration++) {
    // Alternate ordering to limit systematic cache/temperature bias.
    for (const label of iteration % 2 ? ['before', 'after'] : ['after', 'before']) {
      run(label, label === 'before' ? snapshot : after, iteration);
    }
  }
  const text = JSON.stringify(report, null, 2) + '\n';
  if (options.output) fs.writeFileSync(path.resolve(options.output), text);
  else console.log(text);
} finally {
  fs.rmSync(temp, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}
