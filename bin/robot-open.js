#!/usr/bin/env node
const path = require('path');
const { request } = require('./robot-say.js');

function parse(args, env = process.env, cwd = process.cwd()) {
  if (args.length === 1 && ['--help', '-h'].includes(args[0])) return { action: 'help' };
  const files = args[0] === '--' ? args.slice(1) : args;
  if (files.length !== 1 || !files[0].trim() || files[0].includes('\0') ||
    (args[0] !== '--' && files[0].startsWith('--'))) {
    throw new Error('Indiquez un fichier : robot-open "chemin"');
  }
  if (!env.ROBOTCONSOLE_SESSION || !env.ROBOTCONSOLE_SPEECH_PIPE) {
    throw new Error('Utilisez robot-open depuis un terminal intégré RobotConsole.');
  }
  return { action: 'open', session: env.ROBOTCONSOLE_SESSION, file: path.resolve(cwd, files[0]) };
}

async function main() {
  const message = parse(process.argv.slice(2));
  if (message.action === 'help') {
    console.log('robot-open "chemin-du-fichier"\nrobot-open -- "--notes.md"\n\nOuvre un fichier existant dans un onglet RobotConsole depuis un terminal intégré.');
    return;
  }
  await request(process.env.ROBOTCONSOLE_SPEECH_PIPE, message);
}

if (require.main === module) main().catch((error) => {
  console.error(`robot-open : ${['ENOENT', 'ECONNREFUSED'].includes(error.code) ? 'RobotConsole est fermé ou le profil est incorrect.' : error.message}`);
  process.exitCode = 1;
});

module.exports = { parse };
