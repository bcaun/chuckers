// Профили игроков: прогресс по уровням бота, покупки, статистика, аватар, цвета.
require('../webapp/shared.js');
const { data, save } = require('./db');
const shop = require('./shop');

const { BOT_LEVELS, WINS_TO_ADVANCE, PALETTE, FREE_COLORS, AVATAR_EMOJI } = globalThis.Shared;
const MAX_LEVEL = BOT_LEVELS.length;
const HISTORY_LEN = 30;

const emptyWLD = () => ({ w: 0, l: 0, d: 0 });

function createUser(id) {
  const bot = {};
  for (const { level } of BOT_LEVELS) bot[level] = emptyWLD();
  return {
    id,
    name: '',
    username: '',
    tgPhoto: '',
    avatar: { type: 'emoji', value: AVATAR_EMOJI[0] },
    // unlocked — максимальный открытый уровень, wins — победы на нём в зачёт перехода,
    // lastBought — последний открытый уровень был куплен (см. shop.canBuy)
    progress: { unlocked: 1, wins: 0, lastBought: false },
    purchases: { undo: false, colors: false },
    colors: { mine: 'white', theirs: 'black' },
    stats: { bot, friend: emptyWLD(), streak: 0, bestStreak: 0 },
    history: [],
    createdAt: Date.now(),
  };
}

// Найти или завести пользователя по данным из Telegram, обновить имя и фото.
function touch(tgUser) {
  const id = String(tgUser.id);
  let u = data.users[id];
  if (!u) {
    u = data.users[id] = createUser(id);
    if (tgUser.photo_url) u.avatar = { type: 'tg' };
  }
  const name = [tgUser.first_name, tgUser.last_name].filter(Boolean).join(' ').slice(0, 64);
  if (name) u.name = name;
  u.username = tgUser.username || '';
  if (tgUser.photo_url) u.tgPhoto = tgUser.photo_url;
  save();
  return u;
}

const get = (id) => data.users[String(id)] || null;

function avatarOf(u) {
  if (u.avatar.type === 'photo') return { type: 'photo', url: u.avatar.url };
  if (u.avatar.type === 'tg' && u.tgPhoto) return { type: 'photo', url: u.tgPhoto };
  return { type: 'emoji', value: u.avatar.type === 'emoji' ? u.avatar.value : AVATAR_EMOJI[0] };
}

const publicInfo = (u) => ({ id: u.id, name: u.name || 'Игрок', avatar: avatarOf(u) });

function profileView(u) {
  const shopView = {};
  for (const id of Object.keys(globalThis.Shared.PRODUCTS)) {
    shopView[id] = { owned: id !== 'level_up' && !!u.purchases[id], blocked: shop.canBuy(u, id) };
  }
  return {
    ...publicInfo(u),
    avatarSetting: u.avatar,
    hasTgPhoto: !!u.tgPhoto,
    progress: u.progress,
    purchases: u.purchases,
    colors: u.colors,
    stats: u.stats,
    history: u.history,
    shop: shopView,
  };
}

function updateSettings(u, body) {
  if (body.avatar) {
    const a = body.avatar;
    if (a.type === 'emoji' && AVATAR_EMOJI.includes(a.value)) u.avatar = { type: 'emoji', value: a.value };
    else if (a.type === 'tg' && u.tgPhoto) u.avatar = { type: 'tg' };
    else throw new Error('Неверный аватар');
  }
  if (body.colors) {
    const { mine, theirs } = body.colors;
    const ok = (c) => PALETTE.some((p) => p.id === c) && (u.purchases.colors || FREE_COLORS.includes(c));
    if (!ok(mine) || !ok(theirs) || mine === theirs) throw new Error('Неверные цвета');
    u.colors = { mine, theirs };
  }
  save();
}

// Записать итог партии. entry: { mode: 'bot'|'friend', result: 'win'|'loss'|'draw', level?, opponent?, reason? }
// Возвращает номер нового уровня, если он открылся.
function recordResult(u, entry) {
  const key = entry.result[0]; // w | l | d
  const bucket = entry.mode === 'bot' ? u.stats.bot[entry.level] : u.stats.friend;
  bucket[key]++;

  if (entry.result === 'win') {
    u.stats.streak++;
    u.stats.bestStreak = Math.max(u.stats.bestStreak, u.stats.streak);
  } else if (entry.result === 'loss') {
    u.stats.streak = 0;
  }

  u.history.unshift({ ...entry, at: Date.now() });
  u.history.length = Math.min(u.history.length, HISTORY_LEN);

  let levelUp = null;
  const p = u.progress;
  // в зачёт перехода идут только победы на максимальном открытом уровне
  if (entry.mode === 'bot' && entry.result === 'win' && entry.level === p.unlocked && p.unlocked < MAX_LEVEL) {
    p.wins++;
    if (p.wins >= WINS_TO_ADVANCE) {
      p.unlocked++;
      p.wins = 0;
      p.lastBought = false;
      levelUp = p.unlocked;
    }
  }
  save();
  return levelUp;
}

module.exports = { touch, get, publicInfo, profileView, updateSettings, recordResult, MAX_LEVEL };
