// RobotConsole — sélecteur d'emoji : recherche (français / anglais), catégories, récents
// EmojiPicker.open(anchor, { onPick(icon|null), allowNone, suggestions: [icon…], render(icon) -> html, tools })
(function () {
  const { h, esc } = UI;
  const RECENT_KEY = 'robotconsole.emojiRecent';
  const MAX_RECENT = 24;

  // Mots français -> mots des noms Unicode (anglais). La recherche accepte aussi l'anglais.
  const FR = {
    visage: 'face', sourire: 'smiling grinning', souriant: 'smiling', rire: 'laughing joy tears', larme: 'tears crying', pleure: 'crying',
    triste: 'sad frowning disappointed', colere: 'angry pouting rage', fache: 'angry', clin: 'winking', bisou: 'kiss kissing', amour: 'heart love',
    coeur: 'heart', peur: 'fearful scream', surpris: 'astonished open mouth', pense: 'thinking', dort: 'sleeping', sommeil: 'sleeping zzz',
    malade: 'sick nauseated vomiting thermometer', fou: 'zany crazy', lunettes: 'glasses sunglasses nerd', cool: 'sunglasses cool', diable: 'devil imp',
    fantome: 'ghost', crane: 'skull', extraterrestre: 'alien', robot: 'robot', clown: 'clown', caca: 'poo', chat: 'cat', chien: 'dog', singe: 'monkey',
    main: 'hand', mains: 'hands', doigt: 'finger index', pouce: 'thumbs', poing: 'fist', applaudir: 'clapping', salut: 'waving', priere: 'folded hands',
    muscle: 'biceps', oeil: 'eye', yeux: 'eyes', oreille: 'ear', nez: 'nose', bouche: 'mouth', langue: 'tongue', cerveau: 'brain', dent: 'tooth',
    os: 'bone', pied: 'foot', jambe: 'leg', bebe: 'baby', enfant: 'child', garcon: 'boy', fille: 'girl', homme: 'man', femme: 'woman', personne: 'person',
    famille: 'family', couple: 'couple', policier: 'police', pompier: 'firefighter fire', medecin: 'health medical', cuisinier: 'cook', developpeur: 'technologist',
    informaticien: 'technologist', scientifique: 'scientist', astronaute: 'astronaut', mecanicien: 'mechanic', ninja: 'ninja', mage: 'mage', fee: 'fairy',
    vampire: 'vampire', zombie: 'zombie', heros: 'superhero', ange: 'angel', pere: 'father', noel: 'christmas father mother', danse: 'dancer dancing',
    course: 'runner running', velo: 'bicycle bicyclist', nage: 'swimmer', ours: 'bear', panda: 'panda', lapin: 'rabbit', renard: 'fox', loup: 'wolf',
    lion: 'lion', tigre: 'tiger', vache: 'cow', cochon: 'pig', grenouille: 'frog', poule: 'chicken hen', poussin: 'chick', oiseau: 'bird', canard: 'duck',
    aigle: 'eagle', hibou: 'owl', chouette: 'owl', cheval: 'horse', licorne: 'unicorn', abeille: 'bee honeybee', insecte: 'bug beetle', papillon: 'butterfly',
    escargot: 'snail', fourmi: 'ant', tortue: 'turtle', serpent: 'snake', lezard: 'lizard', dinosaure: 'sauropod t-rex', poulpe: 'octopus', pieuvre: 'octopus',
    crabe: 'crab', poisson: 'fish', dauphin: 'dolphin', baleine: 'whale', requin: 'shark', crocodile: 'crocodile', elephant: 'elephant', girafe: 'giraffe',
    chameau: 'camel', souris: 'mouse', rat: 'rat', araignee: 'spider', scorpion: 'scorpion', microbe: 'microbe', dragon: 'dragon', plume: 'feather',
    patte: 'paw', fleur: 'flower blossom', rose: 'rose', tulipe: 'tulip', tournesol: 'sunflower', arbre: 'tree', sapin: 'evergreen christmas tree', palmier: 'palm',
    cactus: 'cactus', feuille: 'leaf leaves', trefle: 'clover shamrock', champignon: 'mushroom', plante: 'plant seedling potted', bois: 'wood', pierre: 'rock',
    fruit: 'apple grapes', pomme: 'apple', poire: 'pear', banane: 'banana', raisin: 'grapes', fraise: 'strawberry', cerise: 'cherries', citron: 'lemon',
    orange: 'orange tangerine', peche: 'peach', ananas: 'pineapple', tomate: 'tomato', avocat: 'avocado', carotte: 'carrot', mais: 'maize corn', piment: 'pepper',
    pain: 'bread', fromage: 'cheese', viande: 'meat', oeuf: 'egg', hamburger: 'hamburger', frites: 'fries', pizza: 'pizza', gateau: 'cake', biscuit: 'cookie',
    chocolat: 'chocolate', bonbon: 'candy', glace: 'ice cream', cafe: 'hot beverage coffee', the: 'tea teacup', biere: 'beer', vin: 'wine', verre: 'glass',
    bouteille: 'bottle', boisson: 'beverage drink', couteau: 'knife hocho', fourchette: 'fork', cuillere: 'spoon', riz: 'rice', nourriture: 'food',
    terre: 'earth globe', monde: 'world globe', carte: 'map', montagne: 'mountain', volcan: 'volcano', plage: 'beach', ile: 'island', desert: 'desert',
    maison: 'house', immeuble: 'building', usine: 'factory', chateau: 'castle', eglise: 'church', hopital: 'hospital', ecole: 'school', banque: 'bank',
    pont: 'bridge', ville: 'cityscape city', nuit: 'night', train: 'train railway locomotive', metro: 'metro', bus: 'bus', voiture: 'automobile car', taxi: 'taxi',
    camion: 'truck lorry', moto: 'motorcycle', avion: 'airplane', fusee: 'rocket', helicoptere: 'helicopter', bateau: 'boat ship sailboat', navire: 'ship',
    ancre: 'anchor', satellite: 'satellite', soucoupe: 'saucer', horloge: 'clock', montre: 'watch', reveil: 'alarm clock', sablier: 'hourglass', minuteur: 'timer',
    soleil: 'sun', lune: 'moon', etoile: 'star', nuage: 'cloud', pluie: 'rain', neige: 'snow snowflake', eclair: 'lightning voltage', orage: 'thunder lightning',
    tornade: 'tornado cyclone', arcenciel: 'rainbow', parapluie: 'umbrella', feu: 'fire', flamme: 'fire', goutte: 'droplet', eau: 'water droplet wave',
    vague: 'wave', meteo: 'cloud sun rain', drapeau: 'flag', fete: 'party popper confetti', cadeau: 'gift wrapped', ballon: 'balloon ball', trophee: 'trophy',
    medaille: 'medal', foot: 'soccer', football: 'soccer american', basket: 'basketball', tennis: 'tennis', jeu: 'game', manette: 'video game joystick',
    de: 'die dice', des: 'dice', cible: 'direct hit dart', puzzle: 'puzzle jigsaw', echecs: 'chess', carte_jeu: 'playing cards', peinture: 'palette artist',
    art: 'art palette', musique: 'musical note', note: 'note', guitare: 'guitar', piano: 'keyboard musical', micro: 'microphone', casque: 'headphone helmet',
    film: 'film movie clapper', camera: 'camera', photo: 'camera', telephone: 'telephone mobile phone', portable: 'mobile phone', ordinateur: 'computer laptop desktop',
    clavier: 'keyboard', ecran: 'computer desktop television', imprimante: 'printer', disque: 'disk', disquette: 'floppy disk', batterie: 'battery', prise: 'plug',
    ampoule: 'bulb light', idee: 'bulb light', lampe: 'lamp flashlight', livre: 'book books', cahier: 'notebook', page: 'page', document: 'page document',
    dossier: 'folder', fichier: 'file folder page', classeur: 'card index file cabinet', calendrier: 'calendar', graphique: 'chart bar', stats: 'chart bar',
    presse: 'clipboard', epingle: 'pushpin pin', trombone: 'paperclip', regle: 'ruler', ciseaux: 'scissors', crayon: 'pencil', stylo: 'pen', lettre: 'envelope letter',
    courriel: 'e-mail envelope', mail: 'e-mail envelope', boite: 'box package', colis: 'package', paquet: 'package', poubelle: 'wastebasket', cle: 'key',
    cadenas: 'lock', verrou: 'lock', securite: 'lock shield', bouclier: 'shield', marteau: 'hammer', outil: 'hammer wrench toolbox', outils: 'toolbox hammer wrench',
    cle_molette: 'wrench', vis: 'nut bolt screwdriver', engrenage: 'gear', reglage: 'gear', parametres: 'gear', chaine: 'chains link', lien: 'link',
    aimant: 'magnet', loupe: 'magnifying glass', recherche: 'magnifying glass', microscope: 'microscope', telescope: 'telescope', science: 'test tube dna alembic',
    adn: 'dna', seringue: 'syringe', pilule: 'pill', argent: 'money dollar banknote', euro: 'euro', dollar: 'dollar', carte_credit: 'credit card', diamant: 'gem diamond',
    bague: 'ring', couronne: 'crown', chapeau: 'hat cap', vetement: 'shirt clothes', chaussure: 'shoe', sac: 'bag', valise: 'briefcase luggage', porte: 'door',
    lit: 'bed', fauteuil: 'chair couch', chaise: 'chair', toilettes: 'toilet', douche: 'shower', balai: 'broom', savon: 'soap', bougie: 'candle', bombe: 'bomb',
    pistolet: 'pistol water', epee: 'sword dagger', fleche: 'arrow', haut: 'up upwards', bas: 'down downwards', gauche: 'left', droite: 'right', retour: 'back return',
    cercle: 'circle', carre: 'square', triangle: 'triangle', losange: 'diamond', rouge: 'red', vert: 'green', bleu: 'blue', jaune: 'yellow', violet: 'purple',
    noir: 'black', blanc: 'white', marron: 'brown', valide: 'check mark', ok: 'ok check', coche: 'check mark ballot', croix: 'cross mark', interdit: 'no entry prohibited',
    attention: 'warning', danger: 'warning high voltage', alerte: 'warning siren rotating light', question: 'question', exclamation: 'exclamation', info: 'information',
    plus: 'plus', moins: 'minus', infini: 'infinity', recycler: 'recycling', radioactif: 'radioactive', atome: 'atom', paix: 'peace', yin: 'yin yang',
    cloche: 'bell', son: 'speaker sound', muet: 'muted', haut_parleur: 'speaker loudspeaker', repeter: 'repeat', lecture: 'play', pause: 'pause', stop: 'stop',
    nouveau: 'new', gratuit: 'free', haut_niveau: 'top', zodiaque: 'zodiac', terminal: 'terminal', code: 'technologist laptop', serveur: 'desktop computer file cabinet',
    base: 'card file box cabinet', donnees: 'card file box chart', nuage_serveur: 'cloud', docker: 'whale', baleine_bleue: 'whale', python: 'snake', rust: 'crab',
    go: 'gopher', java: 'hot beverage', ruby: 'gem', web: 'globe', reseau: 'globe network satellite antenna', antenne: 'antenna', signal: 'antenna bars',
    construction: 'construction building', chantier: 'construction', brique: 'brick', test: 'test tube', tests: 'test tube', bug: 'bug', fusion: 'merge',
    deploiement: 'rocket', vitesse: 'high voltage zap dash', rapide: 'high voltage dash', lent: 'snail turtle', temps: 'clock hourglass', calcul: 'abacus',
  };
  const norm = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const FR_KEYS = Object.keys(FR);

  function termsFor(token) {
    const out = [token];
    for (const k of FR_KEYS) {
      const flat = k.replace(/_/g, '');
      if (flat === token || (token.length >= 3 && flat.startsWith(token))) out.push(...FR[k].split(' '));
    }
    return out;
  }

  function searchEmojis(query) {
    const data = window.EMOJI_DATA || { groups: [], emojis: [] };
    const groups = norm(query).trim().split(/\s+/).filter(Boolean).map(termsFor);
    return data.emojis.filter(([emoji, name, group]) => {
      const label = norm(data.groups[group][1]);
      return groups.every((alternatives) => alternatives.some((term) => emoji.includes(term) || norm(name).includes(term) || label.includes(term)));
    });
  }

  function loadRecent() { try { return JSON.parse(localStorage.getItem(RECENT_KEY)) || []; } catch { return []; } }
  function pushRecent(icon) {
    try {
      const r = [icon, ...loadRecent().filter((x) => x !== icon)].slice(0, MAX_RECENT);
      localStorage.setItem(RECENT_KEY, JSON.stringify(r));
    } catch { /* stockage indisponible */ }
  }

  let current = null;
  function close() { current?.(); current = null; }

  function open(anchor, opts = {}) {
    close();
    UI.closeMenus();
    const data = window.EMOJI_DATA || { groups: [], emojis: [] };
    const render = opts.render || ((ic) => esc(ic));
    const nameOf = new Map(data.emojis.map((e) => [e[0], e[1]]));

    const box = h('div', 'menu emj');
    const top = h('div', 'emj-top');
    const search = h('input', 'set-input emj-search');
    search.placeholder = 'Rechercher (fusée, chat, rocket…)';
    search.spellcheck = false;
    top.appendChild(search);
    if (opts.allowNone) {
      const none = h('button', 'tb-btn small emj-none', '∅ Aucune');
      none.title = 'Retirer l\'icône';
      none.addEventListener('click', () => pick(null));
      top.appendChild(none);
    }
    const cats = h('div', 'emj-cats');
    const grid = h('div', 'emj-grid');
    const foot = h('div', 'emj-foot', '<span class="emj-prev"></span><span class="emj-name muted">Survolez un emoji</span>');
    box.append(top, cats, grid, foot);
    let toolMode = false, toolCat = '';
    let firstResult = null;
    const toolCats = h('div', 'emj-tool-cats hidden');
    if (opts.tools) {
      const modes = h('div', 'emj-modes');
      const emojiBtn = h('button', 'tb-btn small active', 'Emojis');
      const toolBtn = h('button', 'tb-btn small', 'Icônes');
      const setMode = (tools) => {
        toolMode = tools;
        emojiBtn.classList.toggle('active', !tools);
        toolBtn.classList.toggle('active', tools);
        toolCats.classList.toggle('hidden', !tools);
        search.placeholder = tools ? `Rechercher parmi ${ToolIcons.all.length} icônes (react, docker, claude…)` : 'Rechercher (fusée, chat, rocket…)';
        foot.querySelector('.emj-prev').innerHTML = '';
        foot.querySelector('.emj-name').textContent = tools ? 'Survolez une icône' : 'Survolez un emoji';
        firstResult = null;
        if (search.value.trim()) renderSearch(search.value); else renderAll();
        search.focus();
      };
      emojiBtn.addEventListener('click', () => setMode(false));
      toolBtn.addEventListener('click', () => setMode(true));
      modes.append(emojiBtn, toolBtn);
      box.prepend(modes);
      box.insertBefore(toolCats, grid);
      for (const c of [{ id: '', label: 'Tout' }, ...ToolIcons.cats]) {
        const b = h('button', 'tb-btn small' + (!c.id ? ' active' : ''));
        b.textContent = c.label;
        b.addEventListener('click', () => {
          toolCat = c.id;
          for (const btn of toolCats.children) btn.classList.toggle('active', btn === b);
          renderTools();
          search.focus();
        });
        toolCats.appendChild(b);
      }
    }

    const sections = [];
    const recent = loadRecent().filter((ic) => opts.tools || !ic.startsWith('tool:'));
    if (recent.length) sections.push({ key: 'recent', label: 'Récents', icon: '🕘', items: recent });
    if (opts.suggestions?.length) sections.push({ key: 'sugg', label: 'Suggestions', icon: '⭐', items: opts.suggestions });
    data.groups.forEach(([key, label, icon], gi) => sections.push({ key, label, icon, items: data.emojis.filter((e) => e[2] === gi).map((e) => e[0]) }));

    function pick(icon) {
      if (icon) pushRecent(icon);
      close();
      opts.onPick?.(icon);
    }
    function cell(icon) {
      const b = h('button', 'emj-cell', render(icon));
      b.dataset.icon = icon;
      b.title = icon.startsWith('tool:') ? ToolIcons.label(icon.slice(5)) : nameOf.get(icon) || (icon === '>_' ? 'terminal' : icon);
      return b;
    }
    // Délégation : un seul écouteur pour toute la grille
    grid.addEventListener('click', (e) => { const b = e.target.closest('.emj-cell'); if (b) pick(b.dataset.icon); });
    grid.addEventListener('mouseover', (e) => {
      const b = e.target.closest('.emj-cell');
      if (!b) return;
      foot.querySelector('.emj-prev').innerHTML = render(b.dataset.icon);
      foot.querySelector('.emj-name').textContent = b.title;
    });

    const catBtns = new Map();
    function renderTools() {
      const hits = ToolIcons.search(search.value, toolCat);
      grid.innerHTML = '';
      grid.scrollTop = 0;
      cats.classList.add('hidden');
      const sec = h('div', 'emj-sec');
      sec.appendChild(h('div', 'emj-title', hits.length ? `${hits.length} résultat${hits.length > 1 ? 's' : ''}` : 'Aucune icône ne correspond.'));
      const g = h('div', 'emj-cells');
      const frag = document.createDocumentFragment();
      for (const it of hits) frag.appendChild(cell(`tool:${it.id}`));
      g.appendChild(frag);
      sec.appendChild(g);
      grid.appendChild(sec);
      firstResult = search.value.trim() && hits.length ? `tool:${hits[0].id}` : null;
    }
    function renderAll() {
      if (toolMode) { renderTools(); return; }
      grid.innerHTML = '';
      cats.classList.remove('hidden');
      for (const s of sections) {
        const sec = h('div', 'emj-sec');
        sec.dataset.key = s.key;
        sec.appendChild(h('div', 'emj-title', esc(s.label)));
        const g = h('div', 'emj-cells');
        s.items.forEach((ic) => g.appendChild(cell(ic)));
        sec.appendChild(g);
        grid.appendChild(sec);
      }
      grid.scrollTop = 0;
      syncCat();
    }
    for (const s of sections) {
      const b = h('button', 'emj-cat', render(s.icon));
      b.title = s.label;
      b.addEventListener('click', () => {
        if (search.value) { search.value = ''; renderAll(); }
        const sec = grid.querySelector(`[data-key="${s.key}"]`);
        if (sec) grid.scrollTop = sec.offsetTop - grid.offsetTop;
        search.focus();
      });
      cats.appendChild(b);
      catBtns.set(s.key, b);
    }
    function syncCat() {
      let cur = sections[0]?.key;
      for (const sec of grid.querySelectorAll('.emj-sec')) if (sec.offsetTop - grid.offsetTop <= grid.scrollTop + 8) cur = sec.dataset.key;
      for (const [k, b] of catBtns) b.classList.toggle('active', k === cur);
    }
    grid.addEventListener('scroll', syncCat);

    function renderSearch(q) {
      if (toolMode) { renderTools(); return; }
      const tokens = norm(q).split(/\s+/).filter(Boolean);
      const groups = tokens.map(termsFor);
      const hits = searchEmojis(q).map((emoji) => emoji[0]);
      for (const ic of opts.suggestions || []) if (!hits.includes(ic) && groups.every((alts) => alts.some((t) => (ic === '>_' ? 'terminal console shell' : '').includes(t)))) hits.unshift(ic);
      grid.innerHTML = '';
      cats.classList.add('hidden');
      const sec = h('div', 'emj-sec');
      sec.appendChild(h('div', 'emj-title', hits.length ? `${hits.length} résultat${hits.length > 1 ? 's' : ''}` : 'Aucun emoji trouvé'));
      const g = h('div', 'emj-cells');
      hits.slice(0, 400).forEach((ic) => g.appendChild(cell(ic)));
      sec.appendChild(g);
      grid.appendChild(sec);
      firstResult = hits[0] || null;
    }
    search.addEventListener('input', () => { if (search.value.trim()) renderSearch(search.value); else { firstResult = null; renderAll(); } });
    search.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape') { e.preventDefault(); close(); }
      else if (e.key === 'Enter' && firstResult) { e.preventDefault(); pick(firstResult); }
    });
    box.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Escape') close(); });

    document.body.appendChild(box);
    renderAll();
    const r = anchor.getBoundingClientRect();
    const W = box.offsetWidth, H = box.offsetHeight;
    box.style.left = `${Math.max(6, Math.min(r.left, innerWidth - W - 6))}px`;
    box.style.top = `${r.bottom + 4 + H > innerHeight - 6 ? Math.max(6, r.top - H - 4) : r.bottom + 4}px`;
    search.focus();

    const off = (e) => { if (!box.contains(e.target) && !anchor.contains(e.target)) close(); };
    setTimeout(() => document.addEventListener('mousedown', off, true), 0);
    current = () => { box.remove(); document.removeEventListener('mousedown', off, true); };
  }

  window.EmojiPicker = { open, close, search: searchEmojis };
})();
