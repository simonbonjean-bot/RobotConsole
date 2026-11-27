(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Shortcuts = factory();
})(typeof window === 'object' ? window : globalThis, function () {
  const actions = [
    ['palette', 'Palette de commandes', ['Primary+Shift+Space']],
    ['settings', 'Paramètres', ['Primary+Comma']],
    ['workspaceOpen', 'Ouvrir un workspace', ['Primary+KeyO']],
    ['workspacePrevious', 'Workspace précédent', ['Primary+Alt+ArrowUp']],
    ['workspaceNext', 'Workspace suivant', ['Primary+Alt+ArrowDown']],
    ['spaceNew', 'Nouvel espace terminal', ['Primary+Shift+KeyN']],
    ['tabNew', 'Nouveau terminal', ['Primary+Shift+KeyT']],
    ['explorer', 'Explorateur de fichiers', ['Primary+Shift+KeyE']],
    ['prompt', 'Rédiger un prompt', ['Primary+Shift+KeyP']],
    ['tabClose', "Fermer l'onglet actif", ['Primary+Shift+KeyW']],
    ['maximize', "Agrandir / restaurer l'espace", ['Primary+Shift+KeyM']],
    ['layout', 'Dispositions suggérées', ['Primary+Shift+KeyL']],
    ['tabPrevious', 'Onglet précédent', ['Primary+Alt+ArrowLeft', 'Ctrl+Shift+Tab']],
    ['tabNext', 'Onglet suivant', ['Primary+Alt+ArrowRight', 'Ctrl+Tab']],
    ['zonePrevious', 'Zone précédente', ['Primary+Shift+ArrowLeft', 'Alt+ArrowLeft']],
    ['zoneNext', 'Zone suivante', ['Primary+Shift+ArrowRight', 'Alt+ArrowRight']],
    ['screenPrevious', 'Écran précédent', ['Primary+Shift+Alt+ArrowLeft']],
    ['screenNext', 'Écran suivant', ['Primary+Shift+Alt+ArrowRight']],
    ...Array.from({ length: 9 }, (_, i) => [`zone${i + 1}`, `Zone ${i + 1}`, [`Alt+Digit${i + 1}`]]),
    ...Array.from({ length: 9 }, (_, i) => [`screen${i + 1}`, `Écran ${i + 1}`, [`Primary+Alt+Digit${i + 1}`]]),
  ].map(([id, label, defaults]) => ({ id, label, defaults }));
  const modifiers = ['Ctrl', 'Meta', 'Alt', 'Shift'];
  function expand(binding, isMac) {
    return binding.replace('Primary', isMac ? 'Meta' : 'Ctrl').split('+');
  }
  function signature(binding, isMac = false) {
    const parts = expand(binding, isMac), code = parts.pop();
    return [...modifiers.filter((m) => parts.includes(m)), code].join('+');
  }
  function signatures(binding, isMac) {
    const values = [signature(binding, isMac)];
    if (isMac && binding.includes('Primary')) values.push(signature(binding, false));
    return values;
  }
  function valid(binding) {
    if (typeof binding !== 'string') return false;
    const parts = binding.split('+'), code = parts.pop();
    return /^(Key[A-Z]|Digit[0-9]|F[1-9]|F1[01]|Arrow(Left|Right|Up|Down)|Comma|Period|Slash|Backslash|BracketLeft|BracketRight|Semicolon|Quote|Backquote|Minus|Equal|Space|Tab|Enter|Home|End|PageUp|PageDown|Insert|Delete|Backspace)$/.test(code) &&
      parts.every((m) => [...modifiers, 'Primary'].includes(m)) && new Set(parts).size === parts.length &&
      !(parts.includes('Primary') && (parts.includes('Ctrl') || parts.includes('Meta'))) &&
      (parts.length > 0 || /^(F\d+|Home|End|PageUp|PageDown|Insert|Delete)$/.test(code));
  }
  function bindings(action, overrides = {}) {
    const values = Object.prototype.hasOwnProperty.call(overrides || {}, action.id) ? overrides[action.id] : action.defaults;
    return Array.isArray(values) ? values.filter(valid) : action.defaults;
  }
  function fromEvent(event) {
    if (event.isComposing || event.getModifierState?.('AltGraph') || !event.code) return null;
    const value = [...modifiers.filter((m) => event[{ Ctrl: 'ctrlKey', Meta: 'metaKey', Alt: 'altKey', Shift: 'shiftKey' }[m]]), event.code].join('+');
    return valid(value) ? value : null;
  }
  function match(event, overrides = {}, isMac = false) {
    const value = fromEvent(event);
    if (!value) return null;
    return actions.find((action) => bindings(action, overrides).some((binding) => signatures(binding, isMac).includes(value)))?.id || null;
  }
  function conflict(id, values, overrides = {}, isMac = false) {
    return actions.find((action) => action.id !== id && bindings(action, overrides).some((binding) =>
      values.some((value) => signatures(value, isMac).some((sig) => signatures(binding, isMac).includes(sig))))) || null;
  }
  function format(binding, isMac = false) {
    return expand(binding, isMac).map((part) => ({
      Meta: 'Cmd', Shift: 'Maj', ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓',
      Space: 'Espace', Comma: ',', Home: 'Début', End: 'Fin', PageUp: 'Page préc.', PageDown: 'Page suiv.',
    })[part] || part.replace(/^Key|^Digit/, '')).join('+');
  }
  return { actions, bindings, valid, fromEvent, match, conflict, format, signature };
});
