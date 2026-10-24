// Общие для клиента и сервера справочники.
(function (global) {
  'use strict';

  // 20 цветов шашек. Первые два — классические и доступны бесплатно.
  const PALETTE = [
    { id: 'white', name: 'Белый', hex: '#f1ebdf' },
    { id: 'black', name: 'Чёрный', hex: '#2a2a2e' },
    { id: 'red', name: 'Красный', hex: '#d63a32' },
    { id: 'crimson', name: 'Бордовый', hex: '#8e1b2c' },
    { id: 'orange', name: 'Оранжевый', hex: '#f07d1a' },
    { id: 'gold', name: 'Золотой', hex: '#e2b13c' },
    { id: 'yellow', name: 'Жёлтый', hex: '#f6dc3d' },
    { id: 'lime', name: 'Лайм', hex: '#9bd13a' },
    { id: 'green', name: 'Зелёный', hex: '#2f9e4a' },
    { id: 'emerald', name: 'Изумрудный', hex: '#0f6e57' },
    { id: 'teal', name: 'Бирюзовый', hex: '#20b2aa' },
    { id: 'sky', name: 'Голубой', hex: '#5cb8f2' },
    { id: 'blue', name: 'Синий', hex: '#2a5bd7' },
    { id: 'navy', name: 'Тёмно-синий', hex: '#1d2d6b' },
    { id: 'violet', name: 'Фиолетовый', hex: '#7b4fd6' },
    { id: 'purple', name: 'Пурпурный', hex: '#a2329c' },
    { id: 'pink', name: 'Розовый', hex: '#f27bb0' },
    { id: 'brown', name: 'Коричневый', hex: '#7a4a2a' },
    { id: 'silver', name: 'Серебряный', hex: '#b9bec6' },
    { id: 'graphite', name: 'Графитовый', hex: '#5b6068' },
  ];
  const FREE_COLORS = ['white', 'black'];

  const AVATAR_EMOJI = [
    '😎', '🙂', '🤓', '😺', '🦊', '🐼', '🐯', '🦁', '🐸', '🐵', '🐧', '🦉',
    '🐲', '🦄', '🐙', '🦈', '👑', '🎩', '🧠', '🔥', '⚡', '🍀', '🚀', '🏆',
  ];

  const BOT_LEVELS = [
    { level: 1, name: 'Новичок', emoji: '🐣' },
    { level: 2, name: 'Любитель', emoji: '🙂' },
    { level: 3, name: 'Разрядник', emoji: '🧐' },
    { level: 4, name: 'Кандидат в мастера', emoji: '😤' },
    { level: 5, name: 'Гроссмейстер', emoji: '🤖' },
  ];
  const WINS_TO_ADVANCE = 5;

  const PRODUCTS = {
    level_up: { title: 'Следующий уровень', description: 'Открывает следующий уровень бота без 5 побед', price: 100 },
    undo: { title: 'Отмена хода', description: 'Навсегда включает отмену хода в игре с ботом', price: 100 },
    colors: { title: 'Цвета шашек', description: '20 цветов шашек для себя и соперника — навсегда', price: 100 },
  };

  global.Shared = { PALETTE, FREE_COLORS, AVATAR_EMOJI, BOT_LEVELS, WINS_TO_ADVANCE, PRODUCTS };
})(typeof window !== 'undefined' ? window : globalThis);
