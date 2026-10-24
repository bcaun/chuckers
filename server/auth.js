// Проверка подписи initData мини-аппа:
// https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
const crypto = require('crypto');
const { BOT_TOKEN, DEV } = require('./config');

const MAX_AGE_SEC = 7 * 24 * 3600;
const secret = BOT_TOKEN ? crypto.createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest() : null;

function verifyInitData(initData) {
  if (!secret || !initData) return null;
  const params = new URLSearchParams(initData);
  const hash = params.get('hash') || '';
  params.delete('hash');
  const checkString = [...params.entries()]
    .map(([k, v]) => `${k}=${v}`)
    .sort()
    .join('\n');
  const calc = crypto.createHmac('sha256', secret).update(checkString).digest('hex');
  if (hash.length !== calc.length || !crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(calc))) return null;
  if (Date.now() / 1000 - Number(params.get('auth_date')) > MAX_AGE_SEC) return null;
  try {
    return JSON.parse(params.get('user'));
  } catch (e) {
    return null;
  }
}

// Строка авторизации: "tma <initData>" из Telegram или "dev <id>:<имя>" в режиме разработки.
function authenticate(value) {
  if (!value) return null;
  const [scheme, ...rest] = value.split(' ');
  const payload = rest.join(' ');
  if (scheme === 'tma') return verifyInitData(payload);
  if (scheme === 'dev' && DEV) {
    const [id, ...name] = payload.split(':');
    if (!/^\d{1,15}$/.test(id)) return null;
    let first = '';
    try { first = decodeURIComponent(name.join(':')).slice(0, 64); } catch (e) { /* битое имя */ }
    return { id: Number(id), first_name: first || `Игрок ${id.slice(-4)}` };
  }
  return null;
}

module.exports = { authenticate };
