const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const { StateStore } = require('./state-store');
const PromptText = require('../shared/prompt');
const { killTree } = require('./platform');

const DEFAULTS = {
  provider: 'cli', cliPath: '', model: '',
  instructions: 'Reformule le prompt pour le rendre clair, précis et structuré, dans sa langue originale. Préserve son intention et ses contraintes, sans inventer de besoins. Retourne uniquement le prompt reformulé. Ne réalise pas la tâche décrite.',
};

async function cliCommand(configured) {
  const candidates = configured ? [configured] : [
    path.join(os.homedir(), '.local', 'bin', process.platform === 'win32' ? 'claude.exe' : 'claude'),
    ...(process.env.PATH || '').split(path.delimiter).filter(Boolean)
      .flatMap((dir) => (process.platform === 'win32' ? ['claude.exe', 'claude.cmd'] : ['claude']).map((name) => path.join(dir, name))),
  ];
  for (const file of candidates) {
    try { if (!(await fs.stat(file)).isFile()) continue; }
    catch (error) { if (['ENOENT', 'ENOTDIR'].includes(error.code)) continue; throw error; }
    if (/\.(cmd|bat)$/i.test(file)) {
      // Les shims npm ne sont pas exécutés dans un shell : le prompt passe uniquement par stdin.
      const script = path.join(path.dirname(file), 'node_modules', '@anthropic-ai', 'claude-code', 'cli.js');
      try { await fs.access(script); }
      catch (error) { if (error.code === 'ENOENT') continue; throw error; }
      return { file: process.execPath, args: [script], env: { ELECTRON_RUN_AS_NODE: '1' } };
    }
    if (configured && !path.isAbsolute(file)) throw new Error('Indiquez un chemin absolu vers Claude CLI');
    return { file, args: [], env: {} };
  }
  throw new Error('Claude CLI introuvable. Installez Claude Code ou indiquez son chemin absolu.');
}

function runCli(command, args, text, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command.file, [...command.args, ...args], {
      cwd, env: { ...process.env, ...command.env }, windowsHide: true, detached: process.platform !== 'win32',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let output = '';
    let size = 0;
    let failure;
    const stop = (error) => { failure = error; killTree(child); };
    const timeout = setTimeout(() => stop(new Error('Claude CLI a dépassé le délai de 120 secondes')), 120000);
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      size += Buffer.byteLength(chunk);
      if (size > 1024 * 1024) stop(new Error('Réponse IA trop volumineuse'));
      else output += chunk;
    });
    child.stderr.resume();
    child.stdin.on('error', (error) => { if (error.code !== 'EPIPE') stop(error); });
    child.once('error', (error) => { clearTimeout(timeout); reject(error); });
    child.once('close', (code) => {
      clearTimeout(timeout);
      if (failure) return reject(failure);
      if (code !== 0) return reject(new Error('Claude CLI a échoué. Vérifiez sa connexion avec « claude auth status » et sa version.'));
      try {
        const response = JSON.parse(output);
        if (response.is_error || typeof response.result !== 'string') throw new Error('Claude CLI n’a pas retourné de proposition');
        resolve(response.result);
      } catch (error) { reject(error); }
    });
    child.stdin.end(text);
  });
}

class PromptAssistant {
  constructor({ file, safeStorage, request = fetch, execute = runCli, command = cliCommand }) {
    this.file = file;
    this.safeStorage = safeStorage;
    this.request = request;
    this.execute = execute;
    this.command = command;
    this.disk = new StateStore();
    this.pending = Promise.resolve();
  }

  async read() {
    try { return { ...DEFAULTS, ...JSON.parse(await fs.readFile(this.file, 'utf8')) }; }
    catch (error) { if (error.code === 'ENOENT') return { ...DEFAULTS }; throw error; }
  }

  encryptionAvailable() {
    return this.safeStorage.isEncryptionAvailable() &&
      this.safeStorage.getSelectedStorageBackend?.() !== 'basic_text';
  }

