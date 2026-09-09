# Prospector — Mode Rules

The flagship mode: mine resources in deep space and haul them home. Runs on
`rules-core.md`. Bracketed names point at `config/config.schema.json` under
`modes.prospector`.

---

## 1. Objective

Deliver resources to your home base. When the supply is exhausted and all delivered,
the player with the highest delivered value wins `[scoring]`, `[endTrigger]`.

## 2. Mode components

- **Resource tiles** `[resources]` — colours green / yellow / red, values 1 / 2 / 3.
- **Booster deck** `[decks.booster]` — 45 cards.
- **Equipment deck** `[decks.equipment]` — 36 cards.
- **Fuel cards** `[decks.fuel]` — 43 (24×1, 19×3); physical change only (core §6).
- **Combat dice** `[core.dice.combat]` — standard 1–6 dice: **red** rolled by the attacker,
  **blue** by the defender.
- **Ship roster** — six ships, `[statSchema] = [shields, lasers, fuelTanks, cargo, engines, booster]`:

| colour | name | shields | lasers | fuelTanks | cargo | engines | booster |
|--|--|--|--|--|--|--|--|
| black  | Pirate | 0 | 2 | 10 | 2 | 1 | 3 |
| white  | Dove   | 2 | 0 | 10 | 2 | 1 | 3 |
| blue   | Polo   | 1 | 0 | 13 | 2 | 1 | 3 |
| red    | Hermes | 0 | 1 | 10 | 2 | 2 | 3 |
| green  | Atlas  | 1 | 0 | 10 | 3 | 1 | 3 |
| yellow | Joe    | 1 | 1 | 10 | 2 | 1 | 3 |

`movementInputs(ship)` → `{ burnCap: engines (+ engine boosters), fuelCapacity: fuelTanks }`.

**Stat effects:** shields = defence in combat · lasers = attack in combat · fuelTanks =
`fuelMax` · cargo = max resources carried · engines = burn cells per turn · booster = hand
limit for booster cards.

**Upgrade caps** `[upgradeCaps]`: lasers 4, shields 4, fuelTanks 19, cargo 4, engines 3,
booster 7.

## 3. Setup

1. Place the resource supply: `[resources.perColour] = base + perPlayer·players`
   (default `3 + players` per colour → 2p 5, 3p 6, 4p 7, 5p 8, 6p 9). Optional
   `[resources.gameLengthAdjust]`: short −1, long +1 per colour.
2. Shuffle the booster deck onto its field.
3. Shuffle equipment; deal 3 to each player, each keeps `[homeBase.setupEquipmentKeep]` (1),
   returns the rest; reshuffle.
4. Each player draws a ship card, places their ship **at rest** on a cell of its
   matching-colour home base.
5. Each player's `fuel = fuelMax` (their ship's `fuelTanks`).
6. Put `[decks.fuel.sharedFieldCards]` (6) value-3 fuel cards on the fuel field (physical
   change-making reserve).
7. Seed one **green** resource per player (§5).
8. Seed one more **green** resource.
9. Roll for start player; play proceeds clockwise.

## 4. Turn — post-move action

After moving, the active player may take **one** of `[postMoveActions]` — **load** *or*
**attack** — never both `[loadRules]`, `[combat]`.

## 5. Resource seeding

Uses core §9 from the golden origin. Placement cell must be **empty**; re-roll if not.
Seed order `[resources.seedOrder]`: all green, then yellow, then red.

**Invariant** `[resources.inPlayInvariant]` (N = 1),
`[resources.inPlayBasis = "initial-players"]`: resources *in play* (on the board or carried)
should be `initialPlayers + N` — the count uses the **initial** player number, fixed for the
whole game (Prospector player count never changes). It is a **floor for seeding**, not a cap,
and guarantees there is always something to chase. Trigger seeding at game start and
whenever resources are delivered home (one new tile per delivered tile), while the supply
holds tiles.

## 6. Booster cards `[decks.booster]`

Hand limit = the ship's current `booster` rating. Draw 1 per turn (core §3.2). A booster
gives a **one-time** bonus when played.

| group | counts |
|--|--|
| shield  | +1 ×4, +2 ×3, +3 ×2, **+99** ×3 |
| laser   | +1 ×4, +2 ×3, +3 ×2, **+50** ×3 |
| reserveFuel | +1 ×4, +2 ×3, +3 ×2 |
| engine  | +1 ×4, +2 ×3, +3 ×2 |
| hyperspace | ×3 |

