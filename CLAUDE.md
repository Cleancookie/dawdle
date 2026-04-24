# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Dawdle is a browser-based social gaming platform (think OMGPOP). Friends join a room via invite link, play casual games together, and chat. See `docs/SPEC.md` for the full founding specification — it is the source of truth. `docs/CONVENTIONS.md` defines coding and workflow standards. `docs/DECISIONS.md` is a running log of architectural decisions and stated opinions — consult it before making significant choices, and add to it when new decisions are made. `docs/AGENTS.md` defines the multi-agent development roster — roles, ownership, briefing templates, and the orchestration protocol.

**Current games:** Tic Tac Toe, Pictionary, Spotto, Pack. Guest-only play, invite-link rooms, per-room chat, spectator support.

## Stack

- **Backend:** Laravel 13 (PHP) + Laravel Reverb (WebSockets)
- **Frontend:** React (Vite) SPA served by Laravel
- **Games:** PhaserJS 3 — each game is an isolated JS module mounted by the shell
- **Cache / live state:** Redis (all game state lives here during play)
- **Database:** MySQL (rooms, game history, results)

## Docker Setup

No local PHP required. Everything runs in Docker except Vite (Node runs on the host).

### Services

| Service | Port | Purpose |
|---|---|---|
| `app` | 8000 | Laravel (php artisan serve) |
| `reverb` | 8080 | WebSocket server |
| `queue` | — | Laravel queue worker |
| `node` | 5173 | Vite dev server (HMR) |
| `mysql` | 3306 | Database |
| `redis` | 6379 | Cache + game state |
| `mailpit` | 8025 | Email UI (dev only) |

### First-time setup

```bash
make build          # build the PHP image
make up             # start all containers
                    # (Laravel is auto-scaffolded on first boot — takes ~60s)
make install        # composer install + migrate
make install-broadcasting   # installs Reverb + Laravel Echo
npm install         # frontend deps (runs on host)
npm install react react-dom @vitejs/plugin-react phaser
```

### Daily workflow

```bash
make up             # start all containers including Vite (background)
make logs           # tail all container logs
make down           # stop containers
```

### Common commands

```bash
make shell          # bash into app container
make tinker         # Laravel Tinker REPL
make migrate        # run migrations
make fresh          # migrate:fresh --seed
make test           # run test suite
make lint           # Laravel Pint (PHP)

# Single test class
make test-filter FILTER=TicTacToeGameLogicTest

# Direct artisan (when make target doesn't exist)
docker compose exec app php artisan <command>
```

## Architecture

### Directory Structure

The backend uses **nWidart Laravel Modules** for a DDD-inspired modular structure. Each module is self-contained with its own routes, controllers, models, services, events, and migrations.

```
Modules/
  Room/                         ← room lifecycle, player presence, chat
    Http/Controllers/
    Models/                     ← Room, RoomGuest
    Services/RoomService.php
    Events/                     ← PlayerJoined, PlayerLeft, etc.
    Database/Migrations/
    Routes/api.php
    Providers/RoomServiceProvider.php
  Game/                         ← cross-cutting orchestration only
    Http/Controllers/GameController.php
    Models/                     ← GameSession, GameResult
    Services/GameService.php    ← dispatches to per-game modules
    Events/GameEnded.php        ← generic end-of-game event
    Enums/GameType.php
    Database/Migrations/
  TicTacToe/                    ← ADR-018: each game owns its own module
    Services/GameLogic.php      ← pure PHP, zero Laravel deps
    Events/TttMoveMade.php
  Pictionary/
    Services/GameLogic.php
    Events/                     ← PictStroke, PictRoundStarted, …
  Spotto/
    Services/GameLogic.php
    Events/                     ← SpottoRoundStarted, SpottoPointScored, SpottoHover
  Pack/
    Services/GameLogic.php
    Events/                     ← PackRoundStarted, PackAnswerSubmitted, PackRoundEnded

resources/js/
  games/
    animation-tokens.js         ← shared ANIM constants (micro/standard/dramatic/settle)
    tic-tac-toe/index.js        ← Phaser scene is the engine (Scale.RESIZE + layout())
    pictionary/
      main.js                   ← ADR-019: engine (pure JS)
      index.jsx                 ← React shell + canvas refs
    spotto/
      main.js
      index.jsx
    pack/
      main.js                   ← PackEngine (pure JS, no Phaser)
      index.jsx                 ← React/HTML shell (ADR-021: HTML for text-input games)
  components/                   ← React shell components
  app.jsx                       ← Shell entry point
```

### Key Architectural Rules

**Module boundaries:** Each module owns its domain. Cross-module calls go through Services, never directly between Controllers or Models. The `Room` module owns chat (it shares the same Reverb channel and room lifecycle).

