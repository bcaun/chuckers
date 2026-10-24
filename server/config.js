const path = require('path');

module.exports = {
  PORT: Number(process.env.PORT) || 8080,
  // На VPS за обратным прокси ставим 127.0.0.1, чтобы порт не торчал наружу.
  HOST: process.env.HOST || '0.0.0.0',
  // Токен бота от @BotFather. Без него не работают авторизация через Telegram и платежи.
  BOT_TOKEN: process.env.BOT_TOKEN || '',
  // short_name мини-аппа из /newapp — для ссылок-приглашений вида t.me/<bot>/<app>?startapp=...
  // Если пусто — используется Main Mini App: t.me/<bot>?startapp=...
  APP_SHORT_NAME: process.env.APP_SHORT_NAME || '',
  // Публичный HTTPS-адрес мини-аппа — для кнопки «Играть» в боте.
  WEBAPP_URL: process.env.WEBAPP_URL || '',
  // Режим разработки: вход без Telegram, покупки выдаются бесплатно.
  DEV: process.env.DEV === '1',
  DATA_DIR: process.env.DATA_DIR || path.join(__dirname, 'data'),
  WEBAPP_DIR: path.join(__dirname, '..', 'webapp'),
};
