// RobotConsole — sons des robots (synthétisés avec WebAudio : aucun fichier audio)
// Utilisés pour prévenir quand un robot a fini de travailler (fin d'activité de son espace).
(function () {
  const LIST = [
    ['ding', 'Ding'],
    ['chime', 'Carillon'],
    ['bipboup', 'Bip boup'],
    ['fanfare', 'Fanfare'],
    ['pop', 'Pop'],
    ['alarm', 'Réveil'],
    ['gong', 'Gong'],
  ];
  const DELAYS = [2, 5, 10, 30]; // secondes de silence avant de considérer le travail terminé

  let ctx = null;
  function audio() {
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  // Une note : oscillateur + enveloppe douce (attaque courte, extinction exponentielle)
  function tone(c, out, t0, freq, dur, { type = 'sine', gain = 0.3, slideTo } = {}) {
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(out);
    o.start(t0);
    o.stop(t0 + dur + 0.05);
  }

  const PRESETS = {
    ding: (c, o, t) => { tone(c, o, t, 880, 1.1, { gain: 0.35 }); tone(c, o, t, 1760, 0.6, { gain: 0.08 }); },
    chime: (c, o, t) => { [659.3, 784, 1046.5].forEach((f, i) => tone(c, o, t + i * 0.16, f, 0.9, { gain: 0.25 })); },
    bipboup: (c, o, t) => { tone(c, o, t, 660, 0.13, { type: 'square', gain: 0.1 }); tone(c, o, t + 0.17, 440, 0.2, { type: 'square', gain: 0.1 }); },
    fanfare: (c, o, t) => { [523.3, 659.3, 784].forEach((f, i) => tone(c, o, t + i * 0.09, f, 0.12, { type: 'triangle', gain: 0.25 })); tone(c, o, t + 0.27, 1046.5, 0.55, { type: 'triangle', gain: 0.28 }); },
    pop: (c, o, t) => { tone(c, o, t, 380, 0.14, { gain: 0.35, slideTo: 1300 }); },
    alarm: (c, o, t) => { for (let i = 0; i < 3; i++) tone(c, o, t + i * 0.16, 988, 0.09, { type: 'square', gain: 0.09 }); },
    gong: (c, o, t) => { tone(c, o, t, 196, 2.2, { gain: 0.35 }); tone(c, o, t, 294, 1.6, { gain: 0.12 }); tone(c, o, t, 523, 0.8, { gain: 0.05 }); },
  };

  // volume : 0…1
  function play(id, volume = 0.7) {
    const preset = PRESETS[id];
    if (!preset || volume <= 0) return;
    try {
      const c = audio();
      const master = c.createGain();
      master.gain.value = Math.min(1, volume);
      master.connect(c.destination);
      preset(c, master, c.currentTime + 0.02);
    } catch (e) { console.warn('[sons]', e); }
  }

  window.RobotSounds = { LIST, DELAYS, play, label: (id) => (LIST.find(([k]) => k === id) || [])[1] || id };
})();
