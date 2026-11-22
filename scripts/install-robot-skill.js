const fs = require('fs');
const path = require('path');
const os = require('os');

function install(root, force = false) {
  const source = fs.readFileSync(path.join(__dirname, '..', 'skills', 'robot-say', 'SKILL.md'));
  const targets = ['.claude', '.agents'].map((folder) => path.join(root, folder, 'skills', 'robot-say', 'SKILL.md'));
  for (const target of targets) {
    if (fs.existsSync(target) && !fs.readFileSync(target).equals(source) && !force) {
      throw new Error(`Skill existant différent : ${target}. Utilisez --force uniquement pour le remplacer.`);
    }
  }
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

module.exports = { install };
