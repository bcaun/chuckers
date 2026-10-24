#!/usr/bin/env bash
# Обновление до свежей версии из GitHub. Запуск от root: bash /opt/chuckers/deploy/update.sh
set -euo pipefail
APP_DIR=/opt/chuckers
BRANCH="${BRANCH:-main}"

/usr/local/bin/chuckers-backup || true
git -C "$APP_DIR" fetch -q origin "$BRANCH"
git -C "$APP_DIR" reset -q --hard "origin/$BRANCH"
(cd "$APP_DIR/server" && npm ci --omit=dev --no-audit --no-fund)
install -m 644 "$APP_DIR/deploy/chuckers.service" /etc/systemd/system/chuckers.service
install -m 755 "$APP_DIR/deploy/backup.sh" /usr/local/bin/chuckers-backup
systemctl daemon-reload
systemctl restart chuckers
sleep 2
systemctl is-active -q chuckers && echo "Обновлено: $(git -C "$APP_DIR" log -1 --format='%h %s')" \
  || { echo "Ошибка запуска: journalctl -u chuckers -n 50"; exit 1; }
