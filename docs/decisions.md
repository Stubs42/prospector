# Phase 0 — Ruleset Decisions

One entry per Open Question (from `rules.en.html` §18) plus structural decisions from Part II.
Status is **DECIDED** (sensible default, reversible) or **NEEDS INPUT** (waiting on the designer).

---

## Structural decisions

### S1 — Rules split into Core + Mode  ·  DECIDED
`docs/rules-core.md` holds everything mode-independent: the hex board model, drift/burn
movement, fuel economy, the generic card framework, the turn skeleton, and movement-based
ship loss. `docs/rules-prospector.md` holds the Prospector mode: objective, setup, resource
seeding, loading, combat, home base, scoring, end trigger.

### S2 — Config-driven, decks generated  ·  DECIDED
No quantity is hard-coded. `config/config.schema.json` defines `core` + `modes.<name>`.
`config/default.config.json` carries the 2006 values. Booster/equipment/fuel decks are
built by a generator from their composition parameters, not authored card-by-card.

### S3 — Coordinate system  ·  DECIDED (confirmed against board.svg)
Axial `(q, r)` hex coordinates, cube-distance. Golden origin at `(0, 0)`.

**Cell orientation: pointy-top** (cells in E–W rows; six neighbours are E, W and the four
diagonals). The board hexagon has flat top/bottom edges and W/E vertices.
*(Board.jpg was ~90° rotated, which briefly pointed at flat-top; the designer's on-screen
review of the render confirmed pointy-top with black at the centre-left.)*

The six directions, indexed 0–5 **clockwise from West**, each bound to a colour (Q3):

| idx | compass | colour | Δ(q,r) |
|--|--|--|--|
| 0 | W  | black  | (-1, 0) |
| 1 | NW | red    | (0, -1) |
| 2 | NE | blue   | (+1, -1) |
| 3 | E  | white  | (+1, 0) |
| 4 | SE | green  | (0, +1) |
| 5 | SW | yellow | (-1, +1) |

Opposite colours on opposite corners: black↔white, red↔green, blue↔yellow. Matches the
designer's original layout: black centre-left, white centre-right, red top-left, blue
top-right, green bottom-right, yellow bottom-left.

### S4 — Turn skeleton (core)  ·  DECIDED
1. *(optional, before drawing)* scrap ship → return empty to home base; turn ends.
2. Draw one booster card; enforce hand limit (mode supplies the deck and the limit source).
3. Move: **drift phase** (skipped if at rest) → **burn phase** (optional unless a correction is required).
4. *(optional)* one mode-defined post-move action.

---

## Open Questions

### Q1 — Board geometry  ·  DECIDED
Physical board is a rectangle with a **hexagonal grid** of flat-top cells inside it and a
decorative starfield in the margins (no printed cells there).
- **Play area:** a hexagon centred on the golden origin `(0,0)`. **Inner region = distance
  0–9** (9 rings). **Outer region = distance 10–11** (2 rings). Field radius = 11.
  Off-field = distance ≥ 12 (ship lost if a drift ends here).
- **Golden origin:** a single cell, marked only by a gold frame.
- **Home bases:** 6, one per ship colour, each a **4-cell cluster at one of the hexagon's
  six corners**, inside the inner region (anchored around distance 9), pointing toward that
  colour's die direction (see Q3). Exact cell picks are a Phase 1 board-authoring detail.
- No other special cells.

### Q2 — Hex orientation  ·  DECIDED
Cells are **pointy-top** (E–W rows). Board.jpg looked flat-top but was a rotated photo;
the designer's review of `board.svg` confirmed pointy-top. See S3.

### Q3 — Coordinate dice → six directions  ·  DECIDED
Three dice: one shows **1** on every face, one **2**, one **3**; each of the six faces
carries one of the **six ship/base colours**. A roll = three vectors of length 1, 2 and 3,
each parallel to the direction of the rolled colour's home base (i.e. toward that corner).
Colour order is irrelevant to the result (vector addition). Board colour order, **clockwise:
black, red, blue, white, green, yellow** — anchored with **black at West, white at East**,
so the bindings are W, NW, NE, E, SE, SW (S3).

