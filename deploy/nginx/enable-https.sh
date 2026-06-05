#!/bin/sh
set -e
cd "$(dirname "$0")/../.."
if [ ! -f /etc/letsencrypt/live/sklodpro.ru/fullchain.pem ]; then
  echo "Нет сертификата /etc/letsencrypt/live/sklodpro.ru/fullchain.pem"
  echo "Сначала certbot, затем повторите."
  exit 1
fi
cp deploy/nginx/default-https.conf deploy/nginx/default.conf
docker compose exec nginx nginx -t
docker compose up -d --force-recreate nginx
echo "HTTPS включён. Проверка: https://sklodpro.ru/api/health"
