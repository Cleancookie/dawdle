# Architecture Decision Records

A log of architectural decisions and stated opinions. Each entry can be followed consistently or challenged if circumstances change. Add a new ADR whenever a significant decision is made — including when a previous one is overturned.

---

## ADR-001 · Single Laravel monolith over microservices (v1)

**Status:** Accepted  
**Date:** 2026-04-16  
**Context:** The platform needs real-time WebSockets for game state and chat. Options were a Laravel monolith with Reverb, or a Laravel API + separate Node.js game server.  
**Decision:** Single Laravel monolith using Laravel Reverb for WebSockets. No separate Node.js service in v1.  
**Consequences:**
- ✅ One codebase, one deployment, no cross-service CORS
- ✅ Developer stays in their primary stack (PHP/Laravel)
- ⚠️ PHP is not the optimal runtime for high-frequency real-time events — acceptable at v1 scale
- ⚠️ Revisit if Reverb becomes a bottleneck or game types demand tighter real-time loops
- 🔮 Migration path preserved: `app/Games/{Type}/GameLogic.php` has zero Laravel coupling, making extraction to Node.js/Go a rewrite of logic only

---

## ADR-002 · No monorepo — one Laravel project serves the frontend

**Status:** Accepted  
**Date:** 2026-04-16  
**Context:** Considered splitting into `frontend/` and `backend/` as separate deployable units within a monorepo.  
**Decision:** Single Laravel project. React SPA is served by Laravel via Vite. No separate frontend deployment.  
**Consequences:**
- ✅ No CORS configuration (same origin)
- ✅ Single deployment target
- ✅ Separation of concerns achieved via directory structure (`app/Games/`, `resources/js/games/`)
- ⚠️ Slightly less clean deployment separation if frontend/backend ever need to scale independently
- 🔮 A `contracts/` directory for shared TypeScript event types is worthwhile when the WebSocket layer is built

---

## ADR-003 · Custom Docker setup over Laravel Sail

