# Development Conventions

Conventions for the Dawdle codebase. These apply to all AI-generated and human-written code.

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

## PHP / Laravel

**Game logic isolation** is the most important rule:

- `app/Games/{GameType}/GameLogic.php` — pure PHP, zero Laravel dependencies. No facades, no Eloquent, no `app()`. This is the future migration boundary to Node.js.
- `app/Games/{GameType}/GameChannel.php` — the Reverb/Laravel layer that calls `GameLogic`.
- Never read live game state from MySQL during an active game — Redis is the source of truth during play.
- All Redis keys are prefixed `dawdle:` — see `docs/SPEC.md §12` for the full schema.

**Migrations:**
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

---

## Documentation

- `docs/SPEC.md` — founding specification, source of truth for the system design
- `docs/CONVENTIONS.md` — this file
- `docs/DECISIONS.md` — architecture decisions and opinions log
- `CLAUDE.md` — AI operational guide (stays at project root)
- Keep `docs/` up to date as decisions are made — it's the project memory.
