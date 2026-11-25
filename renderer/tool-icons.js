// RobotConsole — catalogue des outils que le robot tient à côté de lui (devicon, simple-icons, lucide).
// Les données viennent de tool-icons-data.js (généré par scripts/build-tool-icons.js).
(function () {
  const D = window.ToolIconData || { cats: [], aliases: {}, icons: [] };
  const byId = new Map(D.icons.map((i) => [i.id, i]));
  const DEVICON = '../node_modules/devicon/icons/';
  const norm = (value) => value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const searchText = new Map(D.icons.map((icon) => [icon.id, norm(`${icon.kw} ${icon.label}`)]));
  const esc = (value) => value.replace(/[&<>]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[character]));

  function get(id) {
    if (!id || id === 'none') return null;
    return byId.get(id) || byId.get(D.aliases[id]) || null;
  }

  // Contenu SVG de l'icône dans un carré (x, y, taille), pour l'insérer dans un autre SVG
  function inner(it, x, y, size, ink = '#2b2f38') {
    if (it.emoji) return `<text x="${x + size / 2}" y="${y + size / 2}" text-anchor="middle" dominant-baseline="central" font-size="${size * 0.86}" font-family="Segoe UI Emoji, Apple Color Emoji, Noto Color Emoji, sans-serif">${esc(it.emoji)}</text>`;
    if (it.src) return `<image href="${DEVICON}${it.src}" x="${x}" y="${y}" width="${size}" height="${size}" preserveAspectRatio="xMidYMid meet"/>`;
    if (it.path) return `<svg x="${x}" y="${y}" width="${size}" height="${size}" viewBox="0 0 24 24"><path fill="${it.color}" d="${it.path}"/></svg>`;
    return `<svg x="${x}" y="${y}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${ink}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${it.body}</svg>`;
  }

  // Outil tenu par le robot : une plaquette claire avec le logo (poignée en (0,0), vers le haut)
  function robotSvg(id, c = {}) {
    const it = get(id);
    if (!it) return '';
    const ink = it.body ? (c.dark2 || '#2b2f38') : undefined;
    return `<rect x="-15" y="-32" width="30" height="30" rx="7" fill="#f7f8fb" stroke="${c.stroke || '#4a5263'}" stroke-width="1.6"/>${inner(it, -11, -28, 22, ink)}`;
  }

  // Icône seule (pour les listes)
  function html(id) {
    const it = get(id);
    if (!it) return '';
    if (it.src) return `<img src="${DEVICON}${it.src}" alt="" loading="lazy" draggable="false">`;
    return `<svg viewBox="0 0 24 24" aria-hidden="true">${inner(it, 0, 0, 24)}</svg>`;
  }

  function search(q, cat) {
    const words = norm(q || '').trim().split(/\s+/).filter(Boolean);
    const emojis = words.length && (!cat || cat === 'emoji') && window.EmojiPicker
      ? new Set(window.EmojiPicker.search(q).map((emoji) => emoji[0])) : null;
    return D.icons.filter((icon) => (!cat || icon.cat === cat) &&
      ((icon.emoji && emojis?.has(icon.emoji)) || words.every((word) => searchText.get(icon.id).includes(word))));
  }

  window.ToolIcons = { get, robotSvg, html, search, cats: D.cats, all: D.icons, label: (id) => get(id)?.label || '' };
})();
