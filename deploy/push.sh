#!/usr/bin/env bash
# 맥에서 실행: 코드를 서버로 올리고 설치·다시 켜기까지.
#   처음:   bash deploy/push.sh root@서버IP 도메인      (서버 준비 server-setup.sh까지 함께)
#   그다음: bash deploy/push.sh root@서버IP
# 올리는 것: 엔진 코드(wsnap)·모델 파일·웹/API 코드. 올리지 않는 것: 고객 사진·작업 폴더(02_prototype/work),
#           개발 데이터(devdata), 가짜 사진(devfake), node_modules, .git
set -euo pipefail
HOST="${1:-}"; DOMAIN="${2:-}"
[[ -n "$HOST" ]] || { echo "쓰는 법: bash deploy/push.sh root@서버IP [도메인]"; exit 1; }
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"          # '01_웨딩 스냅 보정 도구'
ENG="$ROOT/02_prototype"; WEB="$ROOT/03_web"
for f in selfie_multiclass_256x256.tflite face_detection_yunet_2023mar.onnx; do
  [[ -f "$ENG/models/$f" ]] || { echo "모델 파일이 없어요: 02_prototype/models/$f (README 참고)"; exit 1; }
done
RS=(rsync -az --delete --human-readable)

echo "== 서버 폴더"
ssh "$HOST" 'mkdir -p /srv/wsnap/app/engine /srv/wsnap/app/web'

echo "== 엔진 코드·모델"
"${RS[@]}" --exclude '__pycache__' --filter 'P filters' --filter 'P .venv' \
  "$ENG/wsnap" "$ENG/models" "$ENG/requirements.txt" "$ENG/THIRD_PARTY_NOTICES.md" "$HOST:/srv/wsnap/app/engine/"

echo "== 웹·API 코드"
"${RS[@]}" --exclude 'node_modules' --exclude '.next' --exclude 'devdata' --exclude 'web/public/devfake' \
  --exclude '.git' --exclude '*.tsbuildinfo' --exclude 'server/data' --exclude '.DS_Store' \
  "$WEB/" "$HOST:/srv/wsnap/app/web/"

if [[ -n "$DOMAIN" ]]; then
  echo "== 서버 준비(처음 한 번)"
  ssh "$HOST" "bash /srv/wsnap/app/web/deploy/server-setup.sh '$DOMAIN'"
fi

echo "== 설치·다시 켜기"
ssh "$HOST" 'chown -R wsnap:wsnap /srv/wsnap/app && bash /srv/wsnap/app/web/deploy/install.sh'
