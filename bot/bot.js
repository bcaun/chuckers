// Минимальный Telegram-бот без зависимостей (Node 18+).
// Отвечает на /start кнопкой запуска мини-аппа и ставит кнопку «Играть» в меню чата.
//
//   BOT_TOKEN=123:ABC WEBAPP_URL=https://you.github.io/checkers/ node bot.js

const TOKEN = process.env.BOT_TOKEN;
const WEBAPP_URL = process.env.WEBAPP_URL;
if (!TOKEN || !WEBAPP_URL) {
  console.error('Нужны переменные окружения BOT_TOKEN и WEBAPP_URL');
  process.exit(1);
}

async function api(method, params = {}) {
  const res = await fetch(`https://api.telegram.org/bot${TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(params),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(`${method}: ${data.description}`);
  return data.result;
}

const playButton = { text: '♟ Играть в шашки', web_app: { url: WEBAPP_URL } };

async function onMessage(msg) {
  const text = msg.text || '';
  if (text.startsWith('/start') || text.startsWith('/play')) {
    await api('sendMessage', {
      chat_id: msg.chat.id,
      text: 'Привет! Сыграем в русские шашки? С ботом трёх уровней сложности или вдвоём на одном телефоне.',
      reply_markup: { inline_keyboard: [[playButton]] },
    });
  }
}

async function main() {
  const me = await api('getMe');
  await api('setMyCommands', { commands: [{ command: 'play', description: 'Играть в шашки' }] });
  await api('setChatMenuButton', { menu_button: { type: 'web_app', text: 'Играть', web_app: { url: WEBAPP_URL } } });
  console.log(`@${me.username} запущен`);

  let offset = 0;
  for (;;) {
    try {
      const updates = await api('getUpdates', { offset, timeout: 50, allowed_updates: ['message'] });
      for (const u of updates) {
        offset = u.update_id + 1;
        if (u.message) onMessage(u.message).catch((e) => console.error(e.message));
      }
    } catch (e) {
      console.error(e.message);
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
}

main();
