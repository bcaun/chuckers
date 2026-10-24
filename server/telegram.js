// Bot API: кнопка запуска мини-аппа, счета в Telegram Stars и обработка оплат.
const crypto = require('crypto');
const { BOT_TOKEN, WEBAPP_URL } = require('./config');
const { data, save } = require('./db');
const users = require('./users');
const shop = require('./shop');

const info = { username: '' };

async function api(method, params = {}) {
  const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(params),
  });
  const body = await res.json();
  if (!body.ok) throw new Error(`${method}: ${body.description}`);
  return body.result;
}

// Ссылка на счёт для WebApp.openInvoice. Валюта XTR = Telegram Stars, provider_token пустой.
function createInvoiceLink(u, productId) {
  const p = shop.PRODUCTS[productId];
  const nonce = crypto.randomBytes(4).toString('hex');
  return api('createInvoiceLink', {
    title: p.title,
    description: p.description,
    payload: `${productId}:${u.id}:${nonce}`,
    provider_token: '',
    currency: 'XTR',
    prices: [{ label: p.title, amount: p.price }],
  });
}

function parsePayload(payload) {
  const [productId, userId] = String(payload).split(':');
  return { productId, userId };
}

// Telegram спрашивает перед списанием: можно ли ещё продать товар. Ответить нужно за 10 секунд.
async function onPreCheckout(q) {
  const { productId, userId } = parsePayload(q.invoice_payload);
  const u = users.get(userId);
  let error = '';
  if (!u || String(q.from.id) !== userId) error = 'Счёт выписан другому пользователю';
  else error = shop.canBuy(u, productId);
  await api('answerPreCheckoutQuery', error
    ? { pre_checkout_query_id: q.id, ok: false, error_message: error }
    : { pre_checkout_query_id: q.id, ok: true });
}

function onPaid(msg) {
  const pay = msg.successful_payment;
  const chargeId = pay.telegram_payment_charge_id;
  if (data.payments[chargeId]) return; // повторная доставка апдейта
  const { productId, userId } = parsePayload(pay.invoice_payload);
  const u = users.get(userId);
  data.payments[chargeId] = {
    userId, productId, amount: pay.total_amount, currency: pay.currency, at: Date.now(), granted: false,
  };
  if (u && !shop.canBuy(u, productId)) {
    shop.grant(u, productId);
    data.payments[chargeId].granted = true;
  } else {
    // Оплачено, но выдать нельзя (например, уровень открылся победами одновременно с оплатой) — возвращаем звёзды.
    api('refundStarPayment', { user_id: Number(userId), telegram_payment_charge_id: chargeId })
      .catch((e) => console.error('refund failed', e.message));
  }
  save();
}

async function onMessage(msg) {
  if (msg.successful_payment) return onPaid(msg);
  const text = msg.text || '';
  if (text.startsWith('/start') || text.startsWith('/play')) {
    await api('sendMessage', {
      chat_id: msg.chat.id,
      text: 'Привет! Сыграем в русские шашки?\n\n' +
        '🤖 5 уровней бота — от новичка до гроссмейстера\n' +
        '👥 Партии с друзьями по приглашению и реванши\n' +
        '🎨 Цвета шашек и свой аватар',
      reply_markup: WEBAPP_URL ? { inline_keyboard: [[{ text: '♟ Играть', web_app: { url: WEBAPP_URL } }]] } : undefined,
    });
  } else if (text.startsWith('/paysupport')) {
    // Обязательная команда для ботов с платежами
    await api('sendMessage', {
      chat_id: msg.chat.id,
      text: 'Вопросы по оплате: опишите проблему ответным сообщением, приложите дату покупки. ' +
        'Если покупка не применилась, звёзды будут возвращены.',
    });
  }
}

async function start() {
  if (!BOT_TOKEN) {
    console.log('BOT_TOKEN не задан — бот и платежи отключены');
    return;
  }
  const me = await api('getMe');
  info.username = me.username;
  await api('setMyCommands', {
    commands: [
      { command: 'play', description: 'Играть в шашки' },
      { command: 'paysupport', description: 'Помощь с оплатой' },
    ],
  });
  if (WEBAPP_URL) {
    await api('setChatMenuButton', { menu_button: { type: 'web_app', text: 'Играть', web_app: { url: WEBAPP_URL } } });
  }
  console.log(`Бот @${me.username} запущен`);
  poll();
}

async function poll() {
  let offset = 0;
  for (;;) {
    try {
      const updates = await api('getUpdates', {
        offset, timeout: 50, allowed_updates: ['message', 'pre_checkout_query'],
      });
      for (const up of updates) {
        offset = up.update_id + 1;
        const job = up.pre_checkout_query ? onPreCheckout(up.pre_checkout_query)
          : up.message ? onMessage(up.message) : null;
        if (job) Promise.resolve(job).catch((e) => console.error(e.message));
      }
    } catch (e) {
      console.error('getUpdates', e.message);
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
}

module.exports = { start, info, createInvoiceLink };
