#!/usr/bin/env bash
# 계정·결혼식·작업 기록 데이터베이스를 매일 복사(사진은 14일 뒤 지워지므로 백업하지 않음). 14일치 보관.
set -euo pipefail
D=/srv/wsnap; T=$D/backups/$(date +%Y%m%d)
mkdir -p "$T"
for db in app jobs; do
  [[ -f $D/data/$db.sqlite ]] && sqlite3 "$D/data/$db.sqlite" ".backup '$T/$db.sqlite'"
done
chown -R wsnap:wsnap "$D/backups"
find "$D/backups" -mindepth 1 -maxdepth 1 -type d -mtime +14 -exec rm -rf {} +
echo "백업: $T"
