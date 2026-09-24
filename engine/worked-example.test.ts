import { describe, it, expect } from "vitest";
import { createGame, applyAction } from "./game.js";
import { legalActions } from "./index.js";
import type { Action, GameState, OreColour } from "./types.js";

/**
 * The rulebook's "eight-turn run": the yellow ship (Joe, 1 engine) leaves home, coasts out
 * on accumulating velocity, picks up one resource, and brings it back to the base.
 *
 * The scan gives no exact hexes, so this is a concrete scenario over the real board that
 * exercises the same mechanics move-for-move: at-rest launch with the free departure cell,
 * drift = current + (current - previous), per-cell fuel, adjacency load, and delivery
 * (brake + refuel + equipment + reseed + score).
 */

function run(s: GameState, a: Action): GameState {
  const r = applyAction(s, a);
  if (!r.ok) throw new Error(`${a.type}: ${r.error}`);
  let next = r.state;
  // this worked example isn't testing event cards — auto-accept any that land on a filler
  // draw (every event now pauses on a choice, even a no-op "accept", since the accept-gate
  // change) so an incidental event draw doesn't block the scripted move sequence below
  while (next.pendingEventChoice) {
    const r2 = applyAction(next, { type: "resolveEventChoice", optionId: next.pendingEventChoice.options[0]!.id });
    if (!r2.ok) throw new Error(`resolveEventChoice: ${r2.error}`);
    next = r2.state;
  }
  return next;
}

/** advance a filler player's turn without moving anywhere meaningful */
function fillerTurn(s: GameState): GameState {
  s = run(s, { type: "drawBooster" });
  const p = s.players[s.activePlayerIndex]!;
  const limit = s.config.modes.prospector.ships[p.colour].booster;
  while (s.players[s.activePlayerIndex]!.hand.length > limit) {
    s = run(s, { type: "discardBooster", cardId: s.players[s.activePlayerIndex]!.hand[0]!.id });
  }
  s = run(s, { type: "drift" });
  s = run(s, { type: "endMove" });
  s = run(s, { type: "endTurn" });
  return s;
}

describe("worked example — yellow's out-and-back", () => {
  it("launches, coasts, loads a resource, and delivers it home", () => {
    // seed 1 (re-picked when the event deck became separate from the booster deck — the
    // deck-shuffle RNG draw shifts with any change to deck composition, and this scripted
    // sequence needs every intermediate assertion to hold exactly, including that no
    // incidental event card alters yellow's own fuel/cargo/equipment along the way)
    let s = createGame({ seed: 1, colours: ["yellow", "black"], startPlayer: 0, upgradeAtStart: "none" });
    // deterministic stage: clear the random seeding, keep supply for the reseed check
    s.board.resources = {};
    const Y = () => s.players[0]!;
    const startFuel = Y().fuel;
    const base = { ...Y().pose.current }; // (-9, 9)
    expect(base).toEqual({ q: -9, r: 9 });

    // --- Turn 1: at rest -> free departure cell + 1 fuel = 2 cells NE ---
    s = run(s, { type: "drawBooster" });
    while (Y().hand.length > 3) s = run(s, { type: "discardBooster", cardId: Y().hand[0]!.id });
    s = run(s, { type: "drift" });
    expect(Y().pose.current).toEqual(base); // no drift from rest
    s = run(s, { type: "burn", path: [{ q: -8, r: 8 }, { q: -7, r: 7 }] });
    expect(Y().pose.current).toEqual({ q: -7, r: 7 });
    expect(Y().pose.previous).toEqual(base);
    expect(Y().fuel).toBe(startFuel - 1); // 2 cells, 1 free
    s = run(s, { type: "endMove" });
    s = run(s, { type: "endTurn" });

    s = fillerTurn(s); // black

    // --- Turn 2: coast NE by velocity (2,-2), then burn one more ---
    expect(s.activePlayerIndex).toBe(0);
    s = run(s, { type: "drawBooster" });
    while (Y().hand.length > 3) s = run(s, { type: "discardBooster", cardId: Y().hand[0]!.id });
    s = run(s, { type: "drift" });
    expect(Y().pose.current).toEqual({ q: -5, r: 5 }); // (-7,7) + (2,-2)
    s = run(s, { type: "burn", path: [{ q: -4, r: 4 }] });
    expect(Y().pose.current).toEqual({ q: -4, r: 4 });
    expect(Y().fuel).toBe(startFuel - 2);

    // plant a resource adjacent to the ship and load it (post-move action)
    s.board.resources["-4,3"] = "green" as OreColour;
    s = run(s, { type: "endMove" });
    s = run(s, { type: "loadResource", from: { q: -4, r: 3 } });
    expect(Y().cargo).toEqual(["green"]);
    expect(s.board.resources["-4,3"]).toBeUndefined();
    s = run(s, { type: "endTurn" });

    s = fillerTurn(s); // black

    // --- Turn 3: fly home. Stage the ship one NE-step from the base corner. ---
    expect(s.activePlayerIndex).toBe(0);
    Y().pose = { current: { q: -7, r: 7 }, previous: { q: -7, r: 7 }, atRest: true };
    const supplyBefore = s.supply.green + s.supply.yellow + s.supply.red;
    s = run(s, { type: "drawBooster" });
    while (Y().hand.length > 3) s = run(s, { type: "discardBooster", cardId: Y().hand[0]!.id });
    s = run(s, { type: "drift" }); // at rest, no-op
    s = run(s, { type: "burn", path: [{ q: -8, r: 8 }] }); // onto a yellow base cell
    s = run(s, { type: "endMove" });

    // homecoming offers three upgrades — pick one
    const offer = legalActions(s).filter((a) => a.type === "chooseEquipment");
    expect(offer.length).toBe(3);
    expect(s.pendingEquipment?.playerId).toBe(0);
    s = run(s, offer[0]!);

    expect(Y().pose.atRest).toBe(true); // braked at base
    expect(Y().fuel).toBe(Y().fuelMax); // refuelled
    expect(Y().delivered).toEqual(["green"]);
    expect(Y().cargo).toEqual([]);
    expect(Y().equipment.length).toBe(1); // 1 chosen on delivery (upgradeAtStart is "none" here)
    // one tile reseeded for the one delivered (supply had plenty)
    expect(s.supply.green + s.supply.yellow + s.supply.red).toBe(supplyBefore - 1);
    expect(Object.keys(s.board.resources).length).toBe(1);
  });
});
