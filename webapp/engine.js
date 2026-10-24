// Движок русских шашек.
// Доска — Int8Array(64), индекс = row * 8 + col, row 0 — верх (сторона чёрных).
// 1 — белая шашка, 2 — белая дамка, -1 — чёрная шашка, -2 — чёрная дамка.
(function (global) {
  'use strict';

  const WHITE = 1;
  const BLACK = -1;
  const DIRS = [[-1, -1], [-1, 1], [1, -1], [1, 1]];

  const inside = (r, c) => r >= 0 && r < 8 && c >= 0 && c < 8;
  const sideOf = (p) => (p > 0) - (p < 0);
  const isKing = (p) => p === 2 || p === -2;

  function initialBoard() {
    const b = new Int8Array(64);
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        if ((r + c) % 2 !== 1) continue;
        if (r < 3) b[r * 8 + c] = BLACK;
        else if (r > 4) b[r * 8 + c] = WHITE;
      }
    }
    return b;
  }

  // Все цепочки взятий для фигуры на поле `from`.
  // Правила: бить можно назад, дамка «дальнобойная», шашка, дошедшая до последнего
  // ряда во время взятия, продолжает бить как дамка, сбитые фигуры снимаются
  // после хода («турецкий удар» запрещён — дважды через одну фигуру прыгать нельзя).
  function capturesFrom(b, from) {
    const piece = b[from];
    const color = sideOf(piece);
    const promoRow = color === WHITE ? 0 : 7;
    const taken = new Set();

    function dfs(r, c, king) {
      const out = [];
      for (const [dr, dc] of DIRS) {
        if (king) {
          let rr = r + dr, cc = c + dc;
          while (inside(rr, cc) && b[rr * 8 + cc] === 0) { rr += dr; cc += dc; }
          if (!inside(rr, cc)) continue;
          const victim = rr * 8 + cc;
          if (sideOf(b[victim]) !== -color || taken.has(victim)) continue;
          const lands = [];
          let lr = rr + dr, lc = cc + dc;
          while (inside(lr, lc) && b[lr * 8 + lc] === 0) { lands.push(lr * 8 + lc); lr += dr; lc += dc; }
          if (!lands.length) continue;

          taken.add(victim);
          const cont = [], stop = [];
          for (const land of lands) {
            const sub = dfs(land >> 3, land & 7, true);
            if (sub.length) {
              for (const s of sub) cont.push({ path: [land, ...s.path], caps: [victim, ...s.caps], king: true });
            } else {
              stop.push({ path: [land], caps: [victim], king: true });
            }
          }
          taken.delete(victim);
          // Если с какого-то поля можно бить дальше — обязаны встать именно туда.
          out.push(...(cont.length ? cont : stop));
        } else {
          const mr = r + dr, mc = c + dc, lr = r + 2 * dr, lc = c + 2 * dc;
          if (!inside(lr, lc)) continue;
          const victim = mr * 8 + mc;
          const land = lr * 8 + lc;
          if (sideOf(b[victim]) !== -color || taken.has(victim) || b[land] !== 0) continue;

          taken.add(victim);
          const nowKing = lr === promoRow;
          const sub = dfs(lr, lc, nowKing);
          taken.delete(victim);
          if (sub.length) {
            for (const s of sub) out.push({ path: [land, ...s.path], caps: [victim, ...s.caps], king: s.king });
          } else {
            out.push({ path: [land], caps: [victim], king: nowKing });
          }
        }
      }
      return out;
    }

    b[from] = 0; // фигура «поднята» — её поле считается свободным
    const seqs = dfs(from >> 3, from & 7, isKing(piece));
    b[from] = piece;
    return seqs.map((s) => ({ from, path: s.path, caps: s.caps, promote: !isKing(piece) && s.king }));
  }

  function quietMovesFrom(b, from) {
    const piece = b[from];
    const color = sideOf(piece);
    const moves = [];
    if (isKing(piece)) {
      for (const [dr, dc] of DIRS) {
        let r = (from >> 3) + dr, c = (from & 7) + dc;
        while (inside(r, c) && b[r * 8 + c] === 0) {
          moves.push({ from, path: [r * 8 + c], caps: [], promote: false });
          r += dr; c += dc;
        }
      }
    } else {
      const dr = color === WHITE ? -1 : 1;
      for (const dc of [-1, 1]) {
        const r = (from >> 3) + dr, c = (from & 7) + dc;
        if (inside(r, c) && b[r * 8 + c] === 0) {
          moves.push({ from, path: [r * 8 + c], caps: [], promote: r === (color === WHITE ? 0 : 7) });
        }
      }
    }
    return moves;
  }

  // Все легальные ходы стороны. Взятие обязательно.
  function legalMoves(b, color) {
    const caps = [];
    for (let i = 0; i < 64; i++) if (sideOf(b[i]) === color) caps.push(...capturesFrom(b, i));
    if (caps.length) return caps;
    const quiet = [];
    for (let i = 0; i < 64; i++) if (sideOf(b[i]) === color) quiet.push(...quietMovesFrom(b, i));
    return quiet;
  }

  function applyMove(b, m) {
    const nb = new Int8Array(b);
    const piece = nb[m.from];
    nb[m.from] = 0;
    for (const v of m.caps) nb[v] = 0;
    nb[m.path[m.path.length - 1]] = m.promote ? piece * 2 : piece;
    return nb;
  }

  function countPieces(b) {
    const n = { white: 0, black: 0, whiteKings: 0, blackKings: 0 };
    for (let i = 0; i < 64; i++) {
      const p = b[i];
      if (p > 0) { n.white++; if (p === 2) n.whiteKings++; }
      else if (p < 0) { n.black++; if (p === -2) n.blackKings++; }
    }
    return n;
  }

  const QUIET_LIMIT = 30; // 15 ходов каждой стороны только дамками без взятий — ничья

  // Партия: история, проверка ходов, определение итога.
  // Используется и в клиенте, и на сервере (проверка онлайн-ходов и партий с ботом).
  class Game {
    constructor() {
      this.board = initialBoard();
      this.turn = WHITE;
      this.quiet = 0;
      this.last = null;
      this.history = []; // снимки до каждого хода — для отмены
      this.log = [];     // ходы в виде [from, ...path]
      this.keys = [this.key()];
      this.result = null; // WHITE | BLACK | 0 (ничья) | null (идёт)
      this.reason = '';
      this.moves = legalMoves(this.board, this.turn);
    }

    key() { return this.board.join('') + this.turn; }

    // Найти легальный ход по полям [from, ...path]
    find(squares) {
      const [from, ...path] = squares;
      return this.moves.find((m) => m.from === from && m.path.length === path.length &&
        m.path.every((sq, k) => sq === path[k])) || null;
    }

    play(m) {
      if (this.result !== null) throw new Error('game over');
      const wasKing = isKing(this.board[m.from]);
      this.history.push({ board: this.board, turn: this.turn, quiet: this.quiet, last: this.last });
      this.board = applyMove(this.board, m);
      this.quiet = wasKing && !m.caps.length ? this.quiet + 1 : 0;
      this.last = m;
      this.turn = -this.turn;
      this.log.push([m.from, ...m.path]);
      this.keys.push(this.key());
      this.moves = legalMoves(this.board, this.turn);
      this.checkEnd();
      return m;
    }

    // Сыграть ход по полям; вернёт null, если ход нелегален.
    playSquares(squares) {
      const m = this.result === null ? this.find(squares) : null;
      return m ? this.play(m) : null;
    }

    undo(n = 1) {
      for (let k = 0; k < n && this.history.length; k++) {
        const s = this.history.pop();
        this.board = s.board; this.turn = s.turn; this.quiet = s.quiet; this.last = s.last;
        this.log.pop();
        this.keys.pop();
      }
      this.result = null;
      this.reason = '';
      this.moves = legalMoves(this.board, this.turn);
    }

    checkEnd() {
      if (!this.moves.length) {
        const n = countPieces(this.board);
        this.result = -this.turn;
        this.reason = (this.turn === WHITE ? n.white : n.black) ? 'Ходов не осталось' : 'Все шашки сбиты';
      } else if (this.quiet >= QUIET_LIMIT) {
        this.result = 0; this.reason = '15 ходов дамками без взятий';
      } else {
        const k = this.keys[this.keys.length - 1];
        if (this.keys.filter((x) => x === k).length >= 3) { this.result = 0; this.reason = 'Позиция повторилась трижды'; }
      }
    }

    resign(color) { this.result = -color; this.reason = 'Соперник сдался'; }
    agreeDraw() { this.result = 0; this.reason = 'Ничья по соглашению'; }

    static replay(log) {
      const g = new Game();
      for (const sq of log) if (!g.playSquares(sq)) return null;
      return g;
    }
  }

  const SQUARE_NAMES = 'abcdefgh';
  const squareName = (i) => SQUARE_NAMES[i & 7] + (8 - (i >> 3));
  const moveNotation = (m) =>
    [m.from, ...m.path].map(squareName).join(m.caps.length ? ':' : '-');

  global.Checkers = {
    WHITE, BLACK, sideOf, isKing,
    initialBoard, legalMoves, applyMove, countPieces, squareName, moveNotation, Game,
  };
})(typeof window !== 'undefined' ? window : globalThis);
