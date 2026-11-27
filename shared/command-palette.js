(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PaletteModel = factory();
})(typeof window === 'object' ? window : globalThis, function () {
  const normalize = (value) => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\\/g, '/').toLowerCase();
  function score(value, query) {
    const text = normalize(value), terms = normalize(query).trim().split(/\s+/).filter(Boolean);
    let total = 0;
    for (const term of terms) {
      const at = text.indexOf(term);
      if (at >= 0) { total += at + text.length / 1000; continue; }
      let pos = -1, gaps = 0;
      for (const char of term) {
        const next = text.indexOf(char, pos + 1);
        if (next < 0) return Infinity;
        gaps += next - pos - 1;
        pos = next;
      }
      total += 100 + gaps;
    }
    return total;
  }
  function filter(items, query) {
    return items.map((item, index) => ({ item, index, score: score([item.label, item.detail, item.keywords].filter(Boolean).join(' '), query) }))
      .filter((row) => Number.isFinite(row.score))
      .sort((a, b) => a.score - b.score || a.index - b.index).map((row) => row.item);
  }
  function step(title, items = [], options = {}) {
    return { title, items, query: '', selected: 0, ...options };
  }
  function selection(index, delta, length) {
    return length ? (index + delta + length) % length : 0;
  }
  function shortcut(event, isMac = false) {
    return !!(!event.altKey && event.shiftKey && (event.ctrlKey || (isMac && event.metaKey)) && event.code === 'Space');
  }
  return { normalize, score, filter, step, selection, shortcut };
});
