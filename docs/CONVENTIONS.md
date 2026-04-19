# Development Conventions

Conventions for the Dawdle codebase. These apply to all AI-generated and human-written code.

---

## General Principle: Prefer Simplicity

**Write the simplest code that correctly solves the problem.** Simple code is easier to read, easier to debug, and has fewer places for bugs to hide.

- Avoid abstractions until they are clearly needed — duplication is preferable to a premature abstraction
- Avoid indirection (extra classes, interfaces, wrappers) unless it earns its keep
- Short, flat functions are better than deep call chains
- If you find yourself explaining what the code does, it probably needs to be simpler

---

## Git

- **Commit messages use gitmojis** — prefix every commit with the appropriate emoji:
  - 🎉 `:tada:` — initial commit / begin a project
  - ✨ `:sparkles:` — new feature
  - 🐛 `:bug:` — bug fix
  - 🔧 `:wrench:` — config / tooling change
  - 📁 `:file_folder:` — file/folder structure changes
  - ♻️ `:recycle:` — refactor
  - 🗃️ `:card_file_box:` — database / migration changes
  - 💄 `:lipstick:` — UI / style changes
  - ✅ `:white_check_mark:` — tests
  - 📝 `:memo:` — docs
  - 🔥 `:fire:` — remove code or files
  - 🚀 `:rocket:` — deploy / release
  - Reference: [gitmoji.dev](https://gitmoji.dev)
- **Branch naming:** `feature/`, `fix/`, `chore/` prefixes
- **One logical change per commit** — don't bundle unrelated changes

---

## Tooling

- **Everything runs in Docker** — no local PHP, no local npm. All commands go through `docker compose exec` or `docker compose run --rm`.
- Use `make <target>` for common operations — see `Makefile` for the full list.
- Vite (Node) runs in the `node` sidecar container, not on the host.

---

## Module Architecture (nWidart Laravel Modules + Light DDD)

The backend is organised into self-contained modules using [nWidart/laravel-modules](https://github.com/nWidart/laravel-modules). Each module owns a single domain.

**Modules:**
- `Room` — room lifecycle, player presence, ready state, chat
- `Game` — game sessions, move validation, game logic, results

**Within each module, follow these layers:**

| Layer | Location | Rule |
|---|---|---|
| Controller | `Http/Controllers/` | Thin — validate input, call service, return response. No business logic. |
| Service | `Services/` | Domain logic. No HTTP concerns (`Request`, `Response`). Can use Eloquent. |
| Model | `Models/` | Eloquent models. Relationships and scopes only — no business logic. |
| Event | `Events/` | Domain events that extend `ShouldBroadcast`. One event per thing that happened. |
| Request | `Http/Requests/` | Form request validation. |

**What we deliberately skip** (full DDD ceremony not warranted at this stage):
- Repository interfaces/implementations — Eloquent is already a repository
- Value objects for simple types — use typed properties instead
- Aggregate roots — Eloquent models serve this purpose cleanly enough

**Cross-module calls:** Go through a module's `Service` class, never directly between controllers or models of different modules.

---

## PHP / Laravel

**Game logic isolation** is the most important rule:

- `Modules/Game/Services/{GameType}/GameLogic.php` — pure PHP, zero Laravel dependencies. No facades, no Eloquent, no `app()`. This is the future migration boundary to Node.js/Go.
- All game rules, win detection, and state transitions live here.
- The Service layer (`Modules/Game/Services/GameService.php`) calls `GameLogic` and handles persistence/broadcasting.
- Never read live game state from MySQL during an active game — Redis is the source of truth during play.
- All Redis keys are prefixed `dawdle:` — see `docs/SPEC.md §12` for the full schema.

**Redis vs Cache facade:**

- **TODO:** Prefer `Cache::` / `cache()` over `Redis::` for simple key-value storage — `cache()->put(key, value, $ttl)`, `cache()->get(key)`, `cache()->forget(key)`. These work with any cache driver and are more testable.
- **Use `Redis::` directly** when you need Redis-specific data structures: sets (`sadd`/`smembers`/`srem`/`sismember`), hashes (`hset`/`hget`/`hgetall`/`hdel`), sorted sets, or atomic multi-key operations. The `Cache` facade does not expose these.
- In practice, most Dawdle Redis usage requires `Redis::` (hashes for room/guest state, sets for players/ready). The clearest candidates for migration are `Redis::del()` → `Cache::forget()` and any isolated `Redis::set()`/`Redis::get()` calls.

**Broadcasting:**

- Always use `ShouldBroadcastNow` (not `ShouldBroadcast`) for game and room events — `ShouldBroadcast` queues the event and requires a running queue worker with Reverb configuration. `ShouldBroadcastNow` fires synchronously within the HTTP request. See ADR-012.
- `toOthers()` requires two things: the `X-Socket-ID` header on the HTTP request, AND `window.Echo` must be set to the Echo instance (not just a module-local variable). The `use-room.js` hook assigns `window.Echo = echoInstance` for this reason.
- `broadcast(new Event())->toOthers()` — use this on events sent from a client action where the sender already applied the change optimistically (e.g. chat messages).
- `broadcast(new Event())` — no `toOthers()` — use this for system events where all clients (including the triggering client) need the update (e.g. `GameStarted`, `PlayerLeft`).

**Models:**

- Models using `HasUlids` auto-generate their ID in the `creating` Eloquent event. If you pass `id` to `Model::create([...])` but `id` is not in `$fillable`, the ID is silently dropped and a new one is generated. Use `Model::forceCreate([...])` when you need to supply your own ID (e.g. the game session ID that was already stored in Redis).

**Migrations:**
- Each module owns its migrations in `Modules/{Name}/Database/Migrations/`
- Use ULIDs (not auto-increment integers) for primary keys on `rooms` and `game_sessions` — these IDs are exposed in URLs and WebSocket payloads.
- Use `bigint` for high-volume join tables (`room_guests`, `game_results`).

---

## JavaScript / React

**The shell ↔ game contract is binding** — every PhaserJS game must implement it exactly. The shell never reaches inside a game module beyond the public interface. See `docs/SPEC.md §7` for the full contract.

- Mount PhaserJS games with `useLayoutEffect` (not `useEffect`) — timing matters for DOM-dependent libraries.
- Always call `game.destroy(true)` in the `useLayoutEffect` cleanup — passes `true` to remove all GPU textures and prevent memory leaks.
- Re-mount only when `config.gameId` changes, not on every render.
- The shell owns the WebSocket connection — games emit moves, the shell relays them.

**File naming:**
- React components: `PascalCase.jsx`
- Game modules: `resources/js/games/{game-type}/index.js`
- Hooks: `use-camel-case.js`

---

## WebSocket Events

- All events are namespaced `{category}.{action}` — e.g. `room.player_joined`, `ttt.move_made`.
- Game-specific events are prefixed with the game type abbreviation: `ttt.*`, `pict.*`.
- Never broadcast raw user input — always validate server-side before broadcasting.
- To handle all events generically (e.g. system messages), use `channel.channel.bind_global(handler)` on the underlying raw Pusher channel object. `channel.channel` is the Pusher-js `Channel` instance that Echo wraps. Always unbind in the cleanup: `channel.channel.unbind_global(handler)`.
- Events that should produce a chat system message include a `systemMessage: string` field in their payload — the generic `bind_global` handler picks this up without any per-event wiring. See ADR-013 and `docs/SPEC.md §8`.

---

## Code Review

Before merging any feature, run the three reviewer profiles defined in `docs/REVIEW_PROFILES.md` as parallel subagents (Quality, Security, Architecture). Fix all **[BLOCK]** findings before committing. See that file for the full process.

---

## Documentation

- `docs/SPEC.md` — founding specification, source of truth for the system design
- `docs/CONVENTIONS.md` — this file
- `docs/DECISIONS.md` — architecture decisions and opinions log
- `docs/REVIEW_PROFILES.md` — parallel reviewer personas for code review
- `CLAUDE.md` — AI operational guide (stays at project root)
- Keep `docs/` up to date as decisions are made — it's the project memory.
