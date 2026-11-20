// RobotConsole — disposition des espaces en arbre (découpes redimensionnables) + ancrage par glisser-déposer
// Nœud : { t: 'leaf', id } | { t: 'split', dir: 'row'|'col', children: [...], sizes: [...] }
(function () {
  const { h } = UI;
  let tree = null;
  let host = null;
  let hooks = null; // { getSpace(id), onChange(), visibleIds() }

  const leaf = (id) => ({ t: 'leaf', id });
  const split = (dir, children, sizes) => ({ t: 'split', dir, children, sizes: sizes || children.map(() => 1) });

  function init(container, h_) { host = container; hooks = h_; }

  // ---------- Opérations sur l'arbre ----------
  function leaves(n = tree, out = []) {
    if (!n) return out;
    if (n.t === 'leaf') out.push(n.id);
    else n.children.forEach((c) => leaves(c, out));
    return out;
  }
  function has(id) { return leaves().includes(id); }

  function findParent(id, n = tree, parent = null) {
    if (!n) return null;
    if (n.t === 'leaf') return n.id === id ? { node: n, parent } : null;
    for (const c of n.children) { const r = findParent(id, c, n); if (r) return r; }
    return null;
  }

  function normalize(n) {
    if (!n) return null;
    if (n.t === 'leaf') return n;
    let kids = [], sizes = [];
    n.children.forEach((c, i) => {
      const nc = normalize(c);
      if (!nc) return;
      if (nc.t === 'split' && nc.dir === n.dir) {
        const tot = nc.sizes.reduce((a, b) => a + b, 0);
        nc.children.forEach((cc, j) => { kids.push(cc); sizes.push(n.sizes[i] * nc.sizes[j] / tot); });
      } else { kids.push(nc); sizes.push(n.sizes[i] ?? 1); }
    });
    if (!kids.length) return null;
    if (kids.length === 1) return kids[0];
    const tot = sizes.reduce((a, b) => a + b, 0);
    return split(n.dir, kids, sizes.map((s) => (s / tot) * kids.length));
  }

  function remove(id) {
    const f = findParent(id);
    if (!f) return;
    if (!f.parent) tree = null;
    else {
      const i = f.parent.children.indexOf(f.node);
      f.parent.children.splice(i, 1);
      f.parent.sizes.splice(i, 1);
    }
    tree = normalize(tree);
  }

  const SIDE = { left: ['row', 0], right: ['row', 1], top: ['col', 0], bottom: ['col', 1] };

  // Ancre « id » sur un côté de « targetId » (ou de la fenêtre si targetId est null)
  function dock(id, targetId, side) {
    if (targetId === id) return;
    if (side === 'center') return swap(id, targetId);
    remove(id);
    const [dir, after] = SIDE[side];
    const nl = leaf(id);
    if (!tree) { tree = nl; return; }
    if (!targetId || !has(targetId)) {
      // Bord de la fenêtre
      if (tree.t === 'split' && tree.dir === dir) {
        const avg = tree.sizes.reduce((a, b) => a + b, 0) / tree.sizes.length;
        if (after) { tree.children.push(nl); tree.sizes.push(avg); } else { tree.children.unshift(nl); tree.sizes.unshift(avg); }
      } else tree = split(dir, after ? [tree, nl] : [nl, tree]);
      tree = normalize(tree);
      return;
    }
    const f = findParent(targetId);
    if (f.parent && f.parent.dir === dir) {
      const i = f.parent.children.indexOf(f.node);
      const half = f.parent.sizes[i] / 2;
      f.parent.sizes[i] = half;
      f.parent.children.splice(i + after, 0, nl);
      f.parent.sizes.splice(i + after, 0, half);
    } else {
      const ns = split(dir, after ? [f.node, nl] : [nl, f.node]);
      if (!f.parent) tree = ns;
      else f.parent.children[f.parent.children.indexOf(f.node)] = ns;
    }
    tree = normalize(tree);
  }

  function swap(a, b) {
    const fa = findParent(a), fb = findParent(b);
    if (!fa || !fb) return;
    fa.node.id = b;
    fb.node.id = a;
  }

  // Ajoute un espace : à côté de l'espace actif, dans la direction où il y a le plus de place
  function add(id, nearId) {
    if (has(id)) return;
    if (!tree) { tree = leaf(id); return; }
    const near = nearId && has(nearId) ? hooks.getSpace(nearId)?.el : null;
    if (near && near.isConnected) {
      const wide = near.offsetWidth > near.offsetHeight * 1.25;
      dock(id, nearId, wide ? 'right' : 'bottom');
    } else dock(id, null, host.offsetWidth > host.offsetHeight ? 'right' : 'bottom');
  }

  // ---------- Sérialisation (identifiants -> index) ----------
  // serialize / deserialize : pour n'importe quel arbre (un par écran)
  function serialize(t, idToIndex) {
    const conv = (n) => (n.t === 'leaf' ? { t: 'leaf', i: idToIndex(n.id) } : { t: 'split', dir: n.dir, sizes: n.sizes.map((s) => +s.toFixed(4)), children: n.children.map(conv) });
    return t ? conv(t) : null;
  }
  function deserialize(json, indexToId) {
    const conv = (n) => {
      if (!n) return null;
      if (n.t === 'leaf') { const id = indexToId(n.i); return id ? leaf(id) : null; }
      return split(n.dir, n.children.map(conv), n.sizes);
    };
    return normalize(conv(json));
  }
  function toJSON(idToIndex) { return serialize(tree, idToIndex); }
  function fromJSON(json, indexToId) { tree = deserialize(json, indexToId); }
  function set(t) { tree = normalize(t); }

  // ---------- Rendu ----------
  function render(maximizedId) {
    host.querySelectorAll(':scope > .split, :scope > .space').forEach((e) => e.remove());
    if (maximizedId) {
      const s = hooks.getSpace(maximizedId);
      s.el.style.flex = '1 1 0px';
      host.appendChild(s.el);
      return;
    }
    if (!tree) return;
    host.appendChild(build(tree, null));
  }

  function build(n, parent) {
    if (n.t === 'leaf') {
      const s = hooks.getSpace(n.id);
      return s.el;
    }
    const el = h('div', `split ${n.dir}`);
    n.children.forEach((c, i) => {
      if (i > 0) el.appendChild(gutter(n, i));
      const child = build(c, n);
      child.style.flex = `${n.sizes[i]} 1 0px`;
      el.appendChild(child);
    });
    return el;
  }

  function gutter(n, i) {
    const g = h('div', `gutter ${n.dir}`);
    g.innerHTML = '<span></span>';
    g.addEventListener('mousedown', (e) => {
      e.preventDefault();
      const horiz = n.dir === 'row';
      const prev = g.previousElementSibling, next = g.nextElementSibling;
      const pa = horiz ? prev.offsetWidth : prev.offsetHeight;
      const pb = horiz ? next.offsetWidth : next.offsetHeight;
      const start = horiz ? e.clientX : e.clientY;
      const total = n.sizes[i - 1] + n.sizes[i];
      g.classList.add('dragging');
      document.body.classList.add(horiz ? 'resizing-x' : 'resizing-y');
      const move = (ev) => {
        const d = (horiz ? ev.clientX : ev.clientY) - start;
        const na = Math.min(Math.max(pa + d, 140), pa + pb - 140);
        n.sizes[i - 1] = (total * na) / (pa + pb);
        n.sizes[i] = total - n.sizes[i - 1];
        prev.style.flex = `${n.sizes[i - 1]} 1 0px`;
        next.style.flex = `${n.sizes[i]} 1 0px`;
      };
      const up = () => {
        g.classList.remove('dragging');
        document.body.classList.remove('resizing-x', 'resizing-y');
        removeEventListener('mousemove', move);
        removeEventListener('mouseup', up);
        hooks.onChange();
      };
      addEventListener('mousemove', move);
      addEventListener('mouseup', up);
    });
    g.addEventListener('dblclick', () => {
      const t = n.sizes[i - 1] + n.sizes[i];
      n.sizes[i - 1] = n.sizes[i] = t / 2;
      hooks.onChange(true);
    });
    return g;
  }

  function equalize(n = tree) {
    if (!n || n.t === 'leaf') return;
    n.sizes = n.children.map(() => 1);
    n.children.forEach((c) => equalize(c));
  }

  // ---------- Dispositions suggérées ----------
  function presets(ids) {
    const n = ids.length;
    const L = ids.map(leaf);
    const out = [];
    if (!n) return out;
    out.push({ id: 'cols', name: 'Colonnes', tree: n > 1 ? split('row', L) : L[0] });
    if (n > 1) out.push({ id: 'rows', name: 'Lignes', tree: split('col', L) });
    if (n > 2) {
      const cols = Math.ceil(Math.sqrt(n));
      const rows = [];
      for (let i = 0; i < n; i += cols) rows.push(L.slice(i, i + cols));
      out.push({ id: 'grid', name: 'Grille', tree: split('col', rows.map((r) => (r.length > 1 ? split('row', r) : r[0]))) });
    }
    if (n > 1) {
      const rest = L.slice(1);
      const side = rest.length > 1 ? split('col', rest) : rest[0];
      out.push({ id: 'main-left', name: 'Principal + côté', tree: split('row', [L[0], side], [1.7, 1]) });
      const bottom = rest.length > 1 ? split('row', rest) : rest[0];
      out.push({ id: 'main-top', name: 'Principal + bas', tree: split('col', [L[0], bottom], [1.8, 1]) });
    }
    if (n > 2) {
      const rest = L.slice(1);
      const a = rest.slice(0, Math.ceil(rest.length / 2)), b = rest.slice(Math.ceil(rest.length / 2));
      const col = (x) => (x.length > 1 ? split('col', x) : x[0]);
      out.push({ id: 'center', name: 'Focus central', tree: split('row', [col(a), L[0], col(b)], [1, 2.2, 1]) });
      const right = L.slice(2);
      out.push({ id: 'ide', name: 'Style IDE', tree: split('row', [L[1], split('col', [L[0], right.length > 1 ? split('row', right) : right[0]], [2.2, 1])], [1, 3]) });
    }
    return out;
  }

  // Vignette d'une disposition (blocs colorés aux couleurs des robots)
  function thumbnail(t) {
    const make = (n) => {
      if (n.t === 'leaf') {
        const s = hooks.getSpace(n.id);
        const b = h('div', 'lt-leaf');
        b.style.setProperty('--c', s ? Themes.spaceAccent(s.bot) : 'var(--accent)');
        if (s) b.innerHTML = `<div class="robot">${s.bot.svg}</div>`;
        return b;
      }
      const d = h('div', `lt-split ${n.dir}`);
      n.children.forEach((c, i) => { const e = make(c); e.style.flex = `${n.sizes[i]} 1 0px`; d.appendChild(e); });
      return d;
    };
    const wrap = h('div', 'lt-thumb');
    wrap.appendChild(make(t));
    return wrap;
  }

  // ---------- Ancrage par glisser-déposer ----------
  let dragId = null;
  let dragMode = 'space'; // 'space' : déplacer un espace · 'tab' : déplacer un onglet
  let zone = null; // { targetId, side }
  let layer = null, preview = null, compass = null, edges = null;

  function beginDrag(id, opts = {}) {
    dragId = id;
    dragMode = opts.mode || 'space';
    zone = null;
    const s = hooks.getSpace(id);
    layer = h('div', 'dock-layer' + (dragMode === 'tab' ? ' tab-mode' : ''));
    preview = h('div', 'dock-preview hidden');
    preview.innerHTML = dragMode === 'tab'
      ? `<div class="dp-inner"><div class="dp-tab">${opts.icon || ''}<span>${UI.esc(opts.label || 'Onglet')}</span></div><span class="dp-label"></span></div>`
      : `<div class="dp-inner"><div class="robot">${s.bot.svg}</div><span class="dp-label"></span></div>`;
    preview.style.setProperty('--c', Themes.spaceAccent(s.bot));
    compass = h('div', 'dock-compass hidden');
    for (const side of ['top', 'left', 'center', 'right', 'bottom']) {
      const b = h('div', `dc-btn dc-${side}`, `<i></i>`);
      b.dataset.side = side;
      b.title = side === 'center' ? 'Échanger' : 'Ancrer ici';
      b.addEventListener('dragover', (e) => { e.preventDefault(); e.stopPropagation(); setZone(compass.dataset.target, side); });
      b.addEventListener('drop', (e) => { e.preventDefault(); e.stopPropagation(); drop(); });
      compass.appendChild(b);
    }
    edges = ['left', 'right', 'top', 'bottom'].map((side) => {
      const e = h('div', `dock-edge de-${side}`, '<i></i>');
      e.addEventListener('dragover', (ev) => { ev.preventDefault(); ev.stopPropagation(); setZone(null, side); });
      e.addEventListener('drop', (ev) => { ev.preventDefault(); ev.stopPropagation(); drop(); });
      return e;
    });
    layer.append(preview, compass, ...edges);
    host.appendChild(layer);
    requestAnimationFrame(() => layer?.classList.add('on'));
  }

  function endDrag() {
    layer?.remove();
    layer = preview = compass = edges = null;
    dragId = null;
    zone = null;
  }

  // Survol d'un espace pendant le glisser : zone selon la position du pointeur
  function overSpace(targetId, e) {
    if (!dragId || !layer) return;
    const s = hooks.getSpace(targetId);
    const r = s.el.getBoundingClientRect();
    const hr = host.getBoundingClientRect();
    compass.dataset.target = targetId;
    compass.classList.remove('hidden');
    compass.style.left = `${r.left - hr.left + r.width / 2}px`;
    compass.style.top = `${r.top - hr.top + r.height / 2}px`;
    const self = targetId === dragId;
    compass.querySelector('.dc-center').classList.toggle('disabled', self);
    compass.querySelectorAll('.dc-btn:not(.dc-center)').forEach((b) => b.classList.toggle('disabled', self && dragMode === 'space'));
    if (self && dragMode === 'space') { setZone(null, null); return; }
    const x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
    let side = 'center';
    const d = { left: x, right: 1 - x, top: y, bottom: 1 - y };
    const min = Object.entries(d).sort((a, b) => a[1] - b[1])[0];
    if (min[1] < 0.3) side = min[0];
    if (self && side === 'center') { setZone(null, null); return; }
    setZone(targetId, side);
  }

  function setZone(targetId, side) {
    if (!preview) return;
    const self = targetId && targetId === dragId;
    if (!side || (self && dragMode === 'space') || (self && side === 'center')) {
      zone = null;
      preview.classList.add('hidden');
      return;
    }
    zone = { targetId, side };
    const hr = host.getBoundingClientRect();
    const r = targetId ? hooks.getSpace(targetId).el.getBoundingClientRect() : hr;
    let x = r.left - hr.left, y = r.top - hr.top, w = r.width, hh = r.height;
    const frac = targetId ? 0.5 : 0.3;
    if (side === 'left') w *= frac;
    if (side === 'right') { x += w * (1 - frac); w *= frac; }
    if (side === 'top') hh *= frac;
    if (side === 'bottom') { y += hh * (1 - frac); hh *= frac; }
    Object.assign(preview.style, { left: `${x}px`, top: `${y}px`, width: `${w}px`, height: `${hh}px` });
    const labels = { left: 'à gauche', right: 'à droite', top: 'en haut', bottom: 'en bas' };
    const tname = targetId ? hooks.getSpace(targetId).name : '';
    preview.querySelector('.dp-label').textContent = dragMode === 'tab'
      ? (side === 'center' ? `Dans ${tname}` : targetId ? `Nouvel espace ${labels[side]} de ${tname}` : `Nouvel espace tout ${labels[side]}`)
      : side === 'center' ? `Échanger avec ${tname}` : targetId ? `${labels[side]} de ${tname}` : `Tout ${labels[side]} de la fenêtre`;
    preview.classList.remove('hidden');
    compass.querySelectorAll('.dc-btn').forEach((b) => b.classList.toggle('hot', !!targetId && b.dataset.side === side && compass.dataset.target === targetId));
    edges.forEach((e) => e.classList.toggle('hot', !targetId && e.classList.contains(`de-${side}`)));
  }

  function drop() {
    if (!dragId || !zone) { hooks.onDrop?.(null); endDrag(); return; }
    const id = dragId, z = zone, mode = dragMode;
    endDrag();
    hooks.onDrop?.({ id, mode, ...z });
  }

  function clearZone() {
    if (!preview) return;
    zone = null;
    preview.classList.add('hidden');
    compass?.classList.add('hidden');
  }

  window.Layout = {
    init, add, remove, dock, swap, has, leaves, equalize, presets, thumbnail, toJSON, fromJSON, serialize, deserialize, set, render,
    beginDrag, endDrag, overSpace, drop, clearZone,
    get dragging() { return dragId; },
    get tree() { return tree; },
  };
})();
