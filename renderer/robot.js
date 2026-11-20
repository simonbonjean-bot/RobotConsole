// RobotConsole — générateur de robots (SVG)
// Un robot = un ensemble de « traits » (tête, yeux, bouche, antenne, oreilles, corps, accessoire,
// outil, motif, finition, couleurs…). Les traits sont tirés au hasard à partir d'une graine, et
// chacun peut être remplacé à la main (atelier du robot).
(function () {
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const SYL = ['Zo', 'Bi', 'Kra', 'Pix', 'Lu', 'Ro', 'Ty', 'Mek', 'Gli', 'Vo', 'Nu', 'Qua', 'Bee', 'Dex', 'Fi', 'Tor', 'Ka', 'Zap', 'Mo', 'Rii', 'Bo', 'Spro', 'Nix', 'Ulu', 'Gax'];
  const SUF = ['', 'x', 'o', 'tron', 'bot', 'ix', 'y', 'on', 'ek'];

  // Catalogue des options (l'ordre des 6 premières têtes, yeux, bouches… est celui des anciennes versions)
  const OPTIONS = {
    head: { label: 'Tête', values: { rounded: 'Arrondie', circle: 'Ronde', hex: 'Hexagone', wide: 'Large', dome: 'Dôme', trapezoid: 'Trapèze', capsule: 'Capsule', octagon: 'Octogone', tv: 'Télé', bucket: 'Seau', tall: 'Haute', flat: 'Plate' } },
    headSize: { label: 'Taille de la tête', values: { normal: 'Normale', small: 'Petite', big: 'Grosse' } },
    eyes: { label: 'Yeux', values: { round: 'Ronds', square: 'Carrés', visor: 'Visière', cyclops: 'Cyclope', oval: 'Ovales', happy: 'Joyeux', heart: 'Cœurs', sleepy: 'Endormis', big: 'Grands', dots: 'Points', led: 'LED', angry: 'Fâchés', triple: 'Trois yeux', lens: 'Objectifs', mismatched: 'Dépareillés' } },
    mouth: { label: 'Bouche', values: { grille: 'Grille', smile: 'Sourire', line: 'Neutre', teeth: 'Dents', o: 'Surpris', zigzag: 'Zigzag', tongue: 'Langue', fangs: 'Crocs', wave: 'Vague', mustache: 'Moustache', speaker: 'Haut-parleur', none: 'Aucune' } },
    antenna: { label: 'Antenne', values: { none: 'Aucune', ball: 'Boule', double: 'Double', spring: 'Ressort', box: 'Balise', propeller: 'Hélice', dish: 'Parabole', bulb: 'Ampoule', horns: 'Cornes' } },
    ears: { label: 'Oreilles', values: { none: 'Aucune', bolts: 'Boulons', panels: 'Panneaux', speakers: 'Haut-parleurs', headphones: 'Casque', cat: 'Chat' } },
    neck: { label: 'Cou', values: { short: 'Court', long: 'Long', spring: 'Ressort' } },
    body: { label: 'Corps', values: { rounded: 'Arrondi', barrel: 'Tonneau', trapezoid: 'Trapèze', box: 'Carré' } },
    chest: { label: 'Torse', values: { panel: 'Écran', core: 'Noyau', star: 'Étoile', bolt: 'Éclair', heart: 'Cœur', gauge: 'Jauge', vents: 'Aérations' } },
    arms: { label: 'Bras', values: { tube: 'Tuyaux', segment: 'Segments', claw: 'Griffes', pincer: 'Pinces', spring: 'Ressorts', tentacle: 'Tentacules', stubby: 'Moignons' } },
    legs: { label: 'Locomotion', values: { stick: 'Tiges', jointed: 'Articulées', chunky: 'Trapues', springs: 'Ressorts', spider: 'Araignée', wheels: 'Roues', unicycle: 'Monoroue', tracks: 'Chenilles', hover: 'Lévitation' } },
    gear: { label: 'Équipement', values: { none: 'Aucun', jetpack: 'Jetpack', wings: 'Ailes', cape: 'Cape', shoulders: 'Épaulettes' } },
    accessory: { label: 'Accessoire', values: { none: 'Aucun', cap: 'Casquette', tophat: 'Haut-de-forme', crown: 'Couronne', beanie: 'Bonnet', bowtie: 'Nœud papillon', glasses: 'Lunettes', headset: 'Micro-casque', scarf: 'Écharpe', flower: 'Fleur', monocle: 'Monocle', eyepatch: 'Cache-œil', mohawk: 'Crête' } },
    tool: { label: 'Outil à côté', values: { none: 'Aucun', auto: "Auto (selon l'onglet)" } }, // + tout le catalogue ToolIcons
    pattern: { label: 'Motif', values: { none: 'Uni', stripes: 'Rayures', spots: 'Pois', panels: 'Plaques', shine: 'Reflet' } },
    wear: { label: 'État', values: { new: 'Neuf', scratched: 'Rayé', rusty: 'Rouillé', patched: 'Rafistolé', stickers: 'Autocollants' } },
    finish: { label: 'Finition', values: { mat: 'Mat', metal: 'Métal', pastel: 'Pastel', neon: 'Néon' } },
  };
  // Traits visibles seulement « en pied »
  const LEGS_KEYS = new Set(['neck', 'chest', 'arms', 'legs', 'gear']);
  const keys = (k) => Object.keys(OPTIONS[k].values);
  const HEAD_OLD = ['rounded', 'circle', 'hex', 'wide', 'dome', 'trapezoid'];
  const EYES_OLD = ['round', 'square', 'visor', 'cyclops', 'oval', 'happy'];
  const MOUTH_OLD = ['grille', 'smile', 'line', 'teeth', 'o', 'zigzag'];
  const ANT_OLD = ['none', 'ball', 'double', 'spring', 'box'];
  const EARS_OLD = ['none', 'bolts', 'panels', 'speakers'];
  const ACC_OLD = ['cap', 'tophat', 'crown', 'beanie', 'bowtie', 'glasses', 'headset', 'scarf', 'flower'];
  const LEG_OLD = ['stick', 'jointed', 'chunky'];
  const ARM_OLD = ['tube', 'segment', 'claw'];
  const HATS = new Set(['cap', 'tophat', 'crown', 'beanie', 'mohawk']);
  const HEAD_SCALE = { normal: 1, small: 0.84, big: 1.14 };

  // Outil « auto » : selon le type d'onglet actif de l'espace
  const AUTO_TOOL = { terminal: 'lu:square-terminal', tests: 'lu:flask-conical', docker: 'dv:docker', services: 'lu:zap', prisma: 'dv:prisma', explorer: 'lu:folder-tree', editor: 'lu:file-code', browser: 'lu:globe', graphify: 'lu:network' };

  function randomSeed() { return (Math.random() * 0xffffffff) >>> 0; }

  // ---------- Tirage des traits ----------
  function traitsFor(seed) {
    const r = mulberry32(seed);
    const between = (a, b) => a + r() * (b - a);
    const chance = (p) => r() < p;
    // Même ordre de tirage que les versions précédentes (les robots existants gardent leur allure et leur nom)
    const t = {};
    t.hue = Math.floor(r() * 360);
    t.sat = Math.floor(between(50, 78));
    t.accentHue = (t.hue + Math.floor(between(140, 220))) % 360;
    t.head = HEAD_OLD[Math.floor(r() * 6)];
    t.bodyW = Math.floor(between(36, 52));
    t.coreR = +between(3, 4.5).toFixed(1);
    t.antenna = ANT_OLD[Math.floor(r() * 5)];
    t.ears = EARS_OLD[Math.floor(r() * 4)];
    t.screen = chance(0.55);
    t.eyes = EYES_OLD[Math.floor(r() * 6)];
    t.gap = +between(8, 12).toFixed(2);
    t.eyeSize = t.eyes === 'round' ? +between(4, 6).toFixed(2) : 5;
    t.cheeks = chance(0.35) && !t.screen;
    t.mouth = MOUTH_OLD[Math.floor(r() * 6)];
    t.rivets = chance(0.4) && t.head !== 'hex';
    const pick = (arr) => arr[Math.floor(r() * arr.length)];
    t.name = pick(SYL) + pick(SYL).toLowerCase() + pick(SUF) + '-' + (1 + Math.floor(r() * 99));
    t.blinkDelay = +(r() * 4).toFixed(2);

    // Variété supplémentaire : second générateur, indépendant
    const r2 = mulberry32((seed ^ 0x5bd1e995) >>> 0);
    const c2 = (p) => r2() < p;
    const p2 = (arr) => arr[Math.floor(r2() * arr.length)];
    if (c2(0.35)) t.head = p2(['capsule', 'octagon', 'tv', 'bucket']);
    if (c2(0.35)) t.eyes = p2(['heart', 'sleepy', 'big', 'dots', 'led', 'angry']);
    if (c2(0.3)) t.mouth = p2(['tongue', 'fangs', 'wave', 'mustache']);
    if (c2(0.3)) t.antenna = p2(['propeller', 'dish', 'bulb', 'horns']);
    if (c2(0.2)) t.ears = p2(['headphones', 'cat']);
    t.body = c2(0.5) ? 'rounded' : p2(['barrel', 'trapezoid', 'box']);
    t.accessory = c2(0.45) ? p2(ACC_OLD) : 'none';
    // Outils au hasard : surtout des outils informatiques
    t.tool = c2(0.45) ? p2(['server', 'database', 'git', 'terminal', 'code', 'chip', 'cloud', 'lock', 'bug', 'electricity', 'battery', 'internet', 'webpage', 'server', 'terminal', 'git']) : 'none';
    t.pattern = c2(0.3) ? p2(keys('pattern').slice(1)) : 'none';
    t.finish = c2(0.55) ? 'mat' : p2(['metal', 'pastel', 'neon', 'metal']);
    t.hue2 = c2(0.5) ? t.hue : Math.floor(r2() * 360); // couleur secondaire (oreilles, membres, accessoires)
    t.legType = Math.floor(r2() * 3);
    t.armType = Math.floor(r2() * 3);
    t.panel = c2(0.6);

    // Silhouette et caractère : troisième générateur, indépendant (robots très différents les uns des autres)
    const r3 = mulberry32((seed ^ 0x9e3779b9) >>> 0);
    const c3 = (p) => r3() < p;
    const p3 = (arr) => arr[Math.floor(r3() * arr.length)];
    t.legs = LEG_OLD[t.legType] || 'stick';
    if (c3(0.5)) t.legs = p3(['springs', 'spider', 'wheels', 'unicycle', 'tracks', 'hover']);
    t.arms = ARM_OLD[t.armType] || 'tube';
    if (c3(0.4)) t.arms = p3(['pincer', 'spring', 'tentacle', 'stubby']);
    t.chest = t.panel ? 'panel' : 'core';
    if (c3(0.45)) t.chest = p3(['star', 'bolt', 'heart', 'gauge', 'vents']);
    t.gear = c3(0.35) ? p3(['jetpack', 'wings', 'cape', 'shoulders']) : 'none';
    t.neck = c3(0.3) ? p3(['long', 'spring']) : 'short';
    t.headSize = c3(0.4) ? p3(['small', 'big']) : 'normal';
    t.wear = c3(0.3) ? p3(['scratched', 'rusty', 'patched', 'stickers']) : 'new';
    if (c3(0.2)) t.head = p3(['tall', 'flat']);
    if (c3(0.18)) t.eyes = p3(['triple', 'lens', 'mismatched']);
    if (c3(0.12)) t.mouth = p3(['speaker', 'none']);
    if (c3(0.14)) t.accessory = p3(['monocle', 'eyepatch', 'mohawk']);
    return t;
  }

  // ---------- Rendu ----------
  let idSeq = 0;
  function hashStr(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); }

  function generate(seed, opts = {}) {
    const base = traitsFor(seed);
    const t = { ...base, ...(opts.traits || {}) };
    if (opts.traits?.name === '') t.name = base.name;
    const toolIt = window.ToolIcons?.get(t.tool === 'auto' ? AUTO_TOOL[opts.context?.tabKind] : t.tool);
    const tool = toolIt ? toolIt.id : 'none';
    const uid = 'rb' + hashStr(JSON.stringify(t) + (opts.legs ? 'L' : '') + tool);

    // --- Couleurs selon la finition ---
    let L = { main: 58, dark: 32, light: 78 }, S = t.sat;
    if (t.finish === 'pastel') { L = { main: 76, dark: 46, light: 88 }; S = Math.max(35, t.sat - 15); }
    if (t.finish === 'neon') { L = { main: 24, dark: 60, light: 40 }; S = 70; }
    const col = (l, h = t.hue, s = S) => `hsl(${h} ${s}% ${l}%)`;
    const main = col(L.main), dark = col(L.dark), light = col(L.light);
    const main2 = col(L.main, t.hue2), dark2 = col(L.dark, t.hue2), light2 = col(L.light, t.hue2);
    const glow = `hsl(${t.accentHue} 95% 65%)`;
    const screen = '#141a26';
    const metal = t.finish === 'neon' ? col(35) : '#8b95a7';
    const stroke = t.finish === 'neon' ? `hsl(${t.hue} 100% 62%)` : dark;
    const defs = [];
    let headFill = main;
    if (t.finish === 'metal') {
      defs.push(`<linearGradient id="${uid}g" x1="0" y1="0" x2="0.4" y2="1"><stop offset="0" stop-color="${col(82)}"/><stop offset="0.45" stop-color="${col(58)}"/><stop offset="1" stop-color="${col(40)}"/></linearGradient>`);
      headFill = `url(#${uid}g)`;
    }
    const SW = `stroke="${stroke}" stroke-width="2.5" stroke-linejoin="round"`;
    const parts = [];

    // --- Forme de la tête ---
    let headShape = '', top = 30, halfW = 28;
    switch (t.head) {
      case 'circle': headShape = '<circle cx="50" cy="54" r="27"/>'; top = 27; halfW = 27; break;
      case 'hex': headShape = '<polygon points="50,26 76,40 76,66 50,80 24,66 24,40"/>'; top = 26; halfW = 26; break;
      case 'wide': headShape = '<rect x="15" y="35" width="70" height="40" rx="7"/>'; top = 35; halfW = 35; break;
      case 'dome': headShape = '<path d="M22 76 V56 A28 28 0 0 1 78 56 V76 Z"/>'; top = 28; break;
      case 'trapezoid': headShape = '<path d="M30 30 H70 L80 76 H20 Z"/>'; top = 30; halfW = 27; break;
      case 'capsule': headShape = '<rect x="27" y="24" width="46" height="54" rx="23"/>'; top = 24; halfW = 23; break;
      case 'octagon': headShape = '<polygon points="37,28 63,28 76,41 76,65 63,78 37,78 24,65 24,41"/>'; top = 28; halfW = 26; break;
      case 'tv': headShape = '<rect x="17" y="33" width="66" height="44" rx="9"/>'; top = 33; halfW = 33; break;
      case 'bucket': headShape = '<path d="M23 30 H77 L70 78 H30 Z"/>'; top = 30; halfW = 27; break;
      case 'tall': headShape = '<rect x="29" y="16" width="42" height="62" rx="9"/>'; top = 16; halfW = 21; break;
      case 'flat': headShape = '<rect x="9" y="40" width="82" height="35" rx="10"/>'; top = 40; halfW = 41; break;
      default: headShape = '<rect x="22" y="30" width="56" height="46" rx="11"/>'; top = 30; break;
    }
    const withAttrs = (shape, attrs) => shape.replace(/\/>$/, ` ${attrs}/>`);
    const hat = HATS.has(t.accessory);

    // --- Corps (version courte : épaules) ---
    const bw = t.bodyW;
    const bodyShape = (x, y, w, hgt, fill) => {
      if (t.body === 'barrel') return `<rect x="${x}" y="${y}" width="${w}" height="${hgt}" rx="${Math.min(w, hgt) / 2}" fill="${fill}" stroke="${stroke}" stroke-width="2"/>`;
      if (t.body === 'trapezoid') return `<path d="M${x + 6} ${y} H${x + w - 6} L${x + w} ${y + hgt} H${x} Z" fill="${fill}" stroke="${stroke}" stroke-width="2" stroke-linejoin="round"/>`;
      if (t.body === 'box') return `<rect x="${x}" y="${y}" width="${w}" height="${hgt}" rx="2" fill="${fill}" stroke="${stroke}" stroke-width="2"/>`;
      return `<rect x="${x}" y="${y}" width="${w}" height="${hgt}" rx="8" fill="${fill}" stroke="${stroke}" stroke-width="2"/>`;
    };
    // --- Cou ---
    const nk = opts.legs ? (t.neck === 'long' ? 12 : t.neck === 'spring' ? 8 : 0) : 0;
    if (t.neck === 'spring') {
      let pts = '';
      for (let i = 0; i <= 6; i++) pts += `${50 + (i === 0 || i === 6 ? 0 : i % 2 ? 5 : -5)},${(74 + i * (10 + nk) / 6).toFixed(1)} `;
      parts.push(`<rect x="46" y="74" width="8" height="${10 + nk}" fill="${dark}" opacity=".5"/><polyline points="${pts}" fill="none" stroke="${metal}" stroke-width="2.6" stroke-linejoin="round"/>`);
    } else if (t.neck === 'long' && opts.legs) {
      parts.push(`<rect x="46" y="74" width="8" height="${10 + nk}" fill="${metal}" stroke="${stroke}" stroke-width="2"/><rect x="44" y="${78 + nk / 2}" width="12" height="4" rx="2" fill="${main2}" stroke="${stroke}" stroke-width="1.5"/>`);
    } else parts.push(`<rect x="45" y="74" width="10" height="10" fill="${metal}" stroke="${stroke}" stroke-width="2"/>`);
    let viewH = 100;
    if (opts.legs) {
      viewH = 156 + nk;
      const tW = Math.max(bw, 44), tx = 50 - tW / 2;
      const behind = [], back = [], front = [];
      const tire = '#2a2f3a';

      // Équipement dans le dos
      if (t.gear === 'cape') behind.push(`<path d="M${tx + 4} 84 H${tx + tW - 4} L${tx + tW + 10} 146 Q50 139 ${tx - 10} 146 Z" fill="${main2}" stroke="${stroke}" stroke-width="2" stroke-linejoin="round"/><path d="M${tx + 4} 84 H${tx + tW - 4} L${tx + tW + 1} 96 H${tx - 1} Z" fill="${dark2}" opacity=".5"/>`);
      if (t.gear === 'wings') for (const s of [-1, 1]) {
        const x0 = 50 + s * (tW / 2 - 4), w = tW / 2;
        behind.push(`<path d="M${x0} 92 Q${50 + s * (w + 22)} 66 ${50 + s * (w + 30)} 80 Q${50 + s * (w + 18)} 90 ${50 + s * (w + 24)} 100 Q${50 + s * (w + 10)} 104 ${x0} 110 Z" fill="${light2}" stroke="${stroke}" stroke-width="2" stroke-linejoin="round"/><path d="M${x0 + s * 4} 96 Q${50 + s * (w + 14)} 84 ${50 + s * (w + 24)} 82 M${x0 + s * 4} 102 Q${50 + s * (w + 10)} 96 ${50 + s * (w + 18)} 98" fill="none" stroke="${stroke}" stroke-width="1.2" opacity=".5"/>`);
      }
      if (t.gear === 'jetpack') for (const s of [-1, 1]) {
        const cx = s < 0 ? tx - 4 : tx + tW + 4;
        behind.push(`<rect x="${cx - 5}" y="86" width="10" height="26" rx="5" fill="${light2}" stroke="${stroke}" stroke-width="2"/><path d="M${cx - 4} 112 h8 l-1 4 h-6 z" fill="${metal}" stroke="${stroke}" stroke-width="1.5"/><path class="ant-light" d="M${cx - 3} 117 Q${cx} 131 ${cx + 3} 117 Z" fill="#ffb347"/><path d="M${cx - 1.4} 117 Q${cx} 124 ${cx + 1.4} 117 Z" fill="#fff3b0"/>`);
      }

      // Bras
      const arm = (side) => {
        const sx = side < 0 ? tx + 3 : tx + tW - 3;
        const cls = side < 0 ? 'arm arm-l' : 'arm arm-r';
        const g = (s) => `<g class="${cls}">${s}</g>`;
        switch (t.arms) {
          case 'segment': return g(`<rect x="${Math.min(sx, sx + side * 16) + (side < 0 ? 4 : -4)}" y="88" width="10" height="26" rx="5" fill="${main2}" stroke="${stroke}" stroke-width="2" transform="rotate(${side * 14} ${sx} 90)"/><circle cx="${sx + side * 10}" cy="118" r="4.5" fill="${metal}" stroke="${stroke}" stroke-width="2"/>`);
          case 'claw': return g(`<polyline points="${sx},90 ${sx + side * 12},102 ${sx + side * 10},114" fill="none" stroke="${metal}" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M${sx + side * 6} 116 l${side * 4} 6 l${side * 6} -4" fill="none" stroke="${stroke}" stroke-width="3" stroke-linecap="round"/>`);
          case 'pincer': { const hx = sx + side * 14; return g(`<line x1="${sx}" y1="90" x2="${hx}" y2="110" stroke="${metal}" stroke-width="5" stroke-linecap="round"/><circle cx="${hx}" cy="110" r="3.5" fill="${main2}" stroke="${stroke}" stroke-width="1.5"/><path d="M${hx} 112 q${-side * 6} 5 ${-side * 2} 11 M${hx} 112 q${side * 7} 4 ${side * 5} 11" fill="none" stroke="${stroke}" stroke-width="3" stroke-linecap="round"/>`); }
          case 'spring': {
            let pts = '';
            for (let i = 0; i <= 6; i++) pts += `${(sx + side * i * 1.8 + (i === 0 || i === 6 ? 0 : (i % 2 ? 4 : -4))).toFixed(1)},${90 + i * 4} `;
            return g(`<polyline points="${pts}" fill="none" stroke="${metal}" stroke-width="2.6" stroke-linejoin="round"/><circle cx="${sx + side * 11}" cy="118" r="4.5" fill="${main2}" stroke="${stroke}" stroke-width="2"/>`);
          }
          case 'tentacle': return g(`<path d="M${sx} 90 C${sx + side * 16} 94 ${sx + side * 2} 108 ${sx + side * 15} 118" fill="none" stroke="${stroke}" stroke-width="8" stroke-linecap="round"/><path d="M${sx} 90 C${sx + side * 16} 94 ${sx + side * 2} 108 ${sx + side * 15} 118" fill="none" stroke="${main2}" stroke-width="5" stroke-linecap="round"/><path d="M${sx} 90 C${sx + side * 16} 94 ${sx + side * 2} 108 ${sx + side * 15} 118" fill="none" stroke="${light2}" stroke-width="2" stroke-dasharray="1 4" stroke-linecap="round"/>`);
          case 'stubby': return g(`<rect x="${side < 0 ? sx - 10 : sx}" y="87" width="10" height="13" rx="5" fill="${main2}" stroke="${stroke}" stroke-width="2"/><circle cx="${sx + side * 5}" cy="102" r="3" fill="${metal}" stroke="${stroke}" stroke-width="1.5"/>`);
          default: { const hx = sx + side * 16; return g(`<path d="M${sx} 90 Q${hx} 98 ${hx} 116" fill="none" stroke="${metal}" stroke-width="5" stroke-linecap="round"/><circle cx="${hx}" cy="118" r="5" fill="${main2}" stroke="${stroke}" stroke-width="2"/>`); }
        }
      };
      back.push(arm(-1), arm(1));

      // Locomotion
      const leg = (side) => {
        const lx = 50 + side * (tW / 4);
        const cls = side < 0 ? 'leg leg-l' : 'leg leg-r';
        const g = (s) => `<g class="${cls}">${s}</g>`;
        switch (t.legs) {
          case 'jointed': return g(`<path d="M${lx} 118 v8 l${side * 3} 6 v8" fill="none" stroke="${metal}" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/><circle cx="${lx}" cy="126" r="3.5" fill="${main2}" stroke="${stroke}" stroke-width="1.5"/><ellipse cx="${lx + side * 4}" cy="143" rx="9" ry="4.5" fill="${dark2}"/>`);
          case 'chunky': return g(`<rect x="${lx - 6}" y="118" width="12" height="20" rx="6" fill="${main2}" stroke="${stroke}" stroke-width="2"/><path d="M${lx - 8} 146 a8 6 0 0 1 16 0 z" fill="${dark2}"/><rect x="${lx - 2}" y="136" width="4" height="6" fill="${metal}"/>`);
          case 'springs': {
            let pts = '';
            for (let i = 0; i <= 6; i++) pts += `${lx + (i === 0 || i === 6 ? 0 : (i % 2 ? 5 : -5))},${(118 + i * 3.4).toFixed(1)} `;
            return g(`<polyline points="${pts}" fill="none" stroke="${metal}" stroke-width="2.8" stroke-linejoin="round"/><rect x="${lx - 9}" y="139" width="18" height="6" rx="3" fill="${dark2}" stroke="${stroke}" stroke-width="1.5"/>`);
          }
          case 'spider': return g(`<path d="M${50 + side * 8} 116 Q${50 + side * 32} 102 ${50 + side * 31} 145" fill="none" stroke="${metal}" stroke-width="4" stroke-linecap="round"/><path d="M${50 + side * 4} 118 Q${50 + side * 19} 112 ${50 + side * 17} 145" fill="none" stroke="${metal}" stroke-width="4" stroke-linecap="round"/><circle cx="${50 + side * 25}" cy="110" r="3" fill="${main2}" stroke="${stroke}" stroke-width="1.5"/><circle cx="${50 + side * 31}" cy="145" r="2.6" fill="${dark2}"/><circle cx="${50 + side * 17}" cy="145" r="2.6" fill="${dark2}"/>`);
          case 'wheels': return `<g class="leg"><rect x="${lx - 2.5}" y="116" width="5" height="14" fill="${metal}" stroke="${stroke}" stroke-width="1.5"/><circle cx="${lx}" cy="138" r="8" fill="${tire}" stroke="${stroke}" stroke-width="2"/><circle cx="${lx}" cy="138" r="3.5" fill="${main2}"/></g>`;
          default: return g(`<rect x="${lx - 4}" y="118" width="8" height="22" rx="3" fill="${metal}" stroke="${stroke}" stroke-width="2"/><rect x="${lx - 9 + side * 2}" y="138" width="18" height="8" rx="4" fill="${dark2}"/>`);
        }
      };
      if (t.legs === 'unicycle') {
        let spokes = '';
        for (let i = 0; i < 4; i++) { const a = (i / 4) * Math.PI; spokes += `<line x1="${(50 - Math.cos(a) * 10).toFixed(1)}" y1="${(135 - Math.sin(a) * 10).toFixed(1)}" x2="${(50 + Math.cos(a) * 10).toFixed(1)}" y2="${(135 + Math.sin(a) * 10).toFixed(1)}" stroke="${metal}" stroke-width="1.2"/>`; }
        back.push(`<g class="leg"><path d="M40 118 L46 124 H54 L60 118" fill="${metal}" stroke="${stroke}" stroke-width="1.5"/><rect x="47" y="118" width="6" height="12" fill="${metal}" stroke="${stroke}" stroke-width="1.5"/><circle cx="50" cy="135" r="11.5" fill="${tire}" stroke="${stroke}" stroke-width="2"/>${spokes}<circle cx="50" cy="135" r="3.5" fill="${main2}" stroke="${stroke}" stroke-width="1.5"/></g>`);
      } else if (t.legs === 'tracks') {
        let wheels = '';
        for (let i = 0; i < 4; i++) wheels += `<circle cx="${(tx + 7 + i * (tW - 14) / 3).toFixed(1)}" cy="134" r="4.5" fill="${metal}" stroke="${stroke}" stroke-width="1.2"/>`;
        back.push(`<g class="leg"><rect x="${tx + 6}" y="116" width="${tW - 12}" height="10" fill="${metal}" stroke="${stroke}" stroke-width="1.5"/><rect x="${tx - 4}" y="124" width="${tW + 8}" height="20" rx="10" fill="${tire}" stroke="${stroke}" stroke-width="2"/><rect x="${tx - 1}" y="127" width="${tW + 2}" height="14" rx="7" fill="none" stroke="${light2}" stroke-width="1.5" stroke-dasharray="2.5 2.5" opacity=".45"/>${wheels}</g>`);
      } else if (t.legs === 'hover') {
        back.push(`<g class="leg"><path class="ant-light" d="M${tx + 8} 124 L${tx + 2} 146 H${tx + tW - 2} L${tx + tW - 8} 124 Z" fill="${glow}" fill-opacity=".28"/><ellipse cx="50" cy="147" rx="${tW / 2 + 2}" ry="3" fill="${glow}" fill-opacity=".3"/><ellipse cx="50" cy="121" rx="${tW / 2 - 3}" ry="5.5" fill="${dark2}" stroke="${stroke}" stroke-width="2"/><ellipse cx="50" cy="122" rx="${tW / 2 - 10}" ry="2" fill="${glow}"/></g>`);
      } else back.push(leg(-1), leg(1));

      // Torse
      front.push(bodyShape(tx, 82, tW, 38, headFill));
      if (t.gear === 'shoulders') for (const s of [-1, 1]) front.push(`<ellipse cx="${s < 0 ? tx + 4 : tx + tW - 4}" cy="86" rx="10" ry="6.5" fill="${main2}" stroke="${stroke}" stroke-width="2"/><circle cx="${s < 0 ? tx + 4 : tx + tW - 4}" cy="85" r="1.6" fill="${stroke}"/>`);
      switch (t.chest) {
        case 'panel': front.push(`<rect x="37" y="92" width="26" height="18" rx="4" fill="${screen}" stroke="${stroke}" stroke-width="1.5"/><circle class="core" cx="44" cy="101" r="3" fill="${glow}"/><rect class="ant-light" x="51" y="97" width="7" height="3" rx="1" fill="${glow}"/><rect x="51" y="102" width="7" height="3" rx="1" fill="${light}" opacity=".7"/>`); break;
        case 'star': {
          let pts = '';
          for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + (i * Math.PI) / 5, rr = i % 2 ? 3.4 : 8; pts += `${(50 + Math.cos(a) * rr).toFixed(1)},${(101 + Math.sin(a) * rr).toFixed(1)} `; }
          front.push(`<polygon class="core" points="${pts}" fill="${glow}" stroke="${stroke}" stroke-width="1.5" stroke-linejoin="round"/>`); break;
        }
        case 'bolt': front.push(`<path class="core" d="M53 90 L43 103 H50 L46 113 L58 98 H51 Z" fill="${glow}" stroke="${stroke}" stroke-width="1.5" stroke-linejoin="round"/>`); break;
        case 'heart': front.push(`<path class="core" d="M50 109 C40 102 42 92 50 96.5 C58 92 60 102 50 109 Z" fill="#ff5c8a" stroke="${stroke}" stroke-width="1.5"/>`); break;
        case 'gauge': front.push(`<circle cx="50" cy="101" r="10" fill="${screen}" stroke="${stroke}" stroke-width="1.5"/><path d="M42.5 103 A7.5 7.5 0 0 1 57.5 103" fill="none" stroke="${light2}" stroke-width="1.5" stroke-dasharray="1.6 2"/><line class="core" x1="50" y1="102" x2="54.5" y2="95.5" stroke="${glow}" stroke-width="2" stroke-linecap="round"/><circle cx="50" cy="102" r="1.8" fill="${glow}"/>`); break;
        case 'vents': {
          let v = '';
          for (let i = 0; i < 3; i++) v += `<rect x="39" y="${91 + i * 6}" width="22" height="3.2" rx="1.6" fill="${screen}"/>`;
          front.push(v + `<circle class="core" cx="50" cy="112" r="2.2" fill="${glow}"/>`); break;
        }
        default: front.push(`<circle class="core" cx="50" cy="100" r="${Math.max(5, t.coreR + 2)}" fill="${glow}" stroke="${stroke}" stroke-width="2"/><circle cx="38" cy="112" r="2" fill="${stroke}"/><circle cx="62" cy="112" r="2" fill="${stroke}"/>`);
      }
      if (t.wear === 'rusty') front.push(`<circle cx="${tx + 7}" cy="88" r="3" fill="hsl(24 65% 36%)" opacity=".6"/><circle cx="${tx + tW - 8}" cy="113" r="4" fill="hsl(24 65% 36%)" opacity=".55"/>`);
      if (t.wear === 'scratched') front.push(`<path d="M${tx + 5} 110 l7 4 M${tx + tW - 12} 87 l6 5" stroke="#fff" stroke-width="1" opacity=".5"/>`);
      if (t.wear === 'patched') front.push(`<rect x="${tx + tW - 14}" y="108" width="9" height="8" fill="${light2}" stroke="${stroke}" stroke-width="1"/><circle cx="${tx + tW - 12.5}" cy="109.5" r=".9" fill="${stroke}"/><circle cx="${tx + tW - 6.5}" cy="114.5" r=".9" fill="${stroke}"/>`);

      parts.push(`<g transform="translate(0 ${nk})">${behind.join('')}<g class="limbs">${back.join('')}</g>${front.join('')}</g>`);
    } else {
      parts.push(bodyShape(50 - bw / 2, 82, bw, 24, t.finish === 'neon' ? main : dark));
      parts.push(`<circle class="core" cx="50" cy="92" r="${t.coreR}" fill="${glow}"/>`);
    }

    // --- Antenne (pas sous un chapeau) ---
    const headStart = parts.length; // tout ce qui suit appartient à la tête (mise à l'échelle)
    if (!hat) {
      const tp = top;
      switch (t.antenna) {
        case 'ball': parts.push(`<line x1="50" y1="${tp}" x2="50" y2="${tp - 14}" stroke="${stroke}" stroke-width="2.5"/><circle class="ant-light" cx="50" cy="${tp - 16}" r="4.5" fill="${glow}" stroke="${stroke}" stroke-width="2"/>`); break;
        case 'double': parts.push(`<line x1="42" y1="${tp + 1}" x2="34" y2="${tp - 12}" stroke="${stroke}" stroke-width="2.5"/><line x1="58" y1="${tp + 1}" x2="66" y2="${tp - 12}" stroke="${stroke}" stroke-width="2.5"/><circle class="ant-light" cx="34" cy="${tp - 13}" r="3.5" fill="${glow}"/><circle class="ant-light" cx="66" cy="${tp - 13}" r="3.5" fill="${glow}"/>`); break;
        case 'spring': parts.push(`<polyline points="50,${tp} 46,${tp - 4} 54,${tp - 8} 46,${tp - 12} 54,${tp - 16} 50,${tp - 19}" fill="none" stroke="${stroke}" stroke-width="2.2"/><circle class="ant-light" cx="50" cy="${tp - 21}" r="3.5" fill="${glow}"/>`); break;
        case 'box': parts.push(`<rect x="44" y="${tp - 7}" width="12" height="8" rx="2" fill="${light}" stroke="${stroke}" stroke-width="2"/><rect class="ant-light" x="47" y="${tp - 12}" width="6" height="5" rx="1" fill="${glow}"/>`); break;
        case 'propeller': parts.push(`<line x1="50" y1="${tp}" x2="50" y2="${tp - 10}" stroke="${stroke}" stroke-width="2.5"/><g class="prop" style="transform-origin:50px ${tp - 11}px"><ellipse cx="42" cy="${tp - 11}" rx="8" ry="2.6" fill="${main2}" stroke="${stroke}" stroke-width="1.5"/><ellipse cx="58" cy="${tp - 11}" rx="8" ry="2.6" fill="${light2}" stroke="${stroke}" stroke-width="1.5"/></g><circle cx="50" cy="${tp - 11}" r="2.5" fill="${glow}"/>`); break;
        case 'dish': parts.push(`<line x1="50" y1="${tp}" x2="54" y2="${tp - 10}" stroke="${stroke}" stroke-width="2.5"/><path d="M44 ${tp - 18} a12 7 -25 0 0 20 6 z" fill="${light2}" stroke="${stroke}" stroke-width="2"/><circle class="ant-light" cx="56" cy="${tp - 16}" r="2" fill="${glow}"/>`); break;
        case 'bulb': parts.push(`<rect x="46" y="${tp - 6}" width="8" height="6" fill="${metal}" stroke="${stroke}" stroke-width="1.5"/><circle class="ant-light" cx="50" cy="${tp - 12}" r="6.5" fill="#ffe27a" stroke="${stroke}" stroke-width="2"/><path d="M47.5 ${tp - 11} l2.5 -3 l2.5 3" fill="none" stroke="#c98a00" stroke-width="1.3"/>`); break;
        case 'horns': parts.push(`<path d="M${50 - halfW * 0.6} ${tp + 4} q-8 -6 -6 -18 q4 9 12 12 z" fill="${light2}" stroke="${stroke}" stroke-width="2" stroke-linejoin="round"/><path d="M${50 + halfW * 0.6} ${tp + 4} q8 -6 6 -18 q-4 9 -12 12 z" fill="${light2}" stroke="${stroke}" stroke-width="2" stroke-linejoin="round"/>`); break;
        default: break;
      }
    }

    // --- Oreilles ---
    const lx = 50 - halfW, rx = 50 + halfW;
    switch (t.ears) {
      case 'bolts': parts.push(`<circle cx="${lx}" cy="54" r="4" fill="${metal}" stroke="${stroke}" stroke-width="2"/><circle cx="${rx}" cy="54" r="4" fill="${metal}" stroke="${stroke}" stroke-width="2"/>`); break;
      case 'panels': parts.push(`<rect x="${lx - 7}" y="45" width="8" height="18" rx="2" fill="${light2}" stroke="${stroke}" stroke-width="2"/><rect x="${rx - 1}" y="45" width="8" height="18" rx="2" fill="${light2}" stroke="${stroke}" stroke-width="2"/>`); break;
      case 'speakers': parts.push(`<circle cx="${lx}" cy="54" r="8" fill="${dark2}"/><circle cx="${lx}" cy="54" r="4" fill="${glow}" opacity=".8"/><circle cx="${rx}" cy="54" r="8" fill="${dark2}"/><circle cx="${rx}" cy="54" r="4" fill="${glow}" opacity=".8"/>`); break;
      case 'headphones': parts.push(`<path d="M${lx - 2} 52 C${lx - 2} ${top - 18} ${rx + 2} ${top - 18} ${rx + 2} 52" fill="none" stroke="${dark2}" stroke-width="4" stroke-linecap="round"/><rect x="${lx - 8}" y="44" width="10" height="20" rx="5" fill="${main2}" stroke="${stroke}" stroke-width="2"/><rect x="${rx - 2}" y="44" width="10" height="20" rx="5" fill="${main2}" stroke="${stroke}" stroke-width="2"/>`); break;
      case 'cat': parts.push(`<path d="M${50 - halfW + 2} ${top + 10} L${50 - halfW + 4} ${top - 10} L${50 - halfW + 18} ${top + 2} Z" fill="${main2}" stroke="${stroke}" stroke-width="2" stroke-linejoin="round"/><path d="M${50 + halfW - 2} ${top + 10} L${50 + halfW - 4} ${top - 10} L${50 + halfW - 18} ${top + 2} Z" fill="${main2}" stroke="${stroke}" stroke-width="2" stroke-linejoin="round"/>`); break;
      default: break;
    }

    // --- Tête + motif ---
    parts.push(withAttrs(headShape, `fill="${headFill}" ${SW}`));
    const clipped = t.pattern !== 'none' || t.wear === 'rusty' || t.wear === 'scratched';
    if (clipped) defs.push(`<clipPath id="${uid}c">${headShape}</clipPath>`);
    if (t.pattern !== 'none') {
      let p = '';
      if (t.pattern === 'stripes') for (let y = top + 4; y < 82; y += 9) p += `<rect x="10" y="${y}" width="80" height="3.5" fill="${light2}" opacity=".45"/>`;
      if (t.pattern === 'spots') for (const [x, y, rr] of [[30, 40, 4], [68, 44, 3], [34, 70, 3.5], [70, 68, 4.5], [56, 34, 2.5]]) p += `<circle cx="${x}" cy="${y}" r="${rr}" fill="${light2}" opacity=".5"/>`;
      if (t.pattern === 'panels') p = `<path d="M10 ${top + 14} H90 M10 72 H90 M32 ${top} V90 M68 ${top} V90" stroke="${stroke}" stroke-width="1.2" opacity=".45"/>`;
      if (t.pattern === 'shine') p = `<ellipse cx="38" cy="${top + 10}" rx="14" ry="5" fill="#fff" opacity=".28" transform="rotate(-20 38 ${top + 10})"/>`;
      parts.push(`<g clip-path="url(#${uid}c)">${p}</g>`);
    }
    // --- Usure de la tête ---
    if (t.wear === 'rusty') parts.push(`<g clip-path="url(#${uid}c)" fill="hsl(24 65% 36%)">${[[50 - halfW + 5, top + 9, 5], [50 + halfW - 6, 69, 6], [50 + halfW * 0.5, top + 4, 3], [50 - halfW * 0.6, 73, 3.5]].map(([x, y, rr]) => `<circle cx="${x}" cy="${y}" r="${rr}" opacity=".55"/><circle cx="${x + 2}" cy="${y - 1}" r="${rr * 0.45}" fill="hsl(30 75% 48%)" opacity=".5"/>`).join('')}</g>`);
    if (t.wear === 'scratched') parts.push(`<g clip-path="url(#${uid}c)" stroke="#fff" stroke-width="1" stroke-linecap="round" opacity=".55"><path d="M${50 - halfW + 4} ${top + 9} l9 5 M${50 - halfW + 7} ${top + 6} l8 7 M${50 + halfW - 12} 70 l8 -5 M${50 + halfW - 9} 73 l5 -3"/></g>`);
    if (t.head === 'tv') parts.push(`<circle cx="76" cy="44" r="2.2" fill="${stroke}"/><circle cx="76" cy="51" r="2.2" fill="${stroke}"/>`);

    // --- Écran du visage ---
    if (t.screen) parts.push(`<rect x="30" y="41" width="40" height="30" rx="7" fill="${screen}" stroke="${stroke}" stroke-width="1.5"/>`);
    const eyeColor = t.screen ? glow : (t.finish === 'neon' ? glow : screen);

    // --- Yeux ---
    const gap = t.gap, ey = 51, L1 = 50 - gap, R1 = 50 + gap;
    let eyes = '';
    switch (t.eyes) {
      case 'square': eyes = `<rect x="${L1 - 4.5}" y="${ey - 4.5}" width="9" height="9" rx="1.5" fill="${eyeColor}"/><rect x="${R1 - 4.5}" y="${ey - 4.5}" width="9" height="9" rx="1.5" fill="${eyeColor}"/>`; break;
      case 'visor': eyes = `<rect x="33" y="${ey - 4}" width="34" height="8" rx="4" fill="${t.screen ? '#0a0e16' : screen}"/><circle class="scan" cx="50" cy="${ey}" r="3" fill="${glow}"/>`; break;
      case 'cyclops': eyes = `<circle cx="50" cy="${ey}" r="8" fill="${eyeColor}"/><circle cx="50" cy="${ey}" r="3.5" fill="${t.screen ? screen : glow}"/><circle cx="52.5" cy="${ey - 2.5}" r="1.5" fill="#fff"/>`; break;
      case 'oval': eyes = `<ellipse cx="${L1}" cy="${ey}" rx="3.5" ry="6" fill="${eyeColor}"/><ellipse cx="${R1}" cy="${ey}" rx="3.5" ry="6" fill="${eyeColor}"/>`; break;
      case 'happy': for (const x of [L1, R1]) eyes += `<path d="M${x - 5} ${ey + 2} L${x} ${ey - 3} L${x + 5} ${ey + 2}" fill="none" stroke="${eyeColor}" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"/>`; break;
      case 'heart': for (const x of [L1, R1]) eyes += `<path d="M${x} ${ey + 4.5} C${x - 7} ${ey - 0.5} ${x - 5} ${ey - 6.5} ${x} ${ey - 3} C${x + 5} ${ey - 6.5} ${x + 7} ${ey - 0.5} ${x} ${ey + 4.5} Z" fill="${t.screen ? glow : '#ff5c8a'}"/>`; break;
      case 'sleepy': for (const x of [L1, R1]) eyes += `<path d="M${x - 5} ${ey} a5 5 0 0 0 10 0" fill="none" stroke="${eyeColor}" stroke-width="2.6" stroke-linecap="round"/>`; break;
      case 'big': for (const x of [L1, R1]) eyes += `<circle cx="${x}" cy="${ey}" r="7" fill="#fff" stroke="${stroke}" stroke-width="1.2"/><circle cx="${x + 1}" cy="${ey + 1}" r="4" fill="${t.screen ? glow : screen}"/><circle cx="${x + 2.2}" cy="${ey - 1}" r="1.4" fill="#fff"/>`; break;
      case 'dots': eyes = `<circle cx="${L1}" cy="${ey}" r="2.4" fill="${eyeColor}"/><circle cx="${R1}" cy="${ey}" r="2.4" fill="${eyeColor}"/>`; break;
      case 'led': for (let i = 0; i < 6; i++) eyes += `<rect x="${33 + i * 6}" y="${ey - 2.5}" width="4" height="5" rx="1" fill="${i % 5 === 0 ? eyeColor : glow}" opacity="${i === 0 || i === 5 ? 1 : 0.55}"/>`; break;
      case 'angry': for (const [x, s] of [[L1, 1], [R1, -1]]) eyes += `<circle cx="${x}" cy="${ey + 1}" r="4" fill="${eyeColor}"/><path d="M${x - 6 * s} ${ey - 6} L${x + 5 * s} ${ey - 2}" stroke="${stroke}" stroke-width="2.6" stroke-linecap="round"/>`; break;
      case 'triple': for (const [x, y, rr] of [[L1 - 1, ey + 2, 3.6], [50, ey - 5, 3], [R1 + 1, ey + 2, 3.6]]) eyes += `<circle cx="${x}" cy="${y}" r="${rr}" fill="${eyeColor}"/><circle cx="${x + 1}" cy="${y - 1}" r="1" fill="#fff" opacity=".85"/>`; break;
      case 'lens': for (const x of [L1, R1]) eyes += `<circle cx="${x}" cy="${ey}" r="6" fill="${metal}" stroke="${stroke}" stroke-width="1.5"/><circle cx="${x}" cy="${ey}" r="4" fill="#0a0e16"/><circle cx="${x}" cy="${ey}" r="1.8" fill="${glow}"/><circle cx="${x + 1.6}" cy="${ey - 1.6}" r="1" fill="#fff" opacity=".8"/>`; break;
      case 'mismatched': eyes = `<circle cx="${L1 - 1}" cy="${ey}" r="6.5" fill="${eyeColor}"/><circle cx="${L1 + 1}" cy="${ey - 2}" r="1.8" fill="#fff" opacity=".85"/><circle cx="${R1}" cy="${ey + 1}" r="2.6" fill="${eyeColor}"/><path d="M${R1 - 4} ${ey - 5} L${R1 + 4} ${ey - 4}" stroke="${t.screen ? glow : stroke}" stroke-width="2" stroke-linecap="round"/>`; break;
      default: {
        const er = t.eyeSize;
        eyes = `<circle cx="${L1}" cy="${ey}" r="${er}" fill="${eyeColor}"/><circle cx="${R1}" cy="${ey}" r="${er}" fill="${eyeColor}"/><circle cx="${L1 + 1.5}" cy="${ey - 1.5}" r="1.4" fill="#fff" opacity=".85"/><circle cx="${R1 + 1.5}" cy="${ey - 1.5}" r="1.4" fill="#fff" opacity=".85"/>`;
      }
    }
    parts.push(`<g class="eyes">${eyes}</g>`);
    if (t.cheeks) parts.push(`<circle cx="${L1 - 6}" cy="60" r="3" fill="#ff7a9a" opacity=".55"/><circle cx="${R1 + 6}" cy="60" r="3" fill="#ff7a9a" opacity=".55"/>`);

    // --- Bouche ---
    const my = 63, mc = t.screen ? glow : (t.finish === 'neon' ? glow : screen);
    let mouth = '';
    switch (t.mouth) {
      case 'grille': mouth = `<rect x="40" y="${my - 3}" width="20" height="6" rx="1.5" fill="${t.screen ? '#0a0e16' : light}" stroke="${mc}" stroke-width="1.5"/>`; for (let i = 1; i < 5; i++) mouth += `<line x1="${40 + i * 4}" y1="${my - 3}" x2="${40 + i * 4}" y2="${my + 3}" stroke="${mc}" stroke-width="1.2"/>`; break;
      case 'smile': mouth = `<path d="M41 ${my - 2} Q50 ${my + 6} 59 ${my - 2}" fill="none" stroke="${mc}" stroke-width="2.6" stroke-linecap="round"/>`; break;
      case 'line': mouth = `<line x1="43" y1="${my}" x2="57" y2="${my}" stroke="${mc}" stroke-width="2.6" stroke-linecap="round"/>`; break;
      case 'teeth': mouth = `<rect x="41" y="${my - 3.5}" width="18" height="7" rx="2" fill="#f4f4f4" stroke="${mc}" stroke-width="1.5"/><line x1="47" y1="${my - 3.5}" x2="47" y2="${my + 3.5}" stroke="${mc}" stroke-width="1.2"/><line x1="53" y1="${my - 3.5}" x2="53" y2="${my + 3.5}" stroke="${mc}" stroke-width="1.2"/>`; break;
      case 'o': mouth = `<ellipse cx="50" cy="${my}" rx="4" ry="3.2" fill="${mc}"/>`; break;
      case 'tongue': mouth = `<path d="M41 ${my - 3} Q50 ${my + 6} 59 ${my - 3} Z" fill="${mc}"/><path d="M47 ${my + 1} q3 5 6 0" fill="#ff7a9a"/>`; break;
      case 'fangs': mouth = `<line x1="42" y1="${my - 1}" x2="58" y2="${my - 1}" stroke="${mc}" stroke-width="2.4" stroke-linecap="round"/><path d="M45 ${my - 1} l1.5 4 l1.5 -4 M52 ${my - 1} l1.5 4 l1.5 -4" fill="#fff" stroke="${mc}" stroke-width="1"/>`; break;
      case 'wave': mouth = `<path d="M40 ${my} q2.5 -3 5 0 t5 0 t5 0 t5 0" fill="none" stroke="${mc}" stroke-width="2.4" stroke-linecap="round"/>`; break;
      case 'mustache': mouth = `<path d="M50 ${my - 2} c-3 -3 -9 -3 -11 1 c2 -1 5 0 6 2 c2 1 4 0 5 -3 c1 3 3 4 5 3 c1 -2 4 -3 6 -2 c-2 -4 -8 -4 -11 -1 z" fill="${t.finish === 'neon' ? glow : '#3b2a20'}"/><line x1="46" y1="${my + 3.5}" x2="54" y2="${my + 3.5}" stroke="${mc}" stroke-width="2" stroke-linecap="round"/>`; break;
      case 'speaker': for (let i = 0; i < 4; i++) for (const dy of [-2, 2]) mouth += `<circle cx="${44 + i * 4}" cy="${my + dy}" r="1.2" fill="${mc}"/>`; break;
      case 'none': break;
      default: mouth = `<polyline points="41,${my} 44,${my - 2.5} 47,${my + 2.5} 50,${my - 2.5} 53,${my + 2.5} 56,${my - 2.5} 59,${my}" fill="none" stroke="${mc}" stroke-width="2" stroke-linejoin="round"/>`; break;
    }
    parts.push(`<g class="mouth">${mouth}</g>`);
    if (t.rivets && !hat) parts.push(`<circle cx="36" cy="${top + 5}" r="1.6" fill="${stroke}"/><circle cx="64" cy="${top + 5}" r="1.6" fill="${stroke}"/>`);

    // --- Accessoire ---
    const acc = accessory(t.accessory, { top, halfW, L1, R1, ey, gap, main2, dark2, light2, stroke, glow });
    if (acc) parts.push(acc);
    if (t.wear === 'patched') parts.push(`<g transform="rotate(-30 ${50 + halfW * 0.55} ${top + 9})"><rect x="${50 + halfW * 0.55 - 8}" y="${top + 6.5}" width="16" height="5" rx="2" fill="#f1d9a6" stroke="#b08a4a" stroke-width="1"/><rect x="${50 + halfW * 0.55 - 2.5}" y="${top + 1}" width="5" height="16" rx="2" fill="#f1d9a6" stroke="#b08a4a" stroke-width="1"/></g>`);
    if (t.wear === 'stickers') parts.push(`<circle cx="${50 + halfW - 7}" cy="70" r="3.6" fill="#6fd3ff" stroke="#fff" stroke-width="1.3"/><path d="M${50 - halfW + 8} ${top + 4} l1.8 3.6 l4 .6 l-2.9 2.8 l.7 4 l-3.6 -1.9 l-3.6 1.9 l.7 -4 l-2.9 -2.8 l4 -.6 z" fill="#ffd34d" stroke="#fff" stroke-width="1.1" stroke-linejoin="round"/>`);

    // --- Taille de la tête : la tête pivote autour du cou ---
    const hs = HEAD_SCALE[t.headSize] || 1;
    if (hs !== 1) { const hp = parts.splice(headStart); parts.push(`<g transform="translate(50 78) scale(${hs}) translate(-50 -78)">${hp.join('')}</g>`); }

    // --- Outil ---
    // Les outils restent à côté du robot : lisibles même dans les petites vignettes.
    if (tool !== 'none') parts.push(`<g class="tool" transform="translate(115 78) scale(1.35)">${toolSvg(tool, { main2, light2, dark2, glow, stroke })}</g>`);

    const svg = `<svg viewBox="0 0 ${tool === 'none' ? 100 : 150} ${viewH}" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">${defs.length ? `<defs>${defs.join('')}</defs>` : ''}${parts.join('')}</svg>`;
    return { svg, name: t.name, hue: t.hue, accentHue: t.accentHue, main, glow, dark, blinkDelay: t.blinkDelay.toFixed ? t.blinkDelay.toFixed(2) : t.blinkDelay, traits: t, base, tool };
  }

  function accessory(kind, c) {
    const { top, halfW, L1, R1, ey, gap, main2, dark2, light2, stroke } = c;
    switch (kind) {
      case 'cap': return `<path d="M${50 - halfW * 0.85} ${top + 6} C${50 - halfW * 0.85} ${top - 14} ${50 + halfW * 0.85} ${top - 14} ${50 + halfW * 0.85} ${top + 6} Z" fill="${main2}" stroke="${stroke}" stroke-width="2"/><path d="M${50 + halfW * 0.5} ${top + 5} h${halfW * 0.9} a3 3 0 0 1 0 5 h-${halfW * 0.9} z" fill="${dark2}" stroke="${stroke}" stroke-width="1.5"/><circle cx="50" cy="${top - 8}" r="2.4" fill="${light2}"/>`;
      case 'tophat': return `<rect x="${50 - halfW * 0.75}" y="${top - 2}" width="${halfW * 1.5}" height="5" rx="2.5" fill="#1d1f27" stroke="${stroke}" stroke-width="1.5"/><rect x="${50 - halfW * 0.45}" y="${top - 24}" width="${halfW * 0.9}" height="23" rx="2" fill="#1d1f27" stroke="${stroke}" stroke-width="1.5"/><rect x="${50 - halfW * 0.45}" y="${top - 8}" width="${halfW * 0.9}" height="4" fill="${main2}"/>`;
      case 'crown': return `<path d="M${50 - halfW * 0.6} ${top + 2} L${50 - halfW * 0.6} ${top - 12} L${50 - halfW * 0.3} ${top - 4} L50 ${top - 16} L${50 + halfW * 0.3} ${top - 4} L${50 + halfW * 0.6} ${top - 12} L${50 + halfW * 0.6} ${top + 2} Z" fill="#ffd34d" stroke="#b8860b" stroke-width="2" stroke-linejoin="round"/><circle cx="50" cy="${top - 4}" r="2.4" fill="#ff5c8a"/>`;
      case 'beanie': return `<path d="M${50 - halfW * 0.9} ${top + 7} C${50 - halfW * 0.9} ${top - 16} ${50 + halfW * 0.9} ${top - 16} ${50 + halfW * 0.9} ${top + 7} Z" fill="${main2}" stroke="${stroke}" stroke-width="2"/><rect x="${50 - halfW * 0.92}" y="${top + 1}" width="${halfW * 1.84}" height="7" rx="3" fill="${light2}" stroke="${stroke}" stroke-width="1.5"/><circle cx="50" cy="${top - 11}" r="4.5" fill="${light2}" stroke="${stroke}" stroke-width="1.5"/>`;
      case 'bowtie': return `<path d="M50 80 L40 75 L40 85 Z M50 80 L60 75 L60 85 Z" fill="${main2}" stroke="${stroke}" stroke-width="1.5" stroke-linejoin="round"/><circle cx="50" cy="80" r="2.6" fill="${dark2}"/>`;
      case 'glasses': return `<circle cx="${L1}" cy="${ey}" r="${Math.max(6.5, gap * 0.62)}" fill="#bfe3ff" fill-opacity=".18" stroke="#1d1f27" stroke-width="2"/><circle cx="${R1}" cy="${ey}" r="${Math.max(6.5, gap * 0.62)}" fill="#bfe3ff" fill-opacity=".18" stroke="#1d1f27" stroke-width="2"/><path d="M${L1 + Math.max(6.5, gap * 0.62)} ${ey} H${R1 - Math.max(6.5, gap * 0.62)}" stroke="#1d1f27" stroke-width="2"/>`;
      case 'headset': return `<path d="M${50 - halfW - 1} 54 C${50 - halfW - 1} ${top - 14} ${50 + halfW + 1} ${top - 14} ${50 + halfW + 1} 54" fill="none" stroke="#2a2f3a" stroke-width="3"/><rect x="${50 - halfW - 5}" y="48" width="7" height="13" rx="3" fill="#2a2f3a"/><path d="M${50 - halfW - 1} 60 Q${50 - halfW + 4} 70 42 68" fill="none" stroke="#2a2f3a" stroke-width="2"/><circle cx="41" cy="68" r="2.4" fill="${main2}"/>`;
      case 'scarf': return `<path d="M30 76 Q50 84 70 76 L70 82 Q50 90 30 82 Z" fill="${main2}" stroke="${stroke}" stroke-width="1.5"/><path d="M60 82 l4 14 l-7 0 l-1 -12 z" fill="${main2}" stroke="${stroke}" stroke-width="1.5"/><path d="M33 79 h34" stroke="${light2}" stroke-width="1.5" stroke-dasharray="3 3"/>`;
      case 'monocle': return `<circle cx="${R1}" cy="${ey}" r="7.5" fill="#bfe3ff" fill-opacity=".15" stroke="#d4a72c" stroke-width="2"/><path d="M${R1 + 5} ${ey + 5.5} q4 8 -2 15" fill="none" stroke="#d4a72c" stroke-width="1.2" stroke-dasharray="1.6 1.4"/>`;
      case 'eyepatch': return `<line x1="${50 - halfW}" y1="${ey - 11}" x2="${50 + halfW}" y2="${ey - 1}" stroke="#1d1f27" stroke-width="2"/><ellipse cx="${R1}" cy="${ey}" rx="7" ry="6.5" fill="#1d1f27"/>`;
      case 'mohawk': return `<path d="M37 ${top + 3} L39 ${top - 8} L44 ${top + 1} L46.5 ${top - 13} L50 ${top} L53.5 ${top - 13} L56 ${top + 1} L61 ${top - 8} L63 ${top + 3} Z" fill="${main2}" stroke="${stroke}" stroke-width="2" stroke-linejoin="round"/>`;
      case 'flower': { const fx = 50 + halfW * 0.65, fy = top + 2; let f = ''; for (let i = 0; i < 5; i++) { const a = (i / 5) * Math.PI * 2; f += `<circle cx="${(fx + Math.cos(a) * 4).toFixed(1)}" cy="${(fy + Math.sin(a) * 4).toFixed(1)}" r="3.2" fill="#ff9ac1"/>`; } return f + `<circle cx="${fx}" cy="${fy}" r="2.6" fill="#ffd34d"/>`; }
      default: return '';
    }
  }

  // Outils : logos et pictogrammes du catalogue ToolIcons (devicon, simple-icons, lucide)
  function toolSvg(kind, c) { return window.ToolIcons ? window.ToolIcons.robotSvg(kind, c) : ''; }

  window.Robot = { generate, randomSeed, traitsFor, OPTIONS, AUTO_TOOL, LEGS_KEYS };
})();
