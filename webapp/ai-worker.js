// Поиск хода бота в отдельном потоке, чтобы не тормозила анимация.
importScripts('engine.js', 'ai.js');

self.onmessage = (e) => {
  const { id, board, color, level } = e.data;
  const m = self.CheckersAI.search(new Int8Array(board), color, level);
  self.postMessage({ id, move: m && [m.from, ...m.path] });
};
