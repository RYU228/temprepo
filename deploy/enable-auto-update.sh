#!/usr/bin/env bash
# 자동 업데이트 켜기: 3분마다 GitHub를 확인해 새 코드가 있으면 반영합니다.
# 사용법: bash deploy/enable-auto-update.sh
# 끄기:   sudo systemctl disable --now ai-office-update.timer
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_USER="$(whoami)"

if [ "$APP_USER" = "root" ]; then
  echo "root가 아닌 일반 사용자(ubuntu)로 실행하세요." >&2
  exit 1
fi
if ! sudo -n true 2>/dev/null; then
  echo "이 사용자는 비밀번호 없이 sudo를 쓸 수 있어야 합니다 (오라클 Ubuntu의 ubuntu 사용자는 기본으로 가능)." >&2
  exit 1
fi
chmod +x "$APP_DIR/deploy/"*.sh

sudo tee /etc/systemd/system/ai-office-update.service >/dev/null <<EOF
[Unit]
Description=AI Office auto update
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
User=$APP_USER
WorkingDirectory=$APP_DIR
ExecStart=/usr/bin/env bash $APP_DIR/deploy/auto-update.sh
TimeoutStartSec=20min
EOF

sudo tee /etc/systemd/system/ai-office-update.timer >/dev/null <<'EOF'
[Unit]
Description=Check GitHub for AI Office updates every 3 minutes

[Timer]
OnBootSec=2min
OnUnitInactiveSec=3min
Persistent=true

[Install]
WantedBy=timers.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now ai-office-update.timer

printf '\n\033[1;32m✔ 자동 업데이트를 켰습니다\033[0m\n'
echo "GitHub main 브랜치에 코드가 올라오면 3분 안에 서버에 반영됩니다."
echo
echo "기록 보기:  sudo journalctl -u ai-office-update -n 30"
echo "지금 바로:  sudo systemctl start ai-office-update"
echo "끄기:      sudo systemctl disable --now ai-office-update.timer"
