// RobotConsole — langues de l'interface
// Le code de l'app écrit ses textes en français. Quand une autre langue est choisie, ce module traduit
// l'interface au moment où elle s'affiche : textes, infobulles (title), placeholders, aria-label…
// Le dictionnaire (i18n-en.js) associe chaque texte français à sa traduction ; {0}, {1}… y marquent
// les parties variables (noms, nombres). Les contenus de l'utilisateur ne sont jamais touchés :
// terminaux, éditeur, aperçus de fichiers, données SQL, journaux…
(function () {
  const DICTS = { en: window.I18N_EN || {} };
  const LANGS = [['auto', 'Automatique (langue du système)'], ['fr', 'Français'], ['en', 'English']];
  const ATTRS = ['title', 'placeholder', 'aria-label', 'alt', 'label'];
  // Zones dont le contenu appartient à l'utilisateur
  const SKIP_ATTR = '.xterm, .monaco-editor, pre, code, script, style, iframe, webview, .pv-body, .pv-md, .markdown, .pz-grid tbody, .dk-log, .gf-log, .tt-out, [data-no-i18n]';
  // Texte d'un textarea (saisi par l'utilisateur) et noms de fichiers de l'explorateur : seuls leurs attributs sont traduits
  const SKIP = SKIP_ATTR + ', textarea, .ex-name, .ex-sub';
  const STORE_KEY = 'rc-lang';

  let lang = 'fr';
  let exact = new Map(), lower = new Map(), buckets = new Map(), loose = [];
  const cache = new Map();
  const orig = new WeakMap();   // nœud texte → texte français d'origine
  const shown = new WeakMap();  // nœud texte → dernière traduction posée
  const attrOrig = new WeakMap(); // élément → { attr: { fr, out } }
  let observer = null;

  const resolve = (pref) => (pref === 'fr' || pref === 'en' ? pref : ((navigator.language || 'fr').toLowerCase().startsWith('fr') ? 'fr' : 'en'));

  function build() {
    exact = new Map(); lower = new Map(); buckets = new Map(); loose = []; cache.clear();
    const d = DICTS[lang];
    if (!d) return;
    for (const [k, v] of Object.entries(d)) {
      if (!/\{\d+\}/.test(k)) { exact.set(k, v); lower.set(k.toLowerCase(), v); continue; }
      const pieces = k.split(/\{(\d+)\}/);
      const literal = pieces.filter((_, i) => i % 2 === 0).join('');
      // Trop vague pour être reconnu sans risque (« {0} de {1} » traduirait n'importe quelle phrase)
      if ((literal.match(/[A-Za-zÀ-ÿ]/g) || []).length < 4) continue;
      const order = [];
      let src = '^';
      pieces.forEach((p, i) => {
        if (i % 2) { order.push(+p); src += '([\\s\\S]*?)'; } else src += p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      });
      const pat = { re: new RegExp(src + '$'), order, out: v };
      const head = pieces[0];
      if (head.length >= 2) {
        const b = head.slice(0, 2);
        if (!buckets.has(b)) buckets.set(b, []);
        buckets.get(b).push(pat);
      } else loose.push(pat);
    }
  }

  // Une partie variable peut elle-même être un texte connu (« Animer : tête »)
  function word(s, depth) {
    if (exact.has(s)) return exact.get(s);
    const l = lower.get(s.toLowerCase());
    if (l != null) return s === s.toLowerCase() ? l.toLowerCase() : l;
    if (depth < 1 && /[A-Za-zÀ-ÿ]/.test(s)) return translateCore(s, depth + 1) ?? s;
    return s;
  }

  function translateCore(core, depth = 0) {
    if (exact.has(core)) return exact.get(core);
    const tryPats = (list) => {
      if (!list) return null;
      for (const p of list) {
        const m = p.re.exec(core);
        if (!m) continue;
        const args = [];
        p.order.forEach((n, i) => { args[n] = word(m[i + 1], depth); });
        return p.out.replace(/\{(\d+)\}/g, (_, n) => args[n] ?? '');
      }
      return null;
    };
    return tryPats(buckets.get(core.slice(0, 2))) ?? tryPats(loose);
  }

  // Traduit une chaîne (garde les espaces autour) ; renvoie la chaîne telle quelle si inconnue
  function t(s, ...vars) {
    if (vars.length) s = s.replace(/\{(\d+)\}/g, (_, n) => vars[n] ?? '');
    if (lang === 'fr' || typeof s !== 'string' || !/[A-Za-zÀ-ÿ]/.test(s)) return s;
    if (cache.has(s)) return cache.get(s);
    const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(s);
    const core = m[2].replace(/\s+/g, ' ');
    const tr = translateCore(core);
    const res = tr == null ? s : m[1] + tr + m[3];
    if (cache.size > 6000) cache.clear();
    cache.set(s, res);
    return res;
  }
  // Pour le code : texte français + variables → texte dans la langue choisie
  function tf(fr, ...vars) {
    if (lang === 'fr') return fr.replace(/\{(\d+)\}/g, (_, n) => vars[n] ?? '');
    const tr = translateCore(fr);
    const out = tr == null ? fr : tr;
    return out.replace(/\{(\d+)\}/g, (_, n) => vars[n] ?? '');
  }

  // ---------- Traduction du DOM ----------
  const skipped = (el) => !!el?.closest?.(SKIP);
  const skippedAttr = (el) => !!el?.closest?.(SKIP_ATTR);

  function doText(node) {
    const cur = node.data;
    let fr = cur;
    if (shown.get(node) === cur) fr = orig.get(node) ?? cur; // déjà traduit par nous
    const out = lang === 'fr' ? fr : t(fr);
    orig.set(node, fr);
    shown.set(node, out);
    if (out !== cur) node.data = out;
  }

  function doAttrs(el) {
    let memo = attrOrig.get(el);
    for (const a of ATTRS) {
      if (!el.hasAttribute(a)) continue;
      const cur = el.getAttribute(a);
      const m = memo?.[a];
      const fr = m && m.out === cur ? m.fr : cur;
      const out = lang === 'fr' ? fr : t(fr);
      if (!memo) { memo = {}; attrOrig.set(el, memo); }
      memo[a] = { fr, out };
      if (out !== cur) el.setAttribute(a, out);
    }
  }

  function walk(root) {
    if (root.nodeType === 3) { if (!skipped(root.parentElement)) doText(root); return; }
    if (root.nodeType !== 1 && root.nodeType !== 11) return;
    if (root.nodeType === 1) { if (skippedAttr(root)) return; doAttrs(root); if (skipped(root)) return; }
    const tw = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => {
        if (n.nodeType !== 1 || !n.matches(SKIP)) return NodeFilter.FILTER_ACCEPT;
        if (!n.matches(SKIP_ATTR)) doAttrs(n); // textarea : seulement son placeholder
        return NodeFilter.FILTER_REJECT;
      },
    });
    let n = tw.nextNode();
    while (n) {
      if (n.nodeType === 3) { if (/[A-Za-zÀ-ÿ]/.test(n.data)) doText(n); } else doAttrs(n);
      n = tw.nextNode();
    }
  }

  function onMutations(list) {
    for (const m of list) {
      if (m.type === 'childList') { for (const n of m.addedNodes) walk(n); }
      else if (m.type === 'characterData') { if (shown.get(m.target) !== m.target.data && !skipped(m.target.parentElement)) doText(m.target); }
      else if (m.type === 'attributes') {
        const memo = attrOrig.get(m.target)?.[m.attributeName];
        if (memo && memo.out === m.target.getAttribute(m.attributeName)) continue;
        if (!skippedAttr(m.target)) doAttrs(m.target);
      }
    }
  }

  function start() {
    if (!observer) observer = new MutationObserver(onMutations);
    observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  }

  // Change de langue : retraduit (ou rétablit le français) toute la page
  function setLang(pref) {
    const next = resolve(pref);
    try { localStorage.setItem(STORE_KEY, pref || 'auto'); } catch {}
    const changed = next !== lang;
    lang = next;
    document.documentElement.lang = lang;
    build();
    if (lang !== 'fr') start();
    if (changed && document.body) { observer?.disconnect(); walk(document.body); if (lang !== 'fr') start(); }
    if (changed) for (const cb of listeners) { try { cb(lang); } catch {} }
  }
  const listeners = [];

  // Langue connue dès le chargement (avant les réglages) pour éviter un flash de français
  let initial = 'auto';
  try { initial = localStorage.getItem(STORE_KEY) || 'auto'; } catch {}
  lang = resolve(initial);
  document.documentElement.lang = lang;
  build();
  if (lang !== 'fr') {
    start();
    const first = () => walk(document.body);
    if (document.body) first(); else document.addEventListener('DOMContentLoaded', first, { once: true });
  }

  window.I18n = { t: tf, translate: t, setLang, get lang() { return lang; }, LANGS, onChange: (cb) => listeners.push(cb) };
})();
