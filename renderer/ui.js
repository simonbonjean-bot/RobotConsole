// RobotConsole — composants d'interface partagés : menus contextuels, boîtes de dialogue, notifications
(function () {
  const h = (tag, cls, html) => {
    const el = document.createElement(tag);
    if (cls) el.className = cls;
    if (html != null) el.innerHTML = html;
    return el;
  };
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // ---------- Menus ----------
  // items : [{ label, icon, hint, action, disabled, danger, checked, submenu: [...] } | '-' | { title }]
  let openMenus = [];

  function closeMenus(fromLevel = 0) {
    while (openMenus.length > fromLevel) openMenus.pop().remove();
  }

  function buildMenu(items, level) {
    const m = h('div', 'menu ctx-menu');
    m.tabIndex = -1;
    const buttons = [];
    for (const it of items) {
      if (!it) continue;
      if (it === '-') { if (m.lastChild && !m.lastChild.classList.contains('sep')) m.appendChild(h('div', 'sep')); continue; }
      if (it.title) { m.appendChild(h('div', 'menu-title', esc(it.title))); continue; }
      const b = h('button', 'ctx-item' + (it.danger ? ' danger' : '') + (it.submenu ? ' has-sub' : ''));
      b.disabled = !!it.disabled;
      b.innerHTML = `<span class="ctx-ico">${it.checked ? '✓' : it.icon || ''}</span><span class="ctx-label">${esc(it.label)}</span>` +
        (it.hint ? `<span class="hint">${esc(it.hint)}</span>` : '') + (it.submenu ? '<span class="ctx-arrow">›</span>' : '');
      if (it.submenu) {
        const open = () => {
          closeMenus(level + 1);
          const r = b.getBoundingClientRect();
          showAt(it.submenu, r.right - 2, r.top - 5, level + 1, r.left);
        };
        b.addEventListener('mouseenter', open);
        b.addEventListener('click', open);
      } else {
        b.addEventListener('mouseenter', () => closeMenus(level + 1));
        b.addEventListener('click', () => { closeMenus(0); it.action?.(); });
      }
      buttons.push(b);
      m.appendChild(b);
    }
    if (m.lastChild?.classList.contains('sep')) m.lastChild.remove();
    m.addEventListener('keydown', (e) => {
      const list = buttons.filter((b) => !b.disabled);
      const i = list.indexOf(document.activeElement);
      if (e.key === 'ArrowDown') { (list[i + 1] || list[0])?.focus(); e.preventDefault(); }
      else if (e.key === 'ArrowUp') { (list[i - 1] || list[list.length - 1])?.focus(); e.preventDefault(); }
      else if (e.key === 'ArrowRight' && document.activeElement?.classList.contains('has-sub')) { document.activeElement.click(); openMenus[level + 1]?.querySelector('.ctx-item:not(:disabled)')?.focus(); e.preventDefault(); }
      else if (e.key === 'ArrowLeft' && level > 0) { closeMenus(level); openMenus[level - 1]?.focus(); e.preventDefault(); }
      else if (e.key === 'Escape') { closeMenus(0); e.preventDefault(); }
      e.stopPropagation();
    });
    return m;
  }

  function showAt(items, x, y, level = 0, altX) {
    if (level === 0) closeMenus(0);
    const m = buildMenu(items, level);
    document.body.appendChild(m);
    openMenus[level] = m;
    const w = m.offsetWidth, hgt = m.offsetHeight;
    let left = x, top = y;
    if (left + w > innerWidth - 6) left = altX != null ? altX - w + 2 : innerWidth - w - 6;
    if (top + hgt > innerHeight - 6) top = Math.max(6, innerHeight - hgt - 6);
    m.style.left = `${Math.max(6, left)}px`;
    m.style.top = `${top}px`;
    if (level === 0) m.focus();
    return m;
  }

  function menu(items, x, y) {
    if (x instanceof Element) { const r = x.getBoundingClientRect(); return showAt(items, r.left, r.bottom + 4); }
    return showAt(items, x, y);
  }

  document.addEventListener('mousedown', (e) => { if (!e.target.closest?.('.ctx-menu')) closeMenus(0); }, true);
  window.addEventListener('blur', () => closeMenus(0));
  window.addEventListener('resize', () => closeMenus(0));

  // ---------- Boîtes de dialogue ----------
  // choices : [{ label, value, primary?, danger? }] remplace les boutons OK / Annuler (Échap renvoie null)
  function dialog({ title, message, input, options, value = '', placeholder = '', ok = 'OK', cancel = 'Annuler', danger, select, choices }) {
    return new Promise((resolve) => {
      const ov = h('div', 'overlay dlg-overlay');
      const card = h('div', 'dlg');
      card.appendChild(h('h3', '', esc(title)));
      if (message) card.appendChild(h('p', 'dlg-msg', message));
      let field = null;
      if (options) {
        field = h('select', 'set-input dlg-input');
        field.setAttribute('aria-label', title);
        for (const option of options) {
          const el = h('option');
          el.value = option.value;
          el.textContent = option.label;
          field.appendChild(el);
        }
        if (options.some((option) => option.value === value)) field.value = value;
        card.appendChild(field);
      } else if (input) {
        field = h('input', 'set-input dlg-input');
        field.value = value;
        field.placeholder = placeholder;
        field.spellcheck = false;
        card.appendChild(field);
      }
      const err = h('div', 'dlg-err');
      card.appendChild(err);
      const row = h('div', 'dlg-actions');
      const bCancel = h('button', 'tb-btn', esc(cancel));
      let bOk = h('button', 'tb-btn ' + (danger ? 'danger-btn' : 'primary'), esc(ok));
      if (choices) {
        row.append(bCancel);
        for (const c of choices) {
          const b = h('button', 'tb-btn' + (c.primary ? ' primary' : '') + (c.danger ? ' danger-btn' : ''), esc(c.label));
          b.addEventListener('click', () => done(c.value));
          if (c.primary) bOk = b;
          row.append(b);
        }
      } else row.append(bCancel, bOk);
      card.appendChild(row);
      ov.appendChild(card);
      document.body.appendChild(ov);
      const done = (v) => { ov.remove(); resolve(v); };
      bCancel.addEventListener('click', () => done(null));
      if (!choices) bOk.addEventListener('click', () => done(field ? field.value : true));
      ov.addEventListener('mousedown', (e) => { if (e.target === ov) done(null); });
      card.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Escape') done(null);
        if (e.key === 'Enter' && !(options && e.target === field)) { e.preventDefault(); bOk.click(); }
      });
      if (field) {
        field.focus();
        if (input && !options) {
          if (typeof select === 'number') field.setSelectionRange(0, select);
          else field.select();
        }
      } else bOk.focus();
    });
  }
  const prompt = (title, value, opts = {}) => dialog({ title, input: true, value, ...opts });
  const confirm = (title, message, opts = {}) => dialog({ title, message, ...opts }).then((v) => !!v);

  // ---------- Notifications ----------
  let toastBox = null;
  function toast(text, { kind = 'info', ms = 3500 } = {}) {
    if (!toastBox) { toastBox = h('div', 'toasts'); document.body.appendChild(toastBox); }
    const t = h('div', 'toast ' + kind);
    t.textContent = text;
    toastBox.appendChild(t);
    setTimeout(() => t.classList.add('out'), ms);
    setTimeout(() => t.remove(), ms + 400);
  }

  // ---------- Conversion ANSI -> HTML (journaux, messages d'erreur) ----------
  const ANSI = ['#555', '#ff7b72', '#7ee787', '#e3b341', '#79c0ff', '#d2a8ff', '#56d4dd', '#c9d1d9'];
  function ansiToHtml(text) {
    let out = '', open = false;
    const parts = String(text).split(/\x1b\[([0-9;]*)m/);
    for (let i = 0; i < parts.length; i++) {
      if (i % 2 === 0) { out += esc(parts[i]); continue; }
      if (open) { out += '</span>'; open = false; }
      const codes = parts[i].split(';').map(Number);
      const st = [];
      for (const c of codes) {
        if (c === 1) st.push('font-weight:700');
        else if (c === 2) st.push('opacity:.7');
        else if (c === 3) st.push('font-style:italic');
        else if (c >= 30 && c <= 37) st.push(`color:var(--ansi-${c - 30},${ANSI[c - 30]})`);
        else if (c >= 90 && c <= 97) st.push(`color:var(--ansi-${c - 90},${ANSI[c - 90]});filter:brightness(1.25)`);
      }
      if (st.length) { out += `<span style="${st.join(';')}">`; open = true; }
    }
    return out + (open ? '</span>' : '');
  }

  // ---------- Petits formats ----------
  const fmtBytes = (n) => (n == null ? '—' : n < 1024 ? `${n} o` : n < 1024 ** 2 ? `${(n / 1024).toFixed(1)} Ko` : n < 1024 ** 3 ? `${(n / 1024 ** 2).toFixed(1)} Mo` : `${(n / 1024 ** 3).toFixed(2)} Go`);
  function fmtDuration(ms) {
    if (ms == null) return '—';
    if (ms < 1000) return `${ms} ms`;
    const s = Math.floor(ms / 1000);
    if (s < 60) return `${(ms / 1000).toFixed(s < 10 ? 1 : 0)} s`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m} min ${s % 60} s`;
    const hh = Math.floor(m / 60);
    return hh < 24 ? `${hh} h ${m % 60} min` : `${Math.floor(hh / 24)} j ${hh % 24} h`;
  }

  // Webview « flottant » : il reste attaché à document.body (le déplacer recrée la page Electron)
  // et suit la position de « slot ». Renvoie { sync, dispose }.
  function floatWebview(view, slot) {
    view.style.cssText = 'position:fixed;display:none;z-index:1';
    document.body.appendChild(view);
    const sync = () => {
      const visible = slot.isConnected && slot.getClientRects().length > 0;
      const rect = slot.getBoundingClientRect();
      view.style.display = visible && rect.width && rect.height ? 'flex' : 'none';
      if (visible) Object.assign(view.style, { left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px` });
    };
    let frame;
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(sync); };
    const size = new ResizeObserver(schedule);
    size.observe(slot);
    const layout = new MutationObserver(schedule);
    layout.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'] });
    window.addEventListener('resize', schedule);
    schedule();
    return { sync, schedule, dispose() { size.disconnect(); layout.disconnect(); cancelAnimationFrame(frame); window.removeEventListener('resize', schedule); view.remove(); } };
  }

  // ---------- Copier / coller dans les consoles xterm des outils (services, Docker, tests) ----------
  // Ctrl+C copie la sélection (sinon il part au programme comme d'habitude), Ctrl+Maj+C copie,
  // Ctrl+V / Maj+Inser collent (consoles interactives) ; clic droit : Copier, Coller, Tout sélectionner, Effacer.
  function termClipboard(term, host, { interactive = false, onClear } = {}) {
    const copy = () => { if (!term.hasSelection()) return false; window.api.writeClipboard(term.getSelection()); return true; };
    const paste = async () => { const text = await window.api.readClipboard(); if (text) { term.paste(text); term.focus(); } };
    term.attachCustomKeyEventHandler((e) => {
      if (e.type !== 'keydown') return true;
      const k = e.key.toLowerCase();
      if (e.ctrlKey && !e.altKey && !e.shiftKey && k === 'c' && term.hasSelection()) { copy(); term.clearSelection(); return false; }
      if (e.ctrlKey && e.shiftKey && !e.altKey && k === 'c') { copy(); return false; }
      if (interactive && ((e.ctrlKey && !e.altKey && k === 'v') || (e.shiftKey && !e.ctrlKey && e.key === 'Insert'))) { e.preventDefault(); paste(); return false; }
      if (!interactive && e.ctrlKey && !e.altKey && !e.shiftKey && k === 'a') { e.preventDefault(); term.selectAll(); return false; }
      return true;
    });
    host.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const sel = term.hasSelection();
      menu([
        { label: 'Copier', icon: '⧉', hint: 'Ctrl+C', disabled: !sel, action: () => { copy(); term.focus(); } },
        interactive && { label: 'Coller', icon: '📋', hint: 'Ctrl+V', action: paste },
        { label: 'Tout sélectionner', icon: '▤', hint: interactive ? '' : 'Ctrl+A', action: () => { term.selectAll(); term.focus(); } },
        '-',
        { label: "Effacer l'affichage", icon: '⌫', action: () => (onClear ? onClear() : term.clear()) },
      ], e.clientX, e.clientY);
    });
  }

  window.UI = { h, esc, menu, closeMenus, dialog, prompt, confirm, toast, ansiToHtml, fmtBytes, fmtDuration, floatWebview, termClipboard };
})();
