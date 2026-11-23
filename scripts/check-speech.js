const { spawnSync } = require('node:child_process');
const path = require('node:path');

let command, args;
if (process.platform === 'win32') {
  command = 'powershell.exe';
  args = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'install-espeak.ps1')];
} else if (process.platform === 'darwin') {
  command = '/usr/bin/say';
  args = ['-v', '?'];
} else {
  command = 'spd-say';
  args = ['--version'];
}
const result = spawnSync(command, args, { stdio: 'inherit' });
if (result.error) {
  console.error(process.platform === 'linux'
    ? 'Installez Speech Dispatcher (Debian/Ubuntu : sudo apt install speech-dispatcher), puis relancez cette commande.'
    : result.error.message);
}
process.exitCode = result.error ? 1 : (result.status ?? 1);