### Q4 — Fuel model  ·  DECIDED
**Fuel is an integer point pool.** Player state carries `fuel` (current) and `fuelMax`
(= the ship's current fuel-tank rating). **`fuel` is never allowed above `fuelMax`** — you
cannot turn more tanks green than you have capacity for.
- Setup: `fuel = fuelMax` (each player is dealt fuel cards summing to their tank capacity).
- 1-cell burn → `fuel -= 1`. A burn needs `fuel >= cells`.
- Reaching home base → `fuel = fuelMax` (all tanks flipped to green).
- Reserve-fuel booster `+n` → `fuel = min(fuel + n, fuelMax)` (this is the "play a fuel card
  to fuel up" mid-flight; overflow is lost).
- Fuel-tank equipment → `fuelMax += 3`, and the player is handed fuel cards for the new
  capacity → `fuel += 3`. (Confirmed by the designer: persistent fuel equipment is +3.)
- Physically: cards have green (full) / red (empty) sides; spending flips green→red; a
  value-3 card swaps for three value-1 cards at any time — pure change-making. The engine
  ignores denominations. Fuel cards double as a fungible currency (flagged for possible
  future trading mechanics; no effect on base rules).

### Q5 — Adjacency  ·  DECIDED
"Adjacent" = the six hex neighbours at distance 1. Used for resource loading and for
detecting a combat target. No diagonals, no wrap.

### Q6 — Drift geometry at edges & occupied cells  ·  DECIDED
`next_current = current + (current − previous)` in axial vector math.
- Outside the outer field → ship lost (per §8 / §15).
- On an occupied inner cell (ship, resource, or base cell) → cell is "not free" → mandatory
  burn to a free cell; if none reachable within the burn cap → ship lost.
- A resource or rival ship on the landing cell triggers no interaction by itself; it only
  makes the cell not-free. Interaction happens only as the post-move action.

### Q7 — Combat dice faces  ·  DECIDED
Standard **1–6** dice. **Red** die is rolled by the attacker, **blue** by the defender.

### Q8 — Ship roster  ·  DECIDED (originals recovered)
The designer supplied all six starting vectors. Stat order: shields / lasers / fuelTanks /
cargo / engines / booster (all `booster = 3`).

| colour | name | shields | lasers | fuelTanks | cargo | engines | booster |
|--|--|--|--|--|--|--|--|
| black  | Pirate | 0 | 2 | 10 | 2 | 1 | 3 |
| white  | Dove   | 2 | 0 | 10 | 2 | 1 | 3 |
| blue   | Polo   | 1 | 0 | 13 | 2 | 1 | 3 |
| red    | Hermes | 0 | 1 | 10 | 2 | 2 | 3 |
| green  | Atlas  | 1 | 0 | 10 | 3 | 1 | 3 |
| yellow | Joe    | 1 | 1 | 10 | 2 | 1 | 3 |

Yellow matches the scan's example ship. The simulator (§C) is now for *checking* balance;
these vectors may still be **rebalanced** if simulation shows one ship winning too often —
`default.config.json` holds the baseline, a tuned config would override `modes.prospector.ships`.

### Q9 — Card art  ·  DECIDED (scope)
Deck *compositions* are known and live in config. Art is Phase 5 work, shared with any
reprint. Not an engine blocker.

### Q10 — Hyperspace booster timing  ·  DECIDED
A Hyperspace booster may be played either:
- at the **start of the burn phase**, before any burn movement → roll coordinate dice for
  the destination, place ship at rest there, then optionally perform a normal burn from it; or
- **in combat as the defender** (per §13).
Never once a burn has begun. The 4-engine + 4-fuel jump is declared *instead of* a normal burn.

### Q11 — Late-game seeding invariant  ·  DECIDED
Seating order is fixed, clockwise from the start player.

The rule "there must always be 1 more resource in play than players" uses the **initial
player count**, fixed for the whole game — it does **not** drop when a player is eliminated
(in Prospector mode the player count never changes until the game ends). Its purpose is
simply to guarantee there is always something on the board to chase. Target in-play count
`= initialPlayers + 1`. Seeding only ever *adds* tiles (one per tile delivered home) and
stops once the supply is empty; it never removes tiles already on the board.
`[modes.prospector.resources.inPlayBasis = "initial-players"]`.
