#!/usr/bin/env bash
# Установка на VPS (Ubuntu 22.04/24.04, Debian 12). Запуск от root:
#   DOMAIN=damka.example.com BOT_TOKEN=123:ABC APP_SHORT_NAME=checkers bash install.sh
#
# Необязательные переменные:
#   EMAIL=you@mail.ru   почта для Let's Encrypt (уведомления о сертификате)
#   PORT=8080           внутренний порт сервера игры
#   PROXY=nginx|caddy   кто отдаёт сайт наружу; по умолчанию nginx, если он уже установлен, иначе caddy
#   FIREWALL=1          включить ufw, даже если он был выключен (на сервере с другими сайтами — осторожно)
#   REPO, BRANCH        откуда брать код
#
# Повторный запуск безопасен: сделанные шаги пропускаются, /etc/chuckers.env и конфиг nginx
# не перезаписываются. Уже работающие на сервере сайты не затрагиваются.
set -euo pipefail

: "${DOMAIN:?Укажите DOMAIN=ваш.домен}"
REPO="${REPO:-https://github.com/bcaun/chuckers.git}"
BRANCH="${BRANCH:-main}"
PORT="${PORT:-8080}"
APP_DIR=/opt/chuckers
DATA_DIR=/var/lib/chuckers
ENV_FILE=/etc/chuckers.env

[ "$(id -u)" -eq 0 ] || { echo "Запустите от root (sudo -i)"; exit 1; }

if [ -z "${PROXY:-}" ]; then
  if command -v nginx >/dev/null; then PROXY=nginx; else PROXY=caddy; fi
fi
echo "==> Веб-сервер: $PROXY"

# Порт из уже существующих настроек важнее переданного
if [ -f "$ENV_FILE" ]; then
  PORT="$(grep -E '^PORT=' "$ENV_FILE" | cut -d= -f2 || echo "$PORT")"
fi
if ss -ltnH "sport = :$PORT" | grep -q . && ! systemctl is-active -q chuckers; then
  echo "Порт $PORT уже занят другой программой. Запустите с другим портом, например PORT=8090"
  exit 1
fi

echo "==> Пакеты"
export DEBIAN_FRONTEND=noninteractive
apt-get update -q
apt-get install -y -q curl git ca-certificates gnupg

echo "==> Node.js"
# Подходящий Node.js (18+) уже есть — не трогаем, им могут пользоваться другие программы
if ! /usr/bin/node -v 2>/dev/null | grep -qE '^v(1[89]|[2-9][0-9])'; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y -q nodejs
fi
/usr/bin/node -v

echo "==> Пользователь и каталоги"
id chuckers >/dev/null 2>&1 || useradd --system --home "$APP_DIR" --shell /usr/sbin/nologin chuckers
mkdir -p "$DATA_DIR/avatars"
chown -R chuckers:chuckers "$DATA_DIR"

echo "==> Код"
if [ -d "$APP_DIR/.git" ]; then
  git -C "$APP_DIR" fetch -q origin "$BRANCH"
  git -C "$APP_DIR" reset -q --hard "origin/$BRANCH"
else
  git clone -q -b "$BRANCH" "$REPO" "$APP_DIR"
fi
(cd "$APP_DIR/server" && npm ci --omit=dev --no-audit --no-fund)
chown -R root:root "$APP_DIR"

echo "==> Настройки $ENV_FILE"
if [ ! -f "$ENV_FILE" ]; then
  : "${BOT_TOKEN:?Укажите BOT_TOKEN при первой установке}"
  cat > "$ENV_FILE" <<EOF
BOT_TOKEN=$BOT_TOKEN
WEBAPP_URL=https://$DOMAIN
APP_SHORT_NAME=${APP_SHORT_NAME:-}
HOST=127.0.0.1
PORT=$PORT
DATA_DIR=$DATA_DIR
DEV=0
EOF
  chmod 600 "$ENV_FILE"
