const { spawn } = require('child_process');

function powershellCommand(script) {
  return {
    file: `${process.env.SystemRoot || 'C:\\Windows'}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`,
    args: ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
  };
}

function voiceCommand(text, volume, platform = process.platform, voiceName = '') {
  if (platform === 'win32') {
    const encodedText = Buffer.from(text, 'utf8').toString('base64');
    const select = voiceName ? `$voice.SelectVoice([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${Buffer.from(voiceName, 'utf8').toString('base64')}'))); ` : '';
    const script = `$ErrorActionPreference = 'Stop'; Add-Type -AssemblyName System.Speech; $voice = New-Object System.Speech.Synthesis.SpeechSynthesizer; try { $voice.Volume = ${volume}; ${select}$voice.Speak([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encodedText}'))) } finally { $voice.Dispose() }`;
    return powershellCommand(script);
  }
  if (platform === 'darwin') return { file: '/usr/bin/say', args: ['--', text] };
  return { file: 'spd-say', args: ['--wait', '--', text] };
}

class SpeechVoice {
  constructor({ spawnProcess = spawn } = {}) { this.queue = Promise.resolve(); this.pending = 0; this.child = null; this.stopped = false; this.spawnProcess = spawnProcess; this.activeAllowed = null; }
  listVoices() {
    if (process.platform !== 'win32') return Promise.resolve({ supported: false, voices: [] });
    if (this.listing) return this.listing;
    const script = "$ErrorActionPreference = 'Stop'; [Console]::OutputEncoding = New-Object Text.UTF8Encoding($false); Add-Type -AssemblyName System.Speech; $voice = New-Object System.Speech.Synthesis.SpeechSynthesizer; try { $items = @($voice.GetInstalledVoices() | Where-Object Enabled | ForEach-Object { @{ id = $_.VoiceInfo.Name; name = $_.VoiceInfo.Name; language = $_.VoiceInfo.Culture.Name } }); ConvertTo-Json -InputObject $items -Compress } finally { $voice.Dispose() }";
    this.listing = new Promise((resolve, reject) => {
      const { file, args } = powershellCommand(script);
      const child = this.spawnProcess(file, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      this.listingChild = child;
      let output = '', errorText = '';
      const timeout = setTimeout(() => { child.kill(); reject(new Error('La liste des voix ne répond pas.')); }, 15000);
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (chunk) => {
        output += chunk;
        if (output.length > 1024 * 1024) { child.kill(); reject(new Error('Liste des voix trop volumineuse.')); }
      });
      child.stderr.on('data', (chunk) => { errorText = (errorText + chunk.toString()).slice(-4000); });
      child.once('error', (error) => { clearTimeout(timeout); reject(error); });
      child.once('close', (code) => {
        clearTimeout(timeout);
        if (this.listingChild === child) this.listingChild = null;
        if (code !== 0) { reject(new Error(errorText.trim() || `Impossible de lister les voix (code ${code}).`)); return; }
        try {
          const voices = JSON.parse(output.trim());
          if (!Array.isArray(voices) || voices.some((voice) => typeof voice.id !== 'string' || typeof voice.name !== 'string' || typeof voice.language !== 'string')) throw new Error('Liste des voix invalide.');
          resolve({ supported: true, voices });
        } catch (error) { reject(error); }
      });
    }).finally(() => { this.listing = null; });
    return this.listing;
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
      const child = this.spawnProcess(file, args, { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
      this.child = child;
      this.activeAllowed = allowed;
      let errorText = '';
      child.stderr.on('data', (chunk) => { errorText = (errorText + chunk.toString()).slice(-4000); });
      child.once('error', reject);
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
  stop() { this.stopped = true; this.child?.kill(); this.listingChild?.kill(); }
}

module.exports = { SpeechVoice, voiceCommand };
