// Presets portables : dossier du workspace, shell par défaut, aucune installation automatique.
(function () {
  const tab = (id, name, kind, icon, commands = '') => ({
    id: `preset-tab-${id}`, name, kind, icon: `tool:${icon}`, dir: '', shellId: '', commands,
  });
  const clients = [
    ['claude', 'Claude Code', 'claude', 'dv:claudecode'],
    ['codex', 'OpenAI Codex', 'codex', 'dv:codex'],
    ['copilot', 'GitHub Copilot CLI', 'copilot', 'si:githubcopilot'],
    ['gemini', 'Gemini CLI', 'gemini', 'si:googlegemini'],
    ['opencode', 'OpenCode', 'opencode', 'cli:opencode'],
    ['aider', 'Aider', 'aider', 'cli:aider'],
    ['goose', 'Goose', 'goose session', 'cli:goose'],
    ['amp', 'Amp', 'amp', 'cli:amp'],
    ['cursor', 'Cursor Agent', 'agent', 'dv:cursor'],
    ['qwen', 'Qwen Code', 'qwen', 'si:qwen'],
    ['kimi', 'Kimi CLI', 'kimi', 'si:kimi'],
    ['vibe', 'Mistral Vibe', 'vibe', 'si:mistralai'],
    ['continue', 'Continue CLI', 'cn', 'cli:continue'],
    ['cline', 'Cline CLI', 'cline', 'si:cline'],
    ['kiro', 'Kiro CLI', 'kiro-cli chat', 'cli:kiro'],
    ['auggie', 'Augment Auggie', 'auggie', 'cli:auggie'],
    ['crush', 'Crush', 'crush', 'cli:crush'],
    ['droid', 'Factory Droid', 'droid', 'cli:droid'],
    ['kilo', 'Kilo Code CLI', 'kilo', 'cli:kilo'],
    ['plandex', 'Plandex', 'plandex', 'cli:plandex'],
    ['interpreter', 'Open Interpreter', 'interpreter', 'cli:interpreter'],
    ['amazon-q', 'Amazon Q Developer CLI (legacy)', 'q chat', 'cli:amazon-q'],
    ['openhands', 'OpenHands CLI (legacy)', 'openhands', 'cli:openhands'],
    ['ollama', 'Ollama (chat local)', 'ollama run llama3.2', 'dv:ollama'],
    ['llm', 'LLM (chat)', 'llm chat', 'cli:llm'],
  ].map(([id, name, command, icon]) => tab(id, name, 'terminal', icon, command));
  const tools = [
    tab('terminal', 'Terminal du projet', 'terminal', 'lu:square-terminal'),
    tab('explorer', 'Fichiers du projet', 'explorer', 'lu:folder-code'),
    tab('tests', 'Tests du projet', 'tests', 'lu:test-tubes'),
    tab('services', 'Services du projet', 'services', 'lu:server'),
    tab('subscriptions', 'Abonnements IA', 'subscriptions', 'lu:brain-circuit'),
    tab('docker', 'Docker du projet', 'docker', 'dv:docker'),
    tab('prisma', 'Base de données du projet', 'prisma', 'lu:database'),
    tab('graphify', 'Graphe du projet', 'graphify', 'lu:git-graph'),
    { ...tab('browser', 'Aperçu local', 'browser', 'lu:globe'), url: 'http://localhost:3000' },
  ];
  const byId = new Map([...clients, ...tools].map((m) => [m.id.replace('preset-tab-', ''), m]));
  const zone = (id, name, icon, ids) => ({
    id: `preset-zone-${id}`, name, icon: `tool:${icon}`, activeTab: 0,
    tabs: ids.map((key) => ({ ...byId.get(key), id: `preset-zone-${id}-${key}` })),
  });
  const zones = [
    zone('coding', 'Développement assisté', 'dv:claudecode', ['claude', 'explorer', 'terminal']),
    zone('agents', 'Équipe IA', 'lu:brain-circuit', ['copilot', 'codex', 'gemini']),
    zone('local', 'IA locale', 'dv:ollama', ['ollama', 'aider', 'terminal']),
    zone('web', 'Développement web', 'lu:globe', ['explorer', 'terminal', 'services', 'browser']),
    zone('quality', 'Tests et qualité', 'lu:test-tubes', ['tests', 'explorer', 'terminal']),
    zone('ops', 'Services et données', 'dv:docker', ['services', 'docker', 'prisma', 'terminal']),
  ];
  const screen = (id, name, icon, zoneIds, dir = 'row') => ({
    id: `preset-screen-${id}`, name, icon: `tool:${icon}`, activeZone: 0,
    zones: zoneIds.map((key) => JSON.parse(JSON.stringify(zones.find((z) => z.id === `preset-zone-${key}`)))),
    layout: { t: 'split', dir, sizes: zoneIds.map(() => 1), children: zoneIds.map((_, i) => ({ t: 'leaf', i })) },
  });
  window.ModelPresets = {
    tab: [...clients, ...tools],
    zone: zones,
    screen: [
      screen('development', 'Développement complet', 'lu:code-xml', ['coding', 'web', 'quality']),
      screen('agents', 'Studio multi-agents', 'lu:brain-circuit', ['coding', 'agents']),
      screen('local', 'Atelier IA locale', 'dv:ollama', ['local', 'quality']),
      screen('ops', 'Pilotage du projet', 'lu:layout-dashboard', ['web', 'ops'], 'col'),
    ],
  };
})();
