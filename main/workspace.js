// RobotConsole — workspaces : un dossier qui contient un sous-dossier .robot
//   .robot/workspace.json  nom, robot, modèles, favoris (à partager / versionner)
//   .robot/services.json   services lancés par l'application
//   .robot/tests.json      (facultatif) commande de test personnalisée
//   .robot/state.json      disposition et sessions de la fenêtre (local, ignoré par git)
const fs = require('fs');
const path = require('path');

const DIR = '.robot';

function robotDir(root) { return path.join(root, DIR); }
function file(root, name) { return path.join(robotDir(root), name); }

function readJson(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; }
}
function writeJson(p, data) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(data, null, 2) + '\n');
}

function isWorkspace(root) {
  return fs.existsSync(file(root, 'workspace.json'));
}

// Crée le dossier .robot avec une configuration par défaut si besoin
function ensure(root) {
  const dir = robotDir(root);
  fs.mkdirSync(dir, { recursive: true });
  const ws = file(root, 'workspace.json');
  if (!fs.existsSync(ws)) {
    writeJson(ws, {
      $schema: 'robotconsole-workspace-1',
      name: path.basename(root),
      seed: Math.floor(Math.random() * 0xffffffff),
      templates: [],
      favorites: [],
      settings: {},
    });
  }
  const svc = file(root, 'services.json');
  if (!fs.existsSync(svc)) writeJson(svc, { services: [] });
  const gi = path.join(dir, '.gitignore');
  let en = false;
  try { en = require('./i18n').lang() === 'en'; } catch {}
  if (!fs.existsSync(gi)) fs.writeFileSync(gi, en ? '# Local RobotConsole window state\nstate.json\n' : '# État local de la fenêtre RobotConsole\nstate.json\n');
  const readme = path.join(dir, 'README.md');
  if (!fs.existsSync(readme)) {
    fs.writeFileSync(readme, (en ? [
      '# .robot folder',
      '',
      'RobotConsole workspace configuration.',
      '',
      '- `workspace.json`: name, robot (`seed`), templates (tabs, zones, screens), favorite folders, workspace-specific settings.',
      '- `services.json`: services started and monitored by the app (command, folder, port, health URL…).',
      '- `tests.json` (optional): `{ "command": "…", "junit": "path/report.xml" }` for a custom test runner.',
      '- `state.json`: window layout, local (ignored by git).',
      '',
    ] : [
      '# Dossier .robot',
      '',
      'Configuration du workspace RobotConsole.',
      '',
      '- `workspace.json` : nom, robot (`seed`), modèles (onglets, zones, écrans), dossiers favoris, réglages propres au workspace.',
      '- `services.json` : services lancés et surveillés par l\'application (commande, dossier, port, URL de santé…).',
      '- `tests.json` (facultatif) : `{ "command": "…", "junit": "chemin/rapport.xml" }` pour un lanceur de tests personnalisé.',
      '- `state.json` : disposition de la fenêtre, local (ignoré par git).',
      '',
    ]).join('\n'));
  }
  return load(root);
}

function load(root) {
  const cfg = readJson(file(root, 'workspace.json'), {});
  return {
    root,
    name: cfg.name || path.basename(root),
    seed: cfg.seed ?? 1,
    templates: cfg.templates || [],
    tabModels: cfg.tabModels || [],
    zoneModels: cfg.zoneModels || [],
    screenModels: cfg.screenModels || [],
    robot: cfg.robot || null,
    favorites: cfg.favorites || [],
    settings: cfg.settings || {},
  };
}

function update(root, patch) {
  const p = file(root, 'workspace.json');
  const cur = readJson(p, {});
  writeJson(p, { ...cur, ...patch });
  return load(root);
}

module.exports = { DIR, robotDir, file, readJson, writeJson, isWorkspace, ensure, load, update };
