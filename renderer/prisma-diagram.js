// RobotConsole — diagramme des relations Prisma (modèles = tables, avec leurs colonnes)
// Vues automatiques (dagre) + « plans » personnels : tables déplaçables, tables masquées,
// titres, notes, cadres, images et icônes. Sauvegarde dans .robot/diagrams/<projet>.json
(function () {
  const { h, esc } = UI;
  const W = 236;          // largeur d'une table
  const HEAD = 30;        // hauteur de l'en-tête
  const ROW = 19;         // hauteur d'une colonne
  const FOOT = 6;
  const SNAP = 10;
  const NS = 'http://www.w3.org/2000/svg';
  const COLORS = [['#f5c542', 'Jaune'], ['#f59342', 'Orange'], ['#ef5b5b', 'Rouge'], ['#e86fb4', 'Rose'], ['#9b7bf0', 'Violet'], ['#4aa8f0', 'Bleu'], ['#3cc7c0', 'Turquoise'], ['#4cc38a', 'Vert'], ['#8a93a3', 'Gris']];
  const EMOJIS = ('🏠 🏡 🏢 🏫 🏥 👤 👥 🧑‍🤝‍🧑 👨‍👩‍👧 🧒 🧑‍🏫 🧑‍💼 🔐 🔑 🛡 🪪 ✉️ 📨 💬 🔔 📢 📣 📅 🗓 ⏰ ⌛ 📍 🗺 🚗 🎫 🎟 💶 💳 🧾 🛒 📦 🏷 📁 📂 🗂 📄 📝 📎 🖼 📷 🎥 🎵 🎮 🏆 🥇 ⭐ 🌟 💡 ⚙️ 🔧 🛠 🧩 🔗 🧪 📊 📈 🗄 💾 ☁️ 🌐 🤖 🧠 ❤️ ✅ ❌ ⚠️ ❓ ℹ️ 🚧 🔥 ⚡ 🎯 🚀 🌱 🍀 🎨 📚 🏃 ⚽ 🎉').split(' ');
  const uid = () => Math.random().toString(36).slice(2, 10);
  const snap = (v) => Math.round(v / SNAP) * SNAP;

  // ---------- Relations du schéma : une arête par champ « propriétaire » (celui qui porte fields: [...]) ----------
  function relations(info) {
    const byName = new Map(info.models.map((m) => [m.name, m]));
    const out = [];
    for (const m of info.models) {
      for (const f of m.fields) {
        if (f.ref !== 'model' || f.relation == null) continue;
        const fk = (f.relation.match(/fields\s*:\s*\[([^\]]*)\]/) || [])[1];
        if (!fk) continue;
        const refs = (f.relation.match(/references\s*:\s*\[([^\]]*)\]/) || [])[1] || '';
        const fkFields = fk.split(',').map((s) => s.trim()).filter(Boolean);
        const target = byName.get(f.type);
        if (!target) continue;
        const single = fkFields.length === 1 && (m.fields.find((x) => x.name === fkFields[0])?.unique || m.attrs.some((a) => new RegExp(`^@@(unique|id)\\(\\s*(fields:\\s*)?\\[\\s*${fkFields[0]}\\s*\\]`).test(a)));
        out.push({ from: m.name, to: target.name, field: f.name, fk: fkFields, refs: refs.split(',').map((s) => s.trim()).filter(Boolean), one: !!single, optional: f.optional, onDelete: (f.relation.match(/onDelete\s*:\s*(\w+)/) || [])[1] || null });
      }
    }
    return out;
  }

  // ---------- Disposition automatique ----------
  function layoutGroup(names, rels, size, aspect) {
    if (names.length === 1) {
      const sz = size(names[0]);
      return { w: sz.width, h: sz.height, nodes: new Map([[names[0], { ...sz, x: sz.width / 2, y: sz.height / 2 }]]), edges: [] };
    }
    const build = (dir) => {
      const g = new dagre.graphlib.Graph({ multigraph: true });
      g.setGraph({ rankdir: dir, nodesep: 26, ranksep: dir === 'LR' ? 90 : 70, edgesep: 14, marginx: 4, marginy: 4, ranker: names.length > 60 ? 'tight-tree' : 'network-simplex' });
      g.setDefaultEdgeLabel(() => ({}));
      for (const n of names) g.setNode(n, size(n));
      rels.forEach((r, i) => { if (r.from !== r.to) g.setEdge(r.from, r.to, { r }, 'e' + i); });
      dagre.layout(g);
      return g;
    };
    const score = (g) => Math.min(aspect / (g.graph().width || 1), 1 / (g.graph().height || 1));
    const lr = build('LR');
    const tb = build('TB');
    const g = score(tb) > score(lr) * 1.1 ? tb : lr;
    return { w: g.graph().width, h: g.graph().height, nodes: new Map(g.nodes().map((n) => [n, g.node(n)])), edges: g.edges().map((e) => g.edge(e)).map(({ r, points }) => ({ r, points })) };
  }
  // Groupes de tables reliées, disposés chacun puis rangés en lignes comme des cartes
  function pack(names, rels, size, aspect) {
    const parent = new Map(names.map((n) => [n, n]));
    const root = (n) => { while (parent.get(n) !== n) { parent.set(n, parent.get(parent.get(n))); n = parent.get(n); } return n; };
    for (const r of rels) if (r.from !== r.to) parent.set(root(r.from), root(r.to));
    const groups = new Map();
    for (const n of names) { const k = root(n); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(n); }
    const comps = [...groups.values()].map((ns) => { const set = new Set(ns); return layoutGroup(ns, rels.filter((r) => set.has(r.from) && set.has(r.to)), size, aspect); });
    const GAP = 46, M = 30;
    comps.sort((a, b) => b.h - a.h || b.w - a.w);
    const area = comps.reduce((s, c) => s + (c.w + GAP) * (c.h + GAP), 0);
    const rowW = Math.max(Math.max(0, ...comps.map((c) => c.w)), Math.sqrt(area * aspect));
    const nodes = new Map();
    const edges = [];
    let x = 0, y = 0, rowH = 0, width = 0;
    for (const c of comps) {
      if (x > 0 && x + c.w > rowW) { x = 0; y += rowH + GAP; rowH = 0; }
      const ox = M + x, oy = M + y;
      for (const [n, v] of c.nodes) nodes.set(n, { ...v, x: v.x + ox, y: v.y + oy });
      for (const e of c.edges) edges.push({ r: e.r, points: e.points.map((p) => ({ x: p.x + ox, y: p.y + oy })) });
      x += c.w + GAP;
      rowH = Math.max(rowH, c.h);
      width = Math.max(width, x - GAP);
    }
    return { nodes, edges, width: width + 2 * M, height: y + rowH + 2 * M };
  }

  // Courbe lissée passant par les points de dagre
  function curve(pts) {
    if (pts.length < 3) return `M${pts[0].x},${pts[0].y} L${pts[pts.length - 1].x},${pts[pts.length - 1].y}`;
    let d = `M${pts[0].x},${pts[0].y}`;
    for (let i = 1; i < pts.length - 1; i++) {
      const mx = (pts[i].x + pts[i + 1].x) / 2, my = (pts[i].y + pts[i + 1].y) / 2;
      d += ` Q${pts[i].x},${pts[i].y} ${i === pts.length - 2 ? `${pts[i + 1].x},${pts[i + 1].y}` : `${mx},${my}`}`;
    }
    return d;
  }
  // Lien entre deux tables placées à la main : de bord à bord, côté le plus logique
  function route(a, b, k = 0) {
    if (a === b) {
      const x = a.x + a.width / 2, y = a.y - a.height / 2 + HEAD / 2;
      return `M${x},${y - 6} C${x + 46},${y - 30} ${x + 46},${y + 30} ${x},${y + 6}`;
    }
    const off = k * 7;
    const dx = b.x - a.x, dy = b.y - a.y;
    const gapX = Math.abs(dx) - (a.width + b.width) / 2;
    const gapY = Math.abs(dy) - (a.height + b.height) / 2;
    if (gapX > 16 || gapX > gapY) {
      const sx = a.x + Math.sign(dx || 1) * a.width / 2, ex = b.x - Math.sign(dx || 1) * b.width / 2;
      const sy = a.y + off, ey = b.y + off;
      const c = Math.max(40, Math.abs(ex - sx) / 2) * Math.sign(dx || 1);
      return `M${sx},${sy} C${sx + c},${sy} ${ex - c},${ey} ${ex},${ey}`;
    }
    const sy = a.y + Math.sign(dy || 1) * a.height / 2, ey = b.y - Math.sign(dy || 1) * b.height / 2;
    const sx = a.x + off, ex = b.x + off;
    const c = Math.max(40, Math.abs(ey - sy) / 2) * Math.sign(dy || 1);
    return `M${sx},${sy} C${sx},${sy + c} ${ex},${ey - c} ${ex},${ey}`;
  }

  // ---------- Petites fenêtres flottantes (choix d'icône, de table) ----------
  function popover(x, y, build) {
    document.querySelectorAll('.pzd-pop').forEach((p) => p.remove());
    const pop = h('div', 'pzd-pop');
    document.body.appendChild(pop);
    const close = () => { pop.remove(); document.removeEventListener('mousedown', out, true); };
    const out = (e) => { if (!pop.contains(e.target)) close(); };
    setTimeout(() => document.addEventListener('mousedown', out, true));
    pop.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Escape') close(); });
    build(pop, close);
    const r = pop.getBoundingClientRect();
    pop.style.left = `${Math.max(6, Math.min(x, innerWidth - r.width - 6))}px`;
    pop.style.top = `${Math.max(6, Math.min(y, innerHeight - r.height - 6))}px`;
    return pop;
  }
  function pickEmoji(x, y, current) {
    return new Promise((resolve) => {
      popover(x, y, (pop, close) => {
        pop.classList.add('emoji');
        const inp = h('input', 'set-input');
        inp.placeholder = 'Ou tapez / collez un emoji…';
        inp.value = current || '';
        inp.addEventListener('keydown', (e) => { if (e.key === 'Enter' && inp.value.trim()) { close(); resolve(inp.value.trim()); } });
        const grid = h('div', 'pzd-emojis');
        for (const em of EMOJIS) {
          const b = h('button', em === current ? 'on' : '', em);
          b.addEventListener('click', () => { close(); resolve(em); });
          grid.appendChild(b);
        }
        const foot = h('div', 'pzd-popfoot');
        if (current) { const rm = h('button', 'tb-btn', 'Retirer l\'icône'); rm.addEventListener('click', () => { close(); resolve(''); }); foot.appendChild(rm); }
        pop.append(inp, grid, foot);
        setTimeout(() => inp.focus());
      });
    });
  }
  function pickModels(x, y, models, title) {
    return new Promise((resolve) => {
      popover(x, y, (pop, close) => {
        pop.classList.add('models');
        pop.appendChild(h('div', 'pzd-poptitle', esc(title)));
        const inp = h('input', 'set-input');
        inp.placeholder = 'Filtrer…';
        const list = h('div', 'pzd-poplist');
        const chosen = new Set();
        const draw = () => {
          const q = inp.value.toLowerCase();
          list.innerHTML = '';
          for (const m of models.filter((x) => !q || x.name.toLowerCase().includes(q) || x.dbName.toLowerCase().includes(q)).slice(0, 200)) {
            const row = h('label', 'pzd-poprow');
            const c = h('input'); c.type = 'checkbox'; c.checked = chosen.has(m.name);
            c.addEventListener('change', () => { if (c.checked) chosen.add(m.name); else chosen.delete(m.name); ok.textContent = `Ajouter (${chosen.size})`; });
            row.append(c, h('span', '', esc(m.name)), h('small', 'muted', esc(m.dbName)));
            row.addEventListener('dblclick', () => { close(); resolve([m.name]); });
            list.appendChild(row);
          }
          if (!list.children.length) list.appendChild(h('div', 'pz-none', 'Aucune table'));
        };
        inp.addEventListener('input', draw);
        inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { const first = list.querySelector('input'); if (chosen.size) { close(); resolve([...chosen]); } else if (first) { close(); resolve([models.find((m) => m.name === list.querySelector('span').textContent).name]); } } });
        const foot = h('div', 'pzd-popfoot');
        const ok = h('button', 'tb-btn primary', 'Ajouter (0)');
        ok.addEventListener('click', () => { close(); resolve([...chosen]); });
        foot.appendChild(ok);
        pop.append(inp, list, foot);
        draw();
        setTimeout(() => inp.focus());
      });
    });
  }
  // Lit un fichier image en data URL (réduite si très grande)
  function readImage(file) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onerror = () => reject(fr.error);
      fr.onload = () => {
        const url = fr.result;
        if (file.type === 'image/svg+xml' || file.type === 'image/gif') return resolve(url);
        const img = new Image();
        img.onload = () => {
          const max = 1800;
          if (img.width <= max && img.height <= max) return resolve(url);
          const s = max / Math.max(img.width, img.height);
          const c = document.createElement('canvas');
          c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
          c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
          resolve(c.toDataURL(file.type === 'image/png' ? 'image/png' : 'image/jpeg', 0.9));
        };
        img.onerror = () => resolve(url);
        img.src = url;
      };
      fr.readAsDataURL(file);
    });
  }
  const imageSize = (url) => new Promise((resolve) => { const i = new Image(); i.onload = () => resolve({ w: i.naturalWidth || 200, h: i.naturalHeight || 150 }); i.onerror = () => resolve({ w: 200, h: 150 }); i.src = url; });


  // =====================================================================
  function create(container, opts) {
    const st = {
      info: null, rels: [], counts: new Map(), focus: opts.focus || null, mode: opts.mode || 'near', depth: opts.depth || 1, cols: opts.cols || 'all',
      showHubs: !!opts.showHubs, hubs: new Set(), planId: opts.plan || null,
      doc: { version: 1, hidden: [], icons: {}, colors: {}, plans: [] }, assets: {}, undo: [],
      sel: new Set(), selectMode: false, // sélection : clés « t:Table » et « i:idElément »
      tx: 0, ty: 0, k: 1, bounds: { x0: 0, y0: 0, x1: 1, y1: 1 }, nodes: null, edgesList: [],
      store: opts.store, onOpen: opts.onOpen, onChange: opts.onChange,
    };
    const plan = () => st.mode === 'plan' ? st.doc.plans.find((p) => p.id === st.planId) || null : null;
    const tk = (n) => 't:' + n;
    const ik = (id) => 'i:' + id;
    container.classList.add('pzd');

    // ---------- Barre ----------
    const bar = h('div', 'pzd-bar');
    const search = h('input', 'set-input tool-search pzd-search');
    search.placeholder = 'Aller à une table…';
    search.setAttribute('list', 'pzd-models-' + uid());
    const dl = h('datalist');
    dl.id = search.getAttribute('list');
    search.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key !== 'Enter') return;
      const q = search.value.trim().toLowerCase();
      const ms = st.info.models;
      const m = ms.find((x) => x.name.toLowerCase() === q) || ms.find((x) => x.name.toLowerCase().startsWith(q)) || ms.find((x) => x.name.toLowerCase().includes(q) || x.dbName.toLowerCase().includes(q));
      if (!m) return;
      goTo(m.name);
      search.select();
    });
    search.addEventListener('change', () => { const m = st.info?.models.find((x) => x.name === search.value); if (m) goTo(m.name); });
    const modeSel = h('select', 'set-input small pzd-mode');
    modeSel.title = 'Vue automatique ou plan personnel';
    modeSel.addEventListener('change', () => {
      const v = modeSel.value;
      if (v === 'new') { modeSel.value = modeValue(); newPlan(); return; }
      const [m, x] = v.split(':');
      st.mode = m;
      if (m === 'plan') st.planId = x; else st.depth = +x || 1;
      st.sel.clear(); st.undo = [];
      render(true); changed();
    });
    const colSel = h('select', 'set-input small');
    colSel.title = 'Colonnes affichées';
    colSel.innerHTML = [['all', 'Toutes les colonnes'], ['keys', 'Clés seulement'], ['none', 'Noms des tables']].map(([v, l]) => `<option value="${v}"${v === st.cols ? ' selected' : ''}>${l}</option>`).join('');
    colSel.addEventListener('change', () => { st.cols = colSel.value; render(); changed(); });
    const btn = (html, title, fn, cls = 'icon-btn') => { const b = h('button', cls, html); b.title = title; b.addEventListener('click', fn); return b; };
    st.label = h('span', 'pzd-label muted');
    st.hubBox = h('label', 'pzd-hubs hidden');
    st.hubChk = h('input'); st.hubChk.type = 'checkbox'; st.hubChk.checked = st.showHubs;
    st.hubChk.addEventListener('change', () => { st.showHubs = st.hubChk.checked; render(true); changed(); });
    st.hubText = h('span');
    st.hubBox.append(st.hubChk, st.hubText);
    st.hiddenBtn = btn('', 'Tables masquées dans les vues automatiques', (e) => hiddenMenu(e.currentTarget), 'tb-btn pzd-hiddenbtn hidden');
    st.selBtn = btn('⬚', 'Mode sélection : glisser sur le fond dessine un rectangle de sélection (sinon : Maj + glisser)', () => { st.selectMode = !st.selectMode; st.selBtn.classList.toggle('on', st.selectMode); vp.classList.toggle('selmode', st.selectMode); }, 'icon-btn toggle');
    st.selInfo = btn('', 'Actions sur la sélection', (e) => selectionMenu(e.currentTarget), 'tb-btn pzd-selinfo hidden');
    bar.append(search, dl, modeSel, colSel, st.hubBox, st.hiddenBtn, st.label, h('div', 'tb-spacer'), st.selInfo, st.selBtn,
      btn('−', 'Dézoomer', () => zoomAt(1 / 1.25)), btn('＋', 'Zoomer', () => zoomAt(1.25)), btn('⤢', 'Tout voir', fit));

    // Outils du plan
    const tools = h('div', 'pzd-tools hidden');
    const tb = (label, title, fn, cls = 'tb-btn') => { const b = btn(label, title, fn, cls); tools.appendChild(b); return b; };
    tb('🔤 Titre', 'Ajouter un titre', () => addItem('title'));
    tb('🗒 Note', 'Ajouter une note', () => addItem('note'));
    tb('▭ Cadre', 'Ajouter un cadre pour regrouper des tables (le déplacer emporte son contenu)', () => addItem('frame'));
    tb('🖼 Image', 'Ajouter une image (aussi : glisser un fichier ou coller avec Ctrl+V)', () => pickImageFile());
    tb('😀 Icône', 'Ajouter une icône', (e) => addIcon(e));
    tb('▦ Tables…', 'Ajouter des tables au plan', (e) => addTables(e));
    tools.appendChild(h('span', 'pzd-sep'));
    st.undoBtn = tb('↶', 'Annuler (Ctrl+Z)', () => undo(), 'icon-btn');
    tb('⋯', 'Plan', (e) => planMenu(e.currentTarget), 'icon-btn');
    st.planInfo = h('span', 'pzd-label muted');
    tools.appendChild(st.planInfo);
    const fileInput = h('input');
    fileInput.type = 'file'; fileInput.accept = 'image/*'; fileInput.multiple = true; fileInput.hidden = true;
    fileInput.addEventListener('change', () => { addImageFiles([...fileInput.files]); fileInput.value = ''; });
    tools.appendChild(fileInput);

    // ---------- Surface ----------
    const vp = h('div', 'pzd-vp');
    vp.tabIndex = 0;
    const world = h('div', 'pzd-world');
    const svg = document.createElementNS(NS, 'svg');
    svg.classList.add('pzd-edges');
    svg.setAttribute('width', '1'); svg.setAttribute('height', '1');
    svg.innerHTML = `<defs>
      <marker id="pzd-many" viewBox="0 0 14 14" refX="13" refY="7" markerWidth="14" markerHeight="14" orient="auto-start-reverse" markerUnits="userSpaceOnUse"><path d="M13 1 L1 7 L13 13 M1 7 L13 7" fill="none" stroke="context-stroke" stroke-width="1.4"/></marker>
      <marker id="pzd-one" viewBox="0 0 14 14" refX="13" refY="7" markerWidth="14" markerHeight="14" orient="auto" markerUnits="userSpaceOnUse"><path d="M7 1 L7 13 M10 1 L10 13" fill="none" stroke="context-stroke" stroke-width="1.4"/></marker>
    </defs>`;
    world.appendChild(svg);
    vp.appendChild(world);
    const lasso = h('div', 'pzd-lasso hidden');
    vp.appendChild(lasso);
    st.hint = h('div', 'pzd-hint');
    vp.appendChild(st.hint);
    container.append(bar, tools, vp);
    Object.assign(st, { vp, world, svg, search, dl, modeSel, colSel, tools });

    // ---------- Navigation ----------
    const apply = () => { world.style.transform = `translate(${st.tx}px, ${st.ty}px) scale(${st.k})`; };
    function zoomAt(f, cx, cy) {
      const r = vp.getBoundingClientRect();
      cx = cx ?? r.width / 2; cy = cy ?? r.height / 2;
      const k = Math.min(3, Math.max(0.06, st.k * f));
      st.tx = cx - (cx - st.tx) * (k / st.k);
      st.ty = cy - (cy - st.ty) * (k / st.k);
      st.k = k;
      apply();
    }
    function fit() {
      const r = vp.getBoundingClientRect();
      const b = st.bounds;
      const bw = Math.max(1, b.x1 - b.x0), bh = Math.max(1, b.y1 - b.y0);
      if (!r.width) return;
      st.k = Math.min(1.2, (r.width - 40) / bw, (r.height - 40) / bh);
      st.tx = (r.width - bw * st.k) / 2 - b.x0 * st.k;
      st.ty = Math.max(14, (r.height - bh * st.k) / 2) - b.y0 * st.k;
      apply();
      saveView();
    }
    function centerOn(name) {
      const n = st.nodes?.get(name);
      if (!n) return;
      const r = vp.getBoundingClientRect();
      st.k = Math.max(st.k, 0.8);
      st.tx = r.width / 2 - n.x * st.k;
      st.ty = r.height / 2 - n.y * st.k;
      apply();
    }
    const toWorld = (cx, cy) => { const r = vp.getBoundingClientRect(); return { x: (cx - r.left - st.tx) / st.k, y: (cy - r.top - st.ty) / st.k }; };
    const viewCenter = () => { const r = vp.getBoundingClientRect(); return toWorld(r.left + r.width / 2, r.top + r.height / 2); };

    vp.addEventListener('wheel', (e) => {
      e.preventDefault();
      const r = vp.getBoundingClientRect();
      zoomAt(Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top);
      saveViewSoon();
    }, { passive: false });

    function startDrag(e, onMove, onEnd) {
      const d = { x: e.clientX, y: e.clientY, moved: false };
      const move = (ev) => {
        const dx = ev.clientX - d.x, dy = ev.clientY - d.y;
        if (!d.moved && Math.abs(dx) + Math.abs(dy) < 4) return;
        d.moved = true;
        onMove(dx, dy, ev);
      };
      const up = (ev) => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); onEnd?.(d.moved, ev); };
      window.addEventListener('mousemove', move);
      window.addEventListener('mouseup', up);
    }

    // Fond : déplacer la vue, ou dessiner un rectangle de sélection (Maj / Ctrl / mode sélection)
    vp.addEventListener('mousedown', (e) => {
      if (e.button !== 0 && e.button !== 1) return;
      if (e.target.isContentEditable) return;
      vp.focus({ preventScroll: true });
      if (e.target.closest('.pzd-node, .pzd-item')) return; // géré par l'élément
      e.preventDefault();
      const additive = e.shiftKey || e.ctrlKey || e.metaKey;
      if (e.button === 0 && (additive || st.selectMode)) {
        const r = vp.getBoundingClientRect();
        const x0 = e.clientX - r.left, y0 = e.clientY - r.top;
        const base = additive ? new Set(st.sel) : new Set();
        startDrag(e, (dx, dy) => {
          lasso.classList.remove('hidden');
          Object.assign(lasso.style, { left: `${Math.min(x0, x0 + dx)}px`, top: `${Math.min(y0, y0 + dy)}px`, width: `${Math.abs(dx)}px`, height: `${Math.abs(dy)}px` });
          const a = toWorld(r.left + x0, r.top + y0), b = toWorld(r.left + x0 + dx, r.top + y0 + dy);
          setSel([...base, ...inRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.max(a.x, b.x), Math.max(a.y, b.y))]);
        }, (moved) => { lasso.classList.add('hidden'); if (!moved && !additive) setSel([]); });
        return;
      }
      const t0 = { tx: st.tx, ty: st.ty };
      vp.classList.add('grabbing');
      startDrag(e, (dx, dy) => { st.tx = t0.tx + dx; st.ty = t0.ty + dy; apply(); }, (moved) => { vp.classList.remove('grabbing'); if (!moved) setSel([]); else saveViewSoon(); });
    });
    function inRect(x0, y0, x1, y1) {
      const out = [];
      for (const [n, v] of st.nodes || []) if (v.x + v.width / 2 > x0 && v.x - v.width / 2 < x1 && v.y + v.height / 2 > y0 && v.y - v.height / 2 < y1) out.push(tk(n));
      for (const it of plan()?.items || []) {
        const inside = it.x >= x0 && it.y >= y0 && it.x + it.w <= x1 && it.y + it.h <= y1;
        const touch = it.x + it.w > x0 && it.x < x1 && it.y + it.h > y0 && it.y < y1;
        if (it.type === 'frame' ? inside : touch) out.push(ik(it.id));
      }
      return out;
    }
    vp.addEventListener('contextmenu', (e) => {
      if (e.target.closest('.pzd-node, .pzd-item')) return;
      e.preventDefault();
      const at = toWorld(e.clientX, e.clientY);
      if (st.sel.size > 1) { selectionMenu(null, e); return; }
      if (plan()) {
        UI.menu([
          { title: 'Ajouter ici' },
          { label: 'Titre', icon: '🔤', action: () => addItem('title', at) },
          { label: 'Note', icon: '🗒', action: () => addItem('note', at) },
          { label: 'Cadre', icon: '▭', action: () => addItem('frame', at) },
          { label: 'Image…', icon: '🖼', action: () => pickImageFile(at) },
          { label: 'Icône…', icon: '😀', action: () => addIcon(e, at) },
          { label: 'Tables…', icon: '▦', action: () => addTables(e, at) },
          '-',
          { label: 'Tout sélectionner', icon: '⬚', hint: 'Ctrl+A', action: selectAll },
          { label: 'Tout voir', icon: '⤢', action: fit },
        ], e.clientX, e.clientY);
      } else {
        UI.menu([
          { label: 'Créer un plan à partir de cette vue…', icon: '✎', action: () => newPlan() },
          { label: 'Tout sélectionner', icon: '⬚', hint: 'Ctrl+A', action: selectAll },
          { label: 'Tout voir', icon: '⤢', action: fit },
        ], e.clientX, e.clientY);
      }
    });

    // Clavier
    vp.addEventListener('keydown', (e) => {
      if (e.target.isContentEditable || e.target.tagName === 'INPUT') return;
      e.stopPropagation();
      const p = plan();
      const ctrl = e.ctrlKey || e.metaKey;
      if (ctrl && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); return; }
      if (ctrl && e.key.toLowerCase() === 'a') { e.preventDefault(); selectAll(); return; }
      if (e.key === 'Escape') { setSel([]); return; }
      if (!st.sel.size) return;
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); removeSelection(); }
      else if (ctrl && e.key.toLowerCase() === 'd' && p) { e.preventDefault(); duplicateSelection(); }
      else if (e.key.startsWith('Arrow') && p) {
        e.preventDefault();
        const s = e.shiftKey ? 50 : SNAP;
        const dx = e.key === 'ArrowLeft' ? -s : e.key === 'ArrowRight' ? s : 0, dy = e.key === 'ArrowUp' ? -s : e.key === 'ArrowDown' ? s : 0;
        checkpoint();
        const tg = moveTargets([...st.sel]);
        for (const c of tg.tables) { c.t.x += dx; c.t.y += dy; }
        for (const c of tg.items) { c.it.x += dx; c.it.y += dy; }
        render(false); save();
      }
    });
    vp.addEventListener('paste', (e) => {
      const files = [...(e.clipboardData?.files || [])].filter((f) => f.type.startsWith('image/'));
      if (!files.length) return;
      e.preventDefault();
      addImageFiles(files);
    });
    vp.addEventListener('dragover', (e) => { if ([...e.dataTransfer.types].includes('Files')) { e.preventDefault(); e.stopPropagation(); vp.classList.add('drop'); } });
    vp.addEventListener('dragleave', () => vp.classList.remove('drop'));
    vp.addEventListener('drop', (e) => {
      vp.classList.remove('drop');
      const files = [...e.dataTransfer.files].filter((f) => f.type.startsWith('image/'));
      if (!files.length) return;
      e.preventDefault(); e.stopPropagation();
      addImageFiles(files, toWorld(e.clientX, e.clientY));
    });

    // ---------- Sauvegarde, annulation ----------
    let saveTimer = null;
    function save() {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(async () => {
        try { await st.store?.save(st.doc); } catch (err) { UI.toast(`Plan non enregistré : ${err.message}`, { kind: 'error' }); }
      }, 400);
    }
    let viewTimer = null;
    function saveView() { const p = plan(); if (p) { p.view = { tx: Math.round(st.tx), ty: Math.round(st.ty), k: +st.k.toFixed(3) }; save(); } }
    function saveViewSoon() { clearTimeout(viewTimer); viewTimer = setTimeout(saveView, 600); }
    // Annulation : instantané du plan et des réglages des tables (masquées, icônes, couleurs)
    function snapshot() { const p = plan(); return JSON.stringify({ plan: p, hidden: st.doc.hidden, icons: st.doc.icons, colors: st.doc.colors }); }
    function checkpoint() {
      st.undo.push(snapshot());
      if (st.undo.length > 60) st.undo.shift();
      st.undoBtn.disabled = false;
    }
    function undo() {
      if (!st.undo.length) return;
      const s = JSON.parse(st.undo.pop());
      const p = plan();
      if (p && s.plan) Object.assign(p, s.plan);
      Object.assign(st.doc, { hidden: s.hidden, icons: s.icons, colors: s.colors });
      st.undoBtn.disabled = !st.undo.length;
      render(false); save();
    }

    // ---------- Plans ----------
    function modeValue() { return st.mode === 'plan' ? `plan:${st.planId}` : `${st.mode}:${st.mode === 'all' ? 0 : st.depth}`; }
    function fillModes() {
      const o = [['near:1', 'Voisins directs'], ['near:2', 'Voisins sur 2 niveaux'], ['all:0', 'Tout le schéma']];
      modeSel.innerHTML = `<optgroup label="Vues automatiques">${o.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</optgroup>` +
        `<optgroup label="Mes plans">${st.doc.plans.map((p) => `<option value="plan:${esc(p.id)}">✎ ${esc(p.name)}</option>`).join('')}<option value="new">＋ Nouveau plan…</option></optgroup>`;
      if (st.mode === 'plan' && !st.doc.plans.some((p) => p.id === st.planId)) { st.mode = 'near'; st.depth = 1; }
      modeSel.value = modeValue();
    }
    function autoName() {
      const base = st.mode === 'near' && st.focus ? `Autour de ${st.focus}` : 'Mon plan';
      let n = base, i = 2;
      while (st.doc.plans.some((p) => p.name === n)) n = `${base} (${i++})`;
      return n;
    }
    // Crée un plan à partir de la vue (ou de certaines tables) ; sans question si silent
    function makePlan(name, only) {
      const p = { id: uid(), name, tables: {}, items: [] };
      const cur = plan();
      if (cur && !only) { p.tables = JSON.parse(JSON.stringify(cur.tables)); p.items = JSON.parse(JSON.stringify(cur.items)).map((it) => ({ ...it, id: uid() })); }
      else for (const [n, v] of st.nodes || []) if (!only || only.has(n)) p.tables[n] = { x: snap(v.x - v.width / 2), y: snap(v.y - v.height / 2) };
      st.doc.plans.push(p);
      st.mode = 'plan'; st.planId = p.id; st.undo = [];
      fillModes(); save(); changed();
      return p;
    }
    async function newPlan(only) {
      const name = await UI.prompt('Nouveau plan', plan() && !only ? `${plan().name} (copie)` : autoName(), { ok: 'Créer', message: 'Le plan reprend les tables et leur disposition actuelles. Vous pourrez les déplacer, en masquer, et ajouter titres, notes, cadres, images et icônes.' });
      if (!name) return;
      makePlan(name.trim() || 'Plan', only);
      st.sel.clear();
      render(!!only);
      UI.toast(`Plan « ${plan().name} » créé`);
    }
    // Déplacer une table dans une vue automatique : la vue devient un plan, sans interrompre le geste
    function ensurePlan() {
      if (plan()) return plan();
      const p = makePlan(autoName());
      render(false);
      UI.toast(`Vue enregistrée comme plan « ${p.name} » : vos déplacements sont conservés (⋯ pour le renommer)`, { ms: 5000 });
      return p;
    }
    function planMenu(anchor) {
      const p = plan();
      if (!p) return;
      UI.menu([
        { title: p.name },
        { label: 'Renommer…', icon: '✎', action: async () => { const n = await UI.prompt('Renommer le plan', p.name); if (n && n.trim()) { p.name = n.trim(); fillModes(); save(); } } },
        { label: 'Dupliquer…', icon: '⧉', action: () => newPlan() },
        { label: 'Réorganiser les tables automatiquement', icon: '⟲', action: async () => {
          if (!(await UI.confirm('Réorganiser ?', 'Les tables du plan seront replacées automatiquement. Les titres, notes et images ne bougent pas. (Ctrl+Z pour revenir en arrière)', { ok: 'Réorganiser' }))) return;
          checkpoint();
          const names = Object.keys(p.tables).filter((n) => st.info.models.some((m) => m.name === n));
          const L = pack(names, st.rels.filter((r) => p.tables[r.from] && p.tables[r.to]), (n) => sizeOf(n), aspect());
          const b = itemsBounds(p);
          const ox = b ? snap(b.x0) : 0, oy = b ? snap(b.y1 + 60) : 0;
          for (const [n, v] of L.nodes) p.tables[n] = { x: snap(ox + v.x - v.width / 2), y: snap(oy + v.y - v.height / 2) };
          render(true); save();
        } },
        '-',
        { label: 'Ouvrir le dossier des plans', icon: '📁', action: () => st.store?.reveal?.() },
        { label: 'Supprimer ce plan', icon: '🗑', action: async () => {
          if (!(await UI.confirm('Supprimer le plan ?', `Le plan <b>${esc(p.name)}</b>, ses notes, titres et images seront supprimés.`, { ok: 'Supprimer', danger: true }))) return;
          st.doc.plans = st.doc.plans.filter((x) => x !== p);
          st.mode = 'near'; st.depth = 1; st.undo = []; st.sel.clear();
          fillModes(); render(true); save(); changed();
        } },
      ], anchor);
    }
    const aspect = () => { const r = vp.getBoundingClientRect(); return (r.width || 1200) / (r.height || 700); };
    function itemsBounds(p) {
      if (!p.items.length) return null;
      return { x0: Math.min(...p.items.map((i) => i.x)), y0: Math.min(...p.items.map((i) => i.y)), x1: Math.max(...p.items.map((i) => i.x + i.w)), y1: Math.max(...p.items.map((i) => i.y + i.h)) };
    }

    // ---------- Tables masquées (vues automatiques) ----------
    function hiddenMenu(anchor) {
      const hid = st.doc.hidden;
      UI.menu([
        { title: `${hid.length} table${hid.length > 1 ? 's' : ''} masquée${hid.length > 1 ? 's' : ''}` },
        ...hid.map((n) => ({ label: n, icon: '👁', hint: 'réafficher', action: () => { checkpoint(); st.doc.hidden = st.doc.hidden.filter((x) => x !== n); render(true); save(); } })),
        '-',
        { label: 'Tout réafficher', icon: '↺', action: () => { checkpoint(); st.doc.hidden = []; render(true); save(); } },
      ], anchor);
    }

    // ---------- Sélection ----------
    function setSel(keys) {
      st.sel = new Set(keys);
      refreshSel();
    }
    function refreshSel() {
      // Retire ce qui n'existe plus
      for (const k of [...st.sel]) {
        if (k.startsWith('t:') && !st.nodes?.has(k.slice(2))) st.sel.delete(k);
        if (k.startsWith('i:') && !plan()?.items.some((x) => x.id === k.slice(2))) st.sel.delete(k);
      }
      world.querySelectorAll('.sel').forEach((x) => x.classList.remove('sel'));
      for (const k of st.sel) elOf(k)?.classList.add('sel');
      const n = st.sel.size;
      st.selInfo.classList.toggle('hidden', n < 1);
      st.selInfo.textContent = `${n} sélectionné${n > 1 ? 's' : ''} ▾`;
    }
    function elOf(k) {
      return k.startsWith('t:') ? world.querySelector(`.pzd-node[data-name="${CSS.escape(k.slice(2))}"]`) : world.querySelector(`.pzd-item[data-id="${CSS.escape(k.slice(2))}"]`);
    }
    function selectAll() {
      setSel([...[...(st.nodes?.keys() || [])].map(tk), ...(plan()?.items || []).map((it) => ik(it.id))]);
    }
    const selTables = () => [...st.sel].filter((k) => k.startsWith('t:')).map((k) => k.slice(2));
    const selItems = () => { const p = plan(); return p ? [...st.sel].filter((k) => k.startsWith('i:')).map((k) => p.items.find((x) => x.id === k.slice(2))).filter(Boolean) : []; };

    // Ce qui bouge quand on déplace une sélection : les éléments, plus le contenu des cadres sélectionnés
    function moveTargets(keys) {
      const p = plan();
      const tables = new Map(), items = new Map();
      for (const k of keys) {
        if (k.startsWith('t:') && p.tables[k.slice(2)]) tables.set(k.slice(2), p.tables[k.slice(2)]);
        if (k.startsWith('i:')) { const it = p.items.find((x) => x.id === k.slice(2)); if (it) items.set(it.id, it); }
      }
      for (const fr of [...items.values()].filter((x) => x.type === 'frame')) {
        const inside = (x, y, w, hh) => x >= fr.x && y >= fr.y && x + w <= fr.x + fr.w && y + hh <= fr.y + fr.h;
        for (const o of p.items) if (o !== fr && inside(o.x, o.y, o.w, o.h)) items.set(o.id, o);
        for (const [n, t] of Object.entries(p.tables)) { const nn = st.nodes.get(n); if (nn && inside(t.x, t.y, nn.width, nn.height)) tables.set(n, t); }
      }
      return { tables: [...tables].map(([n, t]) => ({ n, t, x0: t.x, y0: t.y })), items: [...items.values()].map((it) => ({ it, x0: it.x, y0: it.y })) };
    }
    function placeTable(n, t) {
      const el = elOf(tk(n));
      if (el) { el.style.left = `${t.x}px`; el.style.top = `${t.y}px`; }
      const nn = st.nodes.get(n);
      if (nn) { nn.x = t.x + nn.width / 2; nn.y = t.y + nn.height / 2; }
    }
    function placeItem(it) {
      const el = elOf(ik(it.id));
      if (el) { el.style.left = `${it.x}px`; el.style.top = `${it.y}px`; }
    }
    // Glisser la sélection (dans une vue automatique, la vue devient d'abord un plan)
    function dragSelection(e, onClick) {
      let tg = null;
      startDrag(e, (dx, dy) => {
        if (!tg) {
          ensurePlan();
          checkpoint();
          tg = moveTargets([...st.sel]);
          refreshSel();
        }
        const ddx = snap(dx / st.k), ddy = snap(dy / st.k);
        for (const c of tg.tables) { c.t.x = c.x0 + ddx; c.t.y = c.y0 + ddy; placeTable(c.n, c.t); }
        for (const c of tg.items) { c.it.x = c.x0 + ddx; c.it.y = c.y0 + ddy; placeItem(c.it); }
        if (tg.tables.length) drawPlanEdges(new Set(tg.tables.map((c) => c.n)));
      }, (moved) => {
        if (moved) { save(); render(false); } else onClick?.();
      });
    }
    // Clic sur un élément : sélection simple, ou ajout / retrait avec Ctrl / Maj
    function pressElement(e, key, onClick) {
      const additive = e.ctrlKey || e.shiftKey || e.metaKey;
      const wasSel = st.sel.has(key);
      if (additive) { if (!wasSel) { st.sel.add(key); refreshSel(); } }
      else if (!wasSel) setSel([key]);
      dragSelection(e, () => {
        if (additive && wasSel) { st.sel.delete(key); refreshSel(); }
        else if (!additive) { setSel([key]); onClick?.(); }
      });
    }

    function removeSelection() {
      const p = plan();
      const tables = selTables();
      if (!p) { hideTables(tables); return; }
      checkpoint();
      for (const n of tables) delete p.tables[n];
      const ids = new Set(selItems().map((x) => x.id));
      p.items = p.items.filter((x) => !ids.has(x.id));
      st.sel.clear();
      render(false); save();
    }
    function hideTables(names) {
      if (!names.length) return;
      checkpoint();
      for (const n of names) if (!st.doc.hidden.includes(n)) st.doc.hidden.push(n);
      if (names.includes(st.focus)) st.focus = null;
      st.sel.clear();
      render(); save();
      UI.toast(`${names.length > 1 ? `${names.length} tables masquées` : `${names[0]} masquée`} — bouton « masquées » pour réafficher · Ctrl+Z pour annuler`);
    }
    function duplicateSelection() {
      const p = plan();
      const its = selItems();
      if (!p || !its.length) return;
      checkpoint();
      const copies = its.map((it) => ({ ...it, id: uid(), x: it.x + 30, y: it.y + 30 }));
      for (const c of copies) { if (c.type === 'frame') p.items.unshift(c); else p.items.push(c); }
      render(false); setSel(copies.map((c) => ik(c.id))); save();
    }
    // Boîtes pour aligner / répartir
    function boxOf(k) {
      const p = plan();
      if (k.startsWith('t:')) { const n = k.slice(2), t = p.tables[n], nn = st.nodes.get(n); return t && nn ? { k, x: t.x, y: t.y, w: nn.width, h: nn.height } : null; }
      const it = p.items.find((x) => x.id === k.slice(2));
      return it ? { k, x: it.x, y: it.y, w: it.w, h: it.h } : null;
    }
    function setBoxPos(k, x, y) {
      const p = plan();
      if (k.startsWith('t:')) { const t = p.tables[k.slice(2)]; if (t) { t.x = snap(x); t.y = snap(y); } }
      else { const it = p.items.find((i) => i.id === k.slice(2)); if (it) { it.x = snap(x); it.y = snap(y); } }
    }
    function align(how) {
      const boxes = [...st.sel].map(boxOf).filter(Boolean);
      if (boxes.length < 2) return;
      checkpoint();
      const x0 = Math.min(...boxes.map((b) => b.x)), x1 = Math.max(...boxes.map((b) => b.x + b.w));
      const y0 = Math.min(...boxes.map((b) => b.y)), y1 = Math.max(...boxes.map((b) => b.y + b.h));
      for (const b of boxes) {
        if (how === 'left') setBoxPos(b.k, x0, b.y);
        if (how === 'right') setBoxPos(b.k, x1 - b.w, b.y);
        if (how === 'hcenter') setBoxPos(b.k, (x0 + x1) / 2 - b.w / 2, b.y);
        if (how === 'top') setBoxPos(b.k, b.x, y0);
        if (how === 'bottom') setBoxPos(b.k, b.x, y1 - b.h);
        if (how === 'vcenter') setBoxPos(b.k, b.x, (y0 + y1) / 2 - b.h / 2);
      }
      render(false); save();
    }
    function distribute(axis) {
      const boxes = [...st.sel].map(boxOf).filter(Boolean);
      if (boxes.length < 3) { UI.toast('Sélectionnez au moins 3 éléments pour les répartir'); return; }
      checkpoint();
      const X = axis === 'x';
      boxes.sort((a, b) => (X ? a.x - b.x : a.y - b.y));
      const start = X ? boxes[0].x : boxes[0].y;
      const end = X ? Math.max(...boxes.map((b) => b.x + b.w)) : Math.max(...boxes.map((b) => b.y + b.h));
      const total = boxes.reduce((s, b) => s + (X ? b.w : b.h), 0);
      const gap = Math.max(20, (end - start - total) / (boxes.length - 1));
      let pos = start;
      for (const b of boxes) { if (X) setBoxPos(b.k, pos, b.y); else setBoxPos(b.k, b.x, pos); pos += (X ? b.w : b.h) + gap; }
      render(false); save();
    }
    // Ranger en grille
    function arrangeGrid() {
      const boxes = [...st.sel].map(boxOf).filter(Boolean);
      if (boxes.length < 2) return;
      checkpoint();
      boxes.sort((a, b) => a.y - b.y || a.x - b.x);
      const cols = Math.ceil(Math.sqrt(boxes.length * 1.6));
      const x0 = Math.min(...boxes.map((b) => b.x)), y0 = Math.min(...boxes.map((b) => b.y));
      const cw = Math.max(...boxes.map((b) => b.w)) + 40;
      let y = y0;
      for (let r = 0; r * cols < boxes.length; r++) {
        const row = boxes.slice(r * cols, r * cols + cols);
        row.forEach((b, i) => setBoxPos(b.k, x0 + i * cw, y));
        y += Math.max(...row.map((b) => b.h)) + 40;
      }
      render(false); save();
    }
    function frameSelection() {
      const boxes = [...st.sel].map(boxOf).filter(Boolean);
      if (!boxes.length) return;
      const x0 = Math.min(...boxes.map((b) => b.x)) - 30, y0 = Math.min(...boxes.map((b) => b.y)) - 40;
      const x1 = Math.max(...boxes.map((b) => b.x + b.w)) + 30, y1 = Math.max(...boxes.map((b) => b.y + b.h)) + 30;
      addItem('frame', { x: x0, y: y0 }, { w: snap(x1 - x0), h: snap(y1 - y0) });
    }
    async function iconForTables(names, x, y) {
      const em = await pickEmoji(x, y, names.length === 1 ? st.doc.icons[names[0]] : '');
      if (em == null) return;
      checkpoint();
      for (const n of names) { if (em) st.doc.icons[n] = em; else delete st.doc.icons[n]; }
      render(false); save();
    }
    function colorForSelection(c) {
      checkpoint();
      for (const n of selTables()) { if (c) st.doc.colors[n] = c; else delete st.doc.colors[n]; }
      for (const it of selItems()) if (it.type === 'note' || it.type === 'frame' || it.type === 'title') it.color = c || (it.type === 'title' ? null : it.color);
      render(false); save();
    }

    // Menu de la sélection multiple
    function selectionMenu(anchor, ev) {
      const p = plan();
      const tables = selTables(), items = selItems();
      const n = st.sel.size;
      if (!n) return;
      const pos = ev ? [ev.clientX, ev.clientY] : [anchor];
      const x = ev ? ev.clientX : anchor.getBoundingClientRect().left, y = ev ? ev.clientY : anchor.getBoundingClientRect().bottom;
      UI.menu([
        { title: `${n} élément${n > 1 ? 's' : ''} sélectionné${n > 1 ? 's' : ''}${tables.length && items.length ? ` (${tables.length} table${tables.length > 1 ? 's' : ''})` : ''}` },
        ...(p && n > 1 ? [
          { label: 'Aligner', icon: '⫷', submenu: [
            { label: 'À gauche', icon: '⇤', action: () => align('left') },
            { label: 'Centrer horizontalement', icon: '↔', action: () => align('hcenter') },
            { label: 'À droite', icon: '⇥', action: () => align('right') },
            '-',
            { label: 'En haut', icon: '⤒', action: () => align('top') },
            { label: 'Centrer verticalement', icon: '↕', action: () => align('vcenter') },
            { label: 'En bas', icon: '⤓', action: () => align('bottom') },
          ] },
          { label: 'Répartir', icon: '☷', submenu: [
            { label: 'Horizontalement', icon: '↔', action: () => distribute('x') },
            { label: 'Verticalement', icon: '↕', action: () => distribute('y') },
            { label: 'Ranger en grille', icon: '▦', action: arrangeGrid },
          ] },
          { label: 'Encadrer la sélection', icon: '▭', action: frameSelection },
        ] : []),
        ...(tables.length ? [
          { label: tables.length > 1 ? `Icône des ${tables.length} tables…` : 'Icône de la table…', icon: '😀', action: () => iconForTables(tables, x, y) },
        ] : []),
        { label: 'Couleur', icon: '🎨', submenu: colorItems(null, (c) => colorForSelection(c)) },
        ...(p && tables.length ? [{ label: 'Ajouter les tables liées', icon: '✚', action: () => addNeighbors(tables) }] : []),
        ...(p && items.length ? [{ label: 'Dupliquer les éléments', icon: '⧉', hint: 'Ctrl+D', action: duplicateSelection }] : []),
        ...(!p && tables.length ? [{ label: `Créer un plan avec ${tables.length > 1 ? `ces ${tables.length} tables` : 'cette table'}…`, icon: '✎', action: () => newPlan(new Set(tables)) }] : []),
        '-',
        p ? { label: items.length && !tables.length ? 'Supprimer' : 'Retirer du plan', icon: '🙈', hint: 'Suppr', action: removeSelection }
          : { label: tables.length > 1 ? `Masquer ces ${tables.length} tables` : 'Masquer cette table', icon: '🙈', hint: 'Suppr', action: removeSelection },
        { label: 'Désélectionner', icon: '✕', hint: 'Échap', action: () => setSel([]) },
      ], ...pos);
    }

    // ---------- Ajout d'éléments ----------
    const DEFAULTS = {
      title: { w: 320, h: 48, text: 'Titre', color: null },
      note: { w: 220, h: 130, text: 'Note', color: '#f5c542' },
      frame: { w: 560, h: 360, text: 'Groupe', color: '#4aa8f0' },
      icon: { w: 56, h: 56, text: '⭐' },
    };
    function addItem(type, at, extra = {}) {
      const p = plan() || ensurePlan();
      checkpoint();
      const d = { ...DEFAULTS[type], ...extra };
      const c = at || freeSpot(d.w, d.h, type === 'frame');
      const it = { id: uid(), type, x: snap(c.x), y: snap(c.y), w: d.w, h: d.h, text: d.text, color: d.color, src: d.src };
      if (type === 'frame') p.items.unshift(it); else p.items.push(it);
      render(false);
      setSel([ik(it.id)]);
      save();
      if (type === 'title' || type === 'note' || type === 'frame') setTimeout(() => editText(it.id), 30);
      return it;
    }
    // Coin haut-gauche d'une place libre (sans table ni élément) la plus proche du centre de la vue
    function freeSpot(w, hh, ignoreAll) {
      const p = plan();
      const c = viewCenter();
      const boxes = [];
      for (const n of st.nodes?.values() || []) boxes.push([n.x - n.width / 2, n.y - n.height / 2, n.width, n.height]);
      for (const it of p?.items || []) if (it.type !== 'frame') boxes.push([it.x, it.y, it.w, it.h]);
      const M = 16;
      const free = (x, y) => ignoreAll || !boxes.some(([bx, by, bw, bh]) => x < bx + bw + M && x + w + M > bx && y < by + bh + M && y + hh + M > by);
      const x0 = c.x - w / 2, y0 = c.y - hh / 2;
      for (let r = 0; r <= 3000; r += 40) {
        const steps = Math.max(1, Math.round((2 * Math.PI * r) / 60));
        for (let i = 0; i < steps; i++) {
          const a = (i / steps) * Math.PI * 2;
          const x = x0 + Math.cos(a) * r, y = y0 + Math.sin(a) * r * 0.75;
          if (free(x, y)) return { x, y };
        }
      }
      return { x: x0, y: y0 };
    }
    async function addIcon(e, at) {
      const r = e?.currentTarget?.getBoundingClientRect?.();
      const em = await pickEmoji(r ? r.left : e.clientX, r ? r.bottom + 4 : e.clientY);
      if (em) addItem('icon', at, { text: em });
    }
    function pickImageFile(at) { st.imageAt = at || null; fileInput.click(); }
    async function addImageFiles(files, at) {
      if (!plan()) ensurePlan();
      let i = 0;
      for (const f of files) {
        try {
          const url = await readImage(f);
          const src = await st.store.saveImage(url);
          st.assets[src] = url;
          const sz = await imageSize(url);
          const s = Math.min(1, 360 / Math.max(sz.w, sz.h));
          const pos = at || st.imageAt;
          const c = pos ? { x: pos.x + i * 30, y: pos.y + i * 30 } : null;
          addItem('image', c, { src, w: Math.round(sz.w * s), h: Math.round(sz.h * s), text: f.name });
          i++;
        } catch (err) { UI.toast(err.message, { kind: 'error' }); }
      }
      st.imageAt = null;
    }
    async function addTables(e, at) {
      const p = plan();
      if (!p) return;
      const r = e?.currentTarget?.getBoundingClientRect?.();
      const free = st.info.models.filter((m) => !p.tables[m.name]).sort((a, b) => a.name.localeCompare(b.name));
      const names = await pickModels(r ? r.left : e.clientX, r ? r.bottom + 4 : e.clientY, free, 'Ajouter des tables au plan');
      if (!names?.length) return;
      checkpoint();
      const cols = Math.min(4, names.length);
      const c = at || freeSpot(cols * (W + 30), Math.ceil(names.length / 4) * 220);
      names.forEach((n, i) => { p.tables[n] = { x: snap(c.x + (i % 4) * (W + 30)), y: snap(c.y + Math.floor(i / 4) * 220) }; });
      render(false);
      setSel(names.map(tk));
    }
    function addNeighbors(names) {
      const p = plan();
      if (!p) return;
      const added = [];
      checkpoint();
      for (const name of names) {
        const t = p.tables[name];
        if (!t) continue;
        const ns = [...new Set(st.rels.filter((r) => r.from === name || r.to === name).map((r) => (r.from === name ? r.to : r.from)))].filter((n) => n !== name && !p.tables[n]);
        const R = 340 + ns.length * 12;
        ns.forEach((n, i) => {
          const a = (i / ns.length) * Math.PI * 2;
          p.tables[n] = { x: snap(t.x + Math.cos(a) * R), y: snap(t.y + Math.sin(a) * R * 0.7) };
          added.push(n);
        });
      }
      if (!added.length) { st.undo.pop(); UI.toast('Toutes les tables liées sont déjà dans le plan'); return; }
      render(false); setSel(added.map(tk)); save();
      UI.toast(`${added.length} table${added.length > 1 ? 's' : ''} ajoutée${added.length > 1 ? 's' : ''} (sélectionnées : glissez-les pour les placer)`);
    }
    function colorItems(cur, fn, allowNone = true) {
      return [...(allowNone ? [{ label: 'Aucune', checked: !cur, action: () => fn(null) }] : []),
        ...COLORS.map(([c, l]) => ({ label: l, icon: `<span class="pzd-dot" style="background:${c}"></span>`, checked: cur === c, action: () => fn(c) }))];
    }

    // ---------- Rendu ----------
    function visibleModels() {
      const all = st.info.models;
      const hiddenSet = new Set(st.doc.hidden);
      const hidden = (n) => (hiddenSet.has(n) || (!st.showHubs && st.hubs.has(n))) && n !== st.focus;
      if (st.mode === 'all' || !st.focus || !all.some((m) => m.name === st.focus)) return new Set(all.map((m) => m.name).filter((n) => !hiddenSet.has(n) && (!st.hubs.has(n) || st.showHubs)));
      const adj = new Map();
      for (const r of st.rels) {
        if (!adj.has(r.from)) adj.set(r.from, new Set());
        if (!adj.has(r.to)) adj.set(r.to, new Set());
        adj.get(r.from).add(r.to); adj.get(r.to).add(r.from);
      }
      const seen = new Set([st.focus]);
      let front = [st.focus];
      for (let i = 0; i < st.depth; i++) {
        const next = [];
        for (const n of front) {
          if (n !== st.focus && st.hubs.has(n)) continue; // on ne s'étend pas à travers une table carrefour
          for (const x of adj.get(n) || []) if (!seen.has(x) && !hidden(x)) { seen.add(x); next.push(x); }
        }
        front = next;
      }
      return seen;
    }
    function shownFields(m) {
      if (st.cols === 'none') return [];
      const fkSet = new Set(st.rels.filter((r) => r.from === m.name).flatMap((r) => r.fk));
      const scal = m.fields.filter((f) => f.ref !== 'model');
      return (st.cols === 'keys' ? scal.filter((f) => f.id || f.unique || fkSet.has(f.name)) : scal).map((f) => ({ f, fk: fkSet.has(f.name) }));
    }
    const byName = () => new Map(st.info.models.map((m) => [m.name, m]));
    function sizeOf(name) {
      const m = st.info.models.find((x) => x.name === name);
      const n = m ? shownFields(m).length : 0;
      return { width: W, height: HEAD + n * ROW + (n ? FOOT : 0) };
    }

    function render(refit) {
      if (!st.info) return;
      const p = plan();
      tools.classList.toggle('hidden', !p);
      st.hiddenBtn.classList.toggle('hidden', !!p || !st.doc.hidden.length);
      st.hiddenBtn.textContent = `🙈 ${st.doc.hidden.length} masquée${st.doc.hidden.length > 1 ? 's' : ''}`;
      st.hubBox.classList.toggle('hidden', !!p || !st.hubs.size);
      st.undoBtn.disabled = !st.undo.length;
      st.hint.textContent = p
        ? 'Glisser : déplacer · Ctrl/Maj + clic : sélection multiple · Maj + glisser sur le fond : sélection par zone · Ctrl+A : tout · Suppr : retirer · Double-clic : texte · Ctrl+Z : annuler'
        : 'Glisser une table : la déplacer (la vue devient un plan) · Glisser le fond : déplacer la vue · Ctrl/Maj + clic ou Maj + glisser : sélectionner · Suppr : masquer';
      vp.classList.toggle('editing', !!p);
      const models = byName();
      const fieldsOf = new Map();

      let L;
      let visNames;
      if (p) {
        visNames = Object.keys(p.tables).filter((n) => models.has(n));
        for (const n of visNames) fieldsOf.set(n, shownFields(models.get(n)));
        const nodes = new Map();
        for (const n of visNames) { const sz = sizeOf(n); const t = p.tables[n]; nodes.set(n, { ...sz, x: t.x + sz.width / 2, y: t.y + sz.height / 2 }); }
        L = { nodes, edges: null };
      } else {
        const vis = visibleModels();
        visNames = [...vis].filter((n) => models.has(n));
        for (const n of visNames) fieldsOf.set(n, shownFields(models.get(n)));
        L = pack(visNames, st.rels.filter((r) => vis.has(r.from) && vis.has(r.to)), (n) => sizeOf(n), aspect());
      }
      st.nodes = L.nodes;
      const visSet = new Set(visNames);
      const rels = st.rels.filter((r) => visSet.has(r.from) && visSet.has(r.to));
      st.label.textContent = `${visNames.length} table${visNames.length > 1 ? 's' : ''} · ${rels.length} relation${rels.length > 1 ? 's' : ''}`;
      if (p) st.planInfo.textContent = `${visNames.length} table${visNames.length > 1 ? 's' : ''} · ${p.items.length} élément${p.items.length > 1 ? 's' : ''}`;
      st.search.value = p ? '' : st.focus || '';

      world.querySelectorAll('.pzd-node, .pzd-item').forEach((n) => n.remove());
      if (p) for (const it of p.items) world.appendChild(itemEl(it));
      for (const name of visNames) world.appendChild(tableEl(models.get(name), L.nodes.get(name), fieldsOf.get(name), rels, visSet, p));

      // Liens
      svg.querySelectorAll('g.pzd-e').forEach((e) => e.remove());
      st.edgesList = [];
      const pairCount = new Map();
      const list = p ? rels.map((r) => ({ r })) : L.edges;
      for (const e of list) {
        const gEl = document.createElementNS(NS, 'g');
        gEl.classList.add('pzd-e');
        if (e.r.optional) gEl.classList.add('opt');
        gEl.dataset.from = e.r.from; gEl.dataset.to = e.r.to;
        const path = document.createElementNS(NS, 'path');
        path.setAttribute('marker-start', e.r.one ? 'url(#pzd-one)' : 'url(#pzd-many)');
        path.setAttribute('marker-end', 'url(#pzd-one)');
        const hit = document.createElementNS(NS, 'path');
        hit.classList.add('hit');
        const t = document.createElementNS(NS, 'title');
        t.textContent = `${e.r.from}.${e.r.fk.join(', ')} → ${e.r.to}.${e.r.refs.join(', ')}\n${e.r.one ? '1 : 1' : 'n : 1'}${e.r.optional ? ' (facultatif)' : ''}${e.r.onDelete ? ` · onDelete: ${e.r.onDelete}` : ''}\nchamp « ${e.r.field} »`;
        hit.appendChild(t);
        gEl.append(path, hit);
        svg.appendChild(gEl);
        const key = [e.r.from, e.r.to].sort().join('|');
        const k = pairCount.get(key) || 0;
        pairCount.set(key, k + 1);
        st.edgesList.push({ r: e.r, path, hit, k });
        if (!p) { const d = curve(e.points); path.setAttribute('d', d); hit.setAttribute('d', d); }
      }
      if (p) drawPlanEdges();

      // Étendue
      const xs = [], ys = [];
      for (const n of L.nodes.values()) { xs.push(n.x - n.width / 2, n.x + n.width / 2); ys.push(n.y - n.height / 2, n.y + n.height / 2); }
      if (p) for (const it of p.items) { xs.push(it.x, it.x + it.w); ys.push(it.y, it.y + it.h); }
      st.bounds = xs.length ? { x0: Math.min(...xs) - 20, y0: Math.min(...ys) - 20, x1: Math.max(...xs) + 20, y1: Math.max(...ys) + 20 } : { x0: 0, y0: 0, x1: 400, y1: 300 };
      refreshSel();

      if (refit !== false && (refit || !p)) {
        requestAnimationFrame(() => {
          if (p && p.view && refit) { st.tx = p.view.tx; st.ty = p.view.ty; st.k = p.view.k; apply(); return; }
          fit();
          if (!p && st.mode !== 'all' && st.k < 0.5) { st.k = 0.7; centerOn(st.focus); }
        });
      }
    }
    function drawPlanEdges(only) {
      if (!plan()) return;
      for (const e of st.edgesList) {
        if (only && !only.has(e.r.from) && !only.has(e.r.to)) continue;
        const a = st.nodes.get(e.r.from), b = st.nodes.get(e.r.to);
        if (!a || !b) continue;
        const d = route(a, b, e.k);
        e.path.setAttribute('d', d); e.hit.setAttribute('d', d);
      }
    }

    function tableEl(m, n, fields, rels, visSet, p) {
      const el = h('div', 'pzd-node' + (m.name === st.focus && !p ? ' focus' : ''));
      el.dataset.name = m.name;
      el.style.left = `${n.x - n.width / 2}px`;
      el.style.top = `${n.y - n.height / 2}px`;
      el.style.width = `${n.width}px`;
      el.style.height = `${n.height}px`;
      const color = st.doc.colors[m.name];
      if (color) { el.style.setProperty('--tc', color); el.classList.add('colored'); }
      const icon = st.doc.icons[m.name];
      const count = st.counts.get(m.dbName);
      const self = rels.filter((r) => r.from === m.name && r.to === m.name);
      const hubLinks = p ? [] : [...new Set(st.rels.filter((r) => r.from === m.name && r.to !== m.name && st.hubs.has(r.to) && !visSet.has(r.to)).map((r) => r.to))];
      el.innerHTML = `<div class="pzd-head" title="${esc(m.doc || '')}">${icon ? `<span class="pzd-ticon">${esc(icon)}</span>` : ''}<b>${esc(m.name)}</b>${m.dbName !== m.name ? `<span>${esc(m.dbName)}</span>` : ''}${hubLinks.length ? `<u title="Liée aux tables carrefour masquées : ${esc(hubLinks.join(', '))}">→ ${esc(hubLinks.join(' · '))}</u>` : ''}${self.length && !p ? `<i title="Relation vers elle-même : ${esc(self.map((r) => r.field).join(', '))}">↺</i>` : ''}${count != null ? `<em title="Lignes (estimation)">${count >= 1000 ? Math.round(count / 1000) + 'k' : count}</em>` : ''}</div>`;
      for (const { f, fk } of fields) {
        const row = h('div', 'pzd-f' + (f.id ? ' pk' : '') + (fk ? ' fk' : ''));
        row.innerHTML = `<span class="k">${f.id ? '🔑' : fk ? '🔗' : f.unique ? '◆' : ''}</span><span class="n">${esc(f.name)}</span><span class="t">${esc(f.dbType ? f.dbType.replace(/\(.*\)/, '') : f.type)}${f.list ? '[]' : ''}${f.optional ? '?' : ''}</span>`;
        row.title = `${f.name} : ${f.type}${f.list ? '[]' : ''}${f.optional ? '?' : ''}${f.dbType ? ` @db.${f.dbType}` : ''}${f.default != null ? `\ndéfaut : ${f.default}` : ''}${f.dbName ? `\ncolonne : ${f.dbName}` : ''}${f.doc ? `\n${f.doc}` : ''}`;
        el.appendChild(row);
      }
      el.addEventListener('mouseenter', () => highlight(m.name));
      el.addEventListener('mouseleave', () => highlight(null));
      el.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;
        e.stopPropagation(); e.preventDefault();
        vp.focus({ preventScroll: true });
        pressElement(e, tk(m.name), () => {
          if (plan()) return;
          // Vue automatique : un simple clic recentre (après un éventuel double-clic)
          clearTimeout(st.clickTimer);
          st.clickTimer = setTimeout(() => {
            if (st.mode === 'all') { st.focus = m.name; world.querySelectorAll('.pzd-node.focus').forEach((x) => x.classList.remove('focus')); el.classList.add('focus'); changed(); }
            else if (m.name !== st.focus) { st.focus = m.name; render(); changed(); }
          }, 260);
        });
      });
      el.addEventListener('dblclick', () => { clearTimeout(st.clickTimer); st.onOpen?.(m.name); });
      el.addEventListener('contextmenu', (e) => {
        e.preventDefault(); e.stopPropagation();
        if (st.sel.has(tk(m.name)) && st.sel.size > 1) { selectionMenu(null, e); return; }
        setSel([tk(m.name)]);
        const pl = plan();
        UI.menu([
          { title: m.name },
          { label: 'Ouvrir la fiche du modèle', icon: '▤', action: () => st.onOpen?.(m.name) },
          ...(!pl ? [{ label: 'Centrer sur cette table', icon: '◎', action: () => { st.focus = m.name; if (st.mode === 'all') centerOn(m.name); else render(); changed(); } }] : []),
          '-',
          { label: st.doc.icons[m.name] ? 'Changer l\'icône…' : 'Ajouter une icône…', icon: esc(st.doc.icons[m.name] || '😀'), action: () => iconForTables([m.name], e.clientX, e.clientY) },
          { label: 'Couleur', icon: '🎨', submenu: colorItems(st.doc.colors[m.name], (c) => colorForSelection(c)) },
          '-',
          ...(pl ? [
            { label: 'Ajouter les tables liées', icon: '✚', action: () => addNeighbors([m.name]) },
            { label: 'Retirer du plan', icon: '🙈', hint: 'Suppr', action: removeSelection },
          ] : [
            { label: 'Masquer cette table', icon: '🙈', hint: 'Suppr', action: () => hideTables([m.name]) },
            { label: 'Créer un plan avec cette vue…', icon: '✎', action: () => newPlan() },
          ]),
        ], e.clientX, e.clientY);
      });
      return el;
    }

    function itemEl(it) {
      const el = h('div', `pzd-item pzd-${it.type}`);
      el.dataset.id = it.id;
      el.style.left = `${it.x}px`; el.style.top = `${it.y}px`;
      el.style.width = `${it.w}px`; el.style.height = `${it.h}px`;
      if (it.color) el.style.setProperty('--ic', it.color);
      if (it.type === 'title') { const t = h('div', 'txt'); t.textContent = it.text || ''; t.style.fontSize = `${Math.max(10, it.h * 0.6)}px`; el.appendChild(t); }
      else if (it.type === 'note' || it.type === 'frame') { const t = h('div', 'txt'); t.textContent = it.text || ''; el.appendChild(t); }
      else if (it.type === 'icon') { const t = h('div', 'txt'); t.textContent = it.text || '⭐'; t.style.fontSize = `${it.h * 0.78}px`; el.appendChild(t); }
      else if (it.type === 'image') {
        const url = st.assets[it.src];
        if (url) { const img = h('img'); img.src = url; img.draggable = false; img.alt = it.text || ''; el.appendChild(img); }
        else el.appendChild(h('div', 'txt missing', 'Image introuvable'));
      }
      const handle = h('div', 'pzd-resize');
      el.appendChild(handle);
      el.addEventListener('mousedown', (e) => {
        if (e.button !== 0 || e.target.isContentEditable) return;
        e.stopPropagation(); e.preventDefault();
        vp.focus({ preventScroll: true });
        if (e.target === handle) {
          setSel([ik(it.id)]);
          let saved = false;
          const s = { w: it.w, h: it.h };
          const ratio = it.type === 'image' || it.type === 'icon' ? s.h / s.w : null;
          startDrag(e, (dx, dy) => {
            if (!saved) { checkpoint(); saved = true; }
            it.w = Math.max(it.type === 'icon' ? 20 : 40, snap(s.w + dx / st.k));
            it.h = ratio ? Math.round(it.w * ratio) : Math.max(20, snap(s.h + dy / st.k));
            el.style.width = `${it.w}px`; el.style.height = `${it.h}px`;
            const t = el.querySelector('.txt');
            if (t && it.type === 'title') t.style.fontSize = `${Math.max(10, it.h * 0.6)}px`;
            if (t && it.type === 'icon') t.style.fontSize = `${it.h * 0.78}px`;
          }, (moved) => { if (moved) save(); });
          return;
        }
        pressElement(e, ik(it.id));
      });
      el.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        if (it.type === 'icon') { pickEmoji(e.clientX, e.clientY, it.text).then((em) => { if (em) { checkpoint(); it.text = em; render(false); save(); } }); return; }
        if (it.type !== 'image') editText(it.id);
      });
      el.addEventListener('contextmenu', (e) => {
        e.preventDefault(); e.stopPropagation();
        if (st.sel.has(ik(it.id)) && st.sel.size > 1) { selectionMenu(null, e); return; }
        setSel([ik(it.id)]);
        const p = plan();
        const front = () => { checkpoint(); p.items = p.items.filter((x) => x !== it); p.items.push(it); render(false); save(); };
        const back = () => { checkpoint(); p.items = p.items.filter((x) => x !== it); p.items.unshift(it); render(false); save(); };
        UI.menu([
          ...(it.type === 'title' || it.type === 'note' || it.type === 'frame' ? [{ label: 'Modifier le texte', icon: '✎', action: () => editText(it.id) }] : []),
          ...(it.type === 'icon' ? [{ label: 'Changer l\'icône…', icon: esc(it.text || ''), action: () => pickEmoji(e.clientX, e.clientY, it.text).then((em) => { if (em) { checkpoint(); it.text = em; render(false); save(); } }) }] : []),
          ...(it.type !== 'image' && it.type !== 'icon' ? [{ label: 'Couleur', icon: '🎨', submenu: colorItems(it.color, (c) => { checkpoint(); it.color = c; render(false); save(); }, it.type === 'title') }] : []),
          ...(it.type === 'image' ? [{ label: 'Taille d\'origine (max 800 px)', icon: '⤢', action: async () => { const sz = await imageSize(st.assets[it.src]); const s = Math.min(1, 800 / Math.max(sz.w, sz.h)); checkpoint(); it.w = Math.round(sz.w * s); it.h = Math.round(sz.h * s); render(false); save(); } }] : []),
          { label: 'Premier plan', icon: '⬆', action: front },
          { label: 'Arrière-plan', icon: '⬇', action: back },
          { label: 'Dupliquer', icon: '⧉', hint: 'Ctrl+D', action: duplicateSelection },
          '-',
          { label: 'Supprimer', icon: '🗑', hint: 'Suppr', action: removeSelection },
        ], e.clientX, e.clientY);
      });
      return el;
    }

    function editText(id) {
      const p = plan();
      const it = p?.items.find((x) => x.id === id);
      const el = world.querySelector(`.pzd-item[data-id="${CSS.escape(id)}"] .txt`);
      if (!it || !el) return;
      setSel([ik(id)]);
      const before = it.text;
      el.contentEditable = 'plaintext-only';
      el.classList.add('editing');
      el.focus();
      const range = document.createRange();
      range.selectNodeContents(el);
      const sel = getSelection(); sel.removeAllRanges(); sel.addRange(range);
      const done = (keep) => {
        el.removeEventListener('blur', onBlur);
        el.removeEventListener('keydown', onKey);
        el.contentEditable = 'false';
        el.classList.remove('editing');
        const txt = keep ? el.innerText.replace(/\n$/, '') : before;
        if (txt !== before) { checkpoint(); it.text = txt; save(); }
        el.textContent = it.text;
        vp.focus({ preventScroll: true });
      };
      const onBlur = () => done(true);
      const onKey = (e) => {
        e.stopPropagation();
        if (e.key === 'Escape') done(false);
        else if (e.key === 'Enter' && (it.type === 'title' || it.type === 'frame' || e.ctrlKey)) { e.preventDefault(); done(true); }
      };
      el.addEventListener('blur', onBlur);
      el.addEventListener('keydown', onKey);
    }

    function highlight(name) {
      world.classList.toggle('hl', !!name);
      const near = new Set(name ? [name] : []);
      svg.querySelectorAll('g.pzd-e').forEach((e) => {
        const on = !!name && (e.dataset.from === name || e.dataset.to === name);
        e.classList.toggle('on', on);
        if (on) { near.add(e.dataset.from); near.add(e.dataset.to); svg.appendChild(e); }
      });
      world.querySelectorAll('.pzd-node').forEach((n) => n.classList.toggle('on', near.has(n.dataset.name)));
    }

    function goTo(name) {
      const p = plan();
      if (p) {
        if (!p.tables[name]) { UI.toast(`${name} n'est pas dans ce plan — « Tables… » pour l'ajouter`); return; }
        centerOn(name); setSel([tk(name)]);
        return;
      }
      st.focus = name;
      if (st.doc.hidden.includes(name)) st.doc.hidden = st.doc.hidden.filter((x) => x !== name);
      if (st.mode === 'all') { render(); centerOn(name); } else render();
      changed();
    }
    const changed = () => st.onChange?.({ focus: st.focus, mode: st.mode, depth: st.depth, cols: st.cols, showHubs: st.showHubs, plan: st.planId });

    return {
      async setInfo(info) {
        st.info = info;
        st.rels = relations(info);
        // Tables carrefour : reliées à beaucoup de tables, leurs liens sont masqués par défaut
        const nb = new Map();
        const link = (a, b) => { if (a === b) return; if (!nb.has(a)) nb.set(a, new Set()); nb.get(a).add(b); };
        for (const r of st.rels) { link(r.from, r.to); link(r.to, r.from); }
        const deg = new Map([...nb].map(([k, v]) => [k, v.size]));
        const limit = Math.max(12, Math.round(info.models.length * 0.12));
        st.hubs = new Set([...deg].filter(([, n]) => n >= limit).sort((a, b) => b[1] - a[1]).map(([k]) => k));
        st.hubText.textContent = `Tables carrefour (${[...st.hubs].join(', ')})`;
        st.hubBox.title = `Tables reliées à ${limit} tables ou plus : leurs liens sont masqués pour garder le diagramme lisible.`;
        if (!st.focus || !info.models.some((m) => m.name === st.focus)) {
          st.focus = [...deg.entries()].filter(([k]) => !st.hubs.has(k)).sort((a, b) => b[1] - a[1])[0]?.[0] || info.models[0]?.name || null;
        }
        st.dl.innerHTML = info.models.map((m) => `<option value="${esc(m.name)}">`).join('');
        try {
          const r = await st.store?.load();
          if (r?.data) st.doc = { version: 1, hidden: [], icons: {}, colors: {}, plans: [], ...r.data };
          st.assets = r?.assets || {};
        } catch {}
        for (const pl of st.doc.plans) { pl.tables = pl.tables || {}; pl.items = pl.items || []; }
        fillModes();
        render(true);
      },
      setCounts(tables) { st.counts = new Map((tables || []).map((t) => [t.name, t.estimate])); render(false); },
      focus(name) {
        if (!name) { requestAnimationFrame(fit); return; }
        if (plan()) { goTo(name); return; }
        if (name !== st.focus) { st.focus = name; render(); } else requestAnimationFrame(fit);
      },
      fit,
    };
  }

  window.PrismaDiagram = { create, relations };
})();
