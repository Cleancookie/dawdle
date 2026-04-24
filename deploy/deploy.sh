#!/usr/bin/env bash
# Deploy: git pull + rebuild frontend + restart app containers + migrate
# Run from /srv/asdfland as the deploy user
set -euo pipefail

cd /srv/asdfland

echo "==> Pulling latest code..."
git pull

echo "==> Building frontend assets..."
docker run --rm \
    -v "$(pwd):/app" \
    -w /app \
    --env-file .env \
    node:22-alpine \
    sh -c "npm ci --prefer-offline && npm run build"

echo "==> Restarting app containers..."
docker compose -f docker-compose.prod.yml up -d --build app reverb queue

echo "==> Waiting for app to be healthy..."
timeout 60 bash -c 'until docker compose -f docker-compose.prod.yml exec -T app php artisan --version &>/dev/null; do sleep 2; done'

echo "==> Running migrations..."
docker compose -f docker-compose.prod.yml exec -T app php artisan migrate --force

echo "==> Caching config/routes/views..."
docker compose -f docker-compose.prod.yml exec -T app php artisan config:cache
docker compose -f docker-compose.prod.yml exec -T app php artisan route:cache
docker compose -f docker-compose.prod.yml exec -T app php artisan view:cache
docker compose -f docker-compose.prod.yml exec -T app php artisan event:cache

echo ""
echo "✓ Deploy complete!"
