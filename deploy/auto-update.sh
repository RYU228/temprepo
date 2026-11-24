#!/usr/bin/env bash
# GitHub main 브랜치에 새 커밋이 있으면 받아서 반영합니다. (systemd 타이머가 주기적으로 실행)
# - 타입 검사나 빌드가 실패하면 반영하지 않고 현재 버전 유지
# - 새 버전이 시작되지 않으면 이전 버전으로 되돌림
# - 실패한 커밋은 다시 시도하지 않음 (새 커밋이 올라오면 다시 시도)
# 직접 실행해도 됩니다: bash deploy/auto-update.sh
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$APP_DIR"
FAILED_FILE="$APP_DIR/.auto-update-failed"
BRANCH=main

# 동시에 두 번 실행되지 않도록
exec 9>"$APP_DIR/.auto-update.lock"
flock -n 9 || { echo "이미 업데이트가 진행 중입니다."; exit 0; }

log() { echo "[auto-update] $*"; }

git fetch -q origin "$BRANCH"
OLD="$(git rev-parse HEAD)"
NEW="$(git rev-parse "origin/$BRANCH")"

[ "$OLD" = "$NEW" ] && exit 0
if [ -f "$FAILED_FILE" ] && [ "$(cat "$FAILED_FILE")" = "$NEW" ]; then
  exit 0 # 이미 실패한 커밋
fi

log "새 버전 발견: ${OLD:0:7} → ${NEW:0:7} ($(git log -1 --format=%s "$NEW"))"

if ! git merge -q --ff-only "$NEW"; then
  log "서버에서 직접 수정된 파일이 있어 업데이트할 수 없습니다. 'git status'로 확인하세요."
  echo "$NEW" >"$FAILED_FILE"
  exit 1
fi

lock_changed() { git diff --name-only "$1" "$2" -- package-lock.json | grep -q .; }

# 주의: if 조건 안에서 호출되므로 set -e 가 적용되지 않음 → 단계마다 실패를 직접 확인
build() {
  if lock_changed "$1" "$2"; then
    log "의존성 설치 중"
    npm ci --no-audit --no-fund --loglevel=error || return 1
  fi
  log "타입 검사 중"
  npm run --silent typecheck || return 1
  log "화면 빌드 중"
  rm -rf dist-next
  npx vite build --outDir dist-next --emptyOutDir --logLevel warn || return 1
}

healthy() {
  for _ in $(seq 1 15); do
    sleep 1
    curl -fsS --max-time 2 http://127.0.0.1:3001/api/info >/dev/null 2>&1 && return 0
  done
  return 1
}

swap_dist() {
  rm -rf dist-old
  [ -d dist ] && mv dist dist-old
  mv dist-next dist
}

rollback_code() {
  git reset -q --hard "$OLD"
  if lock_changed "$OLD" "$NEW"; then npm ci --no-audit --no-fund --loglevel=error || true; fi
}

if ! build "$OLD" "$NEW"; then
  log "검사 또는 빌드 실패 → 반영하지 않고 이전 버전(${OLD:0:7}) 유지"
  rm -rf dist-next
  rollback_code
  echo "$NEW" >"$FAILED_FILE"
  exit 1
fi

swap_dist
sudo systemctl restart ai-office 9>&-  # 잠금을 앱에 넘기지 않음
if healthy; then
  rm -f "$FAILED_FILE"
  rm -rf dist-old
  log "✔ 업데이트 완료 (${NEW:0:7})"
  exit 0
fi

log "새 버전이 시작되지 않음 → 이전 버전(${OLD:0:7})으로 되돌림"
rollback_code
if [ -d dist-old ]; then rm -rf dist && mv dist-old dist; fi
sudo systemctl restart ai-office 9>&-  # 잠금을 앱에 넘기지 않음
healthy && log "이전 버전으로 복구했습니다." || log "복구 후에도 시작되지 않습니다. 'sudo journalctl -u ai-office -n 50'으로 확인하세요."
echo "$NEW" >"$FAILED_FILE"
exit 1
