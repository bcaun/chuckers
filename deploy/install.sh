#!/usr/bin/env bash
# Первичная установка на чистый VPS (Ubuntu 22.04/24.04, Debian 12).
# Запуск от root:
#   DOMAIN=checkers.example.com BOT_TOKEN=123:ABC APP_SHORT_NAME=checkers bash install.sh
# Повторный запуск безопасен: уже сделанные шаги пропускаются, /etc/chuckers.env не перезаписывается.
set -euo pipefail

: "${DOMAIN:?Укажите DOMAIN=ваш.домен}"
REPO="${REPO:-https://github.com/bcaun/chuckers.git}"
BRANCH="${BRANCH:-main}"
APP_DIR=/opt/chuckers
DATA_DIR=/var/lib/chuckers
ENV_FILE=/etc/chuckers.env

[ "$(id -u)" -eq 0 ] || { echo "Запустите от root (sudo -i)"; exit 1; }

echo "==> Пакеты"
export DEBIAN_FRONTEND=noninteractive
apt-get update -q
apt-get install -y -q curl git ufw gnupg ca-certificates debian-keyring debian-archive-keyring apt-transport-https

echo "==> Node.js 22"
if ! node -v 2>/dev/null | grep -qE '^v(2[2-9]|[3-9][0-9])'; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y -q nodejs
fi
node -v

echo "==> Caddy (HTTPS-сертификат получит сам)"
if ! command -v caddy >/dev/null; then
  curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/gpg.key \
    | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt \
    > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -q
  apt-get install -y -q caddy
fi

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
PORT=8080
DATA_DIR=$DATA_DIR
DEV=0
EOF
  chmod 600 "$ENV_FILE"
else
  echo "    уже есть — не трогаю"
fi

echo "==> systemd"
install -m 644 "$APP_DIR/deploy/chuckers.service" /etc/systemd/system/chuckers.service
systemctl daemon-reload
systemctl enable -q chuckers
systemctl restart chuckers

echo "==> Caddy"
sed "s/{\$DOMAIN}/$DOMAIN/" "$APP_DIR/deploy/Caddyfile" > /etc/caddy/Caddyfile
systemctl enable -q caddy
systemctl reload caddy || systemctl restart caddy

echo "==> Резервные копии (каждую ночь, хранятся 14 дней)"
install -m 755 "$APP_DIR/deploy/backup.sh" /usr/local/bin/chuckers-backup
echo "15 4 * * * root /usr/local/bin/chuckers-backup" > /etc/cron.d/chuckers-backup

echo "==> Брандмауэр: открыты только SSH, 80, 443"
ufw allow OpenSSH >/dev/null
ufw allow 80/tcp >/dev/null
ufw allow 443/tcp >/dev/null
ufw --force enable >/dev/null

sleep 2
if systemctl is-active -q chuckers; then
  echo
  echo "Готово: https://$DOMAIN"
  echo "Логи:   journalctl -u chuckers -f"
else
  echo "Сервер не запустился, смотрите: journalctl -u chuckers -n 50"
  exit 1
fi