- **reserveFuel +n** → `fuel = min(fuel + n, fuelMax)` (core §6; overflow lost).
- **engine +n** → burn cap `+n` this turn (still ≤ `core.movement.burnMaxCells`).
- **shield / laser +n** → combat only (§8).
- **hyperspace** → a jump; playable at the start of the burn phase, or as combat defence.
- **laser +50** may only be played as a single card `[combat.laserBooster50SingleCardOnly]`.
- **shield +99** or a **hyperspace** played on defence ends the attack immediately with no
  roll `[combat.shieldBooster99AutoWin]`, `[combat.hyperspaceDefenceAutoEscape]`.

## 7. Equipment cards `[decks.equipment]`

**Permanent** upgrades. `[decks.equipment.perType]` (6) of each type
`[decks.equipment.types]`: shields +1, lasers +1, fuelTanks +3, cargo +1, engines +1,
booster +1.

- On delivering ≥1 resource home: draw `[homeBase.equipmentDraw]` (3), keep
  `[homeBase.equipmentKeep]` (1), place face-up by the ship card; rejects go under the deck.
  One per delivery regardless of count.
- May not pick a type already at its `[upgradeCaps]`.
- 3 identical drawn and unusable/unwanted → draw 3 fresh.
- Picking **fuelTanks** `[decks.equipment.fuelEquip]`: `fuelMax += 3`, `fuel += 3`
  (still clamped to `fuelMax`).

## 8. Loading resources `[loadRules]`

If the ship ends movement **adjacent** to a resource, it may load it onto the ship card.

- Carried ≤ `cargo` rating.
- If `cargo` is full and an adjacent resource is **more valuable** than one carried
  `[loadRules.swapMoreValuableWhenFull]`: load it, drop the less valuable on the ship's cell.
- `[loadRules.maxPerTurn]` = 1.
- Loaded this turn → no combat this turn `[loadRules.noCombatSameTurnIfLoaded]`.

## 9. Combat `[combat]`

If the ship ends movement **adjacent** to another player's **current position**, it may
attack. Requirements: the **target** carries ≥1 resource `[combat.targetNeedsResource]`; the
**attacker** has a free cargo slot — `carried < cargo` `[combat.attackerNeedsFreeCargo]`.
The attacker needs no resource of its own.

Sequence — strict order:

1. Attacker may play any number of **laser** boosters (+50 single only).
2. Defender may play **shield** boosters, or a **hyperspace** (auto-escape), or a
   **shield +99** (auto-repel). Either of the last two ends it with no roll.
3. Both roll `[core.dice.combat]`. Attacker wins iff
   `lasers + laserBoosters + attackRoll  >  shields + shieldBoosters + defenceRoll`
   `[combat.winTest = "strict-greater"]`. Winner takes the loser's **most valuable** carried
   resource `[combat.spoil]` onto their own ship.

- Failed attack → the defender may continue as attacker
  `[combat.counterattackOnFailedAttack]` (roles swap; repeat from step 1).
- Ends when an attack succeeds or the winning defender declines.
- `[combat.attacksPerTurn]` = 1 (one target per turn).
- Fought this turn → no load this turn.

## 10. Home base

- Reaching any base cell at the end of the movement phase → ship **at rest** automatically.
- On departure: core §5 free-departure cell applies.
- **Refuel** `[homeBase.refuel]`: `fuel = fuelMax` (all tanks green).
- **Deliver:** placing carried resources by the base — they are permanently scored and
  cannot be raided `[homeBase.deliveredResourcesSafe]`. Then take one equipment card (§7)
  and trigger seeding (§5).

## 11. Ship loss (mode additions)

On any core §8 loss: carried resources are **re-seeded** into the supply
`[shipLoss.rerollCargo]`; the ship returns at rest to its home base
`[shipLoss.returnToBaseAtRest]`.

If the supply is already empty when the loss occurs `[shipLoss.eliminateIfSupplyEmpty]`:
the player is **out** — ship removed — but keeps already-delivered resources for final
scoring. The §5 seeding target is unaffected (it uses the fixed initial player count, and
the supply is empty anyway).

## 12. End & scoring

`[endTrigger]`: every supply tile has been delivered to a home base. Each player's score is
the summed value of their delivered resources `[scoring]` (green 1, yellow 2, red 3).
Highest wins.
