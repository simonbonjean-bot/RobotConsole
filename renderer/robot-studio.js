// RobotConsole — Atelier du robot : personnaliser chaque trait d'un robot (aperçu en direct)
(function () {
  const { h, esc } = UI;
  const SECTIONS = ['head', 'headSize', 'eyes', 'mouth', 'antenna', 'ears', 'neck', 'body', 'chest', 'arms', 'legs', 'gear', 'accessory', 'pattern', 'wear', 'finish']; // l'outil se choisit dans « Choisir un robot »
  const TOGGLES = { screen: 'Écran sur le visage', cheeks: 'Joues roses', rivets: 'Rivets' };

  // open({ seed, traits, legs, title, contextKind, onApply(seed, traits) })
  function open(cfg) {
    let seed = cfg.seed;
    let over = { ...(cfg.traits || {}) };
    let big = !!cfg.legs;
    const ov = h('div', 'overlay studio-overlay');
    const card = h('div', 'studio');
    ov.appendChild(card);
    document.body.appendChild(ov);

    const head = h('div', 'settings-head');
    head.innerHTML = `<h2>🛠 Atelier du robot${cfg.title ? ` — ${esc(cfg.title)}` : ''}</h2>`;
    const close = h('button', 'icon-btn', '✕');
    head.appendChild(close);

    const left = h('div', 'st-left');
    const stage = h('div', 'st-stage');
    const name = h('input', 'set-input st-name');
    name.placeholder = 'Nom du robot';
    const modeRow = h('div', 'ex-seg st-mode');
    const mSmall = h('button', '', 'Tête');
    const mBig = h('button', '', 'En pied');
    modeRow.append(mSmall, mBig);
    const actions = h('div', 'st-actions');
    const bNew = h('button', 'tb-btn', '🎲 Nouveau robot');
    bNew.title = 'Tirer un tout nouveau robot';
    const bShuffle = h('button', 'tb-btn', '🔀 Mélanger');
    bShuffle.title = 'Changer tous les traits au hasard';
    const bReset = h('button', 'tb-btn', '↺ Origine');
    bReset.title = 'Revenir au robot tiré au hasard (annule les réglages)';
    actions.append(bNew, bShuffle, bReset);
    const colors = h('div', 'st-colors');
    const toggles = h('div', 'st-toggles');
    left.append(stage, name, modeRow, actions, colors, toggles);

    const right = h('div', 'st-right');
    const foot = h('div', 'dlg-actions st-foot');
    const cancel = h('button', 'tb-btn', 'Annuler');
    const apply = h('button', 'tb-btn primary', 'Appliquer');
    foot.append(cancel, apply);
    const body = h('div', 'st-body');
    body.append(left, right);
    card.append(head, body, foot);

    const gen = (extra = {}, legs = big) => Robot.generate(seed, { legs, traits: { ...over, ...extra }, context: { tabKind: cfg.contextKind || 'tests' } });

    function renderStage() {
      const r = gen();
      stage.innerHTML = `<div class="robot st-robot ${big ? 'legs' : ''}">${r.svg}</div>`;
      if (document.activeElement !== name) name.value = over.name ?? r.name;
      name.placeholder = r.base.name;
      mSmall.classList.toggle('active', !big);
      mBig.classList.toggle('active', big);
      return r;
    }

    function renderColors() {
      const t = gen().traits;
      colors.innerHTML = '';
      const slider = (key, label, min, max, track) => {
        const row = h('label', 'st-slider');
        row.innerHTML = `<span>${label}</span>`;
        const inp = h('input');
        inp.type = 'range'; inp.min = min; inp.max = max; inp.value = t[key];
        if (track) inp.style.background = track;
        inp.addEventListener('input', () => { over[key] = +inp.value; renderStage(); });
        inp.addEventListener('change', () => renderChips());
        row.appendChild(inp);
        colors.appendChild(row);
      };
      const rainbow = 'linear-gradient(90deg, hsl(0 80% 60%), hsl(60 80% 60%), hsl(120 80% 60%), hsl(180 80% 60%), hsl(240 80% 60%), hsl(300 80% 60%), hsl(360 80% 60%))';
      slider('hue', 'Couleur', 0, 359, rainbow);
      slider('hue2', 'Couleur secondaire', 0, 359, rainbow);
      slider('accentHue', 'Lumières / yeux', 0, 359, rainbow);
      slider('sat', 'Saturation', 25, 95, `linear-gradient(90deg, hsl(${t.hue} 25% 58%), hsl(${t.hue} 95% 58%))`);
      slider('gap', 'Écart des yeux', 6, 14);
      slider('bodyW', 'Largeur du corps', 30, 60);
      toggles.innerHTML = '';
      for (const [k, label] of Object.entries(TOGGLES)) {
        const l = h('label', 'svc-check');
        const c = h('input');
        c.type = 'checkbox';
        c.checked = !!t[k];
        c.addEventListener('change', () => { over[k] = c.checked; renderStage(); renderChips(); });
        l.append(c, document.createTextNode(label));
        toggles.appendChild(l);
      }
      // Animations : l'outil (choisi ailleurs) et un interrupteur général
      const animRow = (label, checked, onChange, mixed) => {
        const l = h('label', 'svc-check');
        const c = h('input');
        c.type = 'checkbox';
        c.checked = checked;
        c.indeterminate = !!mixed;
        c.addEventListener('change', () => { onChange(c.checked); refresh(); });
        l.append(c, document.createTextNode(label));
        toggles.appendChild(l);
      };
      animRow("Animer l'outil", t.anim_tool !== false, (v) => { over.anim_tool = v; });
      const on = Robot.ANIM_KEYS.filter((k) => t['anim_' + k] !== false).length;
      animRow('Tout animer', on === Robot.ANIM_KEYS.length, (v) => { for (const k of Robot.ANIM_KEYS) over['anim_' + k] = v; }, on > 0 && on < Robot.ANIM_KEYS.length);
    }

    function renderChips() {
      const t = gen().traits;
      right.innerHTML = '';
      for (const key of SECTIONS) {
        const opt = Robot.OPTIONS[key];
        const sec = h('div', 'st-sec');
        const title = h('div', 'st-sec-title');
        title.innerHTML = `<span>${opt.label}</span><span class="muted">${esc(opt.values[t[key]] || '')}</span>`;
        const dice = h('button', 'icon-btn', '🎲');
        dice.title = `${opt.label} au hasard`;
        dice.addEventListener('click', () => {
          const vals = Object.keys(opt.values).filter((v) => v !== t[key] && v !== 'auto');
          over[key] = vals[Math.floor(Math.random() * vals.length)];
          if (Robot.LEGS_KEYS.has(key)) big = true;
          refresh();
        });
        // Case « Animé » : active / coupe l'animation de ce trait
        const anim = h('label', 'st-anim');
        const ac = h('input');
        ac.type = 'checkbox';
        ac.checked = t['anim_' + key] !== false;
        ac.addEventListener('change', () => { over['anim_' + key] = ac.checked; if (Robot.LEGS_KEYS.has(key)) big = true; refresh(); });
        anim.title = `Animer : ${opt.label.toLowerCase()}`;
        anim.append(ac, document.createTextNode('Animé'));
        title.append(anim, dice);
        sec.appendChild(title);
        const grid = h('div', 'st-grid');
        // Outils et accessoires se voient mieux en pied
        const legsPreview = key === 'tool' || key === 'body' || Robot.LEGS_KEYS.has(key);
        for (const [val, label] of Object.entries(opt.values)) {
          const chip = h('button', 'st-chip' + (t[key] === val ? ' on' : ''));
          const r = gen({ [key]: val }, legsPreview);
          chip.innerHTML = `<div class="robot ${legsPreview ? 'legs' : ''}">${r.svg}</div><span>${esc(label)}</span>`;
          chip.title = label;
          chip.addEventListener('click', () => { over[key] = val; if (Robot.LEGS_KEYS.has(key)) big = true; refresh(); });
          grid.appendChild(chip);
        }
        sec.appendChild(grid);
        right.appendChild(sec);
      }
    }

    function refresh() { renderStage(); renderColors(); renderChips(); }

    mSmall.addEventListener('click', () => { big = false; renderStage(); });
    mBig.addEventListener('click', () => { big = true; renderStage(); });
    name.addEventListener('input', () => { over.name = name.value; });
    bNew.addEventListener('click', () => { seed = Robot.randomSeed(); over = {}; refresh(); });
    bReset.addEventListener('click', () => { over = {}; refresh(); });
    bShuffle.addEventListener('click', () => {
      for (const key of SECTIONS) {
        const vals = Object.keys(Robot.OPTIONS[key].values).filter((v) => v !== 'auto');
        over[key] = vals[Math.floor(Math.random() * vals.length)];
      }
      over.hue = Math.floor(Math.random() * 360);
      over.hue2 = Math.random() < 0.5 ? over.hue : Math.floor(Math.random() * 360);
      over.accentHue = Math.floor(Math.random() * 360);
      refresh();
    });
    const done = () => ov.remove();
    close.addEventListener('click', done);
    cancel.addEventListener('click', done);
    ov.addEventListener('mousedown', (e) => { if (e.target === ov) done(); });
    card.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Escape') done(); });
    apply.addEventListener('click', () => {
      // Ne garde que ce qui diffère du robot d'origine
      const base = Robot.traitsFor(seed);
      const clean = {};
      for (const [k, v] of Object.entries(over)) if (v !== base[k] && !(k === 'name' && !v)) clean[k] = v;
      done();
      cfg.onApply?.(seed, Object.keys(clean).length ? clean : null);
    });
    refresh();
  }

  window.RobotStudio = { open };
})();
