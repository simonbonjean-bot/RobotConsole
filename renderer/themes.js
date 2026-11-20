// RobotConsole — thèmes (interface + palette des terminaux + coloration syntaxique)
(function () {
  const T = (id, name, dark, ui, term, syn) => ({ id, name, dark, ui, term, syn });

  const THEMES = [
    T('minuit', 'Minuit', true,
      { bg: '#0e1117', panel: '#151a23', panel2: '#1b2130', border: '#262d3b', text: '#c9d1d9', muted: '#7d8696', accent: '#3fb6f5', hover: '#222a3b' },
      { foreground: '#c9d1d9', black: '#1b2130', red: '#ff7b72', green: '#7ee787', yellow: '#e3b341', blue: '#79c0ff', magenta: '#d2a8ff', cyan: '#56d4dd', white: '#c9d1d9',
        brightBlack: '#6e7681', brightRed: '#ffa198', brightGreen: '#aff5b4', brightYellow: '#f8e3a1', brightBlue: '#a5d6ff', brightMagenta: '#e2c5ff', brightCyan: '#b3f0ff', brightWhite: '#ffffff' },
      { kw: '#ff7b72', str: '#a5d6ff', num: '#79c0ff', com: '#6e7681', fn: '#d2a8ff', type: '#ffa657', attr: '#7ee787' }),

    T('aube', 'Aube (clair)', false,
      { bg: '#e9edf3', panel: '#ffffff', panel2: '#f4f6fa', border: '#d5dbe5', text: '#24292f', muted: '#6e7781', accent: '#0969da', hover: '#e6ebf2' },
      { foreground: '#24292f', black: '#24292f', red: '#cf222e', green: '#116329', yellow: '#9a6700', blue: '#0969da', magenta: '#8250df', cyan: '#1b7c83', white: '#6e7781',
        brightBlack: '#57606a', brightRed: '#a40e26', brightGreen: '#1a7f37', brightYellow: '#7d4e00', brightBlue: '#218bff', brightMagenta: '#a475f9', brightCyan: '#3192aa', brightWhite: '#8c959f' },
      { kw: '#cf222e', str: '#0a3069', num: '#0550ae', com: '#6e7781', fn: '#8250df', type: '#953800', attr: '#116329' }),

    T('ocean', 'Océan', true,
      { bg: '#0a1520', panel: '#0f1e2d', panel2: '#132638', border: '#1f3a52', text: '#cfe3f2', muted: '#6f8ea8', accent: '#4fc3f7', hover: '#183049' },
      { foreground: '#cfe3f2', black: '#132638', red: '#f07178', green: '#9fe07c', yellow: '#ffcb6b', blue: '#82aaff', magenta: '#c792ea', cyan: '#5ce1e6', white: '#cfe3f2',
        brightBlack: '#5d7a92', brightRed: '#ff9ca3', brightGreen: '#c3f5a5', brightYellow: '#ffe0a3', brightBlue: '#b0c9ff', brightMagenta: '#e0bfff', brightCyan: '#a6f4f7', brightWhite: '#ffffff' },
      { kw: '#c792ea', str: '#9fe07c', num: '#f78c6c', com: '#5d7a92', fn: '#82aaff', type: '#ffcb6b', attr: '#5ce1e6' }),

    T('foret', 'Forêt', true,
      { bg: '#0f1410', panel: '#151c16', panel2: '#1b241c', border: '#2a382b', text: '#d6dfcc', muted: '#7f8f7a', accent: '#8bc34a', hover: '#223024' },
      { foreground: '#d6dfcc', black: '#1b241c', red: '#e67e80', green: '#a7c080', yellow: '#dbbc7f', blue: '#7fbbb3', magenta: '#d699b6', cyan: '#83c092', white: '#d6dfcc',
        brightBlack: '#6b7a66', brightRed: '#f0a0a2', brightGreen: '#c4dba0', brightYellow: '#ecd3a0', brightBlue: '#a3d4cd', brightMagenta: '#ebbcd2', brightCyan: '#a8dbb5', brightWhite: '#f3f7ee' },
      { kw: '#e67e80', str: '#a7c080', num: '#d699b6', com: '#6b7a66', fn: '#83c092', type: '#dbbc7f', attr: '#7fbbb3' }),

    T('neon', 'Néon', true,
      { bg: '#110820', panel: '#180d2a', panel2: '#211436', border: '#3a2257', text: '#f0e6ff', muted: '#9a85b8', accent: '#ff4fd8', hover: '#2c1a46' },
      { foreground: '#f0e6ff', black: '#211436', red: '#ff5c8a', green: '#3dffb0', yellow: '#ffe66b', blue: '#5cb8ff', magenta: '#ff4fd8', cyan: '#3df2ff', white: '#f0e6ff',
        brightBlack: '#6f5a8f', brightRed: '#ff8fb0', brightGreen: '#8affd2', brightYellow: '#fff0a3', brightBlue: '#9ad4ff', brightMagenta: '#ff94e8', brightCyan: '#8ff8ff', brightWhite: '#ffffff' },
      { kw: '#ff4fd8', str: '#3dffb0', num: '#ffe66b', com: '#6f5a8f', fn: '#3df2ff', type: '#ff9a5c', attr: '#5cb8ff' }),

    T('contraste', 'Contraste élevé', true,
      { bg: '#000000', panel: '#000000', panel2: '#0d0d0d', border: '#bfbfbf', text: '#ffffff', muted: '#d0d0d0', accent: '#ffd800', hover: '#262626' },
      { foreground: '#ffffff', black: '#000000', red: '#ff5555', green: '#55ff55', yellow: '#ffff55', blue: '#66a3ff', magenta: '#ff66ff', cyan: '#55ffff', white: '#e0e0e0',
        brightBlack: '#9a9a9a', brightRed: '#ff8080', brightGreen: '#80ff80', brightYellow: '#ffff99', brightBlue: '#99c2ff', brightMagenta: '#ff99ff', brightCyan: '#99ffff', brightWhite: '#ffffff' },
      { kw: '#ffd800', str: '#55ff55', num: '#66a3ff', com: '#b0b0b0', fn: '#55ffff', type: '#ff8080', attr: '#ff66ff' }),
  ];

  let current = THEMES[0];

  function get(id) {
    return THEMES.find((t) => t.id === id) || THEMES[0];
  }

  function apply(id) {
    current = get(id);
    const t = current;
    const s = document.documentElement.style;
    s.setProperty('--bg', t.ui.bg);
    s.setProperty('--panel', t.ui.panel);
    s.setProperty('--panel-2', t.ui.panel2);
    s.setProperty('--border', t.ui.border);
    s.setProperty('--text', t.ui.text);
    s.setProperty('--muted', t.ui.muted);
    s.setProperty('--accent', t.ui.accent);
    s.setProperty('--hover', t.ui.hover);
    // Couleurs Git / diff dérivées de la palette du terminal
    s.setProperty('--git-m', t.term.yellow);
    s.setProperty('--git-a', t.term.green);
    s.setProperty('--git-u', t.term.green);
    s.setProperty('--git-d', t.term.red);
    s.setProperty('--git-r', t.term.blue);
    s.setProperty('--git-c', t.term.magenta);
    for (const [k, v] of Object.entries(t.syn)) s.setProperty(`--syn-${k}`, v);
    document.documentElement.dataset.mode = t.dark ? 'dark' : 'light';
    window.api?.setTitleBar(t.ui.bg, t.ui.text);
    return t;
  }

  // Palette xterm pour le thème courant, avec les couleurs du robot de l'espace
  function terminal(bot) {
    const t = current;
    const curL = t.dark ? 65 : 42;
    return {
      ...t.term,
      background: t.ui.panel,
      cursor: hsl(bot.accentHue, 90, curL),
      cursorAccent: t.ui.panel,
      selectionBackground: hsl(bot.hue, 60, t.dark ? 40 : 75) + '88',
    };
  }

  // Couleur d'accent d'un espace selon le robot et la luminosité du thème
  function spaceAccent(bot) {
    return current.id === 'contraste' ? hsl(bot.hue, 100, 70) : hsl(bot.hue, 75, current.dark ? 66 : 42);
  }

  function hsl(h, s, l) {
    s /= 100; l /= 100;
    const k = (n) => (n + h / 30) % 12;
    const a = s * Math.min(l, 1 - l);
    const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
    return '#' + [f(0), f(8), f(4)].map((x) => Math.round(x * 255).toString(16).padStart(2, '0')).join('');
  }

  window.Themes = { list: THEMES, get, apply, terminal, spaceAccent, get current() { return current; } };
})();
