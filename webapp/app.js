(function () {
  'use strict';
  const E = window.Checkers;
  const { PALETTE, FREE_COLORS, AVATAR_EMOJI, BOT_LEVELS, WINS_TO_ADVANCE, PRODUCTS } = window.Shared;
  const { WHITE, BLACK } = E;
  const tg = Api.tg;

  const $ = (s) => document.querySelector(s);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const STEP_MS = 210;
  const MAX_LEVEL = BOT_LEVELS.length;

  // ── Telegram и мелкие помощники ───────────────────────────
  function initTelegram() {
    if (!tg) return;
    tg.ready();
    tg.expand();
    if (tg.disableVerticalSwipes) tg.disableVerticalSwipes();
    document.documentElement.dataset.theme = tg.colorScheme;
    tg.onEvent('themeChanged', () => { document.documentElement.dataset.theme = tg.colorScheme; });
    tg.BackButton.onClick(goBack);
  }

  const hf = () => tg && tg.HapticFeedback;
  const haptic = {
    tap() { hf() && hf().selectionChanged(); },
    hit() { hf() && hf().impactOccurred('medium'); },
    move() { hf() && hf().impactOccurred('light'); },
    error() { hf() && hf().notificationOccurred('error'); },
    win() { hf() && hf().notificationOccurred('success'); },
  };

  const confirmDialog = (text) => new Promise((res) =>
    (tg ? tg.showConfirm(text, (ok) => res(!!ok)) : res(window.confirm(text))));
  const alertDialog = (text) => new Promise((res) =>
    (tg ? tg.showAlert(text, () => res()) : (window.alert(text), res())));

  function toast(text) {
    const el = $('#toast');
    el.textContent = text;
    el.classList.remove('hidden');
    clearTimeout(toast.t);
    toast.t = setTimeout(() => el.classList.add('hidden'), 2200);
  }

  const prefs = (() => {
    let p = {};
    try { p = JSON.parse(localStorage.getItem('prefs')) || {}; } catch (e) { /* нет хранилища */ }
    return {
      botColor: p.botColor === BLACK ? BLACK : WHITE,
      botLevel: p.botLevel || 0,
      save() { try { localStorage.setItem('prefs', JSON.stringify({ botColor: this.botColor, botLevel: this.botLevel })); } catch (e) { /* ок */ } },
    };
  })();

  let config = {};
  let profile = null;

  function setAvatar(el, avatar) {
    el.classList.toggle('photo', avatar.type === 'photo');
    el.style.backgroundImage = avatar.type === 'photo' ? `url("${avatar.url}")` : '';
    el.textContent = avatar.type === 'photo' ? '' : avatar.value;
  }

  const colorHex = (id) => (PALETTE.find((c) => c.id === id) || PALETTE[0]).hex;
  function isLight(hex) {
    const n = parseInt(hex.slice(1), 16);
    return (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) > 150;
  }

  // ── Экраны ────────────────────────────────────────────────
  let screen = 'menu';
  function showScreen(id) {
    screen = id;
    document.querySelectorAll('.screen').forEach((s) => s.classList.toggle('active', s.id === id));
    if (tg) (id === 'menu' ? tg.BackButton.hide() : tg.BackButton.show());
    window.scrollTo(0, 0);
  }

  function goBack() {
    if (!$('#modal').classList.contains('hidden') && screen !== 'game') hideModal();
    if (screen === 'game') return leaveGame();
    if (screen === 'lobby') return closeOnline();
    showMenu();
  }

  function showMenu() {
    hideModal();
    renderMenu();
    showScreen('menu');
  }

  // ═════════════════════════════════════════════════════════
  // Доска (общая для всех режимов)
  // ═════════════════════════════════════════════════════════
  // mode: 'bot' | 'local' | 'online'; mySide — за какой цвет играет владелец телефона
  const B = { mode: null, game: null, flip: false, mySide: WHITE, sel: null, busy: false, token: 0 };
  let pieceAt = new Array(64).fill(null);
  const cellEls = [];

  function displayRC(i) {
    let r = i >> 3, c = i & 7;
    if (B.flip) { r = 7 - r; c = 7 - c; }
    return [r, c];
  }

  function setupBoard() {
    B.token++;
    B.sel = null;
    B.busy = false;
    const root = $('#cells');
    root.innerHTML = '';
    for (let dr = 0; dr < 8; dr++) {
      for (let dc = 0; dc < 8; dc++) {
        const r = B.flip ? 7 - dr : dr, c = B.flip ? 7 - dc : dc;
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
    applyPieceColors();
    renderPieces();
    renderControls();
    render();
  }

  function applyPieceColors() {
    const colors = profile ? profile.colors : { mine: 'white', theirs: 'black' };
    const w = colorHex(B.mySide === WHITE ? colors.mine : colors.theirs);
    const b = colorHex(B.mySide === WHITE ? colors.theirs : colors.mine);
    const board = $('#board');
    board.style.setProperty('--pw', w);
    board.style.setProperty('--pb', b);
    board.style.setProperty('--kw', isLight(w) ? '#9a6b12' : '#f0cd73');
    board.style.setProperty('--kb', isLight(b) ? '#9a6b12' : '#f0cd73');
    $('#top-dot').style.background = B.flip ? w : b;
    $('#bottom-dot').style.background = B.flip ? b : w;
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
      const p = B.game.board[i];
      if (!p) continue;
      const el = document.createElement('div');
      el.className = 'piece ' + (p > 0 ? 'white' : 'black') + (E.isKing(p) ? ' king' : '');
      placeEl(el, i);
      root.appendChild(el);
      pieceAt[i] = el;
    }
  }

  function humanCanMove() {
    const g = B.game;
    if (B.busy || !g || g.result !== null) return false;
    if (B.mode === 'bot') return g.turn === bot.color;
    if (B.mode === 'online') return !!online.room && online.room.status === 'playing' && g.turn === online.room.you;
    return true;
  }

  function renderHighlights() {
    const g = B.game;
    const sel = B.sel;
    const targets = new Map();
    if (sel) for (const m of sel.cands) targets.set(m.path[sel.steps.length], m.caps.length > 0);
    const forced = humanCanMove() && !sel && g.moves.length && g.moves[0].caps.length;
    const movable = new Set(forced ? g.moves.map((m) => m.from) : []);
    const lastSq = new Set(g.last ? [g.last.from, ...g.last.path] : []);
    const selSq = sel ? (sel.steps.length ? sel.steps[sel.steps.length - 1] : sel.from) : -1;
    for (let i = 0; i < 64; i++) {
      const el = cellEls[i];
      el.classList.toggle('sel', i === selSq);
      el.classList.toggle('last', !sel && lastSq.has(i));
      el.classList.toggle('target', targets.has(i));
      el.classList.toggle('capture', targets.get(i) === true);
      el.classList.toggle('movable', movable.has(i));
    }
  }

  function renderBars() {
    const n = E.countPieces(B.game.board);
    const bottomColor = B.flip ? BLACK : WHITE;
    const info = modeBars(bottomColor);
    for (const [pos, color] of [['bottom', bottomColor], ['top', -bottomColor]]) {
      const p = info[pos];
      setAvatar($(`#${pos}-avatar`), p.avatar);
      $(`#${pos}-name`).textContent = p.name;
      $(`#${pos}-sub`).textContent = p.sub || '';
      const taken = 12 - (color === WHITE ? n.black : n.white);
      $(`#${pos}-taken`).textContent = taken ? `×${taken}` : '';
      $(`#p-${pos}`).classList.toggle('turn', B.game.result === null && B.game.turn === color);
      $(`#p-${pos}`).classList.toggle('offline', !!p.offline);
    }
  }

  function setStatus(text, alert) {
    const st = $('#status');
    st.textContent = text;
    st.classList.toggle('alert', !!alert);
  }

  function renderStatus() {
    const g = B.game;
    if (g.result !== null) return setStatus('Партия окончена');
    if (B.mode === 'online') {
      const room = online.room;
      const opp = room && room.players.find((p) => p.color !== room.you);
      if (!online.connected) return setStatus('Нет связи, переподключаемся…', true);
      if (opp && !opp.online) return setStatus('Соперник не в сети. Ждём его до 2 минут…', true);
      if (g.turn !== room.you) return setStatus('Ход соперника');
    }
    if (B.mode === 'bot' && g.turn !== bot.color) return setStatus('Бот думает…');
    if (g.moves.length && g.moves[0].caps.length) return setStatus('Бить обязательно!', true);
    if (B.mode === 'local') return setStatus(`Ход: ${g.turn === WHITE ? 'белые' : 'чёрные'}`);
    setStatus('Ваш ход');
  }

  function render() {
    renderHighlights();
    renderBars();
    renderStatus();
    updateControls();
  }

  // Анимация одного шага хода. piece — значение фигуры до хода.
  function animateStep(el, m, k, piece) {
    placeEl(el, m.path[k]);
    if (m.caps.length) {
      pieceAt[m.caps[k]].classList.add('taken');
      haptic.hit();
    } else {
      haptic.move();
    }
    const r = m.path[k] >> 3;
    if ((piece === 1 && r === 0) || (piece === -1 && r === 7)) el.classList.add('king');
  }

  // Сыграть ход: состояние партии меняется сразу, анимация — следом.
  // animated — сколько шагов игрок уже «прошёл» кликами.
  async function commit(m, animated, source) {
    const token = B.token;
    const piece = B.game.board[m.from];
    B.game.play(m);
    if (B.mode === 'online' && source === 'me') online.socket.send({ t: 'move', squares: [m.from, ...m.path] });
    B.sel = null;
    B.busy = true;
    render();

    const el = pieceAt[m.from];
    el.classList.add('moving');
    for (let k = animated; k < m.path.length; k++) {
      animateStep(el, m, k, piece);
      await sleep(STEP_MS);
      if (token !== B.token) return;
    }
    el.classList.remove('moving');
    for (const v of m.caps) {
      const c = pieceAt[v];
      c.classList.add('gone');
      setTimeout(() => c.remove(), 260);
      pieceAt[v] = null;
    }
    pieceAt[m.from] = null;
    pieceAt[m.path[m.path.length - 1]] = el;
    B.busy = false;
    render();
    afterMove();
  }

  function afterMove() {
    if (B.mode === 'bot') return botAfterMove();
    if (B.mode === 'online') return onlineAfterMove();
    if (B.game.result !== null) localGameOver();
  }

  function onCellClick(i) {
    if (!humanCanMove()) return;
    const g = B.game;
    const sel = B.sel;

    if (sel) {
      const k = sel.steps.length;
      const next = sel.cands.filter((m) => m.path[k] === i);
      if (next.length) {
        sel.steps.push(i);
        sel.cands = next;
        const el = pieceAt[sel.from];
        el.classList.add('moving');
        animateStep(el, next[0], k, g.board[sel.from]);
        const done = next.find((m) => m.path.length === sel.steps.length);
        if (done) commit(done, sel.steps.length, 'me');
        else renderHighlights();
        return;
      }
      if (k > 0) { haptic.error(); return; } // посреди взятия передумать нельзя
    }

    const own = g.moves.filter((m) => m.from === i);
    if (own.length) {
      B.sel = sel && sel.from === i ? null : { from: i, steps: [], cands: own };
      haptic.tap();
    } else {
      if (g.board[i] && E.sideOf(g.board[i]) === g.turn) {
        haptic.error();
        if (g.moves[0].caps.length) flashStatus('Есть обязательное взятие');
      }
      B.sel = null;
    }
    renderHighlights();
  }

  function flashStatus(text) {
    setStatus(text, true);
    clearTimeout(flashStatus.t);
    flashStatus.t = setTimeout(renderStatus, 1400);
  }

  // ── Кнопки под доской ─────────────────────────────────────
  function renderControls() {
    const defs = {
      bot: [['undo', '↶ Отменить'], ['restart', '⟳ Заново'], ['menu', '☰ Меню']],
      local: [['undo', '↶ Отменить'], ['restart', '⟳ Заново'], ['menu', '☰ Меню']],
      online: [['draw', '½ Ничья'], ['resign', '🏳 Сдаться'], ['menu', '☰ Меню']],
    }[B.mode];
    $('#controls').innerHTML = defs.map(([id, text]) => `<button data-act="${id}">${text}</button>`).join('');
  }

  function updateControls() {
    const btn = (id) => $(`#controls [data-act="${id}"]`);
    const g = B.game;
    if (B.mode === 'bot') {
      const locked = !profile || !profile.purchases.undo;
      btn('undo').textContent = locked ? '🔒 Отменить' : '↶ Отменить';
      btn('undo').disabled = !locked && (B.busy || g.result !== null || g.turn !== bot.color || g.history.length < 2);
    } else if (B.mode === 'local') {
      btn('undo').disabled = B.busy || !g.history.length;
    } else if (B.mode === 'online') {
      const playing = online.room && online.room.status === 'playing';
      btn('draw').disabled = !playing || !!online.room.drawOffer || g.log.length < 2;
      btn('resign').disabled = !playing;
    }
  }

  async function onControl(act) {
    if (act === 'menu') return leaveGame();
    if (act === 'restart') {
      if (B.mode === 'bot') { if (await abandonBotGame()) startBotGame(); return; }
      return startLocalGame();
    }
    if (act === 'undo') {
      if (B.mode === 'bot' && !profile.purchases.undo) {
        if (await confirmDialog(`Отмена хода в игре с ботом — ${PRODUCTS.undo.price} ⭐ навсегда. Купить?`)) buy('undo');
        return;
      }
      if (B.busy) return;
      B.game.undo(B.mode === 'bot' ? 2 : 1);
      B.sel = null;
      renderPieces();
      render();
      return;
    }
    if (act === 'draw') {
      online.socket.send({ t: 'draw_offer' });
      toast('Предложение ничьей отправлено');
      return;
    }
    if (act === 'resign') {
      if (await confirmDialog('Сдаться? Партия будет засчитана как поражение.')) online.socket.send({ t: 'resign' });
    }
  }

  async function leaveGame() {
    if (B.mode === 'bot') { if (await abandonBotGame()) showMenu(); return; }
    if (B.mode === 'online') return closeOnline();
    showMenu();
  }

  // ── Модальное окно итога ──────────────────────────────────
  function showModal({ emoji, title, text, progress, actions }) {
    $('#modal-emoji').textContent = emoji;
    $('#modal-title').textContent = title;
    $('#modal-text').textContent = text || '';
    const pr = $('#modal-progress');
    pr.classList.toggle('hidden', !progress);
    if (progress) {
      pr.querySelector('i').style.width = `${(progress.value / progress.max) * 100}%`;
      pr.querySelector('small').textContent = progress.label;
    }
    const box = $('#modal-actions');
    box.innerHTML = '';
    for (const a of actions) {
      const b = document.createElement('button');
      b.textContent = a.text;
      if (a.primary) b.className = 'primary';
      b.disabled = !!a.disabled;
      b.onclick = a.onClick;
      box.appendChild(b);
    }
    $('#modal').classList.remove('hidden');
  }
  function hideModal() { $('#modal').classList.add('hidden'); }

  function resultLook(result) {
    if (result === 'win') { haptic.win(); return { emoji: '🏆', title: 'Победа!' }; }
    if (result === 'loss') { haptic.error(); return { emoji: '😔', title: 'Поражение' }; }
    return { emoji: '🤝', title: 'Ничья' };
  }

  // ═════════════════════════════════════════════════════════
  // Игра с ботом
  // ═════════════════════════════════════════════════════════
  const bot = { level: 1, color: WHITE, gameId: null, worker: null, reqId: 0 };

  function aiSearch(board, color, level) {
    if (!bot.worker && window.Worker) {
      try { bot.worker = new Worker('ai-worker.js'); } catch (e) { bot.worker = null; }
    }
    if (!bot.worker) {
      const m = window.CheckersAI.search(board, color, level);
      return Promise.resolve(m && [m.from, ...m.path]);
    }
    const id = ++bot.reqId;
    return new Promise((resolve) => {
      const onMsg = (e) => {
        if (e.data.id !== id) return;
        bot.worker.removeEventListener('message', onMsg);
        resolve(e.data.move);
      };
      bot.worker.addEventListener('message', onMsg);
      bot.worker.postMessage({ id, board: Array.from(board), color, level });
    });
  }

  function startBotGame() {
    B.mode = 'bot';
    B.game = new E.Game();
    B.flip = bot.color === BLACK;
    B.mySide = bot.color;
    bot.gameId = null;
    hideModal();
    showScreen('game');
    setupBoard();
    if (B.game.turn !== bot.color) botThink();
  }

  // Партию регистрируем на сервере при первом ходе — выход до первого хода ничем не грозит.
  function ensureServerGame() {
    if (!bot.gameId) {
      bot.gameId = Api.post('/api/bot/start', { level: bot.level, color: bot.color })
        .then((r) => r.gameId)
        .catch((e) => { toast('Партия не будет засчитана: ' + e.message); return null; });
    }
    return bot.gameId;
  }

  async function botThink() {
    const token = B.token;
    B.busy = true;
    render();
    const [squares] = await Promise.all([aiSearch(B.game.board, B.game.turn, bot.level), sleep(400)]);
    if (token !== B.token) return;
    B.busy = false;
    const m = squares && B.game.find(squares);
    if (m) commit(m, 0, 'bot');
  }

  function botAfterMove() {
    ensureServerGame();
    if (B.game.result !== null) return finishBotGame(false);
    if (B.game.turn !== bot.color) botThink();
  }

  async function finishBotGame(resign) {
    const token = B.token;
    const gameId = await ensureServerGame();
    let res = null;
    if (gameId) {
      try {
        res = await Api.post('/api/bot/finish', { gameId, log: B.game.log, resign });
        profile = res.profile;
      } catch (e) {
        toast(e.message);
      }
    }
    if (resign || token !== B.token) return;

    const result = res ? res.result
      : B.game.result === 0 ? 'draw' : B.game.result === bot.color ? 'win' : 'loss';
    const look = resultLook(result);
    const lv = BOT_LEVELS[bot.level - 1];
    const actions = [];
    let text = B.game.reason;
    let progress = null;

    if (res && res.levelUp) {
      const next = BOT_LEVELS[res.levelUp - 1];
      look.emoji = '🎉';
      text = `Открыт уровень ${next.level} — ${next.name}!`;
      actions.push({ text: `Играть на уровне ${next.level}`, primary: true, onClick: () => { bot.level = next.level; prefs.botLevel = next.level; prefs.save(); startBotGame(); } });
      actions.push({ text: 'Ещё раз на этом уровне', onClick: startBotGame });
    } else {
      actions.push({ text: 'Ещё партию', primary: true, onClick: startBotGame });
      const p = profile && profile.progress;
      if (p && bot.level === p.unlocked && p.unlocked < MAX_LEVEL) {
        progress = { value: p.wins, max: WINS_TO_ADVANCE, label: `Побед для уровня ${p.unlocked + 1}: ${p.wins} из ${WINS_TO_ADVANCE}` };
      }
    }
    actions.push({ text: 'В меню', onClick: showMenu });
    showModal({ ...look, text: `${lv.emoji} ${lv.name} · ${text}`, progress, actions });
  }

  // Выход из незаконченной партии = поражение (иначе можно было бы уходить от проигрышей).
  async function abandonBotGame() {
    const g = B.game;
    if (g.result !== null || !bot.gameId) { B.token++; return true; }
    if (!(await confirmDialog('Партия будет засчитана как поражение. Выйти?'))) return false;
    B.token++;
    await finishBotGame(true);
    return true;
  }

  // ── Экран выбора уровня ───────────────────────────────────
  function renderBotScreen() {
    const p = profile.progress;
    if (!prefs.botLevel || prefs.botLevel > p.unlocked) prefs.botLevel = p.unlocked;
    const buyBlocked = profile.shop.level_up.blocked;
    $('#levels').innerHTML = BOT_LEVELS.map((lv) => {
      const open = lv.level <= p.unlocked;
      const st = profile.stats.bot[lv.level];
      let right = '';
      if (open && lv.level === p.unlocked && lv.level < MAX_LEVEL) {
        right = `<div class="lv-progress"><div class="bar"><i style="width:${(p.wins / WINS_TO_ADVANCE) * 100}%"></i></div><small>${p.wins}/${WINS_TO_ADVANCE} побед</small></div>`;
      } else if (open) {
        right = `<small class="hint">${st.w}–${st.l}–${st.d}</small>`;
      } else if (lv.level === p.unlocked + 1) {
        right = buyBlocked
          ? `<small class="hint lock-reason">🔒 ${esc(buyBlocked)}</small>`
          : `<button class="buy-btn" data-buy="level_up">${PRODUCTS.level_up.price} ⭐</button>`;
      } else {
        right = '<span class="lock">🔒</span>';
      }
      return `<div class="level ${open ? 'open' : 'locked'} ${prefs.botLevel === lv.level ? 'on' : ''}" data-level="${lv.level}">
        <span class="lv-emoji">${lv.emoji}</span>
        <span class="lv-text"><b>${lv.level}. ${lv.name}</b></span>
        <span class="lv-right">${right}</span>
      </div>`;
    }).join('');
    document.querySelectorAll('#bot-color button').forEach((b) =>
      b.classList.toggle('on', Number(b.dataset.value) === prefs.botColor));
  }

  // ═════════════════════════════════════════════════════════
  // Вдвоём на одном устройстве
  // ═════════════════════════════════════════════════════════
  function startLocalGame() {
    B.mode = 'local';
    B.game = new E.Game();
    B.flip = false;
    B.mySide = WHITE;
    hideModal();
    showScreen('game');
    setupBoard();
  }

  function localGameOver() {
    const g = B.game;
    haptic.win();
    setTimeout(() => showModal({
      emoji: g.result === 0 ? '🤝' : '🏆',
      title: g.result === 0 ? 'Ничья' : `${g.result === WHITE ? 'Белые' : 'Чёрные'} победили!`,
      text: g.reason,
      actions: [
        { text: 'Ещё партию', primary: true, onClick: startLocalGame },
        { text: 'В меню', onClick: showMenu },
      ],
    }), 400);
  }

  // ═════════════════════════════════════════════════════════
  // Игра с другом
  // ═════════════════════════════════════════════════════════
  const online = { socket: null, room: null, roomId: null, connected: false, pending: null, shownOver: 0 };

  function inviteLink(roomId) {
    const param = `room_${roomId}`;
    if (!config.botUsername) return `${location.origin}${location.pathname}?room=${roomId}`;
    return config.appShortName
      ? `https://t.me/${config.botUsername}/${config.appShortName}?startapp=${param}`
      : `https://t.me/${config.botUsername}?startapp=${param}`;
  }

  async function startFriendGame() {
    try {
      const { roomId } = await Api.post('/api/rooms');
      openRoom(roomId, true);
    } catch (e) {
      alertDialog(e.message);
    }
  }

  function openRoom(roomId, creator) {
    closeSocket();
    online.roomId = roomId;
    online.room = null;
    online.shownOver = 0;
    setAvatar($('#lobby-me'), profile.avatar);
    $('#lobby-me-name').textContent = profile.name;
    $('#lobby-text').textContent = creator
      ? 'Отправьте приглашение. Партия начнётся, как только друг откроет ссылку.'
      : 'Подключаемся к партии…';
    $('#lobby-invite').classList.toggle('hidden', !creator);
    $('#lobby-copy').classList.toggle('hidden', !creator);
    showScreen('lobby');
    online.socket = new Api.RoomSocket(roomId, {
      state: onRoomState,
      error: onRoomError,
      connection: (ok) => { online.connected = ok; if (screen === 'game' && B.mode === 'online') renderStatus(); },
    });
  }

  function closeSocket() {
    if (online.socket) online.socket.close();
    online.socket = null;
  }

  async function onRoomError(err) {
    if (err.code === 'not_found' || err.code === 'full' || !online.room) {
      closeSocket();
      await alertDialog(err.msg);
      showMenu();
    } else {
      toast(err.msg);
    }
  }

  function onRoomState(room) {
    if (B.busy && B.mode === 'online') { online.pending = room; return; }
    const prev = online.room;
    online.room = room;

    if (room.status === 'waiting') {
      $('#lobby-invite').classList.remove('hidden');
      $('#lobby-copy').classList.remove('hidden');
      if (screen !== 'lobby') showScreen('lobby');
      return;
    }

    const fresh = B.mode !== 'online' || screen !== 'game' || !prev || prev.gameNo !== room.gameNo;
    if (fresh) {
      if (prev && prev.gameNo !== room.gameNo) toast('Реванш! Цвета поменялись');
      setupOnlineGame(room);
    } else {
      syncOnline(room);
    }
    renderOnlineExtras();
  }

  function setupOnlineGame(room) {
    B.mode = 'online';
    B.game = E.Game.replay(room.log) || new E.Game();
    B.flip = room.you === BLACK;
    B.mySide = room.you || WHITE;
    hideModal();
    showScreen('game');
    setupBoard();
  }

  // Сравниваем запись партии с сервером: один новый ход — анимируем, иначе пересобираем.
  function syncOnline(room) {
    const local = B.game.log;
    const remote = room.log;
    const same = (a, b) => a.length === b.length && a.every((x, k) => x === b[k]);
    const prefixOk = local.every((m, k) => remote[k] && same(m, remote[k]));
    if (prefixOk && remote.length === local.length + 1) {
      const m = B.game.find(remote[remote.length - 1]);
      if (m) { commit(m, 0, 'remote'); return; }
    }
    if (!prefixOk || remote.length !== local.length) {
      B.game = E.Game.replay(remote) || new E.Game();
      B.sel = null;
      renderPieces();
    }
    render();
  }

  function onlineAfterMove() {
    if (online.pending) {
      const r = online.pending;
      online.pending = null;
      onRoomState(r);
    } else {
      renderOnlineExtras();
    }
  }

  function renderOnlineExtras() {
    const room = online.room;
    if (!room || screen !== 'game') return;
    const offer = room.status === 'playing' && room.drawOffer && room.drawOffer !== room.you;
    $('#draw-banner').classList.toggle('hidden', !offer);
    if (offer && !online.offerSeen) { haptic.tap(); online.offerSeen = true; }
    if (!room.drawOffer) online.offerSeen = false;
    render();
    if (room.status === 'over') showOnlineResult(room);
  }

  function showOnlineResult(room) {
    const me = room.players.find((p) => p.color === room.you);
    const opp = room.players.find((p) => p.color !== room.you);
    const result = room.result === 0 ? 'draw' : room.result === room.you ? 'win' : 'loss';
    let look = { emoji: '🤝', title: 'Ничья' };
    if (result === 'win') look = { emoji: '🏆', title: 'Победа!' };
    if (result === 'loss') look = { emoji: '😔', title: 'Поражение' };
    if (online.shownOver !== room.gameNo) {
      online.shownOver = room.gameNo;
      resultLook(result); // вибрация
    }
    let rematchText = 'Реванш';
    if (me.rematch) rematchText = 'Ждём соперника…';
    else if (opp.rematch) rematchText = 'Принять реванш';
    const reason = room.reason === 'Соперник сдался' && result === 'loss' ? 'Вы сдались' : room.reason;
    showModal({
      ...look,
      text: `${reason}${opp.rematch && !me.rematch ? ' · Соперник хочет реванш!' : ''}`,
      actions: [
        { text: rematchText, primary: true, disabled: me.rematch || !opp.online, onClick: () => online.socket.send({ t: 'rematch' }) },
        { text: 'В меню', onClick: closeOnline },
      ],
    });
    if (!opp.online && !me.rematch) $('#modal-text').textContent += ' · Соперник вышел';
  }

  async function closeOnline() {
    const room = online.room;
    if (room && room.status === 'playing' && screen === 'game') {
      if (!(await confirmDialog('Выйти из партии? Вам будет засчитано поражение.'))) return;
    }
    if (online.socket) online.socket.send({ t: 'leave' });
    await sleep(50);
    closeSocket();
    online.room = null;
    B.token++;
    B.mode = null;
    showMenu();
  }

  async function shareInvite() {
    const link = inviteLink(online.roomId);
    const text = `${profile.name} приглашает вас сыграть в шашки!`;
    if (tg) tg.openTelegramLink(`https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(text)}`);
    else if (navigator.share) navigator.share({ text, url: link }).catch(() => {});
    else copyInvite();
  }

  async function copyInvite() {
    const link = inviteLink(online.roomId);
    try { await navigator.clipboard.writeText(link); toast('Ссылка скопирована'); }
    catch (e) { window.prompt('Скопируйте ссылку:', link); }
  }

  // Подписи игроков над и под доской
  function modeBars(bottomColor) {
    const me = { avatar: profile.avatar, name: profile.name, sub: '' };
    if (B.mode === 'bot') {
      const lv = BOT_LEVELS[bot.level - 1];
      const botInfo = { avatar: { type: 'emoji', value: lv.emoji }, name: `Бот · ${lv.name}`, sub: `уровень ${lv.level}` };
      return bottomColor === bot.color ? { bottom: me, top: botInfo } : { bottom: botInfo, top: me };
    }
    if (B.mode === 'online' && online.room) {
      const by = (c) => {
        const p = online.room.players.find((x) => x.color === c);
        return p ? { avatar: p.avatar, name: p.name, sub: p.online ? '' : 'не в сети', offline: !p.online } : me;
      };
      return { bottom: by(bottomColor), top: by(-bottomColor) };
    }
    return {
      bottom: { avatar: { type: 'emoji', value: '⚪' }, name: 'Белые' },
      top: { avatar: { type: 'emoji', value: '⚫' }, name: 'Чёрные' },
    };
  }

  // ═════════════════════════════════════════════════════════
  // Покупки
  // ═════════════════════════════════════════════════════════
  async function buy(product) {
    let r;
    try {
      r = await Api.post('/api/invoice', { product });
    } catch (e) {
      return alertDialog(e.message);
    }
    if (r.granted) { // режим разработки без бота
      profile = r.profile;
      onPurchased(product);
      return;
    }
    if (!tg) return alertDialog('Оплата звёздами доступна только внутри Telegram');
    const before = JSON.stringify(profile.progress) + JSON.stringify(profile.purchases);
    tg.openInvoice(r.link, async (status) => {
      if (status === 'paid') {
        // оплата применяется, когда серверу придёт successful_payment — ждём его
        for (let i = 0; i < 10; i++) {
          await sleep(700);
          try { profile = await Api.get('/api/me'); } catch (e) { continue; }
          if (JSON.stringify(profile.progress) + JSON.stringify(profile.purchases) !== before) break;
        }
        onPurchased(product);
      } else if (status === 'failed') {
        alertDialog('Оплата не прошла');
      }
    });
  }

  function onPurchased(product) {
    haptic.win();
    const msg = {
      level_up: `Открыт уровень ${profile.progress.unlocked}!`,
      undo: 'Отмена хода включена',
      colors: 'Цвета шашек открыты — выберите в профиле',
    }[product];
    toast(msg);
    if (product === 'level_up') { prefs.botLevel = profile.progress.unlocked; prefs.save(); }
    if (screen === 'bot') renderBotScreen();
    if (screen === 'shop') renderShop();
    if (screen === 'profile') renderProfile();
    if (screen === 'game') updateControls();
    renderMenu();
  }

  function renderShop() {
    const icons = { level_up: '🚀', undo: '↶', colors: '🎨' };
    $('#shop-list').innerHTML = Object.entries(PRODUCTS).map(([id, p]) => {
      const s = profile.shop[id];
      let desc = p.description;
      if (id === 'level_up') {
        const u = profile.progress.unlocked;
        desc = u < MAX_LEVEL ? `Сейчас открыт уровень ${u}. Откроет уровень ${u + 1} — «${BOT_LEVELS[u].name}».` : 'Все уровни открыты';
      }
      const action = s.owned ? '<span class="owned">Куплено ✓</span>'
        : s.blocked ? `<small class="hint">${esc(s.blocked)}</small>`
          : `<button class="buy-btn" data-buy="${id}">${p.price} ⭐</button>`;
      return `<div class="shop-item">
        <span class="si-icon">${icons[id]}</span>
        <span class="si-text"><b>${p.title}</b><small>${esc(desc)}</small></span>
        <span class="si-action">${action}</span>
      </div>`;
    }).join('');
  }

  // ═════════════════════════════════════════════════════════
  // Профиль: аватар, цвета, статистика
  // ═════════════════════════════════════════════════════════
  function renderMenu() {
    if (!profile) return;
    setAvatar($('#me-avatar'), profile.avatar);
    $('#me-name').textContent = profile.name;
    const p = profile.progress;
    $('#menu-bot-sub').textContent = p.unlocked < MAX_LEVEL
      ? `Уровень ${p.unlocked} из ${MAX_LEVEL} · ${p.wins}/${WINS_TO_ADVANCE} побед до следующего`
      : 'Все 5 уровней открыты';
  }

  function renderProfile() {
    setAvatar($('#pf-avatar'), profile.avatar);
    $('#pf-name').textContent = profile.name;

    const cur = profile.avatarSetting;
    $('#emoji-grid').innerHTML = AVATAR_EMOJI.map((e) =>
      `<button class="emoji ${cur.type === 'emoji' && cur.value === e ? 'on' : ''}" data-emoji="${e}">${e}</button>`).join('');
    $('#tg-photo').classList.toggle('hidden', !profile.hasTgPhoto);
    $('#tg-photo').classList.toggle('on', cur.type === 'tg');

    const owned = profile.purchases.colors;
    $('#colors-lock').innerHTML = owned ? '' : `<button class="buy-btn small" data-buy="colors">🔒 ${PRODUCTS.colors.price} ⭐</button>`;
    const sw = (which) => PALETTE.map((c) => {
      const locked = !owned && !FREE_COLORS.includes(c.id);
      const on = profile.colors[which] === c.id;
      const other = profile.colors[which === 'mine' ? 'theirs' : 'mine'] === c.id;
      return `<button class="swatch ${on ? 'on' : ''} ${locked ? 'locked' : ''}" ${other ? 'disabled' : ''}
        data-color="${c.id}" data-which="${which}" title="${c.name}" style="--c:${c.hex}"></button>`;
    }).join('');
    $('#sw-mine').innerHTML = sw('mine');
    $('#sw-theirs').innerHTML = sw('theirs');
    $('#color-preview').innerHTML =
      `<span class="pv" style="--c:${colorHex(profile.colors.mine)}"></span><span class="pv-vs">против</span><span class="pv" style="--c:${colorHex(profile.colors.theirs)}"></span>`;

    renderStats();
  }

  function renderStats() {
    const s = profile.stats;
    const sum = (k) => s.friend[k] + Object.values(s.bot).reduce((a, x) => a + x[k], 0);
    const w = sum('w'), l = sum('l'), d = sum('d');
    const total = w + l + d;
    const pct = total ? Math.round((w / total) * 100) : 0;
    const rows = BOT_LEVELS.map((lv) => {
      const x = s.bot[lv.level];
      const open = lv.level <= profile.progress.unlocked;
      return `<tr class="${open ? '' : 'dim'}"><td>${lv.emoji} ${lv.name}</td><td>${x.w}</td><td>${x.l}</td><td>${x.d}</td></tr>`;
    }).join('');
    const f = s.friend;
    const icon = { win: '🏆', loss: '❌', draw: '🤝' };
    const fmt = (t) => new Date(t).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
    const hist = profile.history.slice(0, 10).map((h) => {
      const who = h.mode === 'bot' ? `Бот · ${BOT_LEVELS[h.level - 1].name}` : `vs ${esc(h.opponent || 'друг')}`;
      return `<li><span>${icon[h.result]}</span><span class="h-who">${who}</span><small>${fmt(h.at)}</small></li>`;
    }).join('');

    $('#stats-card').innerHTML = `
      <div class="label">Статистика</div>
      <div class="tiles">
        <div class="tile"><b>${total}</b><small>партий</small></div>
        <div class="tile"><b>${w}</b><small>побед</small></div>
        <div class="tile"><b>${pct}%</b><small>побед</small></div>
        <div class="tile"><b>${s.bestStreak}</b><small>лучшая серия</small></div>
      </div>
      <table class="stats-table">
        <thead><tr><th></th><th>П</th><th>Пр</th><th>Н</th></tr></thead>
        <tbody>${rows}
          <tr class="sep"><td>👥 С друзьями</td><td>${f.w}</td><td>${f.l}</td><td>${f.d}</td></tr>
        </tbody>
      </table>
      ${hist ? `<div class="label">Последние партии</div><ul class="history">${hist}</ul>` : '<p class="hint">Сыгранных партий пока нет</p>'}`;
  }

  async function saveSettings(body) {
    try {
      profile = await Api.patch('/api/me', body);
      renderProfile();
      renderMenu();
    } catch (e) {
      toast(e.message);
    }
  }

  // Обрезаем фото по центру до квадрата 256×256 и сжимаем в JPEG.
  function loadPhoto(file) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const size = 256;
        const cv = document.createElement('canvas');
        cv.width = cv.height = size;
        const s = Math.min(img.width, img.height);
        cv.getContext('2d').drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, size, size);
        URL.revokeObjectURL(img.src);
        let q = 0.85, url = cv.toDataURL('image/jpeg', q);
        while (url.length > 350000 && q > 0.4) { q -= 0.15; url = cv.toDataURL('image/jpeg', q); }
        resolve(url);
      };
      img.onerror = () => reject(new Error('Не удалось открыть картинку'));
      img.src = URL.createObjectURL(file);
    });
  }

  // ═════════════════════════════════════════════════════════
  // Запуск
  // ═════════════════════════════════════════════════════════
  function bind() {
    $('#me-chip').onclick = () => { renderProfile(); showScreen('profile'); };
    document.querySelectorAll('[data-go]').forEach((b) => {
      b.onclick = () => {
        const id = b.dataset.go;
        if (id === 'bot') renderBotScreen();
        if (id === 'shop') renderShop();
        showScreen(id);
      };
    });
    $('#play-friend').onclick = startFriendGame;
    $('#play-local').onclick = startLocalGame;

    $('#levels').onclick = (e) => {
      const lv = e.target.closest('.level.open');
      if (lv && !e.target.closest('[data-buy]')) {
        prefs.botLevel = Number(lv.dataset.level);
        prefs.save();
        haptic.tap();
        renderBotScreen();
      }
    };
    $('#bot-color').onclick = (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      prefs.botColor = Number(b.dataset.value);
      prefs.save();
      haptic.tap();
      renderBotScreen();
    };
    $('#bot-start').onclick = () => {
      bot.level = prefs.botLevel;
      bot.color = prefs.botColor;
      startBotGame();
    };

    $('#lobby-invite').onclick = shareInvite;
    $('#lobby-copy').onclick = copyInvite;
    $('#lobby-cancel').onclick = closeOnline;

    $('#cells').onclick = (e) => {
      const cell = e.target.closest('.cell');
      if (cell) onCellClick(Number(cell.dataset.idx));
    };
    $('#controls').onclick = (e) => {
      const b = e.target.closest('[data-act]');
      if (b) onControl(b.dataset.act);
    };
    $('#draw-yes').onclick = () => online.socket.send({ t: 'draw_answer', accept: true });
    $('#draw-no').onclick = () => online.socket.send({ t: 'draw_answer', accept: false });

    // Кнопки покупки разбросаны по экранам — ловим их одним обработчиком
    document.addEventListener('click', (e) => {
      const b = e.target.closest('[data-buy]');
      if (b) { e.stopPropagation(); buy(b.dataset.buy); }
    }, true);

    $('#emoji-grid').onclick = (e) => {
      const b = e.target.closest('[data-emoji]');
      if (b) { haptic.tap(); saveSettings({ avatar: { type: 'emoji', value: b.dataset.emoji } }); }
    };
    $('#tg-photo').onclick = () => saveSettings({ avatar: { type: 'tg' } });
    $('#photo-input').onchange = async (e) => {
      const file = e.target.files[0];
      e.target.value = '';
      if (!file) return;
      try {
        const dataUrl = await loadPhoto(file);
        profile = await Api.post('/api/avatar', { dataUrl });
        renderProfile();
        renderMenu();
        toast('Аватар обновлён');
      } catch (err) {
        alertDialog(err.message);
      }
    };
    const onSwatch = async (e) => {
      const b = e.target.closest('.swatch');
      if (!b || b.disabled) return;
      if (b.classList.contains('locked')) {
        if (await confirmDialog(`20 цветов шашек — ${PRODUCTS.colors.price} ⭐ навсегда. Купить?`)) buy('colors');
        return;
      }
      haptic.tap();
      saveSettings({ colors: { ...profile.colors, [b.dataset.which]: b.dataset.color } });
    };
    $('#sw-mine').onclick = onSwatch;
    $('#sw-theirs').onclick = onSwatch;
  }

  function startParam() {
    const p = (tg && tg.initDataUnsafe && tg.initDataUnsafe.start_param) || '';
    if (p.startsWith('room_')) return p.slice(5);
    return new URLSearchParams(location.search).get('room');
  }

  async function init() {
    initTelegram();
    bind();
    try {
      [config, profile] = await Promise.all([Api.get('/api/config'), Api.get('/api/me')]);
    } catch (e) {
      $('#me-name').textContent = 'Нет связи с сервером';
      await alertDialog(`${e.message}. Попробуйте открыть приложение позже.`);
      return;
    }
    renderMenu();
    const roomId = startParam();
    if (roomId) openRoom(roomId, false);
  }

  init();
})();
