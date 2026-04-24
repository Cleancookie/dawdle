# Architecture Decision Records

A log of architectural decisions and stated opinions. Each entry can be followed consistently or challenged if circumstances change. Add a new ADR whenever a significant decision is made — including when a previous one is overturned.

---

## ADR-022 · Deployment: single VPS + Docker Compose + Caddy

**Status:** Accepted
**Date:** 2026-04-24
**Context:** Needed a cheap, simple production deployment. WebSocket requirement (Reverb) rules out most free/serverless tiers. Considered Cloudflare Pages + VPS split.
**Decision:** Single VPS (DigitalOcean, Ubuntu 24.04) running `docker-compose.prod.yml`. Caddy as reverse proxy — handles TLS automatically via Let's Encrypt, proxies HTTP to `app:8000` and WebSocket (`/app/*`) to `reverb:8080`. Frontend is built by `npm run build` during deploy and served by Laravel. Server bootstrapped via cloud-init on first boot. Deploys are `git pull` + `deploy/deploy.sh`.
**Consequences:**
- ✅ Single deployment target, no CORS, minimal infra complexity
- ✅ Caddy handles TLS with zero config beyond the domain name
- ✅ cloud-init gives declarative first-boot provisioning without Ansible overhead
- ⚠️ 512MB RAM is tight — MySQL tuned with `--innodb-buffer-pool-size=64M`; 1GB swap added
- ⚠️ No zero-downtime deploys — containers restart during deploy (~5s gap)
- 🔮 GitHub Actions SSH deploy wired to call `deploy/deploy.sh` remotely

---

## ADR-021 · Game renderer choice: Phaser for spatial games, React/HTML for text-input games

