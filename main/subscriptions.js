const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const readline = require('node:readline');
const { quoteShell } = require('./platform');

const number = (v) => typeof v === 'number' && Number.isFinite(v) ? v : null;
const percent = (v) => number(v) !== null && v >= 0 && v <= 100 ? v : null;
const date = (v) => {
  if (v == null) return null;
  const ms = typeof v === 'number' ? v * 1000 : Date.parse(v);
  return Number.isFinite(ms) && ms > 0 && ms <= 8640000000000000 ? new Date(ms).toISOString() : null;
};

function copilotQuotas(result) {
  if (!result?.quotaSnapshots || typeof result.quotaSnapshots !== 'object') throw new Error('Réponse quota Copilot invalide.');
  return Object.entries(result.quotaSnapshots).filter(([, q]) => q && typeof q === 'object').map(([id, q]) => ({
    id, label: { premium_interactions: 'Interactions premium', chat: 'Chat', completions: 'Complétions' }[id] || id,
    used: number(q.usedRequests), limit: number(q.entitlementRequests) === -1 ? null : number(q.entitlementRequests),
    unlimited: q.isUnlimitedEntitlement === true || q.entitlementRequests === -1,
    usedPercent: q.isUnlimitedEntitlement === true || q.entitlementRequests === -1 || percent(q.remainingPercentage) === null ? null : 100 - q.remainingPercentage,
    resetAt: date(q.resetDate), unit: 'requêtes', overage: number(q.overage),
  }));
}

function codexQuotas(result) {
  const snapshots = result?.rateLimitsByLimitId && Object.keys(result.rateLimitsByLimitId).length
    ? Object.entries(result.rateLimitsByLimitId) : result?.rateLimits ? [['codex', result.rateLimits]] : [];
  if (!snapshots.length) throw new Error('Codex ne retourne aucun quota. Vérifiez la connexion à un compte ChatGPT.');
  const quotas = [];
  for (const [id, snapshot] of snapshots) {
    if (!snapshot || typeof snapshot !== 'object') continue;
    for (const key of ['primary', 'secondary']) {
      const q = snapshot[key];
      if (!q) continue;
      const minutes = number(q.windowDurationMins);
      const duration = minutes === null ? key : minutes >= 1440 ? `${minutes / 1440} j` : `${minutes / 60} h`;
      quotas.push({
        id: `${id}:${key}`, label: `${snapshot.limitName || id} · ${duration}`,
        usedPercent: percent(q.usedPercent), resetAt: date(q.resetsAt),
        used: null, limit: null, unlimited: false, unit: null,
      });
    }
  }
  return { quotas, plan: snapshots.find(([, q]) => q?.planType)?.[1].planType || null };
}

function claudeQuotas(data) {
  return ['five_hour', 'seven_day', 'spend_limit'].filter((key) => data?.rate_limits?.[key]).map((key) => {
    const q = data.rate_limits[key];
    return {
      id: key, label: { five_hour: 'Fenêtre de 5 heures', seven_day: 'Fenêtre de 7 jours', spend_limit: 'Plafond de dépenses' }[key],
      usedPercent: percent(q.used_percentage), resetAt: date(q.resets_at),
      used: number(q.used_usd), limit: number(q.limit_usd), unit: key === 'spend_limit' ? 'USD' : null, unlimited: false,
    };
  });
}

async function codexCommand() {
  if (process.platform !== 'win32') return { file: 'codex', args: [] };
  for (const dir of (process.env.PATH || '').split(path.delimiter).filter(Boolean)) {
    const exe = path.join(dir, 'codex.exe');
    try { await fs.access(exe); return { file: exe, args: [] }; } catch (e) { if (e.code !== 'ENOENT') throw e; }
    // npm's Windows shim cannot be spawned without a shell. Launch its JS entry directly.
    const js = path.join(dir, 'node_modules', '@openai', 'codex', 'bin', 'codex.js');
    try { await fs.access(js); return { file: process.execPath, args: [js], env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } }; } catch (e) { if (e.code !== 'ENOENT') throw e; }
  }
  throw new Error('Codex introuvable dans le PATH. Installez Codex CLI puis relancez RobotConsole.');
}

