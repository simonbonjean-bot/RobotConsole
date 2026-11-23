// RobotConsole — onglet « Prisma / BDD » : schéma, données des tables, console SQL, migrations
(function () {
  const api = window.api;
  const { h, esc } = UI;
  const PAGE = 100;
  const VIEWS = [['schema', 'Schéma'], ['diagram', 'Diagramme'], ['data', 'Données'], ['sql', 'SQL'], ['migrations', 'Migrations']];
  const STATUS = {
    applied: ['Appliquée', 'ok'], pending: ['En attente', 'warn'], failed: ['Échouée', 'bad'], rolledback: ['Annulée', 'off'],
    dbonly: ['En base seulement', 'warn'], unknown: ['?', 'off'],
  };

  const PrismaTab = {
    icon: '<span class="kind-prisma">◆</span>',
    defaultTitle() { return 'Prisma'; },

    mount(tab, spec) {
      const d = tab.d = {
        root: spec.root, projectId: spec.project || null, view: spec.view || 'schema', model: spec.prismaModel || (typeof spec.model === 'string' ? spec.model : null), table: spec.table || null,
        sqlHistory: spec.sqlHistory || [], sqlText: spec.sql || '', diagState: spec.diagram || {}, histPos: -1, info: null, conn: null, tables: null,
        grid: { offset: 0, orderBy: null, dir: 'asc', filter: '' }, schemaFilter: '', tableFilter: '', migrations: null, migSel: null,
      };
      tab.pane.classList.add('prisma-pane', 'tool-pane');

      const bar = h('div', 'tool-bar');
      d.badge = h('span', 'tool-badge', '◆ Prisma');
      d.projSel = h('select', 'set-input small pz-proj hidden');
      d.projSel.addEventListener('change', () => { d.projectId = d.projSel.value; d.tables = null; d.migrations = null; load(tab); CAI.save(); });
      d.conn = h('button', 'pz-conn');
      d.conn.addEventListener('click', () => connMenu(tab));
      const seg = h('div', 'pz-seg');
      d.segBtns = {};
      for (const [id, label] of VIEWS) {
        const b = h('button', '', label);
        b.addEventListener('click', () => show(tab, id));
        d.segBtns[id] = b;
        seg.appendChild(b);
      }
      const btn = (html, title, fn) => { const b = h('button', 'icon-btn', html); b.title = title; b.addEventListener('click', fn); return b; };
      bar.append(d.badge, d.projSel, d.conn, h('div', 'tb-spacer'), seg,
        btn('⟳', 'Recharger le schéma et la connexion', () => { d.tables = null; d.migrations = null; load(tab); }),
        btn('⋯', 'Plus', (e) => UI.menu(moreMenu(tab), e.currentTarget)));
      d.progress = h('div', 'tool-progress hidden', '<i></i>');
      d.body = h('div', 'pz-body');
      d.views = {};
      for (const [id] of VIEWS) { d.views[id] = h('div', `pz-view pz-${id} hidden`); d.body.appendChild(d.views[id]); }
      tab.pane.append(bar, d.progress, d.body);
      buildSchema(tab); buildDiagram(tab); buildData(tab); buildSql(tab); buildMigrations(tab);
      d.body.innerHTML = '';
      d.body.appendChild(h('div', 'tool-empty', '<div class="spinner"></div>Lecture du schéma Prisma…'));
      load(tab, true);
    },

    activate(tab) { if (tab.d.info && !tab.d.connOk) ping(tab); },
    focus(tab) { if (tab.d.view === 'sql') tab.d.sqlInput?.focus(); },
    resize() {},
    dispose() {},
    serialize(tab) {
      const d = tab.d;
      return { root: d.root, project: d.projectId, view: d.view, prismaModel: d.model, table: d.table, sqlHistory: d.sqlHistory.slice(0, 30), sql: d.sqlInput?.value || d.sqlText, diagram: d.diagState };
    },
    applyTheme() {},

    // Accès à distance (téléphone / tablette) : consultation seulement (pas de SQL libre)
    remoteReadActions: ['rows'],
    async remoteSnapshot(tab) {
      const d = tab.d;
      if (d.connOk && !d.tables) { const r = await api.prismaTables(d.root, d.projectId).catch(() => null); if (r?.ok) { d.tables = r.tables; d.defaultSchema = r.defaultSchema; } }
      const models = new Map((d.info?.models || []).map((m) => [m.dbName, m.name]));
      return {
        summary: d.connOk === undefined ? 'Connexion à la base…' : d.connOk ? `Base connectée · ${d.tables?.length ?? '…'} table(s)` : `Base injoignable${d.connError ? ' : ' + d.connError : ''}`,
        sections: d.tables ? [{ items: d.tables.map((t) => ({
          id: `${t.schema}|${t.name}`, label: t.name, badge: t.view ? 'vue' : '', detail: models.get(t.name) && models.get(t.name) !== t.name ? `modèle ${models.get(t.name)}` : '',
          meta: t.estimate ? `≈ ${t.estimate.toLocaleString('fr-FR')} lignes` : '', tap: { id: 'rows', read: true },
        })) }] : [],
      };
    },
    async remoteAction(tab, action, { item } = {}) {
      const d = tab.d;
      if (action !== 'rows') return { error: 'Action inconnue' };
      const [schema, table] = String(item || '').split('|');
      if (!d.tables?.some((t) => t.name === table && t.schema === schema)) return { error: 'Table inconnue' };
      const r = await api.prismaRows(d.root, d.projectId, { table, schema, limit: 50, offset: 0 });
      if (!r.ok) return { error: r.error };
      return { title: `${table} · ${r.total?.toLocaleString('fr-FR') ?? r.rows.length} ligne(s)`, table: { columns: r.columns.map((c) => c.name), rows: r.rows.map((row) => row.map((v) => (v === null ? null : String(v).slice(0, 200)))) } };
    },
  };

  const busy = (tab, on) => tab.d.progress.classList.toggle('hidden', !on);
  const call = async (tab, fn) => { busy(tab, true); try { return await fn(); } catch (e) { return { ok: false, error: e.message }; } finally { busy(tab, false); } };
  const cp = (text) => { api.writeClipboard(String(text ?? '')); UI.toast('Copié'); };

  // ---------- Chargement ----------
  async function load(tab, first) {
    const d = tab.d;
    const info = await call(tab, () => api.prismaInfo(d.root, d.projectId));
    d.info = info;
    d.body.innerHTML = '';
    if (!info?.found) {
      d.badge.textContent = '◆ Prisma';
      d.conn.classList.add('hidden');
      d.body.appendChild(h('div', 'tool-empty', `<div class="robot big">${tab.space.bot.svg}</div><b>Aucun schéma Prisma dans ce dossier</b>
        <div>RobotConsole cherche un fichier <code>schema.prisma</code> (jusqu'à 4 niveaux de profondeur) dans<br><code>${esc(d.root)}</code></div>`));
      return;
    }
    d.projectId = info.project.id;
    d.diagReady = false;
    for (const v of Object.values(d.views)) d.body.appendChild(v);
    d.projSel.innerHTML = info.projects.map((p) => `<option value="${esc(p.id)}"${p.id === d.projectId ? ' selected' : ''}>${esc(p.rel)}</option>`).join('');
    d.projSel.classList.toggle('hidden', info.projects.length < 2);
    d.badge.textContent = `◆ ${info.models.length} modèles${info.enums.length ? ` · ${info.enums.length} enums` : ''}`;
    d.badge.title = info.project.schema;
    d.conn.classList.remove('hidden');
    renderSchemaList(tab);
    show(tab, d.view);
    await ping(tab);
    if (first) CAI.say(tab.space, d.connOk ? `Base ${info.connection?.database} branchée, ${info.models.length} modèles` : `${info.models.length} modèles Prisma trouvés`, 2500);
  }

  async function ping(tab) {
    const d = tab.d;
    const i = d.info;
    if (!i?.found) return;
    const c = i.connection;
    const where = c ? `${c.database}@${c.host}:${c.port}` : (i.urlSource || 'DATABASE_URL');
    if (!i.supported) { setConn(tab, 'off', `${i.provider || '?'} · non pris en charge`, `Seul PostgreSQL est pris en charge pour les données et le SQL.\nLe schéma et les migrations restent disponibles.`); return; }
    if (!c) { setConn(tab, 'bad', `${i.urlSource || 'DATABASE_URL'} introuvable`, 'Variable absente du fichier .env du projet'); return; }
    setConn(tab, 'wait', where, 'Connexion…');
    const r = await api.prismaPing(d.root, d.projectId);
    d.connOk = !!r.ok;
    d.connError = r.ok ? null : r.error;
    if (r.ok) setConn(tab, 'ok', where, `${r.version}\nUtilisateur : ${c.user} · schéma ${c.schema}\nURL lue dans ${i.urlSource}`);
    else setConn(tab, 'bad', where, r.error);
    if (d.view === 'data' || d.view === 'migrations') show(tab, d.view);
  }
  function setConn(tab, state, text, title) {
    const c = tab.d.conn;
    c.className = 'pz-conn ' + state;
    c.innerHTML = `<i></i><span>${esc(text)}</span>`;
    c.title = title || '';
  }
  function connMenu(tab) {
    const d = tab.d;
    UI.menu([
      { title: d.connOk ? 'Connecté' : 'Non connecté' },
      { label: 'Se reconnecter', icon: '⟳', action: async () => { await api.prismaClose(d.root, d.projectId); ping(tab); } },
      { label: 'Ouvrir le .env / datasource', icon: '✎', action: () => CAI.openFile(tab.space, d.info.project.schema, d.info.datasourceLine) },
    ], d.conn);
  }

  function show(tab, view) {
    const d = tab.d;
    d.view = view;
    for (const [id, b] of Object.entries(d.segBtns)) b.classList.toggle('active', id === view);
    for (const [id, v] of Object.entries(d.views)) v.classList.toggle('hidden', id !== view);
    if (!d.info?.found) return;
    if (view === 'schema') renderSchemaDetail(tab);
    if (view === 'diagram') showDiagram(tab);
    if (view === 'data') { if (!d.tables) loadTables(tab); else renderTables(tab); }
    if (view === 'migrations' && !d.migrations) loadMigrations(tab);
    if (view === 'sql') setTimeout(() => d.sqlInput.focus(), 0);
    CAI.save();
  }

  function moreMenu(tab) {
    const d = tab.d;
    const i = d.info;
    if (!i?.found) return [{ label: 'Terminal dans le workspace', icon: '>_', action: () => CAI.openTab(tab.space, { kind: 'terminal', cwd: d.root }) }];
    return [
      { title: i.project.rel },
      { label: 'Ouvrir schema.prisma', icon: '✎', action: () => CAI.openFile(tab.space, i.project.schema) },
      { label: 'Explorer le dossier du projet', icon: '📁', action: () => CAI.openTab(tab.space, { kind: 'explorer', root: i.project.dir }) },
      { label: 'Terminal dans le projet', icon: '>_', action: () => CAI.openTab(tab.space, { kind: 'terminal', cwd: i.project.dir }) },
      '-',
      ...COMMANDS.slice(0, 4).map((c) => ({ label: c.label, icon: c.icon, hint: `prisma ${c.args}`, action: () => runCmd(tab, c) })),
      { label: 'Prisma Studio', icon: '🖥', action: () => runCmd(tab, COMMANDS.find((c) => c.args === 'studio')) },
    ];
  }

  // ---------- Commandes prisma (dans un onglet terminal) ----------
  const COMMANDS = [
    { label: 'Générer le client', icon: '⚙', args: 'generate' },
    { label: 'Nouvelle migration (dev)', icon: '＋', args: 'migrate dev', ask: 'Nom de la migration (facultatif)' },
    { label: 'État des migrations', icon: '≡', args: 'migrate status' },
    { label: 'Appliquer (deploy)', icon: '▶', args: 'migrate deploy' },
    { label: 'Synchroniser (db push)', icon: '⇅', args: 'db push', confirm: 'Pousser le schéma directement dans la base, sans migration ?' },
    { label: 'Seed', icon: '🌱', args: 'db seed' },
    { label: 'Prisma Studio', icon: '🖥', args: 'studio' },
    { label: 'Réinitialiser la base', icon: '⚠', args: 'migrate reset', danger: true, confirm: '<b>Toutes les données de la base seront effacées</b>, puis les migrations et le seed relancés.' },
  ];
  async function runCmd(tab, c) {
    const i = tab.d.info;
    let args = c.args;
    if (c.confirm && !(await UI.confirm(c.label, c.confirm, { ok: 'Lancer', danger: !!c.danger }))) return;
    if (c.ask) {
      const name = await UI.prompt(c.ask, '', { placeholder: 'ex. add_user_avatar', ok: 'Lancer' });
      if (name === null) return;
      if (name.trim()) args += ` --name ${name.trim().replace(/[^\w-]+/g, '_')}`;
    }
    const schemaArg = i.project.defaultLocation ? '' : ` --schema "${i.project.schema}"`;
    CAI.openTab(tab.space, { kind: 'terminal', cwd: i.project.dir, commands: `${i.project.runner} ${args}${schemaArg}` }, { title: `prisma ${c.args}` });
  }

  // ---------- Vue Schéma ----------
  function buildSchema(tab) {
    const d = tab.d;
    const v = d.views.schema;
    const side = h('div', 'pz-side');
    const f = h('input', 'set-input tool-search pz-filter');
    f.placeholder = 'Modèle, champ…';
    f.value = d.schemaFilter;
    f.addEventListener('input', () => { d.schemaFilter = f.value.toLowerCase(); renderSchemaList(tab); });
    f.addEventListener('keydown', (e) => e.stopPropagation());
    d.schemaList = h('div', 'pz-list');
    side.append(f, d.schemaList);
    d.schemaDetail = h('div', 'pz-detail');
    v.append(side, d.schemaDetail);
  }
  function renderSchemaList(tab) {
    const d = tab.d;
    const i = d.info;
    if (!i?.found) return;
    const q = d.schemaFilter;
    const match = (x) => !q || x.name.toLowerCase().includes(q) || (x.dbName || '').toLowerCase().includes(q) || (x.fields || x.values || []).some((f) => f.name.toLowerCase().includes(q));
    d.schemaList.innerHTML = '';
    const add = (x, kind) => {
      const row = h('div', 'pz-item' + (d.model === x.name ? ' sel' : ''));
      row.innerHTML = `<span class="pz-k ${kind}">${kind === 'enum' ? 'E' : kind === 'view' ? 'V' : 'M'}</span><span class="pz-n">${esc(x.name)}</span><span class="pz-c">${(x.fields || x.values).length}</span>`;
      row.title = x.doc || (x.dbName && x.dbName !== x.name ? `table ${x.dbName}` : x.name);
      row.addEventListener('click', () => { d.model = x.name; renderSchemaList(tab); renderSchemaDetail(tab); CAI.save(); });
      d.schemaList.appendChild(row);
    };
    const models = i.models.filter(match).sort((a, b) => a.name.localeCompare(b.name));
    const enums = i.enums.filter(match).sort((a, b) => a.name.localeCompare(b.name));
    models.forEach((m) => add(m, m.kind === 'view' ? 'view' : 'model'));
    if (enums.length) { d.schemaList.appendChild(h('div', 'pz-sep', 'Enums')); enums.forEach((e) => add(e, 'enum')); }
    if (!models.length && !enums.length) d.schemaList.appendChild(h('div', 'pz-none', 'Aucun résultat'));
  }
  function renderSchemaDetail(tab) {
    const d = tab.d;
    const i = d.info;
    const box = d.schemaDetail;
    box.innerHTML = '';
    const m = i.models.find((x) => x.name === d.model);
    const en = !m && i.enums.find((x) => x.name === d.model);
    if (!m && !en) {
      const c = i.connection;
      box.appendChild(h('div', 'tool-empty', `<div class="robot big">${tab.space.bot.svg}</div><b>${esc(i.project.rel)}</b>
        <div>${i.models.length} modèles · ${i.enums.length} enums · ${esc(i.provider || '?')}${c ? ` · base <code>${esc(c.database)}</code> sur ${esc(c.host)}:${esc(c.port)}` : ''}</div>
        <div>Générateurs : ${i.generators.map((g) => `<code>${esc(g.name)}</code> ${esc(g.provider || '')}`).join(', ') || '—'}</div>
        <div class="muted">Choisissez un modèle à gauche.</div>`));
      return;
    }
    const head = h('div', 'pz-dhead');
    const x = m || en;
    head.innerHTML = `<div><div class="pz-title">${esc(x.name)}${m && m.dbName !== m.name ? ` <span class="muted">→ table ${esc(m.dbName)}</span>` : ''}${en && en.dbName ? ` <span class="muted">→ ${esc(en.dbName)}</span>` : ''}</div>${x.doc ? `<div class="pz-doc">${esc(x.doc)}</div>` : ''}</div>`;
    const acts = h('div', 'pz-dacts');
    const b = (label, fn, cls = 'tb-btn') => { const e = h('button', cls, label); e.addEventListener('click', fn); acts.appendChild(e); };
    b('✎ Ouvrir dans l\'éditeur', () => CAI.openFile(tab.space, x.file, x.line));
    if (m) b('◇ Diagramme', () => { d.diagState = { ...d.diagState, focus: m.name }; d.diagFocusReq = m.name; show(tab, 'diagram'); });
    if (m) b('▦ Voir les données', () => { d.table = m.dbName; d.grid = { offset: 0, orderBy: null, dir: 'asc', filter: '' }; show(tab, 'data'); });
    head.appendChild(acts);
    box.appendChild(head);

    if (en) {
      const list = h('div', 'pz-enum');
      for (const v of en.values) { const s = h('span', 'pz-chip'); s.textContent = v.name; list.appendChild(s); }
      box.appendChild(list);
      // Modèles qui utilisent cet enum
      const users = i.models.filter((mo) => mo.fields.some((f) => f.type === en.name));
      if (users.length) {
        const u = h('div', 'pz-used', '<span class="muted">Utilisé par : </span>');
        users.forEach((mo) => { const a = h('a', 'pz-link'); a.textContent = mo.name; a.addEventListener('click', () => { d.model = mo.name; renderSchemaList(tab); renderSchemaDetail(tab); }); u.appendChild(a); });
        box.appendChild(u);
      }
      return;
    }

    const t = h('table', 'pz-fields');
    t.innerHTML = '<thead><tr><th>Champ</th><th>Type</th><th>Attributs</th><th>Défaut</th></tr></thead>';
    const tb = h('tbody');
    for (const f of m.fields) {
      const tr = h('tr', f.ref === 'model' ? 'rel' : '');
      const badges = [
        f.id && '<span class="pz-b pk">PK</span>', f.unique && '<span class="pz-b uq">unique</span>', f.updatedAt && '<span class="pz-b">updatedAt</span>',
        f.relation != null && `<span class="pz-b rl" title="${esc(f.relation)}">relation</span>`, f.dbType && `<span class="pz-b db">@db.${esc(f.dbType)}</span>`,
        f.dbName && `<span class="pz-b">→ ${esc(f.dbName)}</span>`,
      ].filter(Boolean).join('');
      tr.innerHTML = `<td class="pz-fn">${esc(f.name)}${f.doc ? `<div class="pz-doc">${esc(f.doc)}</div>` : ''}</td>
        <td class="pz-ft"><span class="${f.ref ? 'pz-link' : ''}">${esc(f.type)}</span>${f.list ? '<span class="muted">[]</span>' : ''}${f.optional ? '<span class="muted">?</span>' : ''}</td>
        <td>${badges}</td><td class="pz-def">${f.default != null ? esc(f.default) : ''}</td>`;
      if (f.ref) tr.querySelector('.pz-link').addEventListener('click', () => { d.model = f.type; renderSchemaList(tab); renderSchemaDetail(tab); });
      tr.addEventListener('dblclick', () => CAI.openFile(tab.space, m.file, f.line));
      tb.appendChild(tr);
    }
    t.appendChild(tb);
    box.appendChild(t);
    if (m.attrs.length) {
      const a = h('div', 'pz-attrs');
      m.attrs.forEach((x) => { const c = h('code'); c.textContent = x; a.appendChild(c); });
      box.appendChild(a);
    }
    // Relations entrantes
    const incoming = i.models.filter((mo) => mo !== m && mo.fields.some((f) => f.type === m.name));
    if (incoming.length) {
      const u = h('div', 'pz-used', '<span class="muted">Référencé par : </span>');
      incoming.forEach((mo) => { const a = h('a', 'pz-link'); a.textContent = mo.name; a.addEventListener('click', () => { d.model = mo.name; renderSchemaList(tab); renderSchemaDetail(tab); }); u.appendChild(a); });
      box.appendChild(u);
    }
  }

  // ---------- Vue Diagramme ----------
  function buildDiagram(tab) {
    const d = tab.d;
    let file = null;
    d.diag = PrismaDiagram.create(d.views.diagram, {
      ...d.diagState,
      store: {
        load: async () => { const r = await api.prismaDiagramLoad(d.root, d.projectId); file = r.file; return r; },
        save: (data) => api.prismaDiagramSave(d.root, d.projectId, data),
        saveImage: (url) => api.prismaDiagramSaveImage(d.root, url),
        reveal: () => file && CAI.openTab(tab.space, { kind: 'explorer', root: file.replace(/[\\/][^\\/]+$/, '') }),
      },
      onOpen: (name) => { d.model = name; renderSchemaList(tab); show(tab, 'schema'); },
      onChange: (s) => { d.diagState = s; CAI.save(); },
    });
  }
  async function showDiagram(tab) {
    const d = tab.d;
    if (!d.diagReady) {
      d.diagReady = true;
      await d.diag.setInfo(d.info);
      // Nombre de lignes par table dans les en-têtes, si la base répond
      if (d.connOk && d.info.supported) {
        const r = d.tables ? { ok: true, tables: d.tables } : await api.prismaTables(d.root, d.projectId);
        if (r.ok) { d.tables = d.tables || r.tables; d.diag.setCounts(r.tables); }
      }
    }
    if (d.diagFocusReq) { d.diag.focus(d.diagFocusReq); d.diagFocusReq = null; }
  }

  // ---------- Grille de résultats (données et SQL) ----------
  function renderGrid(box, res, opts = {}) {
    box.innerHTML = '';
    if (!res.columns?.length) { box.appendChild(h('div', 'pz-none', res.command ? `${esc(res.command)} : ${res.rowCount ?? 0} ligne(s)` : 'Aucune colonne')); return; }
    const t = h('table', 'pz-grid');
    const tr = h('tr');
    tr.appendChild(h('th', 'pz-rn', '#'));
    res.columns.forEach((c) => {
      const th = h('th');
      const sorted = opts.orderBy === c.name;
      th.innerHTML = `<span>${esc(c.name)}</span><small>${esc(c.type || '')}</small>${sorted ? `<b>${opts.dir === 'desc' ? '▼' : '▲'}</b>` : ''}`;
      if (opts.onSort) { th.classList.add('sortable'); th.addEventListener('click', () => opts.onSort(c.name)); }
      tr.appendChild(th);
    });
    const thead = h('thead'); thead.appendChild(tr); t.appendChild(thead);
    const tb = h('tbody');
    res.rows.forEach((row, ri) => {
      const r = h('tr');
      r.appendChild(h('td', 'pz-rn', String((opts.offset || 0) + ri + 1)));
      row.forEach((v, ci) => {
        const td = h('td');
        if (v === null) { td.className = 'null'; td.textContent = 'NULL'; }
        else {
          const s = String(v);
          td.textContent = s.length > 160 ? s.slice(0, 160) + '…' : s;
          if (typeof v === 'number') td.className = 'num';
          else if (typeof v === 'boolean') td.className = 'bool';
          if (s.length > 40) td.title = s.length > 2000 ? s.slice(0, 2000) + '…' : s;
        }
        td.addEventListener('dblclick', () => showValue(res.columns[ci].name, v));
        td.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          const obj = Object.fromEntries(res.columns.map((c, i) => [c.name, row[i]]));
          UI.menu([
            { label: 'Copier la valeur', icon: '⧉', action: () => cp(v) },
            { label: 'Copier la ligne (JSON)', icon: '{}', action: () => cp(JSON.stringify(obj, null, 2)) },
            { label: 'Voir la valeur', icon: '👁', action: () => showValue(res.columns[ci].name, v) },
            ...(opts.onFilter && v !== null ? [{ label: 'Filtrer sur cette valeur', icon: '⌕', action: () => opts.onFilter(String(v)) }] : []),
          ], e.clientX, e.clientY);
        });
        r.appendChild(td);
      });
      tb.appendChild(r);
    });
    t.appendChild(tb);
    box.appendChild(t);
  }
  function showValue(name, v) {
    let s = v === null ? 'NULL' : String(v);
    try { if (/^[[{]/.test(s)) s = JSON.stringify(JSON.parse(s), null, 2); } catch {}
    UI.dialog({ title: name, message: `<pre class="pz-value">${esc(s)}</pre>`, ok: 'Copier', cancel: 'Fermer' }).then((ok) => { if (ok) cp(v); });
  }

  // ---------- Vue Données ----------
  function buildData(tab) {
    const d = tab.d;
    const v = d.views.data;
    const side = h('div', 'pz-side');
    const f = h('input', 'set-input tool-search pz-filter');
    f.placeholder = 'Table…';
    f.addEventListener('input', () => { d.tableFilter = f.value.toLowerCase(); renderTables(tab); });
    f.addEventListener('keydown', (e) => e.stopPropagation());
    d.tableList = h('div', 'pz-list');
    side.append(f, d.tableList);
    const main = h('div', 'pz-detail pz-datamain');
    const tb = h('div', 'pz-gridbar');
    d.dataTitle = h('span', 'pz-title');
    d.dataFilter = h('input', 'set-input tool-search');
    d.dataFilter.placeholder = 'Rechercher dans la table…';
    let ft = null;
    d.dataFilter.addEventListener('input', () => { clearTimeout(ft); ft = setTimeout(() => { d.grid.filter = d.dataFilter.value; d.grid.offset = 0; loadRows(tab); }, 300); });
    d.dataFilter.addEventListener('keydown', (e) => e.stopPropagation());
    d.pager = h('div', 'pz-pager');
    const btn = (html, title, fn) => { const b = h('button', 'icon-btn', html); b.title = title; b.addEventListener('click', fn); return b; };
    d.prev = btn('‹', 'Page précédente', () => { d.grid.offset = Math.max(0, d.grid.offset - PAGE); loadRows(tab); });
    d.next = btn('›', 'Page suivante', () => { d.grid.offset += PAGE; loadRows(tab); });
    d.pageInfo = h('span', 'muted');
    d.pager.append(d.prev, d.pageInfo, d.next,
      btn('⟳', 'Rafraîchir', () => loadRows(tab)),
      btn('SQL', 'Ouvrir dans la console SQL', () => { const t = d.tables?.find((x) => x.name === d.table); setSql(tab, `select *\nfrom ${t && t.schema !== 'public' ? `"${t.schema}".` : ''}"${d.table}"\nlimit 100;`); show(tab, 'sql'); }));
    tb.append(d.dataTitle, d.dataFilter, h('div', 'tb-spacer'), d.pager);
    d.dataGrid = h('div', 'pz-gridwrap');
    main.append(tb, d.dataGrid);
    v.append(side, main);
  }
  function dbError(tab, box) {
    const d = tab.d;
    const i = d.info;
    box.innerHTML = '';
    const msg = !i.supported ? `Le fournisseur <code>${esc(i.provider || '?')}</code> n'est pas encore pris en charge : seul PostgreSQL l'est.`
      : `<b>Impossible de se connecter à la base</b><div>${esc(d.connError || '')}</div>`;
    const e = h('div', 'tool-empty', `<div class="robot big">${tab.space.bot.svg}</div>${msg}`);
    if (i.supported) { const b = h('button', 'tb-btn', '⟳ Réessayer'); b.addEventListener('click', async () => { await api.prismaClose(d.root, d.projectId); await ping(tab); }); e.appendChild(b); }
    box.appendChild(e);
  }
  async function loadTables(tab) {
    const d = tab.d;
    if (d.connOk === undefined) { d.dataGrid.innerHTML = '<div class="tool-empty"><div class="spinner"></div>Connexion à la base…</div>'; return; }
    if (!d.connOk) { d.tableList.innerHTML = ''; d.dataTitle.textContent = ''; dbError(tab, d.dataGrid); return; }
    const r = await call(tab, () => api.prismaTables(d.root, d.projectId));
    if (!r.ok) { d.connError = r.error; dbError(tab, d.dataGrid); return; }
    d.tables = r.tables;
    d.defaultSchema = r.defaultSchema;
    renderTables(tab);
  }
  function renderTables(tab) {
    const d = tab.d;
    if (!d.tables) return;
    const byTable = new Map(d.info.models.map((m) => [m.dbName, m.name]));
    const q = d.tableFilter;
    d.tableList.innerHTML = '';
    const list = d.tables.filter((t) => !q || t.name.toLowerCase().includes(q) || (byTable.get(t.name) || '').toLowerCase().includes(q));
    let lastSchema = d.defaultSchema;
    for (const t of list) {
      if (t.schema !== lastSchema) { d.tableList.appendChild(h('div', 'pz-sep', esc(t.schema))); lastSchema = t.schema; }
      const row = h('div', 'pz-item' + (d.table === t.name ? ' sel' : ''));
      const model = byTable.get(t.name);
      row.innerHTML = `<span class="pz-k ${t.view ? 'view' : 'table'}">${t.view ? 'V' : 'T'}</span><span class="pz-n">${esc(t.name)}</span><span class="pz-c">${t.estimate >= 1000 ? Math.round(t.estimate / 1000) + 'k' : t.estimate || ''}</span>`;
      row.title = model ? `Modèle ${model}` : t.name;
      row.addEventListener('click', () => { d.table = t.name; d.tableSchema = t.schema; d.grid = { offset: 0, orderBy: null, dir: 'asc', filter: '' }; d.dataFilter.value = ''; renderTables(tab); loadRows(tab); CAI.save(); });
      d.tableList.appendChild(row);
    }
    if (!list.length) d.tableList.appendChild(h('div', 'pz-none', 'Aucune table'));
    if (d.table && d.tables.some((t) => t.name === d.table)) { if (!d.rowsLoaded) loadRows(tab); }
    else { d.dataTitle.textContent = ''; d.pageInfo.textContent = ''; d.dataGrid.innerHTML = '<div class="tool-empty">Choisissez une table à gauche.</div>'; }
  }
  async function loadRows(tab) {
    const d = tab.d;
    if (!d.table) return;
    d.rowsLoaded = true;
    const t = d.tables?.find((x) => x.name === d.table && (!d.tableSchema || x.schema === d.tableSchema));
    const model = d.info.models.find((m) => m.dbName === d.table);
    d.dataTitle.innerHTML = `${esc(d.table)}${model && model.name !== d.table ? ` <span class="muted">${esc(model.name)}</span>` : ''}`;
    const r = await call(tab, () => api.prismaRows(d.root, d.projectId, { table: d.table, schema: t?.schema, limit: PAGE, offset: d.grid.offset, orderBy: d.grid.orderBy, dir: d.grid.dir, filter: d.grid.filter }));
    if (!r.ok) { d.dataGrid.innerHTML = `<div class="pz-err">${esc(r.error)}</div>`; return; }
    const end = Math.min(r.offset + r.rows.length, r.total);
    d.pageInfo.textContent = r.total ? `${r.offset + 1}–${end} sur ${r.estimated ? '~' : ''}${r.total.toLocaleString('fr-FR')}` : '0 ligne';
    d.prev.disabled = r.offset === 0;
    d.next.disabled = end >= r.total;
    const scroll = d.dataGrid.scrollLeft;
    renderGrid(d.dataGrid, r, {
      offset: r.offset, orderBy: d.grid.orderBy, dir: d.grid.dir,
      onSort: (col) => { if (d.grid.orderBy === col) d.grid.dir = d.grid.dir === 'asc' ? 'desc' : 'asc'; else { d.grid.orderBy = col; d.grid.dir = 'asc'; } d.grid.offset = 0; loadRows(tab); },
      onFilter: (v) => { d.dataFilter.value = v; d.grid.filter = v; d.grid.offset = 0; loadRows(tab); },
    });
    d.dataGrid.scrollLeft = scroll;
  }

  // ---------- Vue SQL ----------
  function buildSql(tab) {
    const d = tab.d;
    const v = d.views.sql;
    const ed = h('div', 'pz-sqled');
    d.sqlInput = h('textarea', 'pz-sqlin');
    d.sqlInput.spellcheck = false;
    d.sqlInput.placeholder = 'select * from users limit 10;\n\nCtrl+Entrée pour exécuter · Ctrl+↑/↓ : historique';
    d.sqlInput.value = d.sqlText;
    d.sqlInput.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); runSql(tab); }
      else if (Platform.primary(e) && (e.key === 'ArrowUp' || e.key === 'ArrowDown') && d.sqlHistory.length) {
        e.preventDefault();
        d.histPos = Math.max(-1, Math.min(d.sqlHistory.length - 1, d.histPos + (e.key === 'ArrowUp' ? 1 : -1)));
        d.sqlInput.value = d.histPos < 0 ? '' : d.sqlHistory[d.histPos];
      } else if (e.key === 'Tab') {
        e.preventDefault();
        const s = d.sqlInput.selectionStart;
        d.sqlInput.setRangeText('  ', s, d.sqlInput.selectionEnd, 'end');
      }
    });
    d.sqlInput.addEventListener('input', () => CAI.save());
    const bar = h('div', 'pz-sqlbar');
    const run = h('button', 'tb-btn primary', '▶ Exécuter');
    run.title = 'Ctrl+Entrée (la sélection seule si du texte est sélectionné)';
    run.addEventListener('click', () => runSql(tab));
    const hist = h('button', 'tb-btn', '🕘 Historique');
    hist.addEventListener('click', (e) => UI.menu(d.sqlHistory.length ? d.sqlHistory.slice(0, 20).map((q) => ({ label: q.replace(/\s+/g, ' ').slice(0, 80), action: () => setSql(tab, q) })) : [{ label: 'Historique vide', disabled: true }], e.currentTarget));
    d.sqlStatus = h('span', 'pz-sqlstatus muted', 'Les requêtes en lecture tournent dans une transaction en lecture seule.');
    bar.append(run, hist, d.sqlStatus);
    ed.append(d.sqlInput, bar);
    d.sqlGrid = h('div', 'pz-gridwrap');
    v.append(ed, d.sqlGrid);
  }
  function setSql(tab, q) { tab.d.sqlInput.value = q; tab.d.histPos = -1; CAI.save(); }
  async function runSql(tab, allowWrite = false) {
    const d = tab.d;
    const el = d.sqlInput;
    const sel = el.value.slice(el.selectionStart, el.selectionEnd).trim();
    const sql = sel || el.value.trim();
    if (!sql) return;
    if (!d.info?.supported) { d.sqlStatus.textContent = 'Seul PostgreSQL est pris en charge.'; return; }
    d.sqlStatus.textContent = 'Exécution…';
    const r = await call(tab, () => api.prismaQuery(d.root, d.projectId, sql, { allowWrite }));
    if (r.needsConfirm) {
      const ok = await UI.confirm('Modifier la base ?', `Cette requête n'est pas en lecture seule et sera <b>validée (commit)</b> dans <code>${esc(d.info.connection?.database || '')}</code>.<pre class="pz-value">${esc(sql.slice(0, 600))}</pre>`, { ok: 'Exécuter', danger: true });
      if (ok) return runSql(tab, true);
      d.sqlStatus.textContent = 'Annulé.';
      return;
    }
    d.sqlHistory = [sql, ...d.sqlHistory.filter((x) => x !== sql)].slice(0, 30);
    d.histPos = -1;
    CAI.save();
    if (!r.ok) {
      d.sqlStatus.innerHTML = `<span class="pz-errtxt">Erreur</span>`;
      d.sqlGrid.innerHTML = `<div class="pz-err">${esc(r.error)}${r.detail ? `<div>${esc(r.detail)}</div>` : ''}${r.hint ? `<div class="muted">${esc(r.hint)}</div>` : ''}</div>`;
      if (r.position && !sel) { el.focus(); el.setSelectionRange(r.position - 1, r.position); }
      return;
    }
    d.sqlStatus.textContent = `${r.command || 'OK'} · ${r.rowCount ?? r.rows.length} ligne${(r.rowCount ?? r.rows.length) > 1 ? 's' : ''}${r.truncated ? ' (1 000 affichées)' : ''} · ${UI.fmtDuration ? UI.fmtDuration(r.ms) : r.ms + ' ms'}${r.readOnly ? '' : ' · validé'}`;
    renderGrid(d.sqlGrid, r);
    if (!r.readOnly) { d.tables = null; d.rowsLoaded = false; }
  }

  // ---------- Vue Migrations ----------
  function buildMigrations(tab) {
    const d = tab.d;
    const v = d.views.migrations;
    const acts = h('div', 'pz-migacts');
    for (const c of COMMANDS) {
      const b = h('button', 'tb-btn' + (c.danger ? ' pz-danger' : ''), `${c.icon} ${c.label}`);
      b.title = `prisma ${c.args} — dans un nouvel onglet terminal`;
      b.addEventListener('click', () => runCmd(tab, c));
      acts.appendChild(b);
    }
    d.migSum = h('div', 'pz-migsum');
    const split = h('div', 'pz-migsplit');
    d.migList = h('div', 'pz-list pz-miglist');
    d.migSql = h('pre', 'pz-migsql');
    split.append(d.migList, d.migSql);
    v.append(acts, d.migSum, split);
  }
  async function loadMigrations(tab) {
    const d = tab.d;
    d.migList.innerHTML = '<div class="tool-empty"><div class="spinner"></div></div>';
    const r = await call(tab, () => api.prismaMigrations(d.root, d.projectId));
    d.migrations = r;
    renderMigrations(tab);
  }
  function renderMigrations(tab) {
    const d = tab.d;
    const r = d.migrations;
    d.migList.innerHTML = '';
    if (!r?.ok) { d.migList.appendChild(h('div', 'pz-err', esc(r?.error || 'Erreur'))); return; }
    const count = (s) => r.list.filter((m) => m.status === s).length;
    const pending = count('pending');
    const failed = count('failed');
    d.migSum.innerHTML = `<span><b>${r.local}</b> <span class="muted">dans prisma/migrations</span></span>` +
      (r.db != null ? `<span><b>${r.db}</b> <span class="muted">en base</span></span>` : '') +
      (pending ? `<span class="pz-st warn">${pending} en attente</span>` : r.db != null ? '<span class="pz-st ok">À jour</span>' : '') +
      (failed ? `<span class="pz-st bad">${failed} échouée${failed > 1 ? 's' : ''}</span>` : '') +
      (count('dbonly') ? `<span class="pz-st warn">${count('dbonly')} en base sans dossier local</span>` : '') +
      (r.dbError ? `<span class="muted" title="${esc(r.dbError)}">⚠ ${esc(r.dbError)}</span>` : '') +
      `<button class="icon-btn" title="Recharger">⟳</button>`;
    d.migSum.querySelector('button').addEventListener('click', () => loadMigrations(tab));
    if (!r.list.length) { d.migList.appendChild(h('div', 'pz-none', 'Aucune migration. Lancez « Nouvelle migration (dev) ».')); d.migSql.textContent = ''; return; }
    // Les plus récentes en haut
    for (const m of [...r.list].reverse()) {
      const [label, cls] = STATUS[m.status] || ['?', 'off'];
      const row = h('div', 'pz-item pz-mig' + (d.migSel === m.name ? ' sel' : ''));
      const ts = m.name.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})/);
      const nice = m.name.replace(/^\d{14}_/, '');
      row.innerHTML = `<span class="pz-st ${cls}">${label}</span><span class="pz-n">${esc(nice)}</span><span class="pz-c">${ts ? `${ts[3]}/${ts[2]}/${ts[1]}` : ''}</span>`;
      row.title = m.name + (m.appliedAt ? `\nAppliquée le ${new Date(m.appliedAt).toLocaleString('fr-FR')}` : '') + (m.logs ? `\n\n${m.logs}` : '');
      row.addEventListener('click', async () => {
        d.migSel = m.name;
        d.migList.querySelectorAll('.pz-mig').forEach((x) => x.classList.toggle('sel', x === row));
        d.migSql.textContent = m.file ? (await api.prismaMigrationSql(m.file)) || '(fichier vide)' : 'Pas de dossier local pour cette migration.';
        if (m.logs) d.migSql.textContent += `\n\n-- Journal d'erreur --\n${m.logs}`;
      });
      row.addEventListener('dblclick', () => m.file && CAI.openFile(tab.space, m.file));
      d.migList.appendChild(row);
    }
    if (!d.migSel) d.migSql.textContent = 'Cliquez sur une migration pour voir son SQL (double-clic : ouvrir dans l\'éditeur).';
  }

  (window.TabKinds = window.TabKinds || {}).prisma = PrismaTab;
})();
