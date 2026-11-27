#!/usr/bin/env node
const net = require('net');
const os = require('os');
const path = require('path');
const { pipeFor } = require('../main/speech');

function parse(args, env = process.env, cwd = process.cwd()) {
  const message = { action: 'say', session: env.ROBOTCONSOLE_SESSION, cwd };
  const words = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--') { words.push(...args.slice(i + 1)); break; }
    if (arg === '--help' || arg === '-h') return { action: 'help' };
    if (arg === '--list' || arg === '--history') {
      if (message.action !== 'say') throw new Error('Utilisez --list ou --history, pas les deux.');
      message.action = arg.slice(2);
    } else if (arg === '--robot') {
      if (!args[i + 1] || args[i + 1].startsWith('--')) throw new Error('--robot nécessite un nom ou un identifiant.');
      message.robot = args[++i];
    } else if (arg.startsWith('--')) throw new Error(`Option inconnue : ${arg}`);
    else words.push(arg);
  }
  message.text = words.join(' ');
  if (message.action === 'say' && (!message.text.trim() || message.text.length > 4000)) throw new Error('Indiquez un message de 1 à 4000 caractères. Utilisez --help pour la syntaxe.');
  if (message.action !== 'say' && words.length) throw new Error('Cette option ne prend pas de message.');
  return message;
}

function request(pipe, message) {
  return new Promise((resolve, reject) => {
    const socket = net.connect(pipe);
    let buffer = '';
    socket.setEncoding('utf8');
    socket.setTimeout(10000, () => socket.destroy(new Error('RobotConsole ne répond pas.')));
    socket.once('connect', () => socket.write(JSON.stringify(message) + '\n'));
    socket.on('data', (chunk) => {
      buffer += chunk;
      if (Buffer.byteLength(buffer) > 4 * 1024 * 1024) { socket.destroy(new Error('Réponse trop volumineuse.')); return; }
      const end = buffer.indexOf('\n');
      if (end < 0) return;
      try {
        const response = JSON.parse(buffer.slice(0, end));
        if (!response.ok) reject(new Error(response.error));
        else resolve(response.result);
      } catch (error) { reject(error); }
      socket.destroy();
    });
    socket.once('error', reject);
    socket.once('close', () => reject(new Error('Connexion à RobotConsole interrompue.')));
  });
}

async function main() {
  const message = parse(process.argv.slice(2));
  if (message.action === 'help') {
    console.log('robot-say "Message"\nrobot-say --robot <nom-ou-id> "Message"\nrobot-say --list\nrobot-say --history [--robot <nom-ou-id>]\n\nMessages : terminal intégré, ou --robot explicite. Hors de RobotConsole, un message sans --robot ne fait rien.\nHistorique : terminal intégré, sinon dossier courant. RobotConsole doit être ouvert pour les opérations explicites.\nVoix optionnelle : activer Paramètres > Robots > Voix de synthèse, puis autoriser le robot dans son menu > Voix.');
    return;
  }
  if (message.action === 'say' && !message.session && !message.robot) return;
  const appData = process.platform === 'win32' ? process.env.APPDATA :
    process.platform === 'darwin' ? path.join(os.homedir(), 'Library', 'Application Support') :
      (process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'));
  const userData = process.env.ROBOTCONSOLE_USERDATA || path.join(appData, 'RobotConsole');
  const result = await request(process.env.ROBOTCONSOLE_SPEECH_PIPE || pipeFor(userData), message);
  if (message.action === 'list') for (const robot of result) console.log(`${robot.rid}\t${robot.name}`);
  else if (message.action === 'history') for (const entry of result) console.log(`${entry.at}\t[${entry.source}] ${entry.text}`);
}

if (require.main === module) main().catch((error) => {
  console.error(`robot-say : ${['ENOENT', 'ECONNREFUSED'].includes(error.code) ? 'RobotConsole est fermé ou le profil est incorrect.' : error.message}`);
  process.exitCode = 1;
});

module.exports = { parse, request };
