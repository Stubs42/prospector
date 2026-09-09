# Prospector — Core Rules

Mode-independent rules: the board, ship movement, fuel, the card framework, the turn
skeleton, and movement-caused ship loss. A **mode** (see `rules-prospector.md`) supplies the
objective, setup, decks, post-move actions and scoring on top of this.

Bracketed names like `[core.movement.burnMaxCells]` point at `config/config.schema.json`.

---

## 1. The board

- A **hexagonal play area** of pointy-top cells on axial coordinates `(q, r)`, centred on the
  **golden origin** `(0, 0)`. Distance is cube-distance. The grid region has flat top/bottom
  edges and W/E vertices.
- **Inner region:** distance `0 … [core.board.innerRadius]` (default 9).
- **Outer region:** distance `innerRadius+1 … [core.board.radius]` (default 10–11). It exists
  only to catch a drifting ship; ships may not deliberately end movement here.
- **Off-field:** distance `> radius`.
- **Six directions**, indexed 0–5 clockwise from West, each with an axial delta and a bound
  colour `[core.board.directions]`, `[core.board.colourOrder]`:
  `0 W (-1,0) black · 1 NW (0,-1) red · 2 NE (+1,-1) blue · 3 E (+1,0) white · 4 SE (0,+1) green · 5 SW (-1,+1) yellow`.
- **Adjacent** = the six cells at distance 1.
- A cell is **free** if it is inside the field and holds no ship position, resource, or other
  token the mode marks as blocking. Home-base cells are free to their owner.

## 2. Ships on the board

A ship is three cones:

- **At rest** — all three cones stacked on one cell. No velocity.
- **In flight** — two cones stacked on the **current position**, one cone on the **previous
  position**. The vector `current − previous` is the velocity.

## 3. The turn

1. *(optional, before anything else)* **Scrap the ship** `[core.turn.allowScrapBeforeDraw]`:
   remove it from play, return it **at rest** and empty to a home-base cell. The turn ends.
2. **Draw** `[core.turn.boostersDrawnPerTurn]` (default 1) booster card into hand. If over the
   hand limit (the mode names the limit source), immediately play or discard down to it.
3. **Move** — the **drift phase** (skipped if at rest) then the **burn phase**
   (optional, unless a correction is required).
4. *(optional)* one **post-move action** defined by the mode.

## 4. Movement — drift

The ship carries its velocity forward:

1. Lift the top cone from the current position and place it at
   `next = current + (current − previous)` — collinear with the previous and current cones,
   the same spacing beyond.
2. Move the previous-position cone onto `next`.

The current position is now `next`; the old current position is the new previous position.

- If `next` is **off-field**, the ship is **lost** (section 8) — even if a burn could
  otherwise have saved it.
- If `next` is **on-field but not free** (occupied cell) or **in the outer region**, the
  ship has not landed cleanly and the burn phase is **mandatory** to reach a free inner cell.

## 5. Movement — burn

Optional, unless drift did not end on a free inner cell.

- Move the current position (both stacked cones) up to `[core.movement.burnMaxCells]`
  (default 3) cells in any direction(s).
- Cost: `[core.movement.fuelPerCell]` (default 1) fuel per cell (section 6). The move needs
  `fuel ≥ cells`.
- The number of cells is capped by the ship's **engine** rating; the mode may let cards
  raise it, still bounded by `burnMaxCells`.
- Every cell the current position passes through, and the destination, must be **free**.
- **Leaving a home base:** the first `[core.movement.freeBaseDepartureCells]` (default 1)
  cells of the burn cost no fuel and no engine capacity.
- **Hyperspace** (section 7) is declared *instead of* a normal burn.

## 6. Fuel

An integer pool `[core.fuel.model = "pool"]`. Player state: `fuel` (current), `fuelMax`
(= current fuel-tank rating). **`fuel` is clamped to `[0, fuelMax]` at all times**
`[core.fuel.reserveMayExceedMax = false]` — you cannot flip more tanks green than you own.

- Burn: `fuel -= cellsBurned`.
- Refuel (mode-triggered, e.g. at a home base) `[core.fuel.refuelAtBase = "toMax"]`:
  `fuel = fuelMax`.
- Reserve-fuel effects: `fuel = min(fuel + n, fuelMax)`; any overflow is lost.
- Physical denominations (value-1 / value-3 cards, green/red faces) are change-making only;
  the engine tracks the integer.

## 7. Hyperspace

`[core.movement.hyperspace]`. A jump is available two ways:

- **4 engines + 4 fuel** spent in the burn phase (`engineThreshold`, `fuelCost`), or
- a mode card that grants a jump.

Procedure: remove the ship, roll the coordinate dice (section 9) for a destination, place
the ship **at rest** there. If the destination is **not free**, the ship is **lost**.

A mode card granting a jump may be played at the **start of the burn phase** (then a normal
burn may still follow) or wherever else the mode allows (e.g. combat defence). Never once a
burn has begun.

## 8. Ship loss (movement-caused)

Triggers: a drift ending off-field; a failed hyperspace (destination not free); no free
inner cell reachable within the burn cap after a mandatory burn.

Effect (mode may extend): the ship returns **at rest** to a home-base cell. Any mode-held
cargo is handled by the mode. A player may also scrap voluntarily (section 3.1).

## 9. Coordinate dice

`[core.dice.coordinate]`. Three dice: one showing **1**, one **2**, one **3**
(`steps: [1,2,3]`); each face is one of the six colours (`faces: colourOrder`). A roll
yields the offset `Σ stepᵢ · direction(colourᵢ)` from a stated origin cell (the golden
origin for resource seeding, or as the mode directs). If the resulting cell is unusable for
the caller's purpose, the mode re-rolls.

## 10. Card framework

`[core.cards]`. A deck is a shuffled stack with a face-up discard pile. Draw from the top;
when the deck empties, shuffle the discard into a new deck
`[core.cards.reshuffleDiscardWhenEmpty = true]`. Hands are private; hand limits are set by
the mode. "Play" moves a card to the discard and applies its effect.
