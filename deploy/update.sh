#!/usr/bin/env bash
# GitHub의 최신 코드로 서버를 업데이트합니다.
# 사용법: bash deploy/update.sh
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
git pull --ff-only
npm ci --no-audit --no-fund
npm run build
sudo systemctl restart ai-office
sleep 2
systemctl is-active --quiet ai-office && echo "✔ 업데이트 완료" || {
  echo "앱이 시작되지 않았습니다. 로그 확인: sudo journalctl -u ai-office -n 50" >&2
  exit 1
}
