(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory;
  else root.Platform = factory(root.api?.platform || root.splash?.platform || 'linux');
})(typeof window === 'object' ? window : globalThis, function (platform) {
  const isMac = platform === 'darwin';
  const isWindows = platform === 'win32';
  const separator = (p) => /^[a-z]:|^\\\\/i.test(p) || (isWindows && !p.startsWith('/')) ? '\\' : '/';
  const pathKey = (p) => {
    let key = String(p || '');
    if (isWindows) key = key.replace(/\//g, '\\').toLowerCase();
    return key.replace(/[\\/]+$/, '') || (key.startsWith('/') ? '/' : key);
  };
  const joinPath = (root, ...parts) => {
    const sep = separator(root);
    return [root.replace(/[\\/]+$/, ''), ...parts.map((p) => String(p).replace(/^[\\/]+|[\\/]+$/g, '').replace(/[\\/]/g, sep))].join(sep);
  };
  const parentPath = (p) => {
    const clean = p.replace(/[\\/]+$/, '');
    const i = Math.max(clean.lastIndexOf('/'), clean.lastIndexOf('\\'));
    if (i === 0) return '/';
    if (i === 2 && /^[a-z]:/i.test(clean)) return clean.slice(0, 3);
    return i > 0 ? clean.slice(0, i) : p;
  };
  const withinPath = (p, root) => {
    const a = pathKey(p), b = pathKey(root);
    const prefix = b.endsWith('/') || b.endsWith('\\') ? b : b + separator(root);
    return a === b || a.startsWith(prefix);
  };
  return {
    isMac, isWindows, pathKey, joinPath, parentPath, withinPath,
    primary: (e) => e.ctrlKey || (isMac && e.metaKey),
    copyModifier: (e) => isMac ? e.altKey : e.ctrlKey,
    quoteShell: (s) => isWindows ? `"${String(s).replace(/"/g, '\\"')}"` : "'" + String(s).replace(/'/g, "'\\''") + "'",
  };
});
