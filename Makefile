.PHONY: build up down restart logs shell tinker migrate fresh seed test lint \
        install install-broadcasting npm-install npm-dev npm-build ps

# ── Docker lifecycle ───────────────────────────────────────────────────────

build:
	docker compose build

up:
	docker compose up -d

down:
	docker compose down

restart:
	docker compose restart

ps:
	docker compose ps

logs:
	docker compose logs -f

logs-app:
	docker compose logs -f app

logs-reverb:
	docker compose logs -f reverb

# ── Shell access ───────────────────────────────────────────────────────────

shell:
	docker compose exec app bash

shell-mysql:
	docker compose exec mysql mysql -u dawdle -psecret dawdle

shell-redis:
	docker compose exec redis redis-cli

# ── Laravel ────────────────────────────────────────────────────────────────

migrate:
	docker compose exec app php artisan migrate

fresh:
	docker compose exec app php artisan migrate:fresh --seed

seed:
	docker compose exec app php artisan db:seed

tinker:
	docker compose exec app php artisan tinker

test:
	docker compose exec app php artisan test

test-filter:
	docker compose exec app php artisan test --filter=$(FILTER)

lint:
	docker compose exec app ./vendor/bin/pint

# ── First-time setup ───────────────────────────────────────────────────────

# Run after first `make up` once app is healthy
install:
	docker compose exec app composer install
	docker compose exec app php artisan migrate

# Install Reverb + Echo (run once after `make install`)
install-broadcasting:
	docker compose exec app composer require laravel/reverb
	docker compose exec app php artisan install:broadcasting

# ── Frontend (runs in node sidecar container) ─────────────────────────────

npm-install:
	docker compose run --rm node npm install

npm-dev:
	docker compose up node

npm-build:
	docker compose run --rm node npm run build

npm:
	docker compose run --rm node npm $(ARGS)
