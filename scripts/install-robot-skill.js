const fs = require('fs');
const path = require('path');
const os = require('os');

const SKILLS = ['robot-say', 'robot-open', 'robot-services', 'robot-tests'];

function inspect(root, skills = SKILLS) {
  if (!skills.length || skills.some((skill) => !SKILLS.includes(skill)) || new Set(skills).size !== skills.length) {
    throw new Error(`Skills invalides. Choisissez parmi : ${SKILLS.join(', ')}.`);
  }
  return skills.flatMap((skill) => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'skills', skill, 'SKILL.md'));
    return ['.claude', '.agents'].map((folder) => {
      const target = path.join(root, folder, 'skills', skill, 'SKILL.md');
      return { skill, path: target, state: !fs.existsSync(target) ? 'missing' : fs.readFileSync(target).equals(source) ? 'installed' : 'conflict' };
    });
  });
}

function install(root, force = false, skills = SKILLS) {
  const files = inspect(root, skills);
  const conflicts = files.filter((file) => file.state === 'conflict');
  if (conflicts.length && !force) {
    const error = new Error(`Skill existant différent : ${conflicts[0].path}. Utilisez --force uniquement pour le remplacer.`);
    error.code = 'SKILL_CONFLICT';
    error.files = conflicts.map((file) => file.path);
    throw error;
  }
  const targets = files.map((file) => file.path);
  for (const file of files) {
    const source = fs.readFileSync(path.join(__dirname, '..', 'skills', file.skill, 'SKILL.md'));
    fs.mkdirSync(path.dirname(file.path), { recursive: true });
    fs.writeFileSync(file.path, source);
  }
  return targets;
}

if (require.main === module) {
  try {
    const args = process.argv.slice(2);
    let root = process.cwd(), force = false;
    const skills = [];
    for (let i = 0; i < args.length; i++) {
      if (args[i] === '--user') root = os.homedir();
      else if (args[i] === '--skill') {
        if (!args[i + 1] || args[i + 1].startsWith('--')) throw new Error('--skill nécessite un nom.');
        skills.push(args[++i]);
      }
      else if (args[i] === '--project') {
        if (!args[i + 1] || args[i + 1].startsWith('--')) throw new Error('--project nécessite un dossier.');
        root = path.resolve(args[++i]);
      } else if (args[i] === '--force') force = true;
      else throw new Error(`Option inconnue : ${args[i]}`);
    }
    for (const target of install(root, force, skills.length ? skills : SKILLS)) console.log(target);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}

module.exports = { install, inspect, SKILLS };
