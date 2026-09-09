# Prospector — Project Status

**What this is:** a movement-engine board-game *system*. The flagship mode is **Prospector**
(resource collection & delivery), revived from a 2006 print-only draft. Other modes
(Race, Rally, Courier, Last Ship Flying) will reuse the same core.

_Last updated: 2026-09-09 — Phase 4 (hot-seat UI) first working build._

## Assets in the repo

| File | Role |
|---|---|
| `Prospector.pdf` | Original 2006 German rules scan, 13 pages. Source of truth for Part I. |
| `rules.en.html` | English rulebook (Part I) + Design & Architecture (Part II). Published artifact: https://claude.ai/code/artifact/a4b4b31b-32b6-41b8-8a1d-4fd5a679c3e4 |
| `session-transcript.md` | Rendered transcript of the design session. |
| `make-transcript.py` | Regenerates the transcript from the Claude Code session log. |
| `docs/decisions.md` | Phase 0 — resolutions to the Open Questions. |

## Agreed principles

1. **Engine / UI separation** — the rules engine never imports the UI.
2. **Everything is a parameter** — every quantity is config; decks are generated from config.
3. **Simulate for balance** — headless bots + parameter sweeps; fairness is a hard constraint.
4. **Modes are plugins** — a shared core; a mode is data + a few hook functions.
5. **Physical-parity gate** — every rule/mode must stay playable as a physical board game.
6. **Physical-object visuals** — the screen shows cards, chips, dice, cones; animations are rigid-body motions of real objects.
7. **Ships are mode-scoped** — stat vector is an open `key → number` map; the core reads it via `mode.movementInputs()`.

## Roadmap

Phases 0–7, defined in `rules.en.html` Part II §A. **Current phase: 0 — Freeze the ruleset.**

### Phase 0 deliverables

- [x] `docs/decisions.md` — resolutions for all Open Questions.
- [x] `docs/rules-core.md` — mode-independent rules (board, movement, fuel, card framework, turn skeleton).
- [x] `docs/rules-prospector.md` — the Prospector mode (objective, setup, resources, combat, home base, scoring).
- [x] `config/config.schema.json` — the parameter schema (core + `modes.*`).
- [x] `config/default.config.json` — the 2006 values; deck totals verified 45 / 36 / 43, resource formula 3 + players.

_Exit criterion: the documents describe one unambiguous game. **Status: met — frozen 2026-09-09.**_

### Phase 1 — model the board as data

- [x] `board/build_board.py` — `config` → `board/board.json` (397 cells: coords, distance, region, base owner, pixel position).
- [x] `board/render_board.py` — `board.json` → `board/board.svg` (+ `board.png` preview).
- [x] Home-base 4-cell clusters generated deterministically (compact fan at each corner).
- [x] **`Board.jpg` / `board.svg` cross-check** — pointy-top cells, black centre-left, confirmed by the designer's review. (Board.jpg was a ~90° rotated photo.)
- [ ] Sanity-check radius: designer says 9+2 rings; worth a quick hex count on the physical board.

_Exit criterion: the board renders from `board.json` alone and matches the physical board.
**Met — 2026-09-09.**_

### Phase 2 — model the content as data

- [x] `content/build_content.py` — `config` → `content/components.json` (dice, 18 cones, 27 resource tiles) + `content/prospector.json` (45 boosters, 36 equipment, 43 fuel cards, 6-ship roster, per-player supply table).
- [x] `content/validate_content.py` — 78 checks against box totals, per-group composition, stat caps, id uniqueness. All pass.
- Known content edge: at 6 players the "long game" adjust (+1/colour → 10) exceeds the 9 tiles/colour in the box. Standard and short are fine. Decide later: cap at 9, or "long unavailable at 6p".

_Exit criterion: every component exists as a validated data row. **Met — 2026-09-09.**_

### Phase 3 — headless rules engine  (TypeScript + Vitest)

**3a — primitives (done, 44 tests green, `tsc` clean):**
- [x] `engine/hex.ts` — axial hex math (add/sub/scale/distance/neighbours/round/spiral)
- [x] `engine/rng.ts` — seeded deterministic RNG (mulberry32); dice, shuffle, pick
- [x] `engine/data.ts` — the only fs-touching module (loads config / board.json / content)
- [x] `engine/board.ts` — board model + `isFree`
- [x] `engine/dice.ts` — coordinate-dice roll (3 vectors) + combat dice
- [x] `engine/movement.ts` — **drift**, **burn** (fuel cost, free base-departure cells, caps), **hyperspace landing**
- [x] `engine/ship.ts` — stat resolution (base + equipment, capped), `movementInputs`
- [x] `engine/cards.ts` — deck: draw / discard / bottom / reshuffle-on-empty
- [x] `engine/types.ts` — full state + action + config types

**3b — state machine (done):**
- [x] `engine/combat.ts` — pure combat resolution + spoil selection
- [x] `engine/game.ts` — `createGame`, `applyAction` reducer (draw → drift → burn/hyperspace → post-move load/attack → combat sub-flow → endTurn), seeding + invariant, home-base arrival (brake/refuel/deliver/equip/reseed), ship loss, scoring, end trigger
- [x] `engine/index.ts` — `legalActions`, `randomBot`, `greedyBot`, `simulate()` (with a stall guard + `finished`/`stalled` reporting)
- [x] `engine/worked-example.test.ts` — launch → coast → load → deliver, asserting drift/burn/fuel/delivery move-for-move
- [x] `engine/game.test.ts`, `engine/combat.test.ts`, `engine/simulate.test.ts`

**61 tests green, `tsc` clean, full suite ~6s.**

Notes:
- `applyAction` preserves `config` identity (cloning it every action made board caching miss and re-parse `board.json` from disk in a tight loop — that was crashing the sim workers).
- `greedyBot` is deliberately simple: locks onto the tile nearest its home base, brakes near goals, uses reserve-fuel boosters, scraps a hopelessly stranded empty ship. It finishes ~90%+ of 3-player games in 150–270 turns; a few stall. A stronger bot + a combat-capable bot are Phase 3/5 balance work (roadmap §C).

_Run: `npm test` · `npm run check`_

### Phase 4 — local hot-seat UI  (Vite + React over the engine)

- [x] Engine refactor: `provideGameData({config, boardJson, content})` injection — no more `node:fs` in the engine path. Node tests inject via `engine/test-provide.ts` (vitest `setupFiles`); browser via `web/data.browser.ts` (bundled JSON).
- [x] `web/` — `main.tsx`, `App.tsx`, `components/Board.tsx`; `vite.config.ts`; scripts `npm run dev` / `build:web` / `preview`.
- [x] SVG board from `board.json` — pointy-top cells, coloured corner bases, gold origin, ore chips, **3-cone ships** (2+1 in flight with a velocity line, 3 stacked at rest).
- [x] Sidebar: active-ship stat tiles, fuel track (green/red), cargo + delivered + score, booster hand (typed card faces), action bar built entirely from `legalActions`, event log.
- [x] Spatial actions: burn destinations and loadable resources are click targets highlighted on the board.
- [x] Pass-the-device gate between turns so hands stay secret.
- [x] `?demo=N` — greedy bots auto-play N actions on load (screenshots / smoke).
- Verified in headless Chrome: fresh game + a 140-action mid-game state both render correctly. 61 engine tests still green.

Polish left for later: board could use more of the canvas; combat panel is minimal (no in-combat booster picker yet); no animation pass yet (Phase 5).
