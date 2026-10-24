// Онлайн-партии с другом по приглашению. Сервер — источник истины: проверяет каждый ход.
//
// Клиент → сервер: auth, join, move, resign, draw_offer, draw_answer, rematch, leave
// Сервер → клиент: state (полное состояние комнаты), error
require('../webapp/engine.js');
const crypto = require('crypto');
const users = require('./users');

const { Game, WHITE } = globalThis.Checkers;

const RECONNECT_GRACE_MS = 120 * 1000; // сколько ждём отключившегося, прежде чем засчитать поражение
const ROOM_TTL_MS = 24 * 3600 * 1000;

const rooms = new Map();

function create(u) {
  // не плодим комнаты: если у игрока уже есть ожидающая — отдаём её
  for (const r of rooms.values()) {
    if (r.players.length === 1 && r.players[0].uid === u.id) return r.id;
  }
  const id = crypto.randomBytes(6).toString('base64url');
  rooms.set(id, {
    id,
    players: [{ uid: u.id, color: WHITE }],
    game: null,
    gameNo: 0,
    recorded: false,
    rematch: new Set(),
    drawOffer: 0, // цвет предложившего ничью
    sockets: new Set(),
    timers: new Map(), // uid -> таймер технического поражения
    touched: Date.now(),
  });
  return id;
}

const playerOf = (room, uid) => room.players.find((p) => p.uid === uid) || null;
const isOnline = (room, uid) => [...room.sockets].some((ws) => ws.user.id === uid);

function status(room) {
  if (room.players.length < 2) return 'waiting';
  return room.game.result === null ? 'playing' : 'over';
}

function stateFor(room, ws) {
  const me = playerOf(room, ws.user.id);
  const g = room.game;
  return {
    t: 'state',
    room: {
      id: room.id,
      status: status(room),
      gameNo: room.gameNo,
      you: me ? me.color : 0,
      players: room.players.map((p) => ({
        ...users.publicInfo(users.get(p.uid)),
        color: p.color,
        online: isOnline(room, p.uid),
        rematch: room.rematch.has(p.uid),
      })),
      log: g ? g.log : [],
      result: g ? g.result : null,
      reason: g ? g.reason : '',
      drawOffer: room.drawOffer,
    },
  };
}

function broadcast(room) {
  room.touched = Date.now();
  for (const ws of room.sockets) send(ws, stateFor(room, ws));
}

function send(ws, msg) {
  if (ws.readyState === 1) ws.send(JSON.stringify(msg));
}

function startGame(room) {
  room.game = new Game();
  room.gameNo++;
  room.recorded = false;
  room.rematch.clear();
  room.drawOffer = 0;
}

function finishGame(room) {
  if (room.recorded || room.game.result === null) return;
  room.recorded = true;
  room.drawOffer = 0;
  for (const t of room.timers.values()) clearTimeout(t);
  room.timers.clear();
  const g = room.game;
  for (const p of room.players) {
    const opp = room.players.find((x) => x !== p);
    const result = g.result === 0 ? 'draw' : g.result === p.color ? 'win' : 'loss';
    users.recordResult(users.get(p.uid), {
      mode: 'friend', result, reason: g.reason, opponent: users.get(opp.uid).name || 'Игрок',
    });
  }
}

function join(ws, roomId) {
  const room = rooms.get(String(roomId));
  if (!room) return send(ws, { t: 'error', code: 'not_found', msg: 'Приглашение устарело или комната не найдена' });
  const uid = ws.user.id;

  if (!playerOf(room, uid)) {
    if (room.players.length >= 2) return send(ws, { t: 'error', code: 'full', msg: 'В этой партии уже два игрока' });
    room.players.push({ uid, color: -room.players[0].color });
    startGame(room);
  }

  leaveCurrent(ws);
  ws.room = room;
  room.sockets.add(ws);
  clearTimeout(room.timers.get(uid));
  room.timers.delete(uid);
  broadcast(room);
}

function leaveCurrent(ws) {
  const room = ws.room;
  if (!room) return;
  room.sockets.delete(ws);
  ws.room = null;
  const uid = ws.user.id;
  const me = playerOf(room, uid);
  // игрок отключился посреди партии — ждём, потом засчитываем поражение
  if (me && status(room) === 'playing' && !isOnline(room, uid) && !room.timers.has(uid)) {
    room.timers.set(uid, setTimeout(() => {
      room.timers.delete(uid);
      if (status(room) !== 'playing' || isOnline(room, uid)) return;
      room.game.resign(me.color);
      room.game.reason = 'Соперник не вернулся в игру';
      finishGame(room);
      broadcast(room);
    }, RECONNECT_GRACE_MS));
  }
  broadcast(room);
}

function onMessage(ws, msg) {
  if (msg.t === 'join') return join(ws, msg.room);
  const room = ws.room;
  if (!room) return;
  const me = playerOf(room, ws.user.id);
  if (!me) return;
  const g = room.game;

  switch (msg.t) {
    case 'move': {
      if (status(room) !== 'playing' || g.turn !== me.color) return send(ws, stateFor(room, ws));
      if (!Array.isArray(msg.squares) || !g.playSquares(msg.squares.map(Number))) {
        send(ws, { t: 'error', msg: 'Ход отклонён' });
        return send(ws, stateFor(room, ws));
      }
      room.drawOffer = 0;
      finishGame(room);
      return broadcast(room);
    }
    case 'resign':
      if (status(room) !== 'playing') return;
      g.resign(me.color);
      finishGame(room);
      return broadcast(room);
    case 'draw_offer':
      if (status(room) !== 'playing' || room.drawOffer) return;
      room.drawOffer = me.color;
      return broadcast(room);
    case 'draw_answer':
      if (status(room) !== 'playing' || room.drawOffer !== -me.color) return;
      if (msg.accept) { g.agreeDraw(); finishGame(room); }
      room.drawOffer = 0;
      return broadcast(room);
    case 'rematch':
      if (status(room) !== 'over') return;
      room.rematch.add(me.uid);
      if (room.rematch.size === 2) {
        for (const p of room.players) p.color = -p.color; // в реванше меняемся цветами
        startGame(room);
      }
      return broadcast(room);
    case 'leave':
      if (status(room) === 'playing') { g.resign(me.color); finishGame(room); }
      return leaveCurrent(ws);
  }
}

function onClose(ws) {
  leaveCurrent(ws);
}

setInterval(() => {
  const now = Date.now();
  for (const [id, r] of rooms) if (!r.sockets.size && now - r.touched > ROOM_TTL_MS) rooms.delete(id);
}, 10 * 60 * 1000).unref();

module.exports = { create, onMessage, onClose };
