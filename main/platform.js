const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const platform = require('../shared/platform')(process.platform);

function executable(file) {
  try { fs.accessSync(file, fs.constants.X_OK); return fs.statSync(file).isFile(); }
  catch { return false; }
}

function unixShells() {
  const files = ['/bin/zsh', '/bin/bash', '/bin/sh', '/usr/bin/fish', '/usr/local/bin/fish', '/opt/homebrew/bin/fish'];
  try { files.push(...fs.readFileSync('/etc/shells', 'utf8').split(/\r?\n/).map((s) => s.trim()).filter((s) => s.startsWith('/'))); }
  catch (error) { if (error.code !== 'ENOENT') console.warn('[shells]', error.message); }
  const preferred = [process.env.SHELL, ...files].find((file) => file && executable(file));
  if (!preferred) throw new Error('Aucun shell disponible.');
  return [
    { id: 'default', label: path.basename(preferred), file: preferred, args: ['-l'] },
    ...[...new Set(files)].filter((file) => file !== preferred && executable(file))
      .map((file) => ({ id: file, label: path.basename(file), file, args: ['-l'] })),
  ];
}

function initializeEnvironment() {
  if (process.platform === 'win32') return;
  const shell = unixShells()[0].file;
  try {
    // Finder et les lanceurs graphiques n'héritent pas du PATH du terminal.
    const marker = '__ROBOTCONSOLE_PATH__';
    const output = execFileSync(shell, ['-ilc', `printf '\\n${marker}'; /usr/bin/printenv PATH`], {
      encoding: 'utf8', timeout: 10000, stdio: ['ignore', 'pipe', 'ignore'],
    });
    const line = output.split(/\r?\n/).find((s) => s.startsWith(marker));
    if (!line) throw new Error('PATH du shell absent.');
    process.env.PATH = line.slice(marker.length);
  } catch (error) { console.warn('[shell PATH]', error.message); }
  const extra = [
    path.join(os.homedir(), '.local', 'bin'),
    ...(process.platform === 'darwin' ? ['/opt/homebrew/bin', '/opt/homebrew/sbin'] : []),
    '/usr/local/bin', '/usr/local/sbin', '/usr/bin', '/bin', '/usr/sbin', '/sbin',
  ];
  process.env.PATH = [...new Set([...(process.env.PATH || '').split(path.delimiter).filter(Boolean), ...extra])].join(path.delimiter);
}

function killTree(child) {
  if (!child?.pid || child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === 'win32') {
    require('node:child_process').execFile('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true }, (error) => {
      if (error && child.exitCode === null) console.warn('[stop process]', error.message);
    });
  } else {
    try { process.kill(-child.pid, 'SIGTERM'); }
    catch (error) { if (error.code !== 'ESRCH') throw error; }
  }
}

module.exports = { ...platform, executable, unixShells, initializeEnvironment, killTree };
