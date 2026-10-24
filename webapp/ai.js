// Бот: negamax + alpha-beta, итеративное углубление с лимитом времени,
// продление поиска на взятиях (чтобы не обрывать размен на середине).
(function (global) {
  'use strict';
  const E = global.Checkers;

  const WIN = 100000;
  const LEVELS = {
    1: { depth: 2, timeMs: 150, blunder: 0.35 },
    2: { depth: 5, timeMs: 500, blunder: 0.05 },
    3: { depth: 14, timeMs: 1500, blunder: 0 },
  };

  // Оценка с точки зрения белых.
  function evaluate(b) {
    let s = 0;
    for (let i = 0; i < 64; i++) {
      const p = b[i];
      if (!p) continue;
      const r = i >> 3, c = i & 7;
      const center = (c >= 2 && c <= 5 && r >= 2 && r <= 5) ? 6 : 0;
      switch (p) {
        case 1: s += 100 + (7 - r) * 4 + center + (r === 7 ? 8 : 0); break;
        case -1: s -= 100 + r * 4 + center + (r === 0 ? 8 : 0); break;
        case 2: s += 300 + (i === 7 || i === 56 ? 15 : 0); break; // большак
        case -2: s -= 300 + (i === 7 || i === 56 ? 15 : 0); break;
      }
    }
    return s;
  }

  class Timeout extends Error {}

  function search(board, color, level) {
    const cfg = LEVELS[level] || LEVELS[2];
    const deadline = Date.now() + cfg.timeMs;
    let nodes = 0;

    function negamax(b, side, depth, alpha, beta, ply) {
      if ((++nodes & 1023) === 0 && Date.now() > deadline) throw new Timeout();
      const moves = E.legalMoves(b, side);
      if (!moves.length) return -WIN + ply;
      const forced = moves[0].caps.length > 0;
      if (depth <= 0 && (!forced || depth < -8)) return side * evaluate(b);
      if (forced) moves.sort((x, y) => y.caps.length - x.caps.length);
      let best = -Infinity;
      for (const m of moves) {
        const v = -negamax(E.applyMove(b, m), -side, depth - 1, -beta, -alpha, ply + 1);
        if (v > best) best = v;
        if (v > alpha) alpha = v;
        if (alpha >= beta) break;
      }
      return best;
    }

    let rootMoves = E.legalMoves(board, color);
    if (rootMoves.length <= 1) return rootMoves[0] || null;
    // перемешиваем — чтобы бот не играл каждую партию одинаково
    rootMoves = rootMoves.map((m) => [Math.random(), m]).sort((a, b) => a[0] - b[0]).map((x) => x[1]);

    if (Math.random() < cfg.blunder) return rootMoves[0];

    let bestMove = rootMoves[0];
    for (let depth = 1; depth <= cfg.depth; depth++) {
      try {
        let alpha = -Infinity, iterBest = null;
        const scored = [];
        for (const m of rootMoves) {
          const v = -negamax(E.applyMove(board, m), -color, depth - 1, -Infinity, -alpha, 1);
          scored.push([v, m]);
          if (v > alpha) { alpha = v; iterBest = m; }
        }
        bestMove = iterBest;
        // лучший ход — первым на следующей итерации
        rootMoves = scored.sort((a, b) => b[0] - a[0]).map((x) => x[1]);
        if (alpha > WIN - 100) break; // нашли форсированную победу
      } catch (e) {
        if (e instanceof Timeout) break;
        throw e;
      }
    }
    return bestMove;
  }

  global.CheckersAI = { search, evaluate, LEVELS };
})(typeof window !== 'undefined' ? window : globalThis);
