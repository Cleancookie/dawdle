# Dawdle — Social Gaming Platform: Founding Specification

> Version 1.0 — April 2026  
> This document is the single source of truth for the initial build. All AI-generated code should conform to the contracts defined here.

---

## Table of Contents

1. [Vision & Scope](#1-vision--scope)
2. [Tech Stack](#2-tech-stack)
3. [System Architecture](#3-system-architecture)
4. [Guest Identity](#4-guest-identity)
5. [Room Lifecycle](#5-room-lifecycle)
6. [Shell UI](#6-shell-ui)
7. [Shell ↔ Game API Contract](#7-shell--game-api-contract)
8. [WebSocket Channel & Event Schema](#8-websocket-channel--event-schema)
9. [Game: Tic Tac Toe](#9-game-tic-tac-toe)
10. [Game: Pictionary](#10-game-pictionary)
11. [Laravel Data Models](#11-laravel-data-models)
12. [Redis Schema](#12-redis-schema)
13. [Future Considerations (Out of Scope v1)](#13-future-considerations-out-of-scope-v1)
14. [References](#14-references)

---

## 1. Vision & Scope

Dawdle is a browser-based social gaming platform. The purpose is casual play — people drop into a room with friends (via an invite link), play lightweight games together, and chat. Think OMGPOP (2012) or Jackbox without a TV.

### v1 Scope

- Guest play only (no accounts)
- Invite-link rooms (no public room browser)
- Per-room chat (active only while in a room)
- Two games: **Tic Tac Toe** and **Pictionary**
- Spectator support
- Single deployable Laravel monolith

### Explicitly Out of Scope for v1

- User accounts, avatars, decorations
- Global chat
- Public matchmaking / room browser
- Mobile-native experience
- Monetisation

---

## 2. Tech Stack

| Layer | Technology | Rationale |
|---|---|---|
| Frontend Shell | React (Vite) | Component lifecycle maps cleanly to PhaserJS mount/unmount |
| Game Rendering | PhaserJS 3 | Mature, browser-native, self-contained game instances |
| Backend | Laravel 13 (PHP) | Developer's primary stack; handles HTTP + WebSocket |
| WebSockets | Laravel Reverb | Native Laravel WebSocket server; presence channels; no extra service |
| Cache / Game State | Redis | Fast ephemeral state; TTL-based room cleanup |
| Database | MySQL | Persistent storage for rooms, results |
| Build Tool | Vite | Laravel's standard frontend build tool |

### Why no separate Node.js service (v1)

Laravel Reverb is built on ReactPHP (async I/O) and handles presence channels, event broadcasting, and the connection volumes expected at v1 scale without a separate service. Game logic in PHP is sufficient for turn-based and drawing games. If real-time throughput becomes a bottleneck, game logic can be extracted to a Node.js service later — the contracts defined in this spec make that migration clean.

---

## 3. System Architecture

```
┌──────────────────────────────────────────────────────┐
│                  Browser (React SPA)                 │
│                                                      │
│  ┌─────────────────────────┐  ┌───────────────────┐  │
│  │      Game Area          │  │   Chat Sidebar    │  │
│  │  (PhaserJS mount point) │  │  (room only)      │  │
│  │   or Lobby View         │  │                   │  │
│  └─────────────────────────┘  └───────────────────┘  │
└────────────────────┬─────────────────────────────────┘
                     │
          ┌──────────┴──────────┐
          │ HTTP/REST           │ WebSocket (Reverb)
          ▼                     ▼
┌─────────────────────────────────────────┐
│             Laravel 13                  │
│                                         │
│  Modules/Room/   Modules/Game/          │
│    RoomService     GameService          │
│    ChatService     TicTacToe/Logic      │
│                    Pictionary/Logic     │
│                                         │
│  Broadcasting (Reverb presence channels)│
└────────────┬──────────────┬────────────┘
             │              │
             ▼              ▼
           MySQL           Redis
     (rooms, results,  (live game state,
      game history)     room presence,
                        chat buffer)
```

### Request Flow Summary

1. User visits `/` — React SPA loads
2. User creates or joins a room via HTTP → Laravel creates/validates room
3. Shell subscribes to Reverb presence channel `presence-room.{roomId}`
4. Room lobby renders inside game area; chat sidebar activates
5. Players ready up → Laravel starts game, broadcasts `game.started`
6. Shell mounts the appropriate PhaserJS game module
7. Game events flow over the presence channel; Laravel validates moves, updates Redis
8. Game ends → Laravel writes result to MySQL, broadcasts `game.ended`
9. Shell destroys PhaserJS instance, renders lobby view

---

## 4. Guest Identity

No authentication in v1. Guests are identified by a UUID generated client-side and stored in `localStorage`.

### Client Behaviour

```js
// On app boot
let guestId = localStorage.getItem('dawdle_guest_id')
if (!guestId) {
  guestId = crypto.randomUUID()
  localStorage.setItem('dawdle_guest_id', guestId)
}

// User also picks a display name (stored in localStorage)
let displayName = localStorage.getItem('dawdle_display_name') // null until set
```

- On first visit: prompt user to enter a display name. Store in `localStorage`.
- `guestId` is sent in every Reverb channel auth payload and every HTTP request header (`X-Guest-ID`).
- On reconnect: same `guestId` retrieved from `localStorage` and re-sent — server restores session.

### Server Behaviour

- Laravel validates `guestId` format (UUID) on all requests.
- Redis stores `guest:{guestId}` hash: `{ displayName, roomId, role, connectedAt }` with 24-hour TTL.
- On reconnect: server looks up `guest:{guestId}` in Redis and re-associates the guest with their room if the room is still active.

### Future Migration Path

When accounts are added: link `guestId` to a `User` record. All game history already stored against `guestId` can be migrated.

---

## 5. Room Lifecycle

### Room States

```
created → waiting → playing → round_end → waiting → ... → closed
```

| State | Description |
|---|---|
| `waiting` | Room exists, players in lobby, no active game |
| `playing` | Game in progress |
| `round_end` | Game just finished, scores shown, returning to lobby |
| `closed` | All players left; room expired |

### Room Creation

- `POST /rooms` → creates room, returns `{ roomId, code, inviteUrl }`
- `code` is a 6-character alphanumeric string (e.g. `XK4D92`)
- `inviteUrl` is `https://{domain}/room/{code}`

### Joining

- Visiting `/room/{code}` → shell calls `GET /rooms/{code}` to validate room exists
- If valid: shell connects to Reverb presence channel
- Guest is added to room presence; all existing members notified

### Player Roles

Every participant has a `role`:

| Role | Description |
|---|---|
| `player` | Active game participant |
| `spectator` | Watching only; receives all events but cannot make moves |

On joining: guests default to `player` if game is in `waiting` state, `spectator` if game is in `playing` state.

### Ready System

- In `waiting` state, each player has `ready: boolean`
- When **all players** (minimum 2) are `ready: true` → Laravel starts game, broadcasts `game.started`
- Spectators do not count toward ready threshold

### Room Cleanup

- Room TTL in Redis: 2 hours of inactivity
- If all guests disconnect: room enters a 10-minute grace period (reconnect window)
- After grace period with no reconnections: room marked `closed` in MySQL, Redis keys deleted

---

## 6. Shell UI

The shell is a React SPA. It owns the page layout and all non-game UI.

### Layout

```
┌────────────────────────────────────────────────────┐
│  Header: Room code | Player list | Leave button    │
├──────────────────────────────────┬─────────────────┤
│                                  │                 │
│         Game Area                │  Chat Sidebar   │
│                                  │                 │
│  (PhaserJS canvas when playing)  │  Messages +     │
│  (Lobby when waiting)            │  Input box      │
│  (Score screen after round)      │                 │
│                                  │  (hidden when   │
│                                  │  not in room)   │
└──────────────────────────────────┴─────────────────┘
```

### Shell Responsibilities

- Routing: `/`, `/room/{code}`
- Guest identity bootstrap
- Room HTTP calls (create, join, leave)
- Reverb WebSocket connection lifecycle
- Mounting and destroying PhaserJS game instances
- Rendering lobby, score screen, chat
- Forwarding game moves from PhaserJS to Reverb
- Forwarding incoming Reverb game events to the active PhaserJS instance

### Lobby View (shown in game area when `waiting`)

- List of players with ready status indicators
- "Ready" button (toggles)
- Game selector (v1: Tic Tac Toe or Pictionary — host chooses)
- Invite link display with copy button

### Score Screen (shown in game area during `round_end`)

- Final scores for all players
- "Play Again" button (resets ready state, returns to lobby)

---

## 7. Shell ↔ Game API Contract

This is the binding contract between the React shell and any PhaserJS game module. Every game must implement this interface exactly. The shell never reaches inside a game module beyond this contract.

### Game Module Interface

Each game is a JavaScript class exported from its own module:

```js
// Every game module exports a class conforming to this interface

class BaseGame extends EventEmitter {
  /**
   * @param {HTMLElement} container  - The DOM element to mount the Phaser canvas into
   * @param {GameConfig}  config     - Game configuration provided by the shell
   */
  constructor(container, config) {}

  /**
   * Called by the shell to cleanly destroy the game instance.
   * Must call game.destroy(true) internally and remove all listeners.
   */
  destroy() {}
}
```

### GameConfig Object

```js
{
  roomId:    string,           // Room identifier
  gameId:    string,           // Unique game session ID
  guestId:   string,           // This player's guest UUID
  players: [                   // All active players (not spectators)
    { guestId: string, displayName: string, isMe: boolean }
  ],
  spectators: [
    { guestId: string, displayName: string }
  ],
  role:      'player' | 'spectator',
  gameType:  'tic_tac_toe' | 'pictionary',
  gameState: object | null,    // Resumed state on reconnect, null for new game
}
```

### Events the Game Fires (shell listens)

```js
game.on('move', (moveData) => {})
// Game wants to broadcast a move. Shell sends this to Reverb.
// moveData is game-specific (see individual game specs below).

game.on('complete', (result) => {})
// Game has ended. result = { scores: [{ guestId, score }], winner: guestId | null }
// Shell shows score screen then tears down game instance.

game.on('error', (err) => {})
// Unrecoverable game error. Shell tears down and returns to lobby.
```

### Events the Shell Sends into the Game

The shell calls methods on the game instance when it receives Reverb events:

```js
game.receiveEvent(eventName, payload)
// Shell calls this when a relevant Reverb event arrives for this game.
// eventName: string (e.g. 'move.made', 'game.state_update')
// payload: object (event-specific, see WebSocket schema)
```

### PhaserJS Mounting Pattern (React)

```jsx
// In the shell's GameArea component:
import { useLayoutEffect, useRef } from 'react'
import TicTacToeGame from '@/games/tic-tac-toe'
import PictionaryGame from '@/games/pictionary'

const GAME_MODULES = {
  tic_tac_toe: TicTacToeGame,
  pictionary:  PictionaryGame,
}

export function GameArea({ gameType, config, onMove, onComplete }) {
  const containerRef = useRef(null)
  const gameRef      = useRef(null)

  useLayoutEffect(() => {
    const GameClass = GAME_MODULES[gameType]
    gameRef.current = new GameClass(containerRef.current, config)
    gameRef.current.on('move',     onMove)
    gameRef.current.on('complete', onComplete)

    return () => {
      gameRef.current?.destroy()
      gameRef.current = null
    }
  }, [gameType, config.gameId]) // re-mount only when game session changes

  return <div ref={containerRef} className="game-mount-point" />
}
```

> **Reference:** [Official Phaser 3 + React Template](https://github.com/phaserjs/template-react) — uses `useLayoutEffect` with `game.destroy(true)` cleanup.

---

## 8. WebSocket Channel & Event Schema

All real-time communication uses Laravel Reverb presence channels.

### Channel

```
presence-room.{roomId}
```

One channel per room. All players and spectators subscribe to it. The presence channel provides the member list (who is connected) for free.

> **Reference:** [Laravel Broadcasting Docs](https://laravel.com/docs/12.x/broadcasting) — presence channel auth and member tracking.

### Channel Auth

The shell sends the `guestId` and `displayName` in the auth payload:

```js
// Laravel Echo / Reverb auth
window.Echo.join(`room.${roomId}`)
  .here(members => { /* initial member list */ })
  .joining(member => { /* someone joined */ })
  .leaving(member => { /* someone left */ })
```

Laravel's `BroadcastServiceProvider` returns this from the auth endpoint:

```php
// routes/channels.php
Broadcast::channel('room.{roomId}', function ($guest, $roomId) {
    // Validate guest belongs to room
    return [
        'id'          => $guest->guestId,
        'displayName' => $guest->displayName,
        'role'        => $guest->role,
    ];
});
```

### Event Catalogue

All events are namespaced `{category}.{action}`.

#### System Message Convention

Any event may include an optional `systemMessage: string` field in its payload. When present, the shell renders it as a grey italic line in the chat sidebar — no client-side string construction required. The `bind_global` handler on the raw Pusher channel intercepts every event and checks for this field. Events that should not produce a chat notice simply omit the field.

#### Room Events (broadcast to all)

| Event | Payload | Description |
|---|---|---|
| `room.player_joined` | `{ guestId, displayName, role, systemMessage }` | New participant joined |
| `room.player_left` | `{ guestId, displayName, systemMessage }` | Participant disconnected |
| `room.player_ready` | `{ guestId, ready }` | Ready state changed |
| `room.game_selected` | `{ gameType, systemMessage }` | Host changed selected game |

#### Game Lifecycle Events

| Event | Payload | Description |
|---|---|---|
| `game.started` | `{ gameId, gameType, players[], firstTurn, systemMessage }` | Game starting; shell mounts game module |
| `game.state_update` | `{ gameId, state }` | Full state sync (used on reconnect) |
| `game.ended` | `{ gameId, scores[], winner }` | Game over; shell shows score screen |

#### Chat Events

| Event | Payload | Description |
|---|---|---|
| `chat.message` | `{ guestId, displayName, message, timestamp }` | Chat message in room |

#### Game-Specific Events (see individual game specs)

Prefixed with the game type: `ttt.*` and `pict.*`.

---

## 9. Game: Tic Tac Toe

### Overview

Two players. 3×3 grid. Classic rules. Spectators watch in real time.

### Players

- Exactly 2 `player` role participants required to start
- Remaining room members become spectators automatically
- Server assigns symbols: first player ready = X, second = O

### Game State (stored in Redis)

```json
{
  "gameId":      "uuid",
  "roomId":      "uuid",
  "gameType":    "tic_tac_toe",
  "board":       [null, null, null, null, null, null, null, null, null],
  "players":     { "X": "guestId-1", "O": "guestId-2" },
  "currentTurn": "guestId-1",
  "status":      "playing",
  "winner":      null
}
```

`roomId` is stored in game state so `endGame` can clear the ready set and reset room status without an extra DB lookup.

`board` is a 9-element array. Index 0 = top-left, 8 = bottom-right. Values: `null | "X" | "O"`.

### Move Event (client → shell → Reverb → Laravel)

```js
// Fired by game via game.on('move', moveData)
{
  type:   'ttt.move',
  gameId: string,
  index:  number   // 0–8, the cell clicked
}
```

### Laravel Move Validation

```
POST /games/{gameId}/move
Body: { type: 'ttt.move', index: number }
Header: X-Guest-ID: {guestId}
```

Laravel:
1. Loads game state from Redis
2. Validates: correct player's turn, cell is empty, game is in progress
3. Applies move, checks for win/draw
4. Updates Redis
5. Broadcasts `ttt.move_made` to channel
6. If game over: broadcasts `game.ended`, writes result to MySQL

### Reverb Events (Laravel → all clients)

```js
// ttt.move_made
{ gameId, index, symbol: 'X'|'O', nextTurn: guestId }

// game.ended (standard event — see §8)
{ gameId, scores: [{ guestId, score }], winner: guestId | null }
```

### PhaserJS Scene Responsibilities

- Render 3×3 grid
- Show current turn indicator
- On player's turn: register click handlers on cells
- On `receiveEvent('ttt.move_made', payload)`: update board visually
- On win/draw: animate result briefly, then fire `game.on('complete', result)`
- Spectators: receive same events, no click handlers registered

### Win Detection

Checked server-side after every move. Winning lines:
`[0,1,2], [3,4,5], [6,7,8], [0,3,6], [1,4,7], [2,5,8], [0,4,8], [2,4,6]`

Draw: all 9 cells filled, no winner.

---

## 10. Game: Pictionary

### Overview

One player draws, others guess the word. Roles rotate each round. All players (and spectators) see the canvas in real time.

### Roles (within game, not room roles)

| Role | Per Round |
|---|---|
| `drawer` | One player; sees the word; draws on canvas |
| `guesser` | All other players; type guesses in chat-style input |
| `spectator` | Room spectators; see canvas and guesses, cannot guess |

Drawer rotates each round in player order.

### Round Structure

1. Server picks word from word list, sends it **only** to the drawer via a private event
2. Countdown timer starts (configurable, default 90 seconds)
3. Drawer draws; canvas deltas broadcast to all
4. Guessers type; correct guess triggers round end
5. Scores awarded; next round begins or game ends

### Scoring

- Correct guess by guesser: +100 points (first correct guess), +50 (subsequent)
- Drawer earns points based on how many people guessed: +20 per correct guesser
- No points for time remaining (v1 — keep it simple)

### Canvas Delta Protocol

Drawing is the performance-critical part of Pictionary. The approach:

- Drawer's browser captures `mousemove` / `touchmove` events
- Events are **throttled to one per 30ms** (requestAnimationFrame aligned)
- Each delta is a small object sent via the move event
- Clients receive deltas and replay them on their local canvas

```js
// Fired by Pictionary game via game.on('move', moveData)
// On stroke start (mousedown):
{
  type:   'pict.stroke_start',
  gameId: string,
  x: number, y: number,
  color: string,   // hex
  lineWidth: number
}

// On stroke move (mousemove, throttled 30ms):
{
  type:   'pict.stroke_delta',
  gameId: string,
  points: [{ x, y }, ...]   // batched points since last send
}

// On stroke end (mouseup / mouseleave):
{
  type: 'pict.stroke_end',
  gameId: string
}

// On canvas clear (drawer hits clear button):
{
  type: 'pict.canvas_clear',
  gameId: string
}
```

> **Reference:** [Build Real-Time Collaborative Drawing with WebSockets & Canvas](https://codezup.com/create-collaborative-drawing-board-webs-sockets-html5-canvas/) — delta encoding and throttling approach.
> **Reference:** [HTML5 Canvas Smooth Drawing](https://ben.akrin.com/?p=4981) — bezier curve interpolation for smooth remote rendering.

### Laravel Pictionary Events (Reverb → all clients)

```js
// pict.stroke_start  — relayed from drawer, broadcast to all
{ gameId, guestId, x, y, color, lineWidth }

// pict.stroke_delta
{ gameId, guestId, points: [{ x, y }] }

// pict.stroke_end
{ gameId, guestId }

// pict.canvas_clear
{ gameId }

// pict.word_hint  — only sent to drawers's private channel
{ gameId, word: string }

// pict.round_started
{ gameId, round: number, drawerGuestId: string, timeLimit: 90 }

// pict.guess_correct
{ gameId, guestId, displayName }  // word NOT included until round ends

// pict.round_ended
{ gameId, word: string, scores: [{ guestId, roundScore }] }

// game.ended  — after all rounds complete
{ gameId, scores: [{ guestId, totalScore }], winner: guestId }
```

### Game State (Redis)

```json
{
  "gameId":         "uuid",
  "gameType":       "pictionary",
  "round":          1,
  "totalRounds":    3,
  "currentDrawer":  "guestId",
  "word":           "elephant",
  "status":         "drawing",
  "timeRemaining":  72,
  "canvasHistory":  [],
  "scores":         { "guestId-1": 150, "guestId-2": 200 },
  "guessedCorrect": ["guestId-2"]
}
```

`canvasHistory` stores the stroke events for the current round only — used to sync late joiners or reconnecting spectators. Cleared on new round.

### PhaserJS Scene Responsibilities

**Drawer view:**
- Toolbar: colour picker, line width, clear button
- Captures mouse/touch input, throttles, fires `move` events via contract
- Receives `pict.word_hint` — displays word prominently

**Guesser view:**
- Read-only canvas (no drawing input)
- Text input for guesses (submitted via `pict.guess` move event)
- On `pict.guess_correct`: animate if it was them

**All views:**
- Timer countdown display
- Current round / total rounds
- Score panel

---

## 11. Laravel Data Models

### rooms

| Column | Type | Notes |
|---|---|---|
| id | ULID | Primary key |
| code | varchar(6) | Unique invite code |
| status | enum | `waiting`, `playing`, `round_end`, `closed` |
| host_guest_id | varchar(36) | UUID of room creator |
| created_at | timestamp | |
| closed_at | timestamp | nullable |

### room_guests

| Column | Type | Notes |
|---|---|---|
| id | bigint | |
| room_id | ULID | FK → rooms |
| guest_id | varchar(36) | UUID from localStorage |
| display_name | varchar(32) | |
| role | enum | `player`, `spectator` |
| joined_at | timestamp | |
| left_at | timestamp | nullable |

### game_sessions

| Column | Type | Notes |
|---|---|---|
| id | ULID | Primary key (also used as gameId) |
| room_id | ULID | FK → rooms |
| game_type | enum | `tic_tac_toe`, `pictionary` |
| status | enum | `in_progress`, `completed`, `abandoned` |
| started_at | timestamp | |
| ended_at | timestamp | nullable |
| winner_guest_id | varchar(36) | nullable |

### game_results

| Column | Type | Notes |
|---|---|---|
| id | bigint | |
| game_session_id | ULID | FK → game_sessions |
| guest_id | varchar(36) | |
| score | int | |
| placement | int | 1 = winner |

---

## 12. Redis Schema

All keys are prefixed `dawdle:`.

### Guest Session

```
dawdle:guest:{guestId}     HASH    TTL: 24h
  displayName
  roomId
  role
  connectedAt
```

### Room State

```
dawdle:room:{roomId}       HASH    TTL: 2h (refreshed on activity)
  status
  hostGuestId
  selectedGame
  lastActivityAt

dawdle:room:{roomId}:players     SET     (guestIds of connected players)
dawdle:room:{roomId}:ready       SET     (guestIds who are ready)
```

### Game State

```
dawdle:game:{gameId}       HASH    TTL: 4h
  (full game state JSON stored as single field 'state')
  (JSON structured per game spec above)
```

### Canvas History (Pictionary)

```
dawdle:game:{gameId}:canvas    LIST    TTL: 4h
  (ordered stroke events for current round — JSON strings)
  (used to sync new spectators; cleared on new round)
```

> **Reference:** [Redis official tutorial: Matchmaking & Game Session State](https://redis.io/tutorials/matchmaking-and-game-session-state-with-redis/) — hash + sorted set + TTL patterns for game rooms.

---

## 13. Future Considerations (Out of Scope v1)

These are noted here so v1 decisions don't accidentally block them.

- **User accounts**: Guest UUID → User migration path. Store all game history against `guest_id`; later attach to `user_id`.
- **Room browser / public matchmaking**: Room model already has `status`; add `visibility` enum.
- **Node.js game service**: Game logic is in isolated `app/Games/{Type}/GameLogic.php` classes with no framework coupling. Rewrite in JS when needed; WebSocket event schema stays the same.
- **More games**: Add a new `app/Games/{Type}/` directory + a new JS module in `resources/js/games/{type}/`. Shell discovers games via a registry array.
- **Mobile**: Shell layout is CSS flex — sidebar can collapse to a bottom drawer on small screens.
- **Horizontal Reverb scaling**: `REVERB_SCALING_ENABLED=true` with Redis adapter. [Reverb Scaling Docs](https://laravel.com/docs/12.x/reverb#scaling).

---

## 14. References

### Laravel & Reverb
- [Laravel Reverb Official Docs](https://laravel.com/docs/12.x/reverb) — installation, config, scaling
- [Laravel Broadcasting Guide](https://laravel.com/docs/12.x/broadcasting) — channel types, auth, presence channels
- [Real-Time Laravel: Complete Guide to WebSockets with Reverb (2025)](https://masteryoflaravel.medium.com/real-time-laravel-a-complete-practical-guide-to-websockets-with-laravel-reverb-2025-edition-bae825c0e9ce)
- [Laravel Reverb Comprehensive Guide — Twilio](https://www.twilio.com/en-us/blog/developers/community/laravel-reverb-comprehensive-guide-real-time-broadcasting)

### PhaserJS + React
- [Official Phaser 3 + React Template](https://github.com/phaserjs/template-react) — useLayoutEffect mounting, EventEmitter bridge
- [Phaser Memory Game with React (2025)](https://phaser.io/news/2025/02/memory-game-with-phaser-and-react) — official tutorial
- [Bridging Worlds: Integrating Phaser with React](https://arokis.me/articles/react-phaser) — lifecycle patterns

### Drawing & Canvas
- [Build Real-Time Collaborative Drawing with WebSockets & Canvas](https://codezup.com/create-collaborative-drawing-board-webs-sockets-html5-canvas/)
- [HTML5 Canvas Smooth Drawing & WebSocket Collaboration](https://ben.akrin.com/?p=4981) — bezier interpolation
- [Live Pictionary with WebSockets](https://ahmadhamze.github.io/posts/pictionary/)

### Redis
- [Redis: Matchmaking & Game Session State](https://redis.io/tutorials/matchmaking-and-game-session-state-with-redis/) — official tutorial
- [Redis Pub/Sub vs Streams (2026)](https://oneuptime.com/blog/post/2026-01-21-redis-streams-vs-pubsub/view)
- [Redis Pub/Sub Official Docs](https://redis.io/docs/latest/develop/pubsub/)

### Guest Identity & Sessions
- [WebSocket Reconnection: State Sync & Recovery](https://websocket.org/guides/reconnection/)
- [AWS: Managing Anonymous User Sessions in WebSocket API](https://aws.amazon.com/blogs/compute/managing-sessions-of-anonymous-users-in-websocket-api-based-applications/)

### Architecture & Methodology
- [2026 Agentic Coding Trends Report — Anthropic](https://resources.anthropic.com/hubfs/2026%20Agentic%20Coding%20Trends%20Report.pdf)
- [Beyond Vibe Coding: Spec-Driven AI Development — The New Stack](https://thenewstack.io/vibe-coding-spec-driven/)
- [Context Engineering for Coding Agents — Martin Fowler](https://martinfowler.com/articles/exploring-gen-ai/context-engineering-coding-agents.html)