function readCodex(command, timeout = 25000) {
  return new Promise((resolve, reject) => {
    const child = spawn(command.file, [...command.args, 'app-server'], {
      cwd: os.homedir(), env: command.env || process.env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
    });
    const lines = readline.createInterface({ input: child.stdout });
    let done = false;
    const finish = (error, result) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      lines.close();
      child.stdin.end();
      child.kill();
      if (error) reject(error); else resolve(result);
    };
    const timer = setTimeout(() => finish(new Error('Délai de lecture du quota Codex dépassé.')), timeout);
    const send = (message) => child.stdin.write(`${JSON.stringify(message)}\n`);
    child.on('error', () => finish(new Error('Impossible de démarrer Codex CLI.')));
    child.stdin.on('error', () => finish(new Error('Connexion Codex interrompue.')));
    child.stderr.resume();
    child.on('exit', () => finish(new Error('Codex a quitté avant de retourner ses quotas.')));
    lines.on('line', (line) => {
      let message;
      try { message = JSON.parse(line); } catch { finish(new Error('Réponse JSON Codex invalide.')); return; }
      if (message.id !== 1 && message.id !== 2) return;
      if (message.error) { finish(new Error('Lecture du quota Codex refusée. Vérifiez votre connexion avec codex login.')); return; }
      if (message.id === 1) {
        send({ method: 'initialized', params: {} });
        send({ method: 'account/rateLimits/read', id: 2, params: {} });
      } else finish(null, message.result);
    });
    send({ method: 'initialize', id: 1, params: { clientInfo: { name: 'robotconsole', version: '1.0.0' } } });
  });
}

async function readCopilot() {
  const { CopilotClient, RuntimeConnection } = await import('@microsoft/copilot-sdk');
  const client = new CopilotClient({
    mode: 'coding-agent', runtime: RuntimeConnection.forSpawnedStdio({ workingDirectory: os.homedir() }),
    clientInfo: { name: 'robotconsole', version: '1.0.0' },
  });
  let timer;
  try {
    return await Promise.race([
      (async () => { await client.start(); return await client.rpc.account.getQuota({}); })(),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Délai de lecture du quota Copilot dépassé.')), 25000); }),
    ]);
  } finally {
    clearTimeout(timer);
    await client.forceStop();
  }
}

