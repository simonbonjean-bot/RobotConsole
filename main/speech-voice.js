const { spawn } = require('child_process');

function voiceCommand(text, volume, platform = process.platform) {
  if (platform === 'win32') {
    const encodedText = Buffer.from(text, 'utf8').toString('base64');
    const script = `$ErrorActionPreference = 'Stop'; Add-Type -AssemblyName System.Speech; $voice = New-Object System.Speech.Synthesis.SpeechSynthesizer; try { $voice.Volume = ${volume}; $voice.Speak([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encodedText}'))) } finally { $voice.Dispose() }`;
    return {
      file: `${process.env.SystemRoot || 'C:\\Windows'}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`,
      args: ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
    };
  }
  if (platform === 'darwin') return { file: '/usr/bin/say', args: ['--', text] };
  return { file: 'spd-say', args: ['--wait', '--', text] };
}

class SpeechVoice {
  constructor() { this.queue = Promise.resolve(); this.pending = 0; this.child = null; this.stopped = false; }
  speak(text, volume) {
    if (typeof text !== 'string' || !text.trim() || text.length > 4000) return Promise.reject(new Error('Message vocal invalide.'));
    if (this.pending >= 20) return Promise.reject(new Error('File de messages vocaux pleine.'));
    const level = Math.max(0, Math.min(100, Math.round(Number(volume) || 0)));
    this.pending++;
    const run = () => new Promise((resolve, reject) => {
      if (this.stopped) { reject(new Error('Voix de synthèse arrêtée.')); return; }
      const { file, args } = voiceCommand(text, level);
      const child = spawn(file, args, { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
      this.child = child;
      let errorText = '';
      child.stderr.on('data', (chunk) => { errorText = (errorText + chunk.toString()).slice(-4000); });
      child.once('error', reject);
      child.once('close', (code) => {
        if (this.child === child) this.child = null;
        if (code === 0) resolve();
        else reject(new Error(errorText.trim() || `Voix de synthèse indisponible (code ${code}).`));
      });
    });
    const result = this.queue.then(run, run).finally(() => { this.pending--; });
    this.queue = result;
    // Le résultat est aussi renvoyé à l'appelant pour signaler l'erreur dans l'interface.
    this.queue.catch(() => {});
    return result;
  }
  stop() { this.stopped = true; this.child?.kill(); }
}

module.exports = { SpeechVoice, voiceCommand };
