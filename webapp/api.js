// Связь с сервером: REST + WebSocket. Авторизация — подписанный initData от Telegram.
(function () {
  'use strict';
  const tg = window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.initData
    ? window.Telegram.WebApp : null;

  // Вне Telegram (только сервер в режиме DEV): постоянный тестовый id в браузере.
  // ?dev_user=2 — чтобы во второй вкладке зайти другим игроком.
  function devAuth() {
    const q = new URLSearchParams(location.search);
    let id = q.get('dev_user');
    if (!id) {
      try {
        id = localStorage.getItem('dev_uid');
        if (!id) { id = String(1e8 + Math.floor(Math.random() * 9e8)); localStorage.setItem('dev_uid', id); }
      } catch (e) { id = '100000001'; }
    }
    return `dev ${id}:${encodeURIComponent(q.get('dev_name') || 'Игрок ' + id.slice(-3))}`;
  }

  const auth = tg ? 'tma ' + tg.initData : devAuth();

  async function request(method, url, body) {
    let res;
    try {
      res = await fetch(url, {
        method,
        headers: { 'content-type': 'application/json', authorization: auth },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (e) {
      throw new Error('Нет связи с сервером');
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Ошибка сервера');
    return data;
  }

  // Соединение для онлайн-партии: переподключается само и заново входит в комнату.
  class RoomSocket {
    constructor(roomId, handlers) {
      this.roomId = roomId;
      this.h = handlers; // { state, error, connection(bool) }
      this.closed = false;
      this.retry = 0;
      this.open();
    }

    open() {
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      const ws = this.ws = new WebSocket(`${proto}://${location.host}/ws`);
      ws.onopen = () => ws.send(JSON.stringify({ t: 'auth', auth }));
      ws.onmessage = (e) => {
        const msg = JSON.parse(e.data);
        if (msg.t === 'ready') {
          this.retry = 0;
          this.h.connection(true);
          this.send({ t: 'join', room: this.roomId });
        } else if (msg.t === 'state') this.h.state(msg.room);
        else if (msg.t === 'error') this.h.error(msg);
      };
      ws.onclose = (e) => {
        if (this.closed) return;
        this.h.connection(false);
        if (e.code === 4001) return this.h.error({ msg: 'Не удалось войти. Перезапустите приложение.' });
        setTimeout(() => this.closed || this.open(), Math.min(1000 * 2 ** this.retry++, 10000));
      };
    }

    send(msg) {
      if (this.ws.readyState === 1) this.ws.send(JSON.stringify(msg));
    }

    close() {
      this.closed = true;
      this.ws.close();
    }
  }

  window.Api = {
    tg,
    get: (url) => request('GET', url),
    post: (url, body) => request('POST', url, body || {}),
    patch: (url, body) => request('PATCH', url, body),
    RoomSocket,
  };
})();
