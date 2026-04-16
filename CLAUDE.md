# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Dawdle is a browser-based social gaming platform (think OMGPOP). Friends join a room via invite link, play casual games together, and chat. See `SPEC.md` for the full founding specification — it is the source of truth.

**v1 scope:** Guest-only play, invite-link rooms, per-room chat, two games (Tic Tac Toe + Pictionary), spectator support.

## Stack

- **Backend:** Laravel 11 (PHP) + Laravel Reverb (WebSockets)
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

```
app/
  Games/
    TicTacToe/
      GameLogic.php     ← pure PHP, zero Laravel deps — game rules only
      GameChannel.php   ← Reverb channel handler, calls GameLogic
    Pictionary/
      GameLogic.php
      GameChannel.php
  Http/
    Controllers/
      RoomController.php
      GameController.php
      ChatController.php

resources/js/
  games/
    tic-tac-toe/index.js    ← PhaserJS game module
    pictionary/index.js
  components/               ← React shell components
  app.jsx                   ← Shell entry point
```

### Key Architectural Rules

**Game logic isolation:** `app/Games/{Type}/GameLogic.php` must have zero framework coupling (no Laravel facades, no Eloquent, no `app()`). This is the migration path to Node.js if needed later — only these files get rewritten.

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

1. Create `app/Games/{GameType}/GameLogic.php` (pure logic) and `GameChannel.php`
2. Create `resources/js/games/{game-type}/index.js` implementing the shell contract
3. Register the game type in the game registry (one place in the shell)
4. Add the game type to the `game_sessions.game_type` enum in the migration

No other changes required — the shell and room system are game-agnostic.