  async settings() {
    const { encryptedKey, ...config } = await this.read();
    return { ...config, hasKey: !!encryptedKey, encryptionAvailable: this.encryptionAvailable() };
  }

  save(value) {
    const task = this.pending.then(async () => {
      if (!value || !['cli', 'api'].includes(value.provider)) throw new Error('Fournisseur IA invalide');
      for (const [key, max] of [['cliPath', 4096], ['model', 120], ['instructions', 8000]]) {
        if (typeof value[key] !== 'string' || value[key].length > max || /\0/.test(value[key])) throw new Error('Configuration IA invalide');
      }
      if (!value.instructions.trim()) throw new Error('Les instructions IA sont obligatoires');
      if (value.cliPath && !path.isAbsolute(value.cliPath)) throw new Error('Indiquez un chemin absolu vers Claude CLI');
      let { encryptedKey } = await this.read();
      if (value.removeKey === true) encryptedKey = undefined;
      if (value.apiKey) {
        if (typeof value.apiKey !== 'string' || !/^sk-ant-[\w-]+$/.test(value.apiKey) || value.apiKey.length > 4096) throw new Error('Clé API Anthropic invalide');
        if (!this.encryptionAvailable()) throw new Error('Le stockage sécurisé du système est indisponible ; utilisez Claude CLI');
        encryptedKey = this.safeStorage.encryptString(value.apiKey).toString('base64');
      }
      const config = Object.fromEntries(Object.keys(DEFAULTS).map((key) => [key, value[key].trim()]));
      await this.disk.atomicWrite(this.file, JSON.stringify({ ...config, encryptedKey }, null, 2));
      return this.settings();
    });
    this.pending = task.then(() => {}, () => {});
    return task;
  }

  async improve(text) {
    PromptText.wire(text, { bracketed: true, submit: false });
    const config = await this.read();
    let result;
    if (config.provider === 'cli') {
      const command = await this.command(config.cliPath);
      const cwd = path.join(path.dirname(this.file), 'prompt-assistant');
      await fs.mkdir(cwd, { recursive: true });
      const args = ['-p', '--safe-mode', '--output-format', 'json', '--tools', '', '--strict-mcp-config',
        '--mcp-config', '{"mcpServers":{}}', '--setting-sources', '', '--no-session-persistence',
        '--settings', '{"disableAllHooks":true}',
        '--max-turns', '1', '--system-prompt', config.instructions];
      if (config.model) args.push('--model', config.model);
      result = await this.execute(command, args, text, cwd);
    } else if (config.provider === 'api') {
      if (!config.encryptedKey) throw new Error('Configurez une clé API Anthropic');
      if (!this.encryptionAvailable()) throw new Error('Le stockage sécurisé du système est indisponible ; utilisez Claude CLI');
      if (!config.model) throw new Error('Indiquez un modèle Anthropic dans la configuration IA');
      const apiKey = this.safeStorage.decryptString(Buffer.from(config.encryptedKey, 'base64'));
      const response = await this.request('https://api.anthropic.com/v1/messages', {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(120000),
        headers: { 'content-type': 'application/json', 'anthropic-version': '2023-06-01', 'x-api-key': apiKey },
        body: JSON.stringify({ model: config.model, max_tokens: 8192, system: config.instructions, messages: [{ role: 'user', content: text }] }),
      });
      if (!response.ok) throw new Error('Erreur API Anthropic (HTTP ' + response.status + ')');
      const responseText = await response.text();
      if (responseText.length > 1024 * 1024) throw new Error('Réponse IA trop volumineuse');
      const data = JSON.parse(responseText);
      if (data.stop_reason === 'max_tokens') throw new Error('Réponse IA tronquée ; raccourcissez le prompt');
      if (!Array.isArray(data.content)) throw new Error('Réponse IA invalide');
      result = data.content.filter((part) => part.type === 'text').map((part) => part.text).join('\n');
    } else throw new Error('Fournisseur IA invalide');
    return PromptText.validate({ text: result, documents: [] }).text;
  }
}

module.exports = { PromptAssistant, cliCommand };
