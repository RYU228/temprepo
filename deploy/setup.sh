#!/usr/bin/env bash
# AI 오피스 서버 설치 스크립트 (Ubuntu 22.04/24.04, 오라클 클라우드 기준)
# 사용법: bash deploy/setup.sh   (여러 번 실행해도 안전)
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_USER="$(whoami)"
ENV_FILE=/etc/ai-office.env
HTPASSWD=/etc/nginx/.ai-office-htpasswd
SERVICE=/etc/systemd/system/ai-office.service
SITE=/etc/nginx/sites-available/ai-office

step() { printf '\n\033[1;34m▶ %s\033[0m\n' "$1"; }

if [ "$APP_USER" = "root" ]; then
  echo "root가 아닌 일반 사용자(ubuntu)로 실행하세요: bash deploy/setup.sh" >&2
  exit 1
fi

step "1/8 스왑 메모리 설정 (메모리 1GB 서버 보완)"
if ! swapon --show | grep -q .; then
  sudo fallocate -l 2G /swapfile
  sudo chmod 600 /swapfile
  sudo mkswap /swapfile >/dev/null
  sudo swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab >/dev/null
  echo "2GB 스왑을 만들었습니다."
else
  echo "스왑이 이미 있습니다."
fi

step "2/8 Node.js 22 설치"
need_node=1
if command -v node >/dev/null; then
  ver="$(node -p 'process.versions.node')"
  major="${ver%%.*}"; rest="${ver#*.}"; minor="${rest%%.*}"
  if [ "$major" -gt 22 ] || { [ "$major" -eq 22 ] && [ "$minor" -ge 13 ]; }; then need_node=0; fi
fi
if [ "$need_node" -eq 1 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi
echo "Node $(node -v)"

step "3/8 nginx, 방화벽 도구 설치"
sudo apt-get update -y
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y nginx apache2-utils iptables-persistent

step "4/8 앱 의존성 설치 및 화면 빌드 (몇 분 걸릴 수 있습니다)"
cd "$APP_DIR"
npm ci --no-audit --no-fund
npm run build

step "5/8 환경 설정 파일 ($ENV_FILE)"
if [ ! -f "$ENV_FILE" ]; then
  sudo tee "$ENV_FILE" >/dev/null <<'EOF'
# AI 오피스 환경 설정. 수정 후: sudo systemctl restart ai-office
PORT=3001
HOST=127.0.0.1
# Claude API 키. 비워 두면 데모 모드로 동작합니다.
ANTHROPIC_API_KEY=
# CLAUDE_MODEL=claude-opus-5-5
EOF
  sudo chmod 600 "$ENV_FILE"
  echo "만들었습니다. API 키는 나중에 이 파일에 넣으면 됩니다."
else
  echo "이미 있습니다. (기존 설정 유지)"
fi

step "6/8 자동 실행 서비스 등록"
sudo tee "$SERVICE" >/dev/null <<EOF
[Unit]
Description=AI Office
After=network.target

[Service]
User=$APP_USER
WorkingDirectory=$APP_DIR
EnvironmentFile=$ENV_FILE
ExecStart=$APP_DIR/node_modules/.bin/tsx server/index.ts
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF
sudo systemctl daemon-reload
sudo systemctl enable ai-office >/dev/null 2>&1
sudo systemctl restart ai-office

step "7/8 접속 비밀번호 설정"
if [ ! -f "$HTPASSWD" ]; then
  read -rp "접속할 때 쓸 아이디를 입력하세요: " AUTH_USER
  sudo htpasswd -c "$HTPASSWD" "$AUTH_USER"
else
  echo "이미 설정되어 있습니다. 바꾸려면: sudo htpasswd $HTPASSWD <아이디>"
fi
sudo chown root:www-data "$HTPASSWD"
sudo chmod 640 "$HTPASSWD"

step "8/8 웹서버(nginx)와 방화벽 설정"
sudo tee "$SITE" >/dev/null <<EOF
server {
    listen 80 default_server;
    server_name _;
    client_max_body_size 2m;

    auth_basic "AI Office";
    auth_basic_user_file $HTPASSWD;

    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header Connection "";
        # 실시간 이벤트(SSE)가 끊기지 않도록
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 1h;
    }
}
EOF
sudo ln -sf "$SITE" /etc/nginx/sites-enabled/ai-office
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl reload nginx

# 오라클 Ubuntu 이미지는 서버 안 방화벽이 22번 포트만 열어 둠 → 80번 허용
if ! sudo iptables -C INPUT -p tcp --dport 80 -j ACCEPT 2>/dev/null; then
  sudo iptables -I INPUT -p tcp --dport 80 -j ACCEPT
  sudo netfilter-persistent save >/dev/null
fi

sleep 2
if systemctl is-active --quiet ai-office && curl -fsS http://127.0.0.1:3001/api/info >/dev/null; then
  PUBLIC_IP="$(curl -fsS --max-time 5 https://ifconfig.me 2>/dev/null || echo '<서버 공인 IP>')"
  printf '\n\033[1;32m✔ 설치 완료\033[0m\n'
  echo "브라우저에서 http://$PUBLIC_IP 로 접속하세요."
  echo "(오라클 콘솔의 Security List에서 80번 포트를 열어야 접속됩니다)"
else
  echo "앱이 시작되지 않았습니다. 로그 확인: sudo journalctl -u ai-office -n 50" >&2
  exit 1
fi
