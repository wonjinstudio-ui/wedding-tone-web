#!/usr/bin/env bash
# 코드를 올린 뒤 매번 실행(root). 파이썬·노드 패키지 설치, 웹 화면 완성본 만들기, 자동 실행 설정, 다시 켜기.
# push.sh가 자동으로 부름. 직접: sudo bash /srv/wsnap/app/web/deploy/install.sh
set -euo pipefail
[[ $EUID -eq 0 ]] || { echo "root로 실행해 주세요(sudo)."; exit 1; }
[[ -f /etc/wsnap/wsnap.env ]] || { echo "먼저 server-setup.sh를 실행해 주세요."; exit 1; }
set -a; source /etc/wsnap/wsnap.env; set +a
D=/srv/wsnap
HERE="$(cd "$(dirname "$0")" && pwd)"
as() { sudo -u wsnap -H env PATH="/usr/local/bin:/usr/bin:/bin" UV_PYTHON_INSTALL_DIR=$D/.python "$@"; }

echo "== 1/5 엔진(파이썬) 패키지"
[[ -x $D/venv/bin/python ]] || as /usr/local/bin/uv venv --python 3.13 $D/venv
as /usr/local/bin/uv pip install --python $D/venv/bin/python -r $D/app/engine/requirements.txt
# 작가 필터는 코드 폴더가 아니라 데이터 폴더에(코드를 다시 올려도 지워지지 않게)
[[ -L $D/app/engine/filters ]] || { rm -rf $D/app/engine/filters; ln -s $D/data/filters $D/app/engine/filters; }
as $D/venv/bin/python -c "import sys; sys.path.insert(0, '$D/app/engine'); import wsnap.engine, wsnap.people as P; print('엔진 불러오기 OK · 사람 분리 모델', 'OK' if P._segmenter() else '없음(사람 밝히기 꺼짐)')"

echo "== 2/5 API 서버·웹 화면(노드) 패키지"
cd $D/app/web/web
as npm ci --no-audit --no-fund
echo "== 3/5 웹 화면 완성본 만들기"
as env API_ORIGIN=http://127.0.0.1:8781 NEXT_TELEMETRY_DISABLED=1 npm run build

echo "== 4/5 자동 실행·HTTPS·백업 설정"
cp $HERE/systemd/*.service $HERE/systemd/*.timer /etc/systemd/system/
sed "s/__DOMAIN__/${DOMAIN}/g" $HERE/Caddyfile > /etc/caddy/Caddyfile
install -m 755 $HERE/backup.sh /usr/local/bin/wsnap-backup
systemctl daemon-reload
systemctl enable --now wsnap-engine wsnap-worker wsnap-api wsnap-web wsnap-backup.timer >/dev/null
systemctl reload caddy || systemctl restart caddy

echo "== 5/5 다시 켜기"
systemctl restart wsnap-engine wsnap-api wsnap-web
# 워커는 하던 작업을 끝낸 뒤 멈추므로(최대 20분) 따로: 진행 중인 작업이 없을 때만 바로 다시 켬
if sqlite3 $D/data/jobs.sqlite "select count(*) from jobs where state='running'" 2>/dev/null | grep -q '^0$'; then
  systemctl restart wsnap-worker
else
  echo "   워커는 하던 작업이 있어 새 코드는 다음 재시작 때 적용됩니다(sudo systemctl restart wsnap-worker)."
fi
sleep 3
bash $HERE/check.sh || true
