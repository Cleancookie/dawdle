#!/usr/bin/env bash
set -e

WORKDIR=/var/www/html

# reverb and queue services set SKIP_BOOTSTRAP=true — they start only after
# the app service is healthy, so scaffolding is already done by then.
if [ "${SKIP_BOOTSTRAP:-false}" != "true" ]; then

    # ── Scaffold Laravel if not yet present ───────────────────────────────────
    if [ ! -f "$WORKDIR/artisan" ]; then
        echo "==> artisan not found — scaffolding Laravel project (this takes ~60s)..."
        composer create-project laravel/laravel /tmp/laravel-scaffold \
            --prefer-dist --no-interaction --quiet

        # Merge into workdir without clobbering existing files
        # (preserves SPEC.md, CLAUDE.md, docker/, docker-compose.yml, Makefile, etc.)
        cp -rn /tmp/laravel-scaffold/. "$WORKDIR"/
        rm -rf /tmp/laravel-scaffold
        echo "==> Laravel scaffolded successfully."
    fi

    # ── .env ──────────────────────────────────────────────────────────────────
    if [ ! -f "$WORKDIR/.env" ]; then
        echo "==> Copying .env.example → .env"
        cp "$WORKDIR/.env.example" "$WORKDIR/.env"
    fi

    # ── App key ───────────────────────────────────────────────────────────────
    if ! grep -qE '^APP_KEY=base64:' "$WORKDIR/.env" 2>/dev/null; then
        echo "==> Generating application key..."
        php artisan key:generate --no-ansi
    fi

fi

exec "$@"
