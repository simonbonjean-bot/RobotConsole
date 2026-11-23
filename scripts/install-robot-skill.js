const fs = require('fs');
const path = require('path');
const os = require('os');

function inspect(root) {
  const source = fs.readFileSync(path.join(__dirname, '..', 'skills', 'robot-say', 'SKILL.md'));
  return ['.claude', '.agents'].map((folder) => {
    const target = path.join(root, folder, 'skills', 'robot-say', 'SKILL.md');
    return { path: target, state: !fs.existsSync(target) ? 'missing' : fs.readFileSync(target).equals(source) ? 'installed' : 'conflict' };
  });
}

function install(root, force = false) {
  const files = inspect(root);
  const conflicts = files.filter((file) => file.state === 'conflict');
  if (conflicts.length && !force) {
    const error = new Error(`Skill existant différent : ${conflicts[0].path}. Utilisez --force uniquement pour le remplacer.`);
    error.code = 'SKILL_CONFLICT';
    error.files = conflicts.map((file) => file.path);
    throw error;
  }
  const source = fs.readFileSync(path.join(__dirname, '..', 'skills', 'robot-say', 'SKILL.md'));
  const targets = files.map((file) => file.path);
  for (const target of targets) {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, source);
  }
  return targets;
}

if (require.main === module) {
  try {
    const args = process.argv.slice(2);
    let root = process.cwd(), force = false;
    for (let i = 0; i < args.length; i++) {
      if (args[i] === '--user') root = os.homedir();
      else if (args[i] === '--project') {
        if (!args[i + 1] || args[i + 1].startsWith('--')) throw new Error('--project nécessite un dossier.');
        root = path.resolve(args[++i]);
      } else if (args[i] === '--force') force = true;
      else throw new Error(`Option inconnue : ${args[i]}`);
    }
    for (const target of install(root, force)) console.log(target);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}

module.exports = { install, inspect };
