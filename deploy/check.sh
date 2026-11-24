#!/usr/bin/env bash
# 배포 뒤 점검: 4개 서비스가 켜졌는지, 각 주소가 대답하는지, 디스크 여유
set -uo pipefail
set -a; source /etc/wsnap/wsnap.env 2>/dev/null; set +a
ok=0
for s in wsnap-engine wsnap-worker wsnap-api wsnap-web caddy; do
  st=$(systemctl is-active $s); printf '%-14s %s\n' "$s" "$st"; [[ $st == active ]] || ok=1
done
c() { printf '%-28s %s\n' "$1" "$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "${@:2}")"; }
c "엔진 API"            -H "X-Engine-Key: ${ENGINE_API_KEY:-}" http://127.0.0.1:8790/v1/health
c "API 서버"            http://127.0.0.1:8781/api/health
c "웹 화면"             http://127.0.0.1:3000/login
c "밖에서(HTTPS)"       https://${DOMAIN:-localhost}/api/health
df -h /srv/wsnap | tail -1 | awk '{print "디스크: 남은 " $4 " / 전체 " $2}'
exit $ok
