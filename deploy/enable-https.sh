#!/usr/bin/env bash
# HTTPS 설정: sslip.io 주소 + Let's Encrypt 무료 인증서 (자동 갱신)
# 사용법: bash deploy/enable-https.sh            (공인 IP 자동 확인)
#        bash deploy/enable-https.sh 1.2.3.4    (IP 직접 지정)
#        bash deploy/enable-https.sh my.domain.com  (내 도메인이 생기면)
# 먼저 deploy/setup.sh 로 설치가 끝나 있어야 하고,
# 오라클 콘솔 Security List 에서 443번 포트를 열어야 합니다.
set -euo pipefail

SITE=/etc/nginx/sites-available/ai-office
step() { printf '\n\033[1;34m▶ %s\033[0m\n' "$1"; }

if [ ! -f "$SITE" ]; then
  echo "nginx 설정이 없습니다. 먼저 bash deploy/setup.sh 를 실행하세요." >&2
  exit 1
fi

step "1/5 접속 주소 정하기"
ARG="${1:-}"
if [ -z "$ARG" ]; then
  ARG="$(curl -fsS --max-time 5 https://ifconfig.me || true)"
  [ -n "$ARG" ] || { echo "공인 IP를 확인하지 못했습니다. IP를 직접 넣어 실행하세요: bash deploy/enable-https.sh <공인IP>" >&2; exit 1; }
fi
if [[ "$ARG" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  DOMAIN="${ARG//./-}.sslip.io"
else
  DOMAIN="$ARG"
fi
echo "주소: https://$DOMAIN"

resolved="$(getent hosts "$DOMAIN" | awk '{print $1; exit}' || true)"
if [ -z "$resolved" ]; then
  echo "$DOMAIN 주소를 찾지 못했습니다. 잠시 후 다시 시도하세요." >&2
  exit 1
fi
echo "이 주소는 $resolved 로 연결됩니다."

step "2/5 서버 방화벽에서 443번 포트 허용"
if ! sudo iptables -C INPUT -p tcp --dport 443 -j ACCEPT 2>/dev/null; then
  sudo iptables -I INPUT -p tcp --dport 443 -j ACCEPT
  sudo netfilter-persistent save >/dev/null
fi
echo "완료"

step "3/5 certbot 설치"
sudo apt-get update -y >/dev/null
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y certbot python3-certbot-nginx

step "4/5 nginx 에 주소 등록"
sudo sed -i -E "0,/server_name [^;]*;/s//server_name $DOMAIN;/" "$SITE"
sudo nginx -t
sudo systemctl reload nginx

step "5/5 인증서 발급 및 HTTPS 적용"
read -rp "인증서 만료 알림을 받을 이메일 (건너뛰려면 Enter): " EMAIL
if [ -n "$EMAIL" ]; then
  EMAIL_OPT=(--email "$EMAIL" --no-eff-email)
else
  EMAIL_OPT=(--register-unsafely-without-email)
fi
sudo certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos --redirect "${EMAIL_OPT[@]}"

sudo nginx -t
sudo systemctl reload nginx

printf '\n\033[1;32m✔ HTTPS 설정 완료\033[0m\n'
echo "브라우저에서 https://$DOMAIN 로 접속하세요."
echo "http:// 로 들어와도 자동으로 https 로 넘어갑니다. 인증서는 자동으로 갱신됩니다."