**Game logic isolation:** `Modules/{GameName}/app/Services/GameLogic.php` must have zero framework coupling (no Laravel facades, no Eloquent, no `app()`). This is the migration path to Node.js if needed later — only these files get rewritten.

**Shell owns the WebSocket:** PhaserJS game modules never manage their own WebSocket connection. The shell passes `socket` in `GameConfig` and relays moves. Games fire events; the shell sends them.

**Redis is the source of truth during play:** Laravel reads/writes game state from Redis on every move. MySQL is written only at game end (or significant checkpoints). Never read game state from MySQL during an active game.

**All Redis keys are prefixed `dawdle:`** — see §12 of SPEC.md for the full schema.

### The Shell ↔ Game Contract

Every PhaserJS game module must implement this exact interface. The shell never reaches inside a game beyond these boundaries:

```js
// Constructor
new GameClass(containerElement, GameConfig)

// Shell → Game (incoming Reverb events)
game.receiveEvent(eventName, payload)

// Game → Shell (outgoing)
game.on('move', moveData)      // shell relays to Reverb / POST /games/{id}/move
game.on('complete', result)    // { scores: [{ guestId, score }], winner: guestId|null }
game.on('error', err)          // shell tears down, returns to lobby

// Teardown
game.destroy()                 // must call phaser game.destroy(true) internally
```

Mount/unmount in React uses `useLayoutEffect` with the game instance in a `useRef`. Re-mounts only when `config.gameId` changes (new game session), not on re-renders.

### WebSocket Channels

Single presence channel per room: `presence-room.{roomId}`

All guests (players + spectators) subscribe to it. The `X-Guest-ID` header (UUID from `localStorage`) is sent on every HTTP request and in the Reverb auth payload.

Event namespace convention: `{category}.{action}` — e.g. `room.player_joined`, `game.started`, `ttt.move_made`, `pict.stroke_delta`.

### Guest Identity

No auth in v1. On first visit: `crypto.randomUUID()` stored in `localStorage` as `dawdle_guest_id`. Display name stored as `dawdle_display_name`. The server stores guest state in `dawdle:guest:{guestId}` Redis hash (TTL 24h) and restores room membership on reconnect using this key.

### Room Lifecycle State Machine

```
waiting → playing → round_end → waiting → ... → closed
```

Game starts when all `player`-role guests have `ready: true` (minimum 2). Guests joining mid-game become spectators automatically. Room cleanup: 2-hour Redis TTL; 10-minute grace period if all disconnect.

### Adding a New Game

1. Create a new nWidart module `Modules/{GameName}/` with `module.json`, `composer.json`, `Providers/{Name}ServiceProvider.php`, `app/Services/GameLogic.php` (pure), and event classes under `app/Events/`
2. Enable the module in `modules_statuses.json`, then `docker compose exec app composer dump-autoload`
3. Create `resources/js/games/{kebab-name}/main.js` (pure-JS engine extending a local `SimpleEmitter`) and `index.jsx` (thin React shell — or a Phaser scene, as in TicTacToe). Use Phaser for spatial/visual games, React/HTML for text-input-heavy games (see ADR-021).
4. Import from the new namespaces in `Modules/Game/Services/GameService.php` and add a branch to the dispatch `match` statements
5. Register the game type in `resources/js/pages/RoomPage.jsx` (`GAME_MODULES` + `GAME_LABELS`)
6. **Add the game's broadcast event names to the `gameEvents` array in `RoomPage.jsx`** — missing this silently drops all server events before they reach the game engine
7. Add the game type to `Modules/Game/app/Enums/GameType.php` and to the `game_sessions.game_type` enum via a migration

## Deployment

Production runs on a single VPS (Ubuntu 24.04) using `docker-compose.prod.yml`. Caddy handles HTTPS and reverse-proxies HTTP to `app:8000` and WebSocket (`/app/*`) to `reverb:8080`.

| File | Purpose |
|---|---|
| `docker-compose.prod.yml` | Production services — no Vite/mailpit, adds Caddy, tuned MySQL |
| `Caddyfile` | Reverse proxy config for `asdf.land` |
| `.env.prod.example` | Production env template — copy to `.env` on the server |
| `deploy/bootstrap.sh` | One-time server setup (Docker, swap, firewall, deploy user) |
| `deploy/deploy.sh` | Ongoing deploys: git pull → build frontend → restart → migrate |

Server bootstrap uses **cloud-init** (paste YAML into DigitalOcean "User Data" field on droplet creation) — see `deploy/bootstrap.sh` for equivalent shell form.

# Tool Use

- prefer `jq` to parse json files
- prefer using commands in the allowlist so less interaction is required
