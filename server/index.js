// Сервер мини-аппа: статика, REST API, WebSocket для онлайн-партий, бот и платежи.
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');

const config = require('./config');
const { authenticate } = require('./auth');
const users = require('./users');
const shop = require('./shop');
const botGames = require('./botgames');
const rooms = require('./rooms');
const telegram = require('./telegram');

const AVATAR_DIR = path.join(config.DATA_DIR, 'avatars');
const MAX_BODY = 700 * 1024;

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.json': 'application/json',
};

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { reject(new HttpError(413, 'Слишком большой запрос')); req.destroy(); }
      else chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks)) : {}); }
      catch (e) { reject(new HttpError(400, 'Неверный JSON')); }
    });
    req.on('error', reject);
  });
}

function sendJson(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

function serveFile(res, file) {
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, {
      'content-type': MIME[path.extname(file)] || 'application/octet-stream',
      'cache-control': 'no-cache',
    });
    fs.createReadStream(file).pipe(res);
  });
}

function serveStatic(req, res, pathname) {
  const [root, rel] = pathname.startsWith('/avatars/')
    ? [AVATAR_DIR, pathname.slice('/avatars/'.length)]
    : [config.WEBAPP_DIR, pathname === '/' ? 'index.html' : pathname.slice(1)];
  const file = path.normalize(path.join(root, decodeURIComponent(rel)));
  if (!file.startsWith(root + path.sep)) { res.writeHead(403); return res.end(); }
  serveFile(res, file);
}

// ── API ─────────────────────────────────────────────────────
const routes = {
  'GET /api/config': () => ({
    botUsername: telegram.info.username,
    appShortName: config.APP_SHORT_NAME,
    dev: config.DEV,
    payments: !!config.BOT_TOKEN,
  }),

  'GET /api/me': (u) => users.profileView(u),

  'PATCH /api/me': (u, body) => {
    users.updateSettings(u, body);
    return users.profileView(u);
  },

  // Фото уже обрезано и сжато на клиенте до 256×256 JPEG.
  'POST /api/avatar': (u, body) => {
    const m = /^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/.exec(body.dataUrl || '');
    if (!m) throw new HttpError(400, 'Нужна картинка JPEG');
    const buf = Buffer.from(m[1], 'base64');
    if (buf.length > 300 * 1024 || buf[0] !== 0xff || buf[1] !== 0xd8) throw new HttpError(400, 'Неверная картинка');
    if (u.avatar.type === 'photo') fs.rm(path.join(AVATAR_DIR, path.basename(u.avatar.url)), () => {});
    const name = `${u.id}-${crypto.randomBytes(4).toString('hex')}.jpg`;
    fs.writeFileSync(path.join(AVATAR_DIR, name), buf);
    u.avatar = { type: 'photo', url: `/avatars/${name}` };
    require('./db').save();
    return users.profileView(u);
  },

  'POST /api/bot/start': (u, body) => ({ gameId: botGames.start(u, body.level, body.color) }),

  'POST /api/bot/finish': (u, body) => {
    const r = botGames.finish(u, body.gameId, body.log, !!body.resign);
    return { ...r, profile: users.profileView(u) };
  },

  'POST /api/invoice': async (u, body) => {
    const reason = shop.canBuy(u, body.product);
    if (reason) throw new HttpError(400, reason);
    if (!config.BOT_TOKEN && config.DEV) { // без бота в режиме разработки выдаём сразу
      shop.grant(u, body.product);
      require('./db').save();
      return { granted: true, profile: users.profileView(u) };
    }
    return { link: await telegram.createInvoiceLink(u, body.product) };
  },

  'POST /api/rooms': (u) => ({ roomId: rooms.create(u) }),
};

async function handleApi(req, res, pathname) {
  const route = routes[`${req.method} ${pathname}`];
  if (!route) return sendJson(res, 404, { error: 'Не найдено' });
  try {
    let u = null;
    if (pathname !== '/api/config') {
      const tgUser = authenticate(req.headers.authorization);
      if (!tgUser) throw new HttpError(401, 'Нет авторизации');
      u = users.touch(tgUser);
    }
    const body = req.method === 'GET' ? {} : await readJson(req);
    sendJson(res, 200, await route(u, body));
  } catch (e) {
    sendJson(res, e.status || 400, { error: e.message });
  }
}

const server = http.createServer((req, res) => {
  const { pathname } = new URL(req.url, 'http://x');
  if (pathname.startsWith('/api/')) return handleApi(req, res, pathname);
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
  serveStatic(req, res, pathname);
});

// ── WebSocket ───────────────────────────────────────────────
// Браузер не умеет ставить заголовки на WebSocket, поэтому первое сообщение — {t:'auth', auth:'tma ...'}.
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 16 * 1024 });

wss.on('connection', (ws) => {
  ws.user = null;
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  const authTimer = setTimeout(() => ws.user || ws.close(4001, 'auth timeout'), 10000);

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch (e) { return; }
    if (!ws.user) {
      const tgUser = msg.t === 'auth' && authenticate(msg.auth);
      if (!tgUser) return ws.close(4001, 'unauthorized');
      clearTimeout(authTimer);
      ws.user = users.touch(tgUser);
      ws.send(JSON.stringify({ t: 'ready' }));
      return;
    }
    try { rooms.onMessage(ws, msg); } catch (e) { console.error(e); }
  });

  ws.on('close', () => {
    clearTimeout(authTimer);
    if (ws.user) rooms.onClose(ws);
  });
});

// пинг, чтобы находить «мёртвые» соединения (мобильная сеть пропала и т. п.)
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false;
    ws.ping();
  }
}, 30000).unref();

server.listen(config.PORT, config.HOST, () => {
  console.log(`Шашки: http://localhost:${config.PORT}${config.DEV ? ' (DEV)' : ''}`);
  telegram.start().catch((e) => console.error('Бот не запустился:', e.message));
});