class Subscriptions {
  constructor({ userData, claudeDir = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), copilot = readCopilot, codex = async () => readCodex(await codexCommand()) }) {
    this.userData = userData;
    this.claudeDir = claudeDir;
    this.readers = { copilot, codex };
    this.pending = null;
    this.cached = null;
  }

  claudeCommand() {
    return `node ${quoteShell(path.join(__dirname, '..', 'bin', 'claude-usage.js'))} --output ${quoteShell(path.join(this.userData, 'claude-usage.json'))}`;
  }

  async installClaude() {
    const file = path.join(this.claudeDir, 'settings.json');
    let settings = {};
    try { settings = JSON.parse(await fs.readFile(file, 'utf8')); } catch (e) { if (e.code !== 'ENOENT') throw new Error('Impossible de lire les réglages Claude. Aucune modification effectuée.'); }
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) throw new Error('Réglages Claude invalides.');
    const command = this.claudeCommand();
    if (settings.statusLine && settings.statusLine.command !== command) {
      throw new Error('Une ligne de statut Claude existe déjà. Pour la conserver, faites appeler le script indiqué dans la carte Claude par votre script actuel, avec le même JSON sur stdin.');
    }
    await fs.mkdir(this.claudeDir, { recursive: true });
    if (!settings.statusLine) {
      // Refuse to overwrite an existing backup, preserving the pre-integration settings.
      try { await fs.copyFile(file, `${file}.robotconsole-backup`, require('node:fs').constants.COPYFILE_EXCL); } catch (e) { if (e.code !== 'ENOENT' && e.code !== 'EEXIST') throw e; }
      settings.statusLine = { type: 'command', command };
      await fs.writeFile(file, JSON.stringify(settings, null, 2), { mode: 0o600 });
    }
    this.cached = null;
    return { message: 'Connecteur activé. Ouvrez Claude Code et attendez sa prochaine mise à jour de statut.' };
  }

  async readClaude() {
    let data;
    try { data = JSON.parse(await fs.readFile(path.join(this.userData, 'claude-usage.json'), 'utf8')); } catch (e) {
      if (e.code === 'ENOENT') return { status: 'unavailable', message: 'Activez le connecteur, puis utilisez Claude Code. Les quotas nécessitent une version exposant rate_limits dans la ligne de statut.', quotas: [] };
      throw new Error('Données du connecteur Claude illisibles.');
    }
    if (!Array.isArray(data.quotas) || !Number.isFinite(Date.parse(data.updatedAt))) throw new Error('Données du connecteur Claude invalides.');
    // Revalidate the bridge file rather than forwarding arbitrary contents to renderer/remote clients.
    const quotas = claudeQuotas({ rate_limits: Object.fromEntries(data.quotas.filter((q) => q && ['five_hour', 'seven_day', 'spend_limit'].includes(q.id)).map((q) => [q.id, {
      used_percentage: q.usedPercent, resets_at: q.resetAt, used_usd: q.used, limit_usd: q.limit,
    }])) });
    const stale = Date.now() - Date.parse(data.updatedAt) > 15 * 60000;
    return {
      status: quotas.length ? (stale ? 'stale' : 'ok') : 'unavailable', quotas, updatedAt: data.updatedAt,
      message: !quotas.length ? 'Claude ne fournit pas de quota pour cette session. Vérifiez la version et la connexion à un abonnement.'
        : stale ? 'Dernière observation ancienne : utilisez Claude Code pour la mettre à jour.' : 'Quotas observés via la ligne de statut Claude Code.',
    };
  }

  async read(force = false) {
    if (this.pending) return this.pending;
    if (!force && this.cached && Date.now() - this.cached.at < 60000) return this.cached.providers;
    this.pending = Promise.all([
      this.provider('copilot', 'GitHub Copilot', async () => ({ quotas: copilotQuotas(await this.readers.copilot()) })),
      this.provider('codex', 'Codex / ChatGPT', async () => codexQuotas(await this.readers.codex())),
      this.provider('claude', 'Claude', () => this.readClaude()),
    ]).then((providers) => { this.cached = { at: Date.now(), providers }; return providers; }).finally(() => { this.pending = null; });
    return this.pending;
  }

  async provider(id, name, read) {
    const base = { id, name, source: id === 'claude' ? 'Claude Code statusLine' : id === 'copilot' ? 'Copilot SDK account.getQuota' : 'Codex account/rateLimits/read' };
    if (id === 'claude') base.command = this.claudeCommand();
    try {
      const data = await read();
      return { ...base, updatedAt: new Date().toISOString(), status: data.quotas.length ? 'ok' : 'unavailable', message: data.quotas.length ? null : 'Aucun quota communiqué par le fournisseur.', ...data };
    } catch (e) {
      console.warn(`[subscriptions:${id}] Lecture impossible (${e.code || e.name || 'Error'}).`);
      // SDK errors may embed credentials or account details; never forward those errors.
      const message = id === 'copilot' ? 'Quota Copilot inaccessible. Vérifiez votre connexion Copilot et réessayez.' : e.message;
      return { ...base, status: 'error', message, quotas: [], updatedAt: null };
    }
  }
}

module.exports = { Subscriptions, copilotQuotas, codexQuotas, claudeQuotas, readCodex };
