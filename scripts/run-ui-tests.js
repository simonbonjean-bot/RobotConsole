const { spawnSync } = require('node:child_process');
const path = require('node:path');
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const tests = [
  'test-platform-app.js',
  'test-speech-ui.js',
  'test-speech-app.js',
  'test-subscriptions-ui.js',
  'test-remote-terminal.js',
  'test-restore-perf.js',
  'test-tab-icons.js',
  'test-screen-removal.js',
  'test-file-preview.js',
];
const selected = new Set(process.argv.slice(2));
for (const name of selected) {
  if (!tests.includes(name)) throw new Error(`Unknown UI test: ${name}`);
}
for (const file of tests.filter((file) => !selected.size || selected.has(file))) {
  console.log(`\n${file}`);
  const result = spawnSync(process.execPath, [path.join(__dirname, file)], {
    stdio: 'inherit', env, timeout: 90000,
  });
  if (result.error) console.error(result.error.message);
  if (result.error || result.status !== 0) {
    process.exitCode = result.status || 1;
    break;
  }
}
