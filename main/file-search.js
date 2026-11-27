// RobotConsole — recherche bornée de noms/chemins, sans dépendance Electron.
const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');

const LIMITS = Object.freeze({ results: 100, entries: 50000, outputBytes: 16 * 1024 * 1024, pathLength: 32768, gitTimeout: 20000 });
const DEPENDENCIES = new Set(['node_modules', 'vendor', 'bower_components', '.venv', 'venv', '__pycache__', '.pnpm-store']);
const CANCELLED = Symbol('cancelled');
const key = (file) => process.platform === 'win32' ? file.toLowerCase() : file;
const normalize = (text) => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\\/g, '/');
const inside = (root, file) => {
  const relative = path.relative(root, file);
  return relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`));
};
const excluded = (relative, includeIgnored) => relative.split(/[\\/]/).some((part) =>
  part.toLowerCase() === '.git' || (!includeIgnored && DEPENDENCIES.has(part.toLowerCase())));

function scorePath(relative, query) {
  const file = normalize(relative), name = file.slice(file.lastIndexOf('/') + 1);
  const terms = normalize(query).trim().split(/\s+/).filter(Boolean);
  let score = 0;
  for (const term of terms) {
    if (name === term) { score += 1000; continue; }
    if (name.startsWith(term)) { score += 800; continue; }
    if (name.includes(term)) { score += 600; continue; }
    if (file.includes(term)) { score += 400; continue; }
    let index = -1, first = -1;
    for (const character of term) {
      index = file.indexOf(character, index + 1);
      if (index < 0) return null;
      if (first < 0) first = index;
    }
    score += 200 - Math.min(199, index - first - term.length + 1);
  }
  return score;
}

async function runGit(root, args, state, consume, maxBytes, onLimit, input) {
  state.check();
  const env = { ...process.env, LC_ALL: 'C', LANG: 'C', GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' };
  // An inherited Git environment must not redirect a workspace search.
  for (const name of Object.keys(env)) {
    if (/^GIT_(DIR|WORK_TREE|INDEX_FILE|COMMON_DIR|OBJECT_DIRECTORY|ALTERNATE_OBJECT_DIRECTORIES)$/i.test(name)) delete env[name];
  }
  const child = spawn('git', ['-C', root, ...args], { env, windowsHide: true, stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'] });
  let stderr = '', stopped = false, timedOut = false, streamError;
  const closed = new Promise((resolve) => {
    child.once('error', (error) => resolve({ error }));
    child.once('close', (code) => resolve({ code }));
  });
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => { stderr = (stderr + chunk).slice(0, 16384); });
  child.stdout.setEncoding('utf8');
  if (input !== undefined) {
    child.stdin.on('error', () => {}); // Git's exit diagnostic handles early pipe closure.
    child.stdin.end(input);
  }
  const stop = () => { child.kill(); };
  state.controller.signal.addEventListener('abort', stop, { once: true });
  const timer = setTimeout(() => { timedOut = true; stop(); }, LIMITS.gitTimeout);
  let bytes = 0;
  try {
    // Awaiting each chunk keeps both the pipe and candidate validation bounded.
    for await (const chunk of child.stdout) {
      state.check();
      bytes += Buffer.byteLength(chunk);
      if (bytes > maxBytes) { onLimit(); stopped = true; stop(); break; }
      if (await consume(chunk) === false) { stopped = true; stop(); break; }
    }
  } catch (error) {
    streamError = error;
    stop();
  }
  try {
    const result = await closed;
    state.check();
    if (timedOut) throw new Error('Git file search timed out.');
    if (result.error) throw new Error(`Cannot start Git: ${result.error.message}`);
    if (streamError) throw new Error(`Git file search stream failed: ${streamError.message || String(streamError)}`);
    return { ...result, stderr, stopped };
  } finally {
    clearTimeout(timer);
    state.controller.signal.removeEventListener('abort', stop);
  }
}

function gitError(result) {
  return new Error(`Git file search failed (exit ${result.code}): ${result.stderr.trim().slice(0, 2048) || 'no diagnostic'}`);
}

/**
 * getRoots(senderId) returns an array of authorized absolute workspace paths (or
 * a Promise of one). Only exact realpath matches are allowed, never descendants.
 * Invalid input/root and Git execution failures reject. Cancellation resolves
 * to empty partial results with a warning. cancel returns whether it matched.
 * Symlinks are excluded. Nested repositories/submodules are not traversed;
 * their omission is reported. Non-Git workspaces have dependency exclusions,
 * but no .gitignore semantics. includeIgnored widens those exclusions too.
 */
function createFileSearch({ getRoots }) {
  if (typeof getRoots !== 'function') throw new TypeError('getRoots is required.');
  const pending = new Map();

  function cancel(senderId, requestId) {
    const state = pending.get(senderId);
    if (!state || state.requestId !== requestId) return false;
    state.controller.abort();
    return true;
  }

  function disposeSender(senderId) {
    pending.get(senderId)?.controller.abort();
    pending.delete(senderId);
  }

  async function search(senderId, options) {
    pending.get(senderId)?.controller.abort();
    const state = {
      requestId: options?.requestId, controller: new AbortController(),
      check() { if (this.controller.signal.aborted) throw CANCELLED; },
    };
    pending.set(senderId, state);
    const warnings = new Set(), best = [], seen = new Set();
    let partial = false, entries = 0, matches = 0;
    const warn = (message) => {
      partial = true;
      if (warnings.size < 31 || warnings.has(message)) warnings.add(message);
      else warnings.add('Additional file search warnings omitted.');
    };
    const count = () => {
      if (++entries <= LIMITS.entries) return true;
      warn(`Scan limited to ${LIMITS.entries} entries; refine the search.`);
      return false;
    };
    try {
      if (!options || typeof options.root !== 'string' || !path.isAbsolute(options.root) ||
          typeof options.query !== 'string' || options.query.length > 1024 ||
          (options.includeIgnored !== undefined && typeof options.includeIgnored !== 'boolean') ||
          !['string', 'number'].includes(typeof options.requestId) ||
          (typeof options.requestId === 'number' && !Number.isFinite(options.requestId)) ||
          (typeof options.requestId === 'string' && options.requestId.length > 256)) {
        throw new TypeError('Invalid file search options.');
      }
      const { root: requestedRoot, query, includeIgnored = false } = options;
      const roots = await getRoots(senderId);
      state.check();
      if (!Array.isArray(roots)) throw new TypeError('getRoots must return an array of paths.');
      const root = await fs.realpath(requestedRoot);
      state.check();
      let allowed = false;
      for (const candidate of roots) {
        state.check();
        if (typeof candidate !== 'string' || !path.isAbsolute(candidate)) continue;
        try {
          if (key(await fs.realpath(candidate)) === key(root)) { allowed = true; break; }
        } catch (error) {
          if (!['ENOENT', 'ENOTDIR'].includes(error.code)) throw error;
        }
      }
      state.check();
      if (!allowed) throw new Error('File search root is not authorized.');
      if (!(await fs.stat(root)).isDirectory()) throw new Error('File search root is not a directory.');
      const compare = (a, b) => b.score - a.score || (a.relative < b.relative ? -1 : a.relative > b.relative ? 1 : 0);
      const safeDirectories = new Map([[key(root), true]]);
      let enqueueDirectory;
      const safeParents = async (file) => {
        const parent = path.dirname(file), cached = safeDirectories.get(key(parent));
        if (cached !== undefined) return cached;
        const safe = await safeParents(parent) && !(await fs.lstat(parent)).isSymbolicLink();
        state.check();
        safeDirectories.set(key(parent), safe);
        return safe;
      };
      const add = async (relative) => {
        state.check();
        if (!relative || excluded(relative, includeIgnored)) return;
        const file = path.resolve(root, relative);
        if (!inside(root, file)) { warn('Git returned a path outside the search root.'); return; }
        if (file === root) { if (enqueueDirectory) enqueueDirectory(root); return; }
        if (seen.has(key(file))) return;
        seen.add(key(file));
        try {
          if (!await safeParents(file)) return;
          const stat = await fs.lstat(file);
          state.check();
          if (stat.isSymbolicLink()) return;
          const canonical = await fs.realpath(file);
          state.check();
          if (!inside(root, canonical) || excluded(path.relative(root, canonical), includeIgnored)) {
            warn('Skipped a file resolving outside the search scope.');
            return;
          }
          if (stat.isDirectory()) {
            if (enqueueDirectory) enqueueDirectory(file);
            return;
          }
          if (!stat.isFile()) return;
          const relativePath = path.relative(root, file);
          const score = scorePath(relativePath, query);
          if (score === null) return;
          matches++;
          best.push({ path: file, relative: relativePath, score });
          best.sort(compare);
          if (best.length > LIMITS.results) best.pop();
        } catch (error) {
          if (error === CANCELLED) throw error;
          warn(`Cannot inspect ${relative}: ${error.code || error.message}`);
        }
      };
      let probeOutput = '';
      const probe = await runGit(root, ['rev-parse', '--is-inside-work-tree'], state,
        (chunk) => { probeOutput += chunk; }, 32768, () => { throw new Error('Git repository probe output exceeded its limit.'); });
      const directories = [], visited = new Set();
      const gitMode = probe.code === 0;
      if (gitMode) {
        if (probeOutput.trim() !== 'true') throw new Error('File search requires a Git work tree, not a bare repository.');
        enqueueDirectory = (directory) => directories.push(directory);
        // Opaque untracked directories keep Git from following junctions itself.
        // Expand them below, checking Git ignores in bounded NUL batches.
        const args = ['ls-files', '-z', '--cached', '--others', '--directory'];
        if (!includeIgnored) args.push('--exclude-standard');
        args.push('--', '.');
        let buffer = '';
        const listing = await runGit(root, args, state, async (chunk) => {
          buffer += chunk;
          let index;
          while ((index = buffer.indexOf('\0')) >= 0) {
            const relative = buffer.slice(0, index);
            buffer = buffer.slice(index + 1);
            if (!count()) return false;
            if (relative.length > LIMITS.pathLength) { warn('Git path length limit exceeded.'); return false; }
            await add(relative);
          }
          if (buffer.length > LIMITS.pathLength) { warn('Git path length limit exceeded.'); return false; }
        }, LIMITS.outputBytes, () => warn(`Git output limited to ${LIMITS.outputBytes} bytes; refine the search.`));
        if (!listing.stopped && listing.code !== 0) throw gitError(listing);
        if (!listing.stopped && buffer) throw new Error('Git returned an incomplete NUL-delimited file listing.');
        if (listing.stopped) directories.length = 0;
      } else {
        // Only Git's explicit "not a repository" diagnostic permits traversal.
        if (probe.code !== 128 || !/^fatal: not a git repository \(or any of the parent directories\): \.git\s*$/i.test(probe.stderr.trim())) {
          throw gitError(probe);
        }
        directories.push(root);
      }
      const processBatch = async (batch) => {
        let ignored = new Set();
        if (gitMode && !includeIgnored && batch.length) {
          let output = '';
          const result = await runGit(root, ['check-ignore', '--stdin', '-z'], state,
            (chunk) => { output += chunk; }, LIMITS.outputBytes,
            () => { throw new Error('Git ignore output exceeded its limit.'); },
            batch.map((entry) => entry.gitPath).join('\0') + '\0');
          if (result.code !== 0 && result.code !== 1) throw gitError(result);
          ignored = new Set(output.split('\0').filter(Boolean).map(key));
        }
        for (const entry of batch) {
          state.check();
          if (ignored.has(key(entry.gitPath))) continue;
          if (entry.directory) directories.push(entry.file);
          else await add(entry.relative);
        }
      };
      while (directories.length && entries <= LIMITS.entries) {
        state.check();
        const directory = directories.pop();
        let handle;
        try {
          const stat = await fs.lstat(directory);
          if (stat.isSymbolicLink()) continue;
          const canonical = await fs.realpath(directory);
          state.check();
          if (!inside(root, canonical) || visited.has(key(canonical))) continue;
          visited.add(key(canonical));
          if (directory !== root) {
            try {
              await fs.lstat(path.join(directory, '.git'));
              warn('Nested repositories/submodules are not searched.');
              continue;
            } catch (error) { if (error.code !== 'ENOENT') throw error; }
          }
          handle = await fs.opendir(directory);
          let batch = [];
          for await (const entry of handle) {
            state.check();
            if (!count()) break;
            const file = path.join(directory, entry.name), relative = path.relative(root, file);
            if (excluded(relative, includeIgnored) || entry.isSymbolicLink()) continue;
            if (relative.length > LIMITS.pathLength) { warn('File path length limit exceeded.'); continue; }
            batch.push({ file, relative, directory: entry.isDirectory(),
              gitPath: relative.split(path.sep).join('/') + (entry.isDirectory() ? '/' : '') });
            if (batch.length === 128) { await processBatch(batch); batch = []; }
          }
          await processBatch(batch);
        } catch (error) {
          if (error === CANCELLED || (gitMode && !error.code)) throw error;
          warn(`Cannot read ${path.relative(root, directory) || '.'}: ${error.code || error.message}`);
        } finally {
          // for-await closes Dir on completion and early exit.
          if (handle) { try { await handle.close(); } catch (error) { if (error.code !== 'ERR_DIR_CLOSED') throw error; } }
        }
      }
      state.check();
      if (matches > LIMITS.results) warn(`Results limited to ${LIMITS.results} files; refine the search.`);
      return { files: best.map(({ path: file, relative }) => ({ path: file, relative })), partial, warnings: [...warnings] };
    } catch (error) {
      if (error === CANCELLED || state.controller.signal.aborted) return { files: [], partial: true, warnings: ['File search cancelled.'] };
      throw error;
    } finally {
      if (pending.get(senderId) === state) pending.delete(senderId);
    }
  }

  return { search, cancel, disposeSender };
}

module.exports = { createFileSearch, scorePath, LIMITS };
