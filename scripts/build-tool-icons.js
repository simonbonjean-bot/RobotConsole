// Génère renderer/tool-icons-data.js : le catalogue des outils que le robot tient à côté de lui.
// Sources (node_modules) :
//   - devicon      : ~650 logos de technos de dev en couleurs (référencés par fichier, pas copiés)
//   - simple-icons : logos officiels des marques (IA, services…) absents de devicon
//   - lucide       : pictogrammes génériques (serveur, bug, terminal…)
// Lancer : node scripts/build-tool-icons.js
const fs = require('fs');
const path = require('path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
const nm = (...p) => path.join(root, 'node_modules', ...p);

const devicon = JSON.parse(fs.readFileSync(nm('devicon', 'devicon.json'), 'utf8'));
const si = require(nm('simple-icons'));
const siBySlug = new Map(Object.values(si).map((x) => [x.slug, x]));
const lucide = JSON.parse(fs.readFileSync(nm('lucide-static', 'icon-nodes.json'), 'utf8'));

const CATS = [
  ['ia', 'IA & agents'],
  ['lang', 'Langages'],
  ['web', 'Frameworks & libs'],
  ['db', 'Données'],
  ['cloud', 'Cloud & DevOps'],
  ['tools', 'Outils & IDE'],
  ['test', 'Tests & qualité'],
  ['os', 'Systèmes'],
  ['design', 'Design'],
  ['dev', 'Pictos dev'],
  ['fun', 'Pictos divers'],
  ['symbols', 'Symboles'],
  ['emoji', 'Emojis'],
  ['other', 'Autres technos'],
];

// Catégorie d'une icône devicon d'après ses tags (premier groupe qui correspond)
const TAG_CATS = [
  ['ia', ['ai', 'assistant', 'coding-agent', 'llm', 'language-model', 'code-completion', 'agent', 'machine-learning', 'machinelearning', 'deep-learning', 'ml', 'computer-vision', 'data-science']],
  ['test', ['testing', 'test-runner', 'linter', 'code-quality', 'code quality', 'coding-style', 'format', 'code-review']],
  ['lang', ['language']],
  ['db', ['database', 'sql', 'nosql', 'db', 'key-value', 'orm', 'object-relational mapper', 'warehouse', 'column-oriented', 'relational', 'big data', 'etl', 'data-processing', 'streaming', 'message-broker']],
  ['cloud', ['cloud', 'devops', 'container', 'docker', 'kubernetes', 'hosting', 'serverless', 'deployment', 'deploy', 'cicd', 'continuous-delivery', 'pipeline', 'pipelines', 'infrastructure', 'infrastructure-as-code', 'monitoring', 'observability', 'cdn', 'proxy', 'web hosting', 'cloud hosting', 'gitops', 'orchestrator', 'provisioning', 'logging', 'metrics', 'tracing', 'service-mesh', 'loadbalancer', 'registry']],
  ['os', ['os', 'operating-system', 'operating system', 'linux', 'unix', 'distribution', 'window manager', 'hypervisor', 'virtual machine']],
  ['tools', ['ide', 'editor', 'text editor', 'tool', 'cli', 'command-line', 'terminal', 'shell', 'version-control', 'version control', 'vcs', 'git', 'package-manager', 'package', 'manager', 'bundler', 'build', 'task-runner', 'compiler', 'transpiler', 'remote-development', 'jetbrains', 'collaboration', 'project-management', 'note-taking', 'documentation', 'api']],
  ['design', ['design', 'graphic', 'graphics', '3d', 'animation', 'vfx', 'svg', 'modelling', 'modeling']],
  ['web', ['framework', 'library', 'frontend', 'backend', 'css', 'web', 'web-development', 'reactjs', 'react', 'vuejs', 'angular', 'mobile', 'cms', 'ssg', 'static site generator', 'static-site-generator', 'ui', 'component', 'components', 'runtime', 'javascript-runtime', 'game-engine', 'state-management']],
];
function deviconCat(tags) {
  const set = new Set(tags.map((t) => t.toLowerCase()));
  for (const [cat, list] of TAG_CATS) if (list.some((t) => set.has(t))) return cat;
  return 'other';
}

const out = [];
const ids = new Set();
const push = (it) => { if (!ids.has(it.id)) { ids.add(it.id); out.push(it); } };
const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

// ---------- devicon ----------
const deviconNames = new Set();
for (const d of devicon) {
  const v = d.versions.svg || [];
  const pick = ['original', 'plain', 'line'].find((x) => v.includes(x)) || v[0];
  if (!pick) continue;
  const file = `${d.name}/${d.name}-${pick}.svg`;
  if (!fs.existsSync(nm('devicon', 'icons', file))) continue;
  // Sans xmlns, le SVG ne s'affiche pas en <img>/<image> : on laisse simple-icons prendre le relais
  if (!/xmlns="http:\/\/www\.w3\.org\/2000\/svg"/.test(fs.readFileSync(nm('devicon', 'icons', file), 'utf8'))) continue;
  deviconNames.add(norm(d.name));
  for (const a of d.altnames || []) deviconNames.add(norm(a));
  const label = siBySlug.get(d.name)?.title || d.name.charAt(0).toUpperCase() + d.name.slice(1);
  push({ id: 'dv:' + d.name, label, cat: deviconCat(d.tags || []), src: file, kw: [d.name, ...(d.altnames || []), ...(d.tags || [])].join(' ').toLowerCase() });
}

// ---------- simple-icons : marques absentes de devicon ----------
const SI = {
  ia: ['anthropic', 'claude', 'mistralai', 'googlegemini', 'perplexity', 'deepseek', 'windsurf', 'v0', 'replit', 'openrouter', 'langchain', 'langgraph', 'llamaindex', 'xai', 'grok', 'meta', 'qwen', 'kimi', 'zhipuai', 'minimax', 'poe', 'githubcopilot', 'cursor', 'ollama', 'huggingface', 'lmstudio', 'n8n', 'zapier', 'make', 'cline', 'continue', 'tabnine', 'sourcegraph', 'openwebui', 'mcp', 'modelcontextprotocol', 'elevenlabs', 'midjourney', 'stabilityai', 'runway', 'cohere', 'groq', 'together', 'togetherai', 'replicate', 'nvidia', 'googlecolab', 'kaggle', 'weightsandbiases', 'pytorch', 'tensorflow', 'keras', 'jupyter'],
  web: ['astro', 'remix', 'solid', 'qwik', 'htmx', 'alpinedotjs', 'hono', 'elysia', 'fastify', 'nestjs', 'nuxt', 'sveltekit', 'tauri', 'electron', 'expo', 'trpc', 'zod', 'tanstack', 'reactquery', 'reactrouter', 'shadcnui', 'radixui', 'daisyui', 'chakraui', 'mui', 'threedotjs', 'pixijs', 'phaser', 'godotengine', 'leaflet', 'mapbox', 'stripe', 'paypal', 'shopify', 'wordpress', 'strapi', 'sanity', 'contentful', 'ghost', 'payloadcms', 'directus', 'clerk', 'auth0', 'okta', 'keycloak', 'supertokens', 'socketdotio', 'livewire', 'inertia', 'filament'],
  db: ['supabase', 'firebase', 'appwrite', 'pocketbase', 'neon', 'planetscale', 'turso', 'upstash', 'redis', 'drizzle', 'prisma', 'sqlite', 'duckdb', 'clickhouse', 'snowflake', 'databricks', 'cockroachlabs', 'surrealdb', 'neo4j', 'mongodb', 'elasticsearch', 'meilisearch', 'algolia', 'typesense', 'apachekafka', 'rabbitmq', 'nats', 'pinecone', 'qdrant', 'weaviate', 'milvus', 'dbeaver', 'tableplus', 'metabase', 'apachesuperset', 'airtable', 'json', 'yaml', 'toml', 'csv'],
  cloud: ['vercel', 'netlify', 'cloudflare', 'cloudflarepages', 'cloudflareworkers', 'render', 'railway', 'flydotio', 'heroku', 'digitalocean', 'hetzner', 'ovh', 'scaleway', 'linode', 'vultr', 'amazonwebservices', 'amazons3', 'awslambda', 'googlecloud', 'microsoftazure', 'githubactions', 'gitlab', 'bitbucket', 'gitea', 'forgejo', 'jenkins', 'circleci', 'travisci', 'argo', 'helm', 'terraform', 'opentofu', 'ansible', 'pulumi', 'vagrant', 'packer', 'consul', 'vault', 'nomad', 'nginx', 'caddy', 'traefikproxy', 'apache', 'haproxy', 'grafana', 'prometheus', 'datadog', 'newrelic', 'sentry', 'pagerduty', 'opentelemetry', 'portainer', 'rancher', 'coolify', 'dokku', 'podman', 'docker', 'kubernetes', 'k3s', 'minikube', 'letsencrypt', 'tailscale', 'wireguard', 'ngrok'],
  tools: ['bun', 'deno', 'pnpm', 'yarn', 'npm', 'vite', 'webpack', 'esbuild', 'rollup', 'turborepo', 'nx', 'biome', 'oxc', 'swc', 'babel', 'postman', 'insomnia', 'bruno', 'hoppscotch', 'swagger', 'openapiinitiative', 'graphql', 'warp', 'iterm2', 'windowsterminal', 'alacritty', 'wezterm', 'kitty', 'ghostty', 'tmux', 'zsh', 'ohmyzsh', 'fishshell', 'powershell', 'gnubash', 'neovim', 'vim', 'helix', 'zedindustries', 'sublimetext', 'visualstudiocode', 'vscodium', 'jetbrains', 'github', 'git', 'gitkraken', 'sourcetree', 'lazygit', 'githubcli', 'homebrew', 'chocolatey', 'scoop', 'winget', 'raycast', 'alfred', 'obsidian', 'notion', 'linear', 'jira', 'confluence', 'trello', 'asana', 'clickup', 'slack', 'discord', 'microsoftteams', 'zoom', 'loom', 'excalidraw', 'mermaid', 'drawio', 'markdown', 'mdx', 'latex', 'stackoverflow', 'devdotto', 'hashnode', 'medium', 'readthedocs', 'gitbook', 'docusaurus', 'mintlify', 'webassembly', 'wasmer', 'regex101', 'jsonwebtokens', 'curl', 'wireshark', 'cmake', 'make', 'gradle', 'apachemaven', 'cargo', 'composer', 'pypi', 'poetry', 'uv', 'conda', 'anaconda', 'nodedotjs', 'nvm'],
  test: ['vitest', 'jest', 'playwright', 'cypress', 'puppeteer', 'selenium', 'testinglibrary', 'mocha', 'pytest', 'junit5', 'storybook', 'chromatic', 'eslint', 'prettier', 'stylelint', 'sonarqube', 'sonarcloud', 'codecov', 'coveralls', 'dependabot', 'renovatebot', 'snyk', 'trivy', 'owasp', 'lighthouse', 'k6', 'postcss', 'husky', 'commitlint', 'semanticrelease', 'conventionalcommits'],
  os: ['linux', 'ubuntu', 'debian', 'fedora', 'archlinux', 'manjaro', 'linuxmint', 'popos', 'nixos', 'alpinelinux', 'centos', 'redhat', 'opensuse', 'gentoo', 'kalilinux', 'freebsd', 'openbsd', 'macos', 'apple', 'ios', 'android', 'windows', 'windows11', 'raspberrypi', 'arduino', 'espressif', 'wsl', 'virtualbox', 'vmware', 'proxmox', 'qemu'],
  design: ['figma', 'sketch', 'penpot', 'framer', 'adobephotoshop', 'adobeillustrator', 'adobexd', 'inkscape', 'gimp', 'blender', 'canva', 'dribbble', 'behance', 'iconify', 'fontawesome', 'googlefonts', 'tailwindcss', 'sass', 'css', 'html5', 'lucide'],
};
const siMissing = [];
for (const [cat, slugs] of Object.entries(SI)) {
  for (const slug of slugs) {
    const s = siBySlug.get(slug);
    if (!s) { siMissing.push(slug); continue; }
    // Pas de doublon avec devicon (sauf l'IA : le logo officiel est plus lisible)
    if (cat !== 'ia' && deviconNames.has(norm(slug))) continue;
    if (cat === 'ia' && ids.has('dv:' + slug)) continue;
    let hex = '#' + s.hex;
    const n = parseInt(s.hex, 16), lum = (0.2126 * (n >> 16) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255;
    if (lum > 0.82) hex = '#2b2f38'; // couleur trop claire pour la plaquette blanche
    push({ id: 'si:' + slug, label: s.title, cat, path: s.path, color: hex, kw: (slug + ' ' + s.title + ' ' + (s.aliases?.aka || []).join(' ')).toLowerCase() });
  }
}

// ---------- lucide : pictogrammes ----------
const LU = {
  dev: {
    'square-terminal': 'Terminal', terminal: 'Invite de commande', 'code-xml': 'Code', code: 'Balises', braces: 'Accolades', brackets: 'Crochets', regex: 'Regex', binary: 'Binaire', variable: 'Variable', 'square-function': 'Fonction', sigma: 'Somme', hash: 'Dièse', 'at-sign': 'Arobase',
    server: 'Serveur', 'server-cog': 'Serveur (réglages)', 'server-crash': 'Serveur en panne', database: 'Base de données', 'database-zap': 'Base de données rapide', 'hard-drive': 'Disque dur', 'memory-stick': 'Mémoire', cpu: 'Processeur', microchip: 'Puce', 'circuit-board': 'Circuit', container: 'Conteneur', package: 'Paquet', boxes: 'Paquets', layers: 'Couches', component: 'Composant', puzzle: 'Extension', plug: 'Prise', 'plug-zap': 'Branchement', cable: 'Câble', unplug: 'Débranché',
    cloud: 'Cloud', 'cloud-upload': 'Envoi cloud', 'cloud-download': 'Téléchargement cloud', 'cloud-cog': 'Cloud (réglages)', 'cloud-lightning': 'Orage', network: 'Réseau', router: 'Routeur', wifi: 'Wi-Fi', globe: 'Internet', link: 'Lien', webhook: 'Webhook', workflow: 'Workflow', 'app-window': 'Page web', monitor: 'Écran', 'monitor-smartphone': 'Responsive', laptop: 'Portable', smartphone: 'Smartphone', tablet: 'Tablette', keyboard: 'Clavier', mouse: 'Souris', usb: 'USB', bluetooth: 'Bluetooth',
    'git-branch': 'Branche', 'git-commit-horizontal': 'Commit', 'git-merge': 'Merge', 'git-pull-request': 'Pull request', 'git-fork': 'Fork', 'git-compare': 'Comparer', 'git-graph': 'Graphe git', 'folder-git-2': 'Dépôt git', diff: 'Diff', 'file-diff': 'Fichier diff',
    'file-code': 'Fichier de code', 'file-terminal': 'Script', 'file-cog': 'Configuration', 'file-text': 'Fichier texte', files: 'Fichiers', folder: 'Dossier', 'folder-open': 'Dossier ouvert', 'folder-code': 'Projet', 'folder-tree': 'Arborescence', archive: 'Archive', save: 'Enregistrer', download: 'Télécharger', upload: 'Envoyer',
    bug: 'Bug', 'bug-off': 'Bug corrigé', 'test-tube': 'Éprouvette', 'test-tubes': 'Éprouvettes', 'flask-conical': 'Fiole', 'list-checks': 'Checklist', 'list-todo': 'À faire', 'circle-check': 'Validé', 'check-check': 'Tout validé', 'octagon-x': 'Erreur', info: 'Info', 'search-code': 'Recherche de code', search: 'Loupe', 'scan-search': 'Inspection',
    lock: 'Cadenas', 'lock-open': 'Ouvert', 'lock-keyhole': 'Sécurisé', key: 'Clé', 'key-round': 'Clé ronde', shield: 'Bouclier', 'shield-check': 'Protégé', 'shield-half': 'Sécurité', vault: 'Coffre', 'scan-face': 'Reconnaissance', 'id-card': 'Identité', 'user-cog': 'Admin',
    zap: 'Électricité', 'battery-full': 'Pile', 'battery-charging': 'En charge', power: 'Alimentation', gauge: 'Performance', activity: 'Activité', 'chart-line': 'Courbe', 'layout-dashboard': 'Tableau de bord', kanban: 'Kanban', table: 'Tableau', sheet: 'Feuille', timer: 'Minuteur', clock: 'Horloge', hourglass: 'Sablier', 'refresh-cw': 'Rafraîchir', repeat: 'Boucle', infinity: 'Infini', bell: 'Notification', mail: 'E-mail', 'message-square': 'Message', 'bot-message-square': 'Chatbot',
    bot: 'Robot', brain: 'Cerveau', 'brain-circuit': 'IA', sparkles: 'Magie IA', 'wand-sparkles': 'Baguette', rocket: 'Fusée', settings: 'Réglages', cog: 'Engrenage', 'sliders-horizontal': 'Curseurs', 'toggle-right': 'Interrupteur', command: 'Commande', option: 'Option', 'text-cursor-input': 'Saisie', type: 'Texte', route: 'Route', split: 'Séparer', merge: 'Fusionner', target: 'Cible', crosshair: 'Viseur',
    wrench: 'Clé à molette', hammer: 'Marteau', drill: 'Perceuse', pickaxe: 'Pioche', construction: 'Chantier', ruler: 'Règle', 'pen-tool': 'Plume', palette: 'Palette', 'book-open': 'Documentation', 'notebook-pen': 'Carnet', library: 'Bibliothèque', clipboard: 'Presse-papiers', 'clipboard-check': 'Revue', 'sticky-note': 'Post-it', scroll: 'Parchemin', 'life-buoy': 'Support',
  },
  fun: {
    coffee: 'Tasse de café', pizza: 'Pizza', lightbulb: 'Ampoule', flame: 'Flamme', flag: 'Drapeau', pencil: 'Crayon', 'brush-cleaning': 'Balai', bomb: 'Bombe', 'dice-5': 'Dé', shuffle: 'Hasard', 'gamepad-2': 'Manette', headphones: 'Casque', mic: 'Micro', camera: 'Appareil photo', image: 'Image', video: 'Vidéo', tv: 'Télé', printer: 'Imprimante', flashlight: 'Lampe torche', lamp: 'Lampe',
    'graduation-cap': 'Diplôme', trophy: 'Trophée', medal: 'Médaille', award: 'Récompense', crown: 'Couronne', star: 'Étoile', heart: 'Cœur', gift: 'Cadeau', 'party-popper': 'Fête', cake: 'Gâteau', ghost: 'Fantôme', skull: 'Crâne', 'hand-metal': 'Rock', 'thumbs-up': 'Pouce',
    atom: 'Atome', dna: 'ADN', microscope: 'Microscope', telescope: 'Télescope', orbit: 'Orbite', satellite: 'Satellite', 'satellite-dish': 'Parabole', radio: 'Radio', antenna: 'Antenne', compass: 'Boussole', map: 'Carte', 'map-pin': 'Repère', anchor: 'Ancre', ship: 'Bateau', plane: 'Avion', car: 'Voiture', truck: 'Camion', bike: 'Vélo', tent: 'Tente', mountain: 'Montagne',
    sun: 'Soleil', moon: 'Lune', snowflake: 'Flocon', droplet: 'Goutte', rainbow: 'Arc-en-ciel', 'tree-pine': 'Sapin', leaf: 'Feuille', sprout: 'Pousse', cat: 'Chat', dog: 'Chien', rabbit: 'Lapin', bird: 'Oiseau', fish: 'Poisson', turtle: 'Tortue', snail: 'Escargot', squirrel: 'Écureuil', egg: 'Œuf', apple: 'Pomme', cherry: 'Cerises', shell: 'Coquillage',
    'shopping-cart': 'Panier', 'credit-card': 'Carte bancaire', wallet: 'Portefeuille', store: 'Boutique', receipt: 'Reçu', 'qr-code': 'QR code', barcode: 'Code-barres', tag: 'Étiquette', bookmark: 'Marque-page', pin: 'Punaise', calendar: 'Calendrier', 'alarm-clock': 'Réveil', umbrella: 'Parapluie', thermometer: 'Thermomètre', siren: 'Sirène', ambulance: 'Ambulance', pill: 'Pilule', syringe: 'Seringue', beaker: 'Bécher', pipette: 'Pipette',
  },
  symbols: {
    circle: 'Cercle', square: 'Carré', triangle: 'Triangle', diamond: 'Losange', pentagon: 'Pentagone', hexagon: 'Hexagone', octagon: 'Octogone', shapes: 'Formes',
    plus: 'Plus', minus: 'Moins', equal: 'Égal', divide: 'Division', percent: 'Pourcentage', pi: 'Pi', omega: 'Oméga', radical: 'Racine carrée', asterisk: 'Astérisque',
    'circle-plus': 'Ajouter', 'circle-minus': 'Retirer', 'circle-question-mark': 'Question', 'circle-exclamation-point': 'Alerte', 'triangle-exclamation-point': 'Attention', 'badge-check': 'Certification', 'badge-exclamation-point': 'Avertissement', 'badge-info': 'Information', check: 'Coche', x: 'Croix', ban: 'Interdit',
    'arrow-up': 'Flèche haut', 'arrow-down': 'Flèche bas', 'arrow-left': 'Flèche gauche', 'arrow-right': 'Flèche droite', 'arrow-up-right': 'Flèche diagonale', 'arrows-up-from-line': 'Flèches montantes', 'chevrons-left-right': 'Chevrons', move: 'Déplacement', expand: 'Agrandir', shrink: 'Réduire', navigation: 'Direction',
    recycle: 'Recyclage', radiation: 'Radioactivité', biohazard: 'Risque biologique', 'circle-dot': 'Point central', handshake: 'Entente', accessibility: 'Accessibilité', scale: 'Équilibre', 'file-music': 'Partition musicale', 'volume-2': 'Son', 'volume-x': 'Muet',
  },
};
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
const luMissing = [];
for (const [cat, list] of Object.entries(LU)) {
  for (const [name, label] of Object.entries(list)) {
    const nodes = lucide[name];
    if (!nodes) { luMissing.push(name); continue; }
    const body = nodes.map(([tag, attrs]) => `<${tag} ${Object.entries(attrs).map(([k, v]) => `${k}="${esc(v)}"`).join(' ')}/>`).join('');
    push({ id: 'lu:' + name, label, cat, body, kw: (name.replace(/-/g, ' ') + ' ' + label).toLowerCase() });
  }
}

// Réutilise la même base Unicode que le sélecteur d'emojis.
const emojiContext = { window: {} };
vm.runInNewContext(fs.readFileSync(path.join(root, 'renderer', 'emoji-data.js'), 'utf8'), emojiContext);
const emojiData = emojiContext.window.EMOJI_DATA;
for (const [emoji, label, group] of emojiData.emojis) {
  const codepoints = Array.from(emoji, (character) => character.codePointAt(0).toString(16)).join('-');
  push({ id: 'emoji:' + codepoints, label, cat: 'emoji', emoji, kw: `${emoji} ${label} ${emojiData.groups[group][1]} emoji`.toLowerCase() });
}

// Pictogrammes nommés pour les clients dont le logo n'est pas fourni par nos catalogues.
const CLI = {
  opencode: ['OpenCode', 'square-terminal'], aider: ['Aider', 'code-xml'],
  goose: ['Goose', 'bird'], amp: ['Amp', 'zap'], continue: ['Continue CLI', 'infinity'],
  kiro: ['Kiro CLI', 'ghost'], auggie: ['Augment Auggie', 'layers'],
  crush: ['Crush', 'gem'], openhands: ['OpenHands CLI', 'hand'],
  llm: ['LLM', 'message-square'],
  droid: ['Factory Droid', 'bot'], kilo: ['Kilo Code CLI', 'square-code'],
  plandex: ['Plandex', 'list-todo'], interpreter: ['Open Interpreter', 'terminal'],
  'amazon-q': ['Amazon Q Developer CLI', 'message-circle'],
};
for (const [id, [label, name]] of Object.entries(CLI)) {
  const nodes = lucide[name];
  if (!nodes) throw new Error(`Pictogramme CLI introuvable : ${name}`);
  const body = nodes.map(([tag, attrs]) => `<${tag} ${Object.entries(attrs).map(([k, v]) => `${k}="${esc(v)}"`).join(' ')}/>`).join('');
  push({ id: 'cli:' + id, label, cat: 'ia', body, kw: `${id} ${label} cli ia ai agent terminal`.toLowerCase() });
}

// Anciens identifiants d'outils (robots déjà personnalisés / tirés au hasard)
const ALIASES = {
  server: 'lu:server', database: 'lu:database', git: 'dv:git', terminal: 'lu:square-terminal', code: 'lu:code-xml', chip: 'lu:cpu', cloud: 'lu:cloud', lock: 'lu:lock', bug: 'lu:bug', electricity: 'lu:zap', battery: 'lu:battery-full', internet: 'lu:globe', webpage: 'lu:app-window',
  wrench: 'lu:wrench', hammer: 'lu:hammer', screwdriver: 'lu:drill', magnifier: 'lu:search', mug: 'lu:coffee', lightbulb: 'lu:lightbulb', flag: 'lu:flag', pencil: 'lu:pencil', testtube: 'lu:test-tube', shield: 'lu:shield', wand: 'lu:wand-sparkles', broom: 'lu:brush-cleaning', laptop: 'lu:laptop',
  codex: 'dv:codex', claude: 'dv:claude', copilot: 'si:githubcopilot', vibe: 'si:mistralai',
};
for (const [k, v] of Object.entries(ALIASES)) if (!ids.has(v)) console.warn('alias cassé', k, v);

const order = Object.fromEntries(CATS.map(([c], i) => [c, i]));
out.sort((a, b) => order[a.cat] - order[b.cat] || a.label.localeCompare(b.label, 'fr'));
const counts = {};
for (const it of out) counts[it.cat] = (counts[it.cat] || 0) + 1;

const js = `// Fichier généré par scripts/build-tool-icons.js — ne pas modifier à la main.
// Sources : devicon (MIT), simple-icons (CC0), lucide (ISC), emoji-data.js (Unicode).
window.ToolIconData = ${JSON.stringify({ cats: CATS.filter(([c]) => counts[c]).map(([id, label]) => ({ id, label, count: counts[id] })), aliases: ALIASES, icons: out })};
`;
fs.writeFileSync(path.join(root, 'renderer', 'tool-icons-data.js'), js);
console.log(`${out.length} icônes`, counts, `(${(js.length / 1024).toFixed(0)} Ko)`);
if (siMissing.length) console.log('simple-icons introuvables :', siMissing.join(' '));
if (luMissing.length) console.log('lucide introuvables :', luMissing.join(' '));
