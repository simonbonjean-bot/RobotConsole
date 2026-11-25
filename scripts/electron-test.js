const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');

module.exports = function run(file, args = []) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'robotconsole-ui-'));
  let status = 1;
  try {
    const env = { ...process.env, ROBOTCONSOLE_TEST_TEMP: temp };
    delete env.ELECTRON_RUN_AS_NODE;
    const result = spawnSync(require('electron'), [file, ...args], { env, stdio: 'inherit', timeout: 60000 });
    if (result.error) throw result.error;
    status = result.status ?? 1;
  } finally {
    // Chromium doit être arrêté avant de supprimer les fichiers du profil.
    fs.rmSync(temp, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
  process.exit(status);
};
