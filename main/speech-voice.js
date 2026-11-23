const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const espeakFile = path.join(__dirname, '..', '.runtime', 'espeak', 'eSpeak NG', 'espeak-ng.exe');
const voices = [
  { id: 'espeak:fr', name: 'Robot', language: 'fr' },
  { id: 'espeak:fr+robosoft', name: 'Robosoft', language: 'fr' },
  { id: 'espeak:fr+robosoft3', name: 'Robosoft 3', language: 'fr' },
  { id: 'espeak:fr+klatt', name: 'Klatt', language: 'fr' },
  { id: 'espeak:en-us', name: 'Robot', language: 'en-US' },
  { id: 'espeak:en-us+robosoft', name: 'Robosoft', language: 'en-US' },
];

function voiceCommand(text, volume, platform = process.platform, voiceName = '') {
  if (platform === 'win32') {
    // Les anciennes voix Windows passent à la voix française par défaut.
    const id = voiceName.startsWith('espeak:') ? voiceName : voices[0].id;
    if (!voices.some((voice) => voice.id === id)) throw new Error('Voix eSpeak NG indisponible.');
    return { file: espeakFile, args: ['--path=' + path.dirname(espeakFile), '-b', '1', '-v', id.slice(7), '-a', String(volume), '--stdin'] };
  }
  if (platform === 'darwin') return { file: '/usr/bin/say', args: ['--', `[[volm ${volume / 100}]]${text}`] };
  return { file: 'spd-say', args: ['--wait', '--volume', String(volume * 2 - 100), '--', text] };
}

class SpeechVoice {
  constructor({ spawnProcess = spawn } = {}) { this.queue = Promise.resolve(); this.pending = 0; this.child = null; this.stopped = false; this.spawnProcess = spawnProcess; this.activeAllowed = null; }
  listVoices() {
    if (process.platform !== 'win32') return Promise.resolve({ supported: false, voices: [] });
    if (!fs.existsSync(espeakFile)) return Promise.reject(new Error("eSpeak NG absent. Exécutez npm run install:espeak."));
    return Promise.resolve({ supported: true, voices });
  }

  speak(text, volume, allowed = () => true, voiceName = '') {
    if (typeof text !== 'string' || !text.trim() || text.length > 4000) return Promise.reject(new Error('Message vocal invalide.'));
    if (typeof voiceName !== 'string' || voiceName.length > 300) return Promise.reject(new Error('Nom de voix invalide.'));
    if (this.pending >= 20) return Promise.reject(new Error('File de messages vocaux pleine.'));
    const level = Math.max(0, Math.min(100, Math.round(Number(volume) || 0)));
    this.pending++;
    const run = () => new Promise((resolve, reject) => {
      if (this.stopped) { reject(new Error('Voix de synthèse arrêtée.')); return; }
      if (!allowed()) { resolve({ cancelled: true }); return; }
      const { file, args } = voiceCommand(text, level, process.platform, voiceName);
      const child = this.spawnProcess(file, args, { windowsHide: true, stdio: [process.platform === 'win32' ? 'pipe' : 'ignore', 'ignore', 'pipe'] });
      this.child = child;
      this.activeAllowed = allowed;
      let errorText = '';
      child.stderr.on('data', (chunk) => { errorText = (errorText + chunk.toString()).slice(-4000); });
      child.once('error', reject);
      if (process.platform === 'win32') {
        child.stdin.on('error', (error) => { if (error.code !== 'EPIPE') reject(error); });
        child.stdin.end(text, 'utf8');
      }
      child.once('close', (code) => {
        if (this.child === child) { this.child = null; this.activeAllowed = null; }
        if (child.voiceCancelled) resolve({ cancelled: true });
        else if (code === 0) resolve();
        else reject(new Error(errorText.trim() || `Voix de synthèse indisponible (code ${code}).`));
      });
    });
    const result = this.queue.then(run, run).finally(() => { this.pending--; });
    this.queue = result;
    // Le résultat est aussi renvoyé à l'appelant pour signaler l'erreur dans l'interface.
    this.queue.catch(() => {});
    return result;
  }
  recheck() {
    if (this.child && this.activeAllowed && !this.activeAllowed()) {
      this.child.voiceCancelled = true;
      this.child.kill();
    }
  }
  stop() { this.stopped = true; this.child?.kill(); }
}

module.exports = { SpeechVoice, voiceCommand };
