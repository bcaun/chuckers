(function () {
  'use strict';
  const E = window.Checkers;
  const AI = window.CheckersAI;
  // Вне Telegram (обычный браузер) initData пустая — работаем без SDK.
  const tg = window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.initData
    ? window.Telegram.WebApp : null;

  const $ = (s) => document.querySelector(s);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const STEP_MS = 210;
  const QUIET_LIMIT = 30; // 15 ходов каждой стороны только дамками без взятий — ничья

  // ── Telegram ──────────────────────────────────────────────
  function initTelegram() {
    if (!tg) return;
    tg.ready();
    tg.expand();
    if (tg.disableVerticalSwipes) tg.disableVerticalSwipes();
    document.documentElement.dataset.theme = tg.colorScheme;
    tg.onEvent('themeChanged', () => { document.documentElement.dataset.theme = tg.colorScheme; });
    tg.BackButton.onClick(() => showMenu());
  }

  const haptic = {
    tap() { tg && tg.HapticFeedback && tg.HapticFeedback.selectionChanged(); },
    hit() { tg && tg.HapticFeedback && tg.HapticFeedback.impactOccurred('medium'); },
    move() { tg && tg.HapticFeedback && tg.HapticFeedback.impactOccurred('light'); },
    error() { tg && tg.HapticFeedback && tg.HapticFeedback.notificationOccurred('error'); },
    win() { tg && tg.HapticFeedback && tg.HapticFeedback.notificationOccurred('success'); },
  };

  // Хранилище: CloudStorage Telegram (синхронизируется между устройствами), иначе localStorage.
  const storage = {
    get(key) {
      return new Promise((resolve) => {
        if (tg && tg.CloudStorage && tg.isVersionAtLeast && tg.isVersionAtLeast('6.9')) {
          tg.CloudStorage.getItem(key, (err, v) => resolve(err ? null : v || null));
        } else {
          try { resolve(localStorage.getItem(key)); } catch (e) { resolve(null); }
        }
      });
    },
    set(key, value) {
      if (tg && tg.CloudStorage && tg.isVersionAtLeast && tg.isVersionAtLeast('6.9')) {
        tg.CloudStorage.setItem(key, value);
      } else {
        try { localStorage.setItem(key, value); } catch (e) { /* приватный режим */ }
      }
    },
  };

  // ── Состояние ─────────────────────────────────────────────
  const settings = { mode: 'bot', level: 2, color: E.WHITE };
  let stats = { 1: [0, 0, 0], 2: [0, 0, 0], 3: [0, 0, 0] }; // [победы, поражения, ничьи]

  const S = {
    board: null, turn: E.WHITE, quiet: 0, last: null,
    history: [], keys: [],
    moves: [], sel: null, // sel = { from, steps: [], cands: [] }
    busy: false, over: false, flip: false, gameId: 0,
  };
  let pieceAt = new Array(64).fill(null);
  const cellEls = [];

  const isBotTurn = () => settings.mode === 'bot' && S.turn !== settings.color;
  const posKey = () => S.board.join('') + S.turn;
  const colorName = (c) => (c === E.WHITE ? 'Белые' : 'Чёрные');

  // ── Отрисовка ─────────────────────────────────────────────
  function displayRC(i) {
    let r = i >> 3, c = i & 7;
    if (S.flip) { r = 7 - r; c = 7 - c; }
    return [r, c];
  }

  function buildCells() {
    const root = $('#cells');
    root.innerHTML = '';
    for (let dr = 0; dr < 8; dr++) {
      for (let dc = 0; dc < 8; dc++) {
        const r = S.flip ? 7 - dr : dr, c = S.flip ? 7 - dc : dc;
        const i = r * 8 + c;
        const el = document.createElement('div');
        el.className = 'cell' + ((r + c) % 2 ? ' dark' : '');
        el.dataset.idx = i;
        if (dr === 7) el.insertAdjacentHTML('beforeend', `<span class="coord file">${'abcdefgh'[c]}</span>`);
        if (dc === 0) el.insertAdjacentHTML('beforeend', `<span class="coord rank">${8 - r}</span>`);
        root.appendChild(el);
        cellEls[i] = el;
      }
    }
  }

  function placeEl(el, i) {
    const [r, c] = displayRC(i);
    el.style.transform = `translate(${c * 100}%, ${r * 100}%)`;
  }

  function renderPieces() {
    const root = $('#pieces');
    root.innerHTML = '';
    pieceAt = new Array(64).fill(null);
    for (let i = 0; i < 64; i++) {
      const p = S.board[i];
      if (!p) continue;
      const el = document.createElement('div');
      el.className = 'piece ' + (p > 0 ? 'white' : 'black') + (E.isKing(p) ? ' king' : '');
      placeEl(el, i);
      root.appendChild(el);
      pieceAt[i] = el;
    }
  }

  function renderHighlights() {
    const sel = S.sel;
    const targets = new Map();
    if (sel) {
      for (const m of sel.cands) targets.set(m.path[sel.steps.length], m.caps.length > 0);
    }
    const movable = new Set();
    if (!sel && !S.busy && !S.over && !isBotTurn()) for (const m of S.moves) movable.add(m.from);
    const lastSq = new Set(S.last ? [S.last.from, ...S.last.path] : []);
    const selSq = sel ? (sel.steps.length ? sel.steps[sel.steps.length - 1] : sel.from) : -1;

    for (let i = 0; i < 64; i++) {
      const el = cellEls[i];
      el.classList.toggle('sel', i === selSq);
      el.classList.toggle('last', !sel && lastSq.has(i));
      el.classList.toggle('target', targets.has(i));
      el.classList.toggle('capture', targets.get(i) === true);
      // подсвечиваем фигуры, только если ходить обязательно ими (взятие)
      el.classList.toggle('movable', movable.has(i) && S.moves[0].caps.length > 0);
    }
  }

  function renderInfo() {
    const n = E.countPieces(S.board);
    const bottom = S.flip ? E.BLACK : E.WHITE;
    const top = -bottom;
    $('#bottom-dot').className = 'dot ' + (bottom === E.WHITE ? 'w' : 'b');
    $('#top-dot').className = 'dot ' + (top === E.WHITE ? 'w' : 'b');
    if (settings.mode === 'bot') {
      $('#bottom-name').textContent = 'Вы';
      $('#top-name').textContent = 'Бот · ' + ['', 'лёгкий', 'средний', 'сложный'][settings.level];
    } else {
      $('#bottom-name').textContent = colorName(bottom);
      $('#top-name').textContent = colorName(top);
    }
    // «сбито» = сколько фигур соперника снял этот игрок
    const takenBy = (c) => 12 - (c === E.WHITE ? n.black : n.white);
    $('#bottom-taken').textContent = takenBy(bottom) ? `сбито: ${takenBy(bottom)}` : '';
    $('#top-taken').textContent = takenBy(top) ? `сбито: ${takenBy(top)}` : '';
    $('.player.bottom').classList.toggle('turn', !S.over && S.turn === bottom);
    $('.player.top').classList.toggle('turn', !S.over && S.turn === top);

    const st = $('#status');
    st.classList.remove('alert');
    if (S.over) st.textContent = 'Партия окончена';
    else if (isBotTurn()) st.textContent = 'Бот думает…';
    else if (S.moves.length && S.moves[0].caps.length) { st.textContent = 'Бить обязательно!'; st.classList.add('alert'); }
    else st.textContent = settings.mode === 'bot' ? 'Ваш ход' : `Ход: ${colorName(S.turn).toLowerCase()}`;

    $('#undo').disabled = S.busy || (isBotTurn() && !S.over) || undoSteps() > S.history.length;
  }

  function render() {
    renderHighlights();
    renderInfo();
  }

  // ── Игровой цикл ──────────────────────────────────────────
  function newGame() {
    S.gameId++;
    S.board = E.initialBoard();
    S.turn = E.WHITE;
    S.quiet = 0;
    S.last = null;
    S.history = [];
    S.keys = [posKey()];
    S.sel = null;
    S.busy = false;
    S.over = false;
    S.flip = settings.mode === 'bot' && settings.color === E.BLACK;
    S.moves = E.legalMoves(S.board, S.turn);
    buildCells();
    renderPieces();
    render();
    hideModal();
    if (isBotTurn()) botTurn();
  }

  // Анимирует шаги хода начиная с шага `from` (ручные шаги игрок уже «сыграл» кликами).
  async function animateSteps(m, fromStep) {
    const el = pieceAt[m.from];
    el.classList.add('moving');
    for (let k = fromStep; k < m.path.length; k++) {
      animateStep(el, m, k);
      await sleep(STEP_MS);
    }
    el.classList.remove('moving');
  }

  function animateStep(el, m, k) {
    placeEl(el, m.path[k]);
    if (m.caps.length) {
      pieceAt[m.caps[k]].classList.add('taken');
      haptic.hit();
    } else {
      haptic.move();
    }
    const r = m.path[k] >> 3;
    const piece = S.board[m.from];
    if (piece === 1 && r === 0) el.classList.add('king');
    if (piece === -1 && r === 7) el.classList.add('king');
  }

  async function commitMove(m, animatedSteps) {
    const gid = S.gameId;
    S.busy = true;
    S.sel = null;
    renderHighlights();
    await animateSteps(m, animatedSteps);
    if (gid !== S.gameId) return; // пока анимировали, начали новую игру

    // снимаем сбитые
    for (const v of m.caps) {
      const el = pieceAt[v];
      el.classList.add('gone');
      setTimeout(() => el.remove(), 260);
      pieceAt[v] = null;
    }
    const el = pieceAt[m.from];
    pieceAt[m.from] = null;
    pieceAt[m.path[m.path.length - 1]] = el;

    const wasKing = E.isKing(S.board[m.from]);
    S.history.push({ board: S.board, turn: S.turn, quiet: S.quiet, last: S.last });
    S.board = E.applyMove(S.board, m);
    S.quiet = wasKing && !m.caps.length ? S.quiet + 1 : 0;
    S.last = m;
    S.turn = -S.turn;
    S.keys.push(posKey());
    S.moves = E.legalMoves(S.board, S.turn);
    S.busy = false;

    if (checkGameOver()) return;
    render();
    if (isBotTurn()) botTurn();
  }

  async function botTurn() {
    const gid = S.gameId;
    S.busy = true;
    render();
    await sleep(350); // даём отрисоваться и не ходим «мгновенно»
    if (gid !== S.gameId) return;
    const m = AI.search(S.board, S.turn, settings.level);
    if (gid !== S.gameId || !m) return;
    await commitMove(m, 0);
  }

  function checkGameOver() {
    let result = null; // 1 — белые, -1 — чёрные, 0 — ничья
    let reason = '';
    if (!S.moves.length) {
      result = -S.turn;
      const n = E.countPieces(S.board);
      reason = (S.turn === E.WHITE ? n.white : n.black) ? 'Ходов не осталось' : 'Все шашки сбиты';
    } else if (S.quiet >= QUIET_LIMIT) {
      result = 0; reason = '15 ходов дамками без взятий';
    } else if (S.keys.filter((k) => k === S.keys[S.keys.length - 1]).length >= 3) {
      result = 0; reason = 'Позиция повторилась трижды';
    }
    if (result === null) return false;

    S.over = true;
    render();
    let emoji, title;
    if (settings.mode === 'bot') {
      const st = stats[settings.level];
      if (result === 0) { emoji = '🤝'; title = 'Ничья'; st[2]++; }
      else if (result === settings.color) { emoji = '🏆'; title = 'Победа!'; st[0]++; haptic.win(); }
      else { emoji = '😔'; title = 'Поражение'; st[1]++; haptic.error(); }
      storage.set('stats', JSON.stringify(stats));
    } else {
      emoji = result === 0 ? '🤝' : '🏆';
      title = result === 0 ? 'Ничья' : `${colorName(result)} победили!`;
      haptic.win();
    }
    setTimeout(() => showModal(emoji, title, reason), 450);
    return true;
  }

  function undoSteps() {
    if (settings.mode !== 'bot') return 1;
    return S.turn === settings.color ? 2 : 1;
  }

  function undo() {
    if (S.busy || !S.history.length) return;
    // против бота откатываем и ответ бота, и свой ход
    const steps = undoSteps();
    if (!steps || steps > S.history.length) return;
    let snap;
    for (let k = 0; k < steps; k++) { snap = S.history.pop(); S.keys.pop(); }
    S.board = snap.board; S.turn = snap.turn; S.quiet = snap.quiet; S.last = snap.last;
    S.over = false;
    S.sel = null;
    S.moves = E.legalMoves(S.board, S.turn);
    hideModal();
    renderPieces();
    render();
    if (isBotTurn()) botTurn();
  }

  // ── Ввод ──────────────────────────────────────────────────
  function onCellClick(i) {
    if (S.busy || S.over || isBotTurn()) return;
    const sel = S.sel;

    if (sel) {
      const k = sel.steps.length;
      const next = sel.cands.filter((m) => m.path[k] === i);
      if (next.length) {
        sel.steps.push(i);
        sel.cands = next;
        const m = next[0];
        animateStep(pieceAt[sel.from], m, k);
        pieceAt[sel.from].classList.add('moving');
        const done = next.find((mv) => mv.path.length === sel.steps.length);
        if (done) commitMove(done, sel.steps.length);
        else renderHighlights();
        return;
      }
      // посреди многоходового взятия передумать нельзя
      if (k > 0) { haptic.error(); return; }
    }

    const own = S.moves.filter((m) => m.from === i);
    if (own.length) {
      S.sel = sel && sel.from === i ? null : { from: i, steps: [], cands: own };
      haptic.tap();
    } else {
      if (S.board[i] && E.sideOf(S.board[i]) === S.turn) {
        haptic.error();
        if (S.moves[0].caps.length) flashStatus('Есть обязательное взятие');
      }
      S.sel = null;
    }
    renderHighlights();
  }

  function flashStatus(text) {
    const st = $('#status');
    st.textContent = text;
    st.classList.add('alert');
    clearTimeout(flashStatus.t);
    flashStatus.t = setTimeout(renderInfo, 1400);
  }

  // ── Экраны ────────────────────────────────────────────────
  function showScreen(id) {
    document.querySelectorAll('.screen').forEach((s) => s.classList.toggle('active', s.id === id));
    if (tg) (id === 'game' ? tg.BackButton.show() : tg.BackButton.hide());
  }

  function showMenu() {
    S.gameId++; // останавливаем бота, если он думал
    S.busy = false;
    hideModal();
    renderStats();
    showScreen('menu');
  }

  function showModal(emoji, title, text) {
    $('#modal-emoji').textContent = emoji;
    $('#modal-title').textContent = title;
    $('#modal-text').textContent = text;
    $('#modal').classList.remove('hidden');
  }
  function hideModal() { $('#modal').classList.add('hidden'); }

  function renderStats() {
    const el = $('#stats');
    if (settings.mode !== 'bot') { el.innerHTML = ''; return; }
    const [w, l, d] = stats[settings.level];
    el.innerHTML = w + l + d
      ? `Против этого бота: <b>${w}</b> побед · <b>${l}</b> поражений · <b>${d}</b> ничьих`
      : 'Сыграйте первую партию против бота';
  }

  function bindMenu() {
    document.querySelectorAll('.seg').forEach((seg) => {
      seg.addEventListener('click', (e) => {
        const btn = e.target.closest('button');
        if (!btn) return;
        seg.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b === btn));
        const v = btn.dataset.value;
        const name = seg.dataset.name;
        settings[name] = name === 'mode' ? v : Number(v);
        document.querySelector('.bot-only').classList.toggle('hidden', settings.mode !== 'bot');
        haptic.tap();
        renderStats();
        storage.set('settings', JSON.stringify(settings));
      });
    });
  }

  function applySettingsToMenu() {
    document.querySelectorAll('.seg').forEach((seg) => {
      const v = String(settings[seg.dataset.name]);
      seg.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.value === v));
    });
    document.querySelector('.bot-only').classList.toggle('hidden', settings.mode !== 'bot');
  }

  async function init() {
    initTelegram();
    bindMenu();

    try {
      const s = JSON.parse(await storage.get('settings'));
      if (s) Object.assign(settings, s);
      const st = JSON.parse(await storage.get('stats'));
      if (st) stats = Object.assign(stats, st);
    } catch (e) { /* битые данные — игнорируем */ }
    applySettingsToMenu();
    renderStats();

    $('#start').addEventListener('click', () => { showScreen('game'); newGame(); });
    $('#restart').addEventListener('click', newGame);
    $('#again').addEventListener('click', newGame);
    $('#undo').addEventListener('click', undo);
    $('#to-menu').addEventListener('click', showMenu);
    $('#modal-menu').addEventListener('click', showMenu);
    $('#cells').addEventListener('click', (e) => {
      const cell = e.target.closest('.cell');
      if (cell) onCellClick(Number(cell.dataset.idx));
    });
  }

  init();
})();