**Status:** Accepted  
**Date:** 2026-04-16  
**Context:** Laravel Sail is the official Docker dev environment, but requires PHP to be installed locally to bootstrap the project before Sail can be used.  
**Decision:** Custom `docker/app/Dockerfile` with an entrypoint that auto-scaffolds Laravel on first boot if `artisan` is not present.  
**Consequences:**
- ✅ Zero local PHP required — entire dev environment is Docker-native
- ✅ Transparent bootstrapping — no magic hidden in Sail internals
- ✅ Full control over image contents and service configuration
- ⚠️ More to maintain than Sail (but it's ~60 lines total)
- See `docker/app/entrypoint.sh` for bootstrapping logic

---

## ADR-004 · All tooling runs in Docker including npm/Node

**Status:** Accepted  
**Date:** 2026-04-16  
**Context:** Developer has Node installed locally; initial plan was to run Vite on the host.  
**Decision:** All tooling (PHP, Node, npm, Vite) runs in Docker containers. `node` sidecar service in `docker-compose.yml` handles all frontend operations.  
**Consequences:**
- ✅ Consistent environment regardless of host machine
- ✅ No Node version mismatch issues
- ✅ `make npm-dev` / `make npm-build` work the same on any machine
- ⚠️ Slightly slower npm install vs. native Node (negligible in practice)

---

## ADR-005 · Tic Tac Toe first, then Pictionary as second game

**Status:** Accepted  
**Date:** 2026-04-16  
**Context:** Need to choose which games to build first to validate the platform architecture.  
**Decision:** Tic Tac Toe as the first game (simplest possible), Pictionary as the second.  
**Consequences:**
- ✅ Tic Tac Toe validates the shell ↔ game contract and WebSocket move/broadcast loop with minimal complexity
- ✅ Pictionary forces design of high-frequency canvas events, timers, role rotation, word selection — patterns that cover most future game architectures
- ✅ Together they define the full range of game types the platform needs to support

---

## ADR-006 · Guest play only for v1 — accounts deferred

**Status:** Accepted  
**Date:** 2026-04-16  
**Context:** Accounts (registration, login, profiles, avatars) add significant complexity upfront.  
**Decision:** Guests are identified by a UUID generated client-side and stored in `localStorage`. No auth system in v1.  
**Consequences:**
- ✅ No auth surface area — significantly reduces v1 scope
- ✅ Faster to build and iterate
- ⚠️ No persistent profiles or cross-device history
- ⚠️ No account-based social features (friends lists, etc.)
- 🔮 Migration path preserved: all game history stored against `guest_id`; linking to a `User` record later is a clean join

---

## ADR-007 · Invite-link rooms over public room browser

**Status:** Accepted  
**Date:** 2026-04-16  
**Context:** Needed to decide room discovery model for v1.  
**Decision:** Rooms are created with a 6-character code and shareable invite link (`/room/{code}`). No public room browser.  
**Consequences:**
- ✅ Solves the core "play with friends" use case
- ✅ Avoids matchmaking, room visibility rules, capacity filtering UI
- ⚠️ No way to find strangers to play with (out of scope for v1 social use case anyway)
- 🔮 Room model has `status` field — add `visibility` enum when browser is needed

---

## ADR-008 · Per-room chat only — no global chat

**Status:** Accepted  
**Date:** 2026-04-16  
**Context:** Considered global chat for users browsing the platform.  
**Decision:** Chat exists only within a room. Chat sidebar is hidden when not in a room.  
**Consequences:**
- ✅ Avoids moderation complexity of a public chat
- ✅ Simpler WebSocket scope — chat is just another event on the room presence channel
- ⚠️ No social browsing or discovery via chat
- 🔮 Global chat would require a separate channel, moderation tooling, and persistent message storage

---

## ADR-009 · PhaserJS for game rendering — self-contained mountable instances

**Status:** Accepted  
**Date:** 2026-04-16  
**Context:** Need a browser game rendering approach that integrates cleanly with the React shell.  
**Decision:** Each game is a PhaserJS 3 instance wrapped in a JS class. The React shell mounts and destroys game instances via a defined API contract. Phaser canvas is injected into a React ref'd `<div>`.  
**Consequences:**
- ✅ Games are fully isolated — a bug in one game cannot affect the shell or other games
- ✅ Games can be developed and tested independently
- ✅ Adding a new game requires only a new directory and class — no shell changes
- ⚠️ React and Phaser operate on the same DOM — `useLayoutEffect` + `game.destroy(true)` cleanup is mandatory to prevent memory leaks
- See `docs/SPEC.md §7` for the full shell ↔ game contract

---

## ADR-011 · Modular architecture using nWidart Laravel Modules + light DDD

**Status:** Accepted  
**Date:** 2026-04-16  
**Context:** All application code was going to live in the standard Laravel `app/` directory. With multiple distinct domains (rooms, games, chat) this would become unorganised quickly. Developer expressed interest in DDD and modular structure from the outset.  
**Decision:** Use [nWidart/laravel-modules](https://github.com/nWidart/laravel-modules) for module scaffolding. Apply DDD-inspired layering within each module (Controllers → Services → Models/Events) but skip full DDD ceremony (no repository interfaces, no value objects, no aggregate roots). Two modules: `Room` and `Game`. Chat lives inside the `Room` module — same Reverb channel, same lifecycle, too thin to warrant its own module initially.  
**Consequences:**
- ✅ Each domain is self-contained with its own routes, migrations, models, services, and events
- ✅ Clear boundary for future extraction (e.g. `Game` module → Node.js service)
- ✅ Thin controllers — domain logic in Services makes testing straightforward
- ✅ Chat folded into `Room` keeps things simple; easy to extract later if it grows
- ⚠️ nWidart adds a layer of module auto-discovery — new developers need to understand the module structure
- ⚠️ Full DDD deferred deliberately — revisit if domain complexity warrants it

---

## ADR-010 · Decisions and opinions are logged as ADRs

**Status:** Accepted  
**Date:** 2026-04-16  
**Context:** Early project decisions made under constraints that may change. Needed a way to track reasoning so decisions can be followed consistently or challenged later.  
**Decision:** All significant architectural decisions and stated opinions are recorded here as ADRs with Status, Context, Decision, and Consequences.  
**Consequences:**
- ✅ AI agents can consult this file before making architectural choices
- ✅ Decisions can be formally superseded rather than silently drifted from
- ✅ New team members (or future AI sessions) understand the why, not just the what
