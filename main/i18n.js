// RobotConsole — traduction des textes natifs du processus principal (boîtes de dialogue…)
// Même dictionnaire que l'interface (renderer/i18n-en.js). La langue est lue dans settings.json.
const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const EN = require('../renderer/i18n-en.js');

function lang() {
  let pref = 'auto';
  try { pref = JSON.parse(fs.readFileSync(path.join(app.getPath('userData'), 'settings.json'), 'utf8')).language || 'auto'; } catch {}
  if (pref === 'fr' || pref === 'en') return pref;
  return (app.getLocale() || 'fr').toLowerCase().startsWith('fr') ? 'fr' : 'en';
}

// t('Texte français {0}', valeur) → texte dans la langue choisie
function t(fr, ...vars) {
  const out = lang() === 'en' && EN[fr] != null ? EN[fr] : fr;
  return out.replace(/\{(\d+)\}/g, (_, n) => (vars[n] ?? ''));
}

module.exports = { t, lang };
