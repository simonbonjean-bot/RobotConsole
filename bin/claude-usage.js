#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const { claudeQuotas } = require('../main/subscriptions');

function capture(data, output) {
  const quotas = claudeQuotas(data);
  const snapshot = { updatedAt: new Date().toISOString(), quotas };
  fs.mkdirSync(path.dirname(output), { recursive: true });
  const temporary = `${output}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(temporary, JSON.stringify(snapshot), { mode: 0o600 });
    fs.renameSync(temporary, output);
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
  return quotas.map((q) => `${q.label}: ${q.usedPercent == null ? '?' : q.usedPercent}%`).join(' | ') || 'Claude : quota indisponible';
}

if (require.main === module) {
  let input = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => {
    input += chunk;
    if (input.length > 1024 * 1024) { console.error('Entrée Claude trop volumineuse.'); process.exit(1); }
  });
  process.stdin.on('end', () => {
    try {
      if (process.argv[2] !== '--output' || !path.isAbsolute(process.argv[3] || '')) throw new Error('Un chemin absolu --output est requis.');
      console.log(capture(JSON.parse(input), process.argv[3]));
    } catch {
      console.error('Impossible de publier les quotas Claude.');
      process.exitCode = 1;
    }
  });
}

module.exports = { capture };
