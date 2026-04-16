# Decisions & Opinions Log

A running record of architectural decisions and stated opinions. Each entry notes the reasoning so it can be followed consistently or challenged if circumstances change.

Format: **Date | Decision | Why | Status**

---

## Architecture

### 2026-04-16 | Single Laravel monolith over microservices (v1)
**Opinion:** "Keep it simple."
**Why:** Avoids service orchestration complexity, cross-service CORS, and deployment overhead at a stage where scale is unproven. Laravel Reverb (ReactPHP-based) handles the WebSocket load expected at v1 scale without a separate Node.js service.
**Trade-off:** PHP is not the optimal runtime for high-frequency real-time events. Accepted for v1.
**Status:** Accepted. Revisit if Reverb becomes a bottleneck or game types demand tighter real-time loops.

---

### 2026-04-16 | No monorepo split — one Laravel project serves the frontend
**Opinion:** Asked about monorepo, then: "let's keep it simple."
**Why:** A frontend/backend split would require CORS configuration (particularly for Reverb's separate origin config), two deployment targets, and added dev complexity. The separation of concerns is achieved through directory structure (`app/Games/`, `resources/js/games/`), not separate repos.
**Trade-off:** Slightly less clean deployment separation. Acceptable for v1.
**Status:** Accepted. A `contracts/` directory for shared TypeScript event types is still worthwhile when the WebSocket layer is built.

---

### 2026-04-16 | Laravel Sail rejected — custom Docker setup preferred
**Opinion:** "I am not a fan of Sail as we need to be able to install the Laravel project first before we can use it."
**Why:** Sail requires PHP-first bootstrapping which creates a chicken-and-egg problem. A custom Docker setup with an entrypoint that auto-scaffolds Laravel is more self-contained and transparent.
**Status:** Accepted. See `docker/app/entrypoint.sh` for the bootstrapping logic.

---

### 2026-04-16 | All tooling runs in Docker — including npm/Node
**Opinion:** Rejected running `npm install` on the host; asked for a Docker sidecar instead.
**Why:** Consistency. If PHP runs in Docker, Node should too. Avoids "works on my machine" issues with Node version mismatches.
**Status:** Accepted. `node` sidecar service in `docker-compose.yml` handles all npm/Vite operations.

---

## Games & Product

### 2026-04-16 | Tic Tac Toe first, then Pictionary
**Opinion:** Start with the simplest possible game, then one that is more complex and paves the way for other game architectures.
**Why:** Tic Tac Toe validates the shell ↔ game contract and the WebSocket move/broadcast loop with minimal complexity. Pictionary forces design of high-frequency canvas events, word selection, timers, and role rotation — patterns that cover most future game types.
**Status:** Accepted.

---

### 2026-04-16 | Guest play only for v1 — accounts deferred
**Opinion:** "I don't want to deal with that complexity" (re: accounts).
**Why:** Auth adds significant surface area (registration, login, session management, password reset). Guest UUIDs stored in localStorage give just enough identity for v1 gameplay without the overhead.
**Trade-off:** No persistent profiles, avatars, or history across devices/browsers.
**Status:** Accepted. Guest UUID → User migration path is designed in from the start (`guest_id` stored on all game history records).

---

### 2026-04-16 | Invite-link rooms over public room browser
**Opinion:** "Let's make it invite your friends to a room with a link first so we don't have to think about a room browser for now."
**Why:** A room browser requires matchmaking, room visibility rules, capacity management, and filtering UI. Invite links solve the social use case (play with friends) without any of that.
**Status:** Accepted. Room model has `status` field — add `visibility` enum when browser is needed.

---

### 2026-04-16 | Per-room chat only — no global chat
**Opinion:** "I haven't considered global chat at all yet. Maybe when the user is not in a game there is no chat."
**Why:** Global chat introduces moderation concerns, a persistent connection outside of rooms, and UI complexity. Scoping chat to rooms keeps it simple and contextually appropriate.
**Status:** Accepted. Chat sidebar is hidden when not in a room.

---

### 2026-04-16 | PhaserJS for game rendering — self-contained instances
**Opinion:** Proposed by developer as the approach.
**Why:** PhaserJS is a mature, battle-tested browser game framework. Self-contained instances that the shell mounts/unmounts cleanly separate game rendering concerns from the platform UI.
**Status:** Accepted. Each game is a JS class the shell controls via the API contract in `docs/SPEC.md §7`.

---

## Project Management

### 2026-04-16 | Opinions should be logged and can be challenged
**Opinion:** "If you hear me say any opinions they should be noted down so they can be followed or challenged in future."
**Why:** Decisions made early in a project are often made under constraints that change. Logging them with reasoning makes it easy to know when to revisit vs. when to stay the course.
**Status:** This file exists because of this opinion.
