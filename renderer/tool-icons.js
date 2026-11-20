// RobotConsole — catalogue des outils que le robot tient à côté de lui (devicon, simple-icons, lucide).
// Les données viennent de tool-icons-data.js (généré par scripts/build-tool-icons.js).
(function () {
  const D = window.ToolIconData || { cats: [], aliases: {}, icons: [] };
  const byId = new Map(D.icons.map((i) => [i.id, i]));
  const DEVICON = '../node_modules/devicon/icons/';

  function get(id) {
    if (!id || id === 'none') return null;
    return byId.get(id) || byId.get(D.aliases[id]) || null;
  }

  // Contenu SVG de l'icône dans un carré (x, y, taille), pour l'insérer dans un autre SVG
  function inner(it, x, y, size, ink = '#2b2f38') {
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
    const words = (q || '').toLowerCase().trim().split(/\s+/).filter(Boolean);
    return D.icons.filter((i) => (!cat || i.cat === cat) && words.every((w) => i.kw.includes(w) || i.label.toLowerCase().includes(w)));
  }

  window.ToolIcons = { get, robotSvg, html, search, cats: D.cats, all: D.icons, label: (id) => get(id)?.label || '' };
})();
