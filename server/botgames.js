// Партии с ботом. Сам бот работает на клиенте, а сервер принимает итог только
// вместе с полной записью партии и проверяет её по правилам: «прислать победу» без
// сыгранной до конца партии нельзя.
require('../webapp/engine.js');
const crypto = require('crypto');
const users = require('./users');

const { Game, WHITE, BLACK } = globalThis.Checkers;
const pending = new Map(); // userId -> { id, level, color, startedAt }

function start(u, level, color) {
  level = Number(level);
  color = Number(color);
  if (!(level >= 1 && level <= users.MAX_LEVEL)) throw new Error('Неверный уровень');
  if (level > u.progress.unlocked) throw new Error('Уровень ещё закрыт');
  if (color !== WHITE && color !== BLACK) throw new Error('Неверный цвет');

  // Брошенная партия засчитывается поражением
  const prev = pending.get(u.id);
  if (prev) users.recordResult(u, { mode: 'bot', level: prev.level, result: 'loss', reason: 'Партия брошена' });

  const g = { id: crypto.randomBytes(8).toString('hex'), level, color, startedAt: Date.now() };
  pending.set(u.id, g);
  return g.id;
}

function finish(u, gameId, log, resign) {
  const g = pending.get(u.id);
  if (!g || g.id !== gameId) throw new Error('Партия не найдена');
  if (!Array.isArray(log) || log.length > 1000 || !log.every((m) => Array.isArray(m) && m.length >= 2 && m.length <= 20)) {
    throw new Error('Неверная запись партии');
  }

  let result, reason;
  if (resign) {
    result = 'loss';
    reason = 'Сдача';
  } else {
    const game = Game.replay(log);
    if (!game) throw new Error('Запись партии не проходит проверку');
    if (game.result === null) throw new Error('Партия ещё не окончена');
    result = game.result === 0 ? 'draw' : game.result === g.color ? 'win' : 'loss';
    reason = game.reason;
  }

  pending.delete(u.id);
  const levelUp = users.recordResult(u, { mode: 'bot', level: g.level, result, reason });
  return { result, levelUp };
}

module.exports = { start, finish };