**Status:** Accepted
**Date:** 2026-04-24
**Context:** All games were initially Phaser-first. Pack (Herd Mentality clone) requires a text input field and answer list — awkward in Phaser's DOM overlay, natural in HTML.
**Decision:** Use Phaser for games that are primarily spatial/visual (Tic Tac Toe, Pictionary, Spotto). Use React/HTML with a pure-JS engine (`main.js` + `index.jsx` pattern) for games that are primarily text-input or card/list driven (Pack). Both patterns satisfy the same shell ↔ game contract.
**Consequences:**
- ✅ Each game uses the renderer it's actually suited for
- ✅ HTML games (Pack) get native accessibility, keyboard handling, and CSS animations for free
- ⚠️ Two patterns to maintain — new contributors must choose deliberately
- 🔮 Spotto and Pictionary are candidates for React/HTML migration (they're already using the engine/shell pattern with a thin Phaser layer)

---

## ADR-020 · Phaser games use Scale.RESIZE + `layout()` for responsive rendering

**Status:** Accepted
**Date:** 2026-04-24
**Context:** Early Phaser games used fixed pixel dimensions. This caused the canvas to not fill the available space and made cursor-to-game-element alignment impossible.
**Decision:** All Phaser games use `Scale.RESIZE` (no fixed width/height in config). A `layout()` method recalculates all positions as fractions of `this.scale.width` / `this.scale.height` and is called on `create()` and on every `scale.on('resize')` event. `shutdown()` removes the resize listener.
**Consequences:**
- ✅ Canvas always fills its container regardless of window size
- ✅ All hit areas stay correctly aligned with visual elements
- ⚠️ Every Phaser game must implement `layout()` — forgetting it means positions are only computed once
- ⚠️ Agents writing Phaser geometry must negate sin terms for upward arcs (`cy - Math.sin(a) * r`) — screen y increases downward

---

## ADR-019 · Frontend pattern: engine in `main.js`, React shell in `index.jsx`

**Status:** Accepted
**Date:** 2026-04-22
**Context:** Game frontends had grown to mix all three concerns — server-event routing, logical game state, and rendering — inside a single React component tree (`index.jsx`). This made the logic hard to read, hard to test without React, and awkward to port if a game ever moved to Phaser or another renderer.
**Decision:** Each game under `resources/js/games/{game}/` now consists of two files:
- `main.js` — a pure-JS `{Game}Engine` class extending a local `SimpleEmitter`. Owns game state, server-event routing (`receiveEvent`), user-action methods (`guess`, `hover`, `startStroke`, …), and internal timers. Emits `stateChanged` on every state mutation, plus per-game render events (e.g. `commitStroke`, `canvasClear`) for the shell to wire to the DOM.
- `index.jsx` — a thin React shell. Subscribes to `engine.on('stateChanged', setState)`, delegates every user action back to engine methods, and is the only place that holds DOM/canvas refs. Also exports the outer `{Game}Game` class that satisfies the shell↔game contract (`receiveEvent`, `on('move'|'complete')`, `destroy`).
- Tic Tac Toe is exempt: the Phaser `Scene` *is* its engine (same shape — state + event handlers + `handleServerEvent`), so splitting it is redundant.
**Consequences:**
- ✅ Engine is testable without React, DOM, or a browser runtime
- ✅ Rendering layer can swap (React → Phaser → canvas-only) without touching game logic
- ✅ Clean boundary mirrors the backend split (GameLogic.php is also pure)
- ⚠️ Pictionary engine can't fully own the canvas hot path — it emits `commitStroke`/`remoteStrokeDelta` events that the shell applies to refs; an acceptable hybrid
- 🔮 Migration to the Node.js scenario runner becomes trivial: import `main.js`, feed it fake `onMove`, assert on `engine.state`

---

## ADR-018 · Per-game nWidart modules (supersedes ADR-011)

**Status:** Accepted
**Date:** 2026-04-22
**Context:** ADR-011 scoped the module layout to just `Room` and `Game`, with every game's logic and events living inside the `Game` module. As games have been added (Pictionary, Spotto), `Modules/Game/` has absorbed per-game `Services/{Type}/` and `Events/{Type}/` subtrees, and `GameService.php` imports from all of them. This undermines ADR-011's stated benefit — a clear boundary for future extraction — because the `Game` module is no longer one domain but several.
**Decision:** Each game gets its own nWidart module at `Modules/{GameName}/` (`TicTacToe`, `Pictionary`, `Spotto`). Each contains only `module.json`, `composer.json`, `Providers/{Name}ServiceProvider.php`, `app/Services/GameLogic.php` (pure, zero framework), and `app/Events/*.php`. The `Game` module shrinks to cross-cutting orchestration only: `GameService` (now importing from per-game namespaces), `GameController`, `GameSession` / `GameResult` models + migrations, `GameType` enum, and the generic `GameEnded` event.
**Consequences:**
- ✅ Adding a game is one new module — no edits to existing game modules, just new imports in `GameService`
- ✅ Restores the "clear extraction boundary" that ADR-011 promised
- ✅ Events file under each game's own namespace (`Modules\Pictionary\Events\…`) matches how the logic is already namespaced on the frontend
- ⚠️ `GameService` still knows about every game type (via the `match(GameType)` switches) — a necessary trade-off unless we register per-game handlers through the container, which adds indirection without payoff at 3 games
- 🔮 If game-specific HTTP endpoints are ever added, they live in their own module's `routes/api.php` with a game-scoped controller

---

## ADR-016 · Pictionary stroke protocol: single event instead of start/delta/end

**Status:** Accepted
**Date:** 2026-04-21
**Context:** SPEC.md §10 defines three stroke events (`pict.stroke_start`, `pict.stroke_delta`, `pict.stroke_end`) to support streaming strokes while drawing. Implementation uses a single `pict.stroke` event sent on pointer-up with the complete stroke.
**Decision:** Use a single `pict.stroke` event containing the full points array. The game module buffers all pointer events locally and emits the completed stroke on mouse/touch up. This matches how perfect-freehand works (full stroke needed for smooth path interpolation).
**Consequences:**
- ✅ Simpler backend and frontend — one event type, one handler
- ✅ Correct with perfect-freehand (needs all points to compute outline)
- ⚠️ Guessers see strokes appear all at once (on lift) rather than streaming — acceptable for v1
- 🔮 If streaming is needed, implement delta buffering in the frontend and keep the single backend event type

## ADR-017 · Pictionary word delivery: HTTP pull instead of private channel push

**Status:** Accepted
**Date:** 2026-04-21
**Context:** The word must be sent only to the drawer, not all presence channel members. A private channel push approach was attempted but has an unsolvable timing race: the server broadcasts `pict.word_hint` synchronously in the same request as `pict.round_started`, before the client can subscribe to the private channel.
**Decision:** Word delivery is pull-based. The drawer calls `GET /games/{gameId}/word` after receiving `pict.round_started` with themselves as drawer. The endpoint returns 403 to non-drawers.
**Consequences:**
- ✅ No timing race — the drawer fetches the word at any point after round starts
- ✅ Simpler than managing per-player private channel subscriptions in the shell
- ✅ Naturally re-fetchable if the client reconnects mid-round
- ⚠️ Adds one HTTP round-trip per round for the drawer

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

## ADR-015 · QA via scenario runner over PHPUnit feature tests

**Status:** Accepted  
**Date:** 2026-04-19  
**Context:** Needed a way to verify new features (starting with Pictionary) are correctly implemented end-to-end — HTTP API, WebSocket events, Redis state, and DB state all together. PHPUnit feature tests in Laravel use a null broadcaster (no real WebSocket), meaning they cannot verify that Reverb events fire and are received correctly.  
**Decision:** Use a Node.js scenario runner (`tools/qa/`) as the primary acceptance mechanism. Scenarios use `VirtualClient` to make real HTTP calls and maintain real WebSocket connections against the running dev stack. The Pictionary scenario defines the full acceptance spec before implementation begins — sub-agents implement against it.  
**Consequences:**
- ✅ Tests the full stack: HTTP, Reverb WebSockets, Redis, MySQL all in one flow
- ✅ Scenarios are readable English-like steps — easy to understand what's being verified
- ✅ Can be run by AI sub-agents as a completion signal ("done when `make qa-pict` passes")
- ✅ `room` and `ttt` scenarios verified green against the live stack (21 and 12 assertions respectively)
- ✅ `make inspect-room/game/guest` gives instant visibility into live state during debugging
- ⚠️ Requires the full Docker stack to be running — not a CI-friendly unit test
- ⚠️ No PHPUnit tests for pure game logic — acceptable for now; add unit tests for `GameLogic` if logic grows complex
- 🔮 PHPUnit unit tests are still appropriate for pure PHP logic (`GameLogic.php`) — add them when the logic is non-trivial enough to warrant it

---

## ADR-012 · ShouldBroadcastNow over queued ShouldBroadcast

**Status:** Accepted  
**Date:** 2026-04-19  
**Context:** Events implementing `ShouldBroadcast` are pushed onto a queue and fired by the queue worker. During development, the queue worker was running but without the correct Reverb broadcasting configuration, meaning events were queued and silently lost. The `game.ended` event was never received by clients until this was diagnosed.  
**Decision:** All game and room events implement `ShouldBroadcastNow`. This fires the broadcast synchronously within the HTTP request cycle — no queue dependency.  
**Consequences:**
- ✅ Broadcasts fire immediately and predictably; no silent failures from misconfigured queue workers
- ✅ Easier to reason about in development (event fires when the HTTP call returns)
- ⚠️ Synchronous broadcast adds latency to the HTTP response — acceptable for the low-frequency events in Dawdle (game moves, ready toggling, chat)
- ⚠️ Under heavy load, async queued broadcasts would be better — revisit if move broadcast latency becomes measurable
- 🔮 If we ever need deferred broadcasting (e.g. scheduled events), use a dedicated artisan command rather than re-introducing `ShouldBroadcast`

---

## ADR-013 · Server-driven system messages via `systemMessage` field + `bind_global`

**Status:** Accepted  
**Date:** 2026-04-19  
**Context:** System messages (join, leave, game start, game change) were initially constructed client-side as strings inside individual event listeners. This meant the client had to know the human-readable label for every event type, and adding a new event type required both a backend change and a matching client-side string.  
**Decision:** Events that should produce a chat system message include a `systemMessage: string` field in their `broadcastWith()` payload. The frontend has a single `bind_global` handler on the raw Pusher channel; if `data.systemMessage` exists, it is added to chat. Events that should not produce a message simply omit the field.  
**Consequences:**
- ✅ Adding a new system message requires only a backend change — no frontend wiring
- ✅ Message text is co-located with the event definition, not scattered across React components
- ✅ Single point of interception handles all current and future event types
- ⚠️ `systemMessage` strings are not localisation-ready (hardcoded English in PHP) — acceptable for v1
- ⚠️ `bind_global` also fires for internal Pusher protocol events (`pusher:subscription_succeeded`, `pusher:member_added`, etc.) — the `if (data?.systemMessage)` guard is sufficient to filter these

---

## ADR-014 · Host concept — first creator is room host; persisted in DB and Redis

**Status:** Accepted  
**Date:** 2026-04-19  
**Context:** The lobby needed a way to designate one player as having privileged control (game selection). The simplest model is that the room creator is the host.  
**Decision:** `rooms.host_guest_id` stores the host UUID in MySQL. `dawdle:room:{roomId}` Redis hash stores `hostGuestId` for fast reads. The host is set at room creation and currently never changes (host handover is out of scope for v1). The host is the only player who can call `PATCH /rooms/{code}/game`.  
**Consequences:**
- ✅ Simple and deterministic — whoever created the room is in charge
- ✅ Host identity is available on the initial `GET /rooms/{code}` response without a separate query
- ⚠️ If the host disconnects, no one can change the game — acceptable for v1
- 🔮 Host handover: when implemented, update both `rooms.host_guest_id` and `dawdle:room:{roomId}.hostGuestId` atomically; broadcast a `room.host_changed` event

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
