// Товары за Telegram Stars и правила их покупки.
require('../webapp/shared.js');
const { PRODUCTS, BOT_LEVELS, WINS_TO_ADVANCE } = globalThis.Shared;
const MAX_LEVEL = BOT_LEVELS.length;

// Пустая строка — купить можно, иначе причина отказа.
function canBuy(u, id) {
  if (!PRODUCTS[id]) return 'Нет такого товара';
  if (id === 'level_up') {
    if (u.progress.unlocked >= MAX_LEVEL) return 'Все уровни уже открыты';
    // Перескакивать через уровни нельзя: после купленного уровня следующий нужно выиграть.
    if (u.progress.lastBought) return `Сначала одержите ${WINS_TO_ADVANCE} побед на уровне ${u.progress.unlocked}`;
    return '';
  }
  return u.purchases[id] ? 'Уже куплено' : '';
}

function grant(u, id) {
  if (id === 'level_up') {
    u.progress.unlocked++;
    u.progress.wins = 0;
    u.progress.lastBought = true;
  } else {
    u.purchases[id] = true;
  }
}

module.exports = { PRODUCTS, canBuy, grant };
