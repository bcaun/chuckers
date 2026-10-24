// Простое хранилище в JSON-файле: всё держим в памяти, на диск пишем с задержкой.
// Для десятков тысяч игроков стоит заменить на SQLite/Postgres — интерфейс тот же: data + save().
const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('./config');

const file = path.join(DATA_DIR, 'db.json');
fs.mkdirSync(path.join(DATA_DIR, 'avatars'), { recursive: true });

const data = { users: {}, payments: {} };
if (fs.existsSync(file)) Object.assign(data, JSON.parse(fs.readFileSync(file, 'utf8')));

let timer = null;

function flush() {
  clearTimeout(timer);
  timer = null;
  fs.writeFileSync(file + '.tmp', JSON.stringify(data));
  fs.renameSync(file + '.tmp', file);
}

function save() {
  if (!timer) timer = setTimeout(flush, 500);
}

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => { flush(); process.exit(0); });
}

module.exports = { data, save, flush };
