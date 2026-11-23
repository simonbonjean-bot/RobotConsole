const { execFile } = require('node:child_process');

function command(file, args) {
  return new Promise((resolve, reject) => {
    execFile(file, args, { windowsHide: true, timeout: 15000, maxBuffer: 16 * 1024 * 1024 }, (error, stdout, stderr) => {
      // lsof retourne 1 lorsqu'aucun port n'est ouvert.
      if (error && !(file === 'lsof' && error.code === 1 && !error.signal && !stdout && !stderr)) reject(error);
      else resolve(stdout);
    });
  });
}

function parseProcesses(text) {
  const procs = [], mem = new Map();
  for (const line of text.trim().split(/\r?\n/)) {
    const [pid, ppid, rss] = line.trim().split(/\s+/).map(Number);
    if (!pid) continue;
    procs.push({ pid, ppid });
    mem.set(pid, (rss || 0) * 1024);
  }
  return { procs, mem };
}

function parseSs(text) {
  const listen = [];
  for (const line of text.trim().split(/\r?\n/)) {
    const address = line.trim().split(/\s+/)[3];
    const port = Number(address?.match(/:(\d+)$/)?.[1]);
    if (!port) continue;
    for (const match of line.matchAll(/\bpid=(\d+)/g)) listen.push({ pid: Number(match[1]), port });
  }
  return listen;
}

function parseLsof(text) {
  const listen = [];
  let pid = null;
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith('p')) pid = Number(line.slice(1));
    if (pid && line.startsWith('n')) {
      const port = Number(line.match(/:(\d+)$/)?.[1]);
      if (port) listen.push({ pid, port });
    }
  }
  return listen;
}

async function unixSnapshot(platform = process.platform, run = command) {
  const snapshot = parseProcesses(await run('ps', ['-A', '-o', 'pid=,ppid=,rss=']));
  try {
    if (platform === 'linux') {
      try { return { ...snapshot, listen: parseSs(await run('ss', ['-H', '-ltnp'])) }; }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    return { ...snapshot, listen: parseLsof(await run('lsof', ['-nP', '-iTCP', '-sTCP:LISTEN', '-Fpn'])) };
  } catch (error) {
    return { ...snapshot, listen: [], error: `Détection des ports indisponible (ss/lsof) : ${error.message}` };
  }
}

module.exports = { unixSnapshot, parseProcesses, parseSs, parseLsof };
