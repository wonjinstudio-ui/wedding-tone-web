#!/usr/bin/env bash
# 새 Ubuntu 24.04 서버를 처음 한 번 준비(root로 실행). 다시 실행해도 안전함.
#   - 프로그램: 파이썬 3.13(uv), Node 24, ExifTool, Caddy(HTTPS), SQLite 도구, 방화벽
#   - 사용자 wsnap, 폴더 /srv/wsnap, 설정 파일 /etc/wsnap/wsnap.env(비밀 키는 처음 한 번 자동 생성)
# 쓰는 법: sudo bash server-setup.sh 도메인
set -euo pipefail

DOMAIN="${1:-}"
if [[ -z "$DOMAIN" ]]; then echo "쓰는 법: sudo bash server-setup.sh 도메인(예: tone.example.com)"; exit 1; fi
[[ $EUID -eq 0 ]] || { echo "root로 실행해 주세요(sudo)."; exit 1; }

echo "== 1/6 기본 패키지"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y curl ca-certificates gnupg rsync sqlite3 ufw unattended-upgrades \
  libimage-exiftool-perl libgl1 libportaudio2
apt-get install -y libglib2.0-0t64 || apt-get install -y libglib2.0-0     # OpenCV(MediaPipe가 끌어옴)가 씀

echo "== 2/6 Node 24"
if ! command -v node >/dev/null || [[ "$(node -p 'process.versions.node.split(".")[0]')" -lt 24 ]]; then
  curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
  apt-get install -y nodejs
fi
node --version

echo "== 3/6 Caddy(HTTPS 자동)"
if ! command -v caddy >/dev/null; then
  apt-get install -y debian-keyring debian-archive-keyring apt-transport-https
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -y && apt-get install -y caddy
fi

echo "== 4/6 사용자·폴더"
id wsnap >/dev/null 2>&1 || useradd --system --create-home --home-dir /srv/wsnap --shell /usr/sbin/nologin wsnap
mkdir -p /srv/wsnap/app/engine /srv/wsnap/app/web /srv/wsnap/data/storage /srv/wsnap/data/work /srv/wsnap/data/filters /srv/wsnap/backups /etc/wsnap
chown -R wsnap:wsnap /srv/wsnap

echo "== 5/6 파이썬 3.13(uv)"
if [[ ! -x /usr/local/bin/uv ]]; then
  curl -LsSf https://astral.sh/uv/install.sh | env UV_INSTALL_DIR=/usr/local/bin INSTALLER_NO_MODIFY_PATH=1 sh
fi
sudo -u wsnap env UV_PYTHON_INSTALL_DIR=/srv/wsnap/.python /usr/local/bin/uv python install 3.13

echo "== 6/6 설정 파일(/etc/wsnap/wsnap.env)·방화벽"
if [[ ! -f /etc/wsnap/wsnap.env ]]; then
  KEY="$(head -c 32 /dev/urandom | base64 | tr -d '/+=' | head -c 40)"
  sed -e "s/__DOMAIN__/${DOMAIN}/g" -e "s/__ENGINE_KEY__/${KEY}/" "$(dirname "$0")/wsnap.env.example" > /etc/wsnap/wsnap.env
  chmod 640 /etc/wsnap/wsnap.env && chown root:wsnap /etc/wsnap/wsnap.env
  echo "   설정 파일을 만들었어요. 엔진 키는 자동으로 넣었습니다."
else
  echo "   설정 파일이 이미 있어 그대로 둡니다."
fi
ufw allow OpenSSH >/dev/null; ufw allow 80/tcp >/dev/null; ufw allow 443/tcp >/dev/null
ufw --force enable >/dev/null
dpkg-reconfigure -f noninteractive unattended-upgrades

echo
echo "준비 끝. 다음: 맥에서 deploy/push.sh 로 코드를 올리면 deploy/install.sh 가 설치·실행합니다."
