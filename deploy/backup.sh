#!/usr/bin/env bash
# Архив базы и аватаров в /var/backups/chuckers, старше 14 дней удаляются.
set -euo pipefail
DATA_DIR=/var/lib/chuckers
OUT=/var/backups/chuckers
mkdir -p "$OUT"
tar -czf "$OUT/chuckers-$(date +%F-%H%M).tar.gz" -C "$DATA_DIR" .
find "$OUT" -name 'chuckers-*.tar.gz' -mtime +14 -delete
