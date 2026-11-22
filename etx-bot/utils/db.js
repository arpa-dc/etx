// Mini base de données JSON (data/db.json), sans dépendance native.
const fs = require('fs');
const path = require('path');
const dir = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const file = path.join(dir, `db-${path.basename(path.resolve(__dirname, '..'))}.json`);
let data = { guilds: {} };
try { data = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}

let timer;
function flush() {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}
function save() {
  clearTimeout(timer);
  timer = setTimeout(flush, 500);
}
process.on('SIGINT', () => { flush(); process.exit(); });
process.on('SIGTERM', () => { flush(); process.exit(); });

// Retourne l'objet persistant d'un serveur : modifie-le puis appelle db.save()
function guild(id) {
  return (data.guilds[id] ||= {});
}
module.exports = { guild, save };