else
  echo "    уже есть — не трогаю"
fi

echo "==> Служба chuckers"
install -m 644 "$APP_DIR/deploy/chuckers.service" /etc/systemd/system/chuckers.service
systemctl daemon-reload
systemctl enable -q chuckers
systemctl restart chuckers

if [ "$PROXY" = nginx ]; then
  echo "==> nginx: сайт $DOMAIN"
  if [ -d /etc/nginx/sites-available ]; then
    SITE=/etc/nginx/sites-available/chuckers
    LINK=/etc/nginx/sites-enabled/chuckers
  else
    SITE=/etc/nginx/conf.d/chuckers.conf
    LINK=
  fi
  if [ ! -f "$SITE" ]; then
    sed -e "s/__DOMAIN__/$DOMAIN/" -e "s/__PORT__/$PORT/" "$APP_DIR/deploy/nginx.conf" > "$SITE"
    [ -n "$LINK" ] && ln -sf "$SITE" "$LINK"
  else
    echo "    $SITE уже есть — не трогаю"
  fi
  nginx -t
  systemctl reload nginx

  echo "==> HTTPS-сертификат (Let's Encrypt через certbot)"
  apt-get install -y -q certbot python3-certbot-nginx
  if [ ! -d "/etc/letsencrypt/live/$DOMAIN" ]; then
    if [ -n "${EMAIL:-}" ]; then MAIL_ARGS=(-m "$EMAIL"); else MAIL_ARGS=(--register-unsafely-without-email); fi
    certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos --redirect "${MAIL_ARGS[@]}"
  else
    echo "    сертификат уже есть"
  fi
  # certbot сам ставит таймер продления: systemctl list-timers | grep certbot
else
  echo "==> Caddy (HTTPS-сертификат получит сам)"
  if ! command -v caddy >/dev/null; then
    apt-get install -y -q debian-keyring debian-archive-keyring apt-transport-https
    curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/gpg.key \
      | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
    curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt \
      > /etc/apt/sources.list.d/caddy-stable.list
    apt-get update -q
    apt-get install -y -q caddy
  fi
  sed -e "s/{\$DOMAIN}/$DOMAIN/" -e "s/127.0.0.1:8080/127.0.0.1:$PORT/" "$APP_DIR/deploy/Caddyfile" > /etc/caddy/Caddyfile
  systemctl enable -q caddy
  systemctl reload caddy || systemctl restart caddy
fi

echo "==> Резервные копии (каждую ночь, хранятся 14 дней)"
install -m 755 "$APP_DIR/deploy/backup.sh" /usr/local/bin/chuckers-backup
echo "15 4 * * * root /usr/local/bin/chuckers-backup" > /etc/cron.d/chuckers-backup

echo "==> Брандмауэр"
if command -v ufw >/dev/null && ufw status | grep -q 'Status: active'; then
  ufw allow 80/tcp >/dev/null
  ufw allow 443/tcp >/dev/null
  echo "    ufw включён — открыты 80 и 443"
elif [ "${FIREWALL:-}" = 1 ] || [ "$PROXY" = caddy ]; then
  apt-get install -y -q ufw
  ufw allow OpenSSH >/dev/null
  ufw allow 80/tcp >/dev/null
  ufw allow 443/tcp >/dev/null
  ufw --force enable >/dev/null
  echo "    ufw включён: открыты SSH, 80, 443"
else
  echo "    ufw выключен — не включаю, чтобы не закрыть другие сервисы (FIREWALL=1 чтобы включить)"
fi

sleep 2
if systemctl is-active -q chuckers && curl -fsS "http://127.0.0.1:$PORT/api/config" >/dev/null; then
  echo
  echo "Готово: https://$DOMAIN"
  echo "Логи:   journalctl -u chuckers -f"
else
  echo "Сервер не запустился, смотрите: journalctl -u chuckers -n 50"
  exit 1
fi
