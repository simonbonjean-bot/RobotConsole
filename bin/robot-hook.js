#!/usr/bin/env node
// Hook Claude Code -> RobotConsole. Lit l'événement JSON sur stdin et fait parler le robot.
// Événements gérés : Notification (attente d'une validation/réponse), PreToolUse(AskUserQuestion), Stop (résumé de fin).
const fs = require('fs');
const path = require('path');
const os = require('os');
const { request } = require('./robot-say.js');
const { pipeFor } = require('../main/speech');

const MAX = 280;

function clean(text) {
  return String(text || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s*/gm, '')
    .replace(/^\s*[-*>|]+\s*/gm, '')
    .replace(/[*_~]{1,3}/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function shorten(text, max = MAX) {
  const t = clean(text);
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const stop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
  return stop > max * 0.5 ? cut.slice(0, stop + 1) : cut.replace(/\s+\S*$/, '') + '…';
}

function lastAssistantText(event) {
  if (event.last_assistant_message) return event.last_assistant_message;
  try {
    const lines = fs.readFileSync(event.transcript_path, 'utf8').trim().split('\n');
    for (let i = lines.length - 1; i >= 0; i--) {
      const entry = JSON.parse(lines[i]);
      const msg = entry.message || entry;
      if (msg.role !== 'assistant' && entry.type !== 'assistant') continue;
      const content = Array.isArray(msg.content) ? msg.content.filter((b) => b.type === 'text').map((b) => b.text).join(' ') : msg.content;
      if (content && content.trim()) return content;
    }
  } catch { /* transcript illisible */ }
  return '';
}

// Résumé de fin : dernier paragraphe de prose (la conclusion), sinon le premier.
function summarize(text) {
  const prose = String(text).split(/\n\s*\n/)
    .filter((p) => p.trim() && !/^\s*([-*>|]|\d+\.)\s/.test(p))
    .map(clean).filter((p) => p.length > 15);
  if (!prose.length) return shorten(text);
  return shorten(prose[prose.length - 1]);
}

function buildMessage(event) {
  const name = event.hook_event_name;
  if (name === 'Stop' || name === 'SubagentStop') {
    if (event.stop_hook_active) return '';
    const text = lastAssistantText(event);
    if (!text) return 'J’ai terminé.';
    const body = summarize(text);
    const asked = clean(text).split(/(?<=[.!?])\s+/).slice(-3).filter((x) => x.includes('?'));
    if (asked.length) return `Question : ${shorten(asked.join(' '))}`;
    return `Terminé. ${body}`;
  }
  if (name === 'PreToolUse' && event.tool_name === 'AskUserQuestion') {
    const qs = (event.tool_input && event.tool_input.questions) || [];
    const parts = qs.map((q) => {
      const opts = (q.options || []).map((o) => o.label).join(', ');
      return `${q.question}${opts ? ` (${opts})` : ''}`;
    });
    return shorten(`Question : ${parts.join(' ')}`, 400);
  }
  if (name === 'Notification') {
    const type = event.notification_type;
    if (type === 'auth_success') return '';
    const msg = shorten(event.message || '');
    if (type === 'idle_prompt') return 'Je suis en attente de votre prochaine demande.';
    if (type === 'permission_prompt' || /permission/i.test(event.message || '')) { const tool = (event.message || '').match(/use (\S+)/i); return `J’attends votre autorisation${tool ? ' pour ' + tool[1] : ''}.`; }
    return msg ? `J’ai besoin de vous. ${msg}` : '';
  }
  return '';
}

async function main() {
  let raw = '';
  for await (const chunk of process.stdin) raw += chunk;
  let event;
  try { event = JSON.parse(raw); } catch { return; }
  const text = buildMessage(event);
  if (!text) return;
  const appData = process.platform === 'win32' ? process.env.APPDATA :
    process.platform === 'darwin' ? path.join(os.homedir(), 'Library', 'Application Support') :
      (process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'));
  const userData = process.env.ROBOTCONSOLE_USERDATA || path.join(appData, 'RobotConsole');
  await request(process.env.ROBOTCONSOLE_SPEECH_PIPE || pipeFor(userData), {
    action: 'say', session: process.env.ROBOTCONSOLE_SESSION, cwd: event.cwd || process.cwd(), text,
  });
}

if (require.main === module) main().catch(() => {}).finally(() => process.exit(0));

module.exports = { buildMessage, summarize, shorten };
