import { describe, it, expect } from "vitest";
import { AUTO_HIDE } from "./useSession.js";
import { createGame, applyAction, legalActions } from "../engine/index.js";
import type { Action, GameState } from "../engine/index.js";

function run(s: GameState, a: Action): GameState {
  const r = applyAction(s, a);
  if (!r.ok) throw new Error(`${a.type}: ${r.error}`);
  return r.state;
}

/**
 * Regression coverage for "attack fired with no confirmation and no chance to pick laser
 * boosters": useSession's auto-advance timer fires the sole legal action automatically when
 * exactly one is on offer (e.g. drawing the only booster, or ending a turn with nothing else
 * to do). `attack` must never be that sole auto-fired action — starting combat is staged
 * through an attack-target click + CombatBox (booster picker) first, and skipping straight to
 * the raw engine action skips that whole flow. See web/dispatchRace.test.ts for why this
 * doesn't render the real hook (no jsdom/RTL here) — it asserts the exact set the hook filters
 * auto-fire candidates through instead.
 */
describe("auto-advance never fires a combat/voluntary action on its own", () => {
  it("excludes attack, alongside the other already-voluntary actions", () => {
    expect(AUTO_HIDE.has("attack")).toBe(true);
    expect(AUTO_HIDE.has("scrapShip")).toBe(true);
    expect(AUTO_HIDE.has("useReserveFuel")).toBe(true);
  });
});

/**
 * Regression coverage for "landed beside a carrier but was never offered attack" (endTurn)
 * and "out of fuel with a reserve-fuel card in hand but the move just ends anyway" (endMove):
 * when a deliberate-choice action (attack, useReserveFuel, ...) is legal but hidden from
 * auto-fire, a "close out this phase" action (endMove as much as endTurn) being the only
 * thing LEFT after hiding it must not fire on its own either — that throws the hidden choice
 * away just as much as auto-firing it directly would. Reimplements useSession's exact
 * soleAutoCandidate/soleClosingAction logic (see that file) against a real state, the same
 * "isolate the exact pattern, don't render the hook" approach as AUTO_HIDE above.
 */
const CLOSING_ACTIONS = new Set<Action["type"]>(["endMove", "endTurn"]);
function autoActionFor(legal: Action[], autoEndTurn: boolean): Action | null {
  const nonHidden = legal.filter((a) => !AUTO_HIDE.has(a.type));
  const soleAutoCandidate = nonHidden.length === 1 && !CLOSING_ACTIONS.has(nonHidden[0]!.type) ? nonHidden[0]! : null;
  const soleClosingAction =
    legal.length === 1 && CLOSING_ACTIONS.has(legal[0]!.type)
      ? legal[0]!.type === "endTurn"
        ? autoEndTurn
          ? legal[0]!
          : null
        : legal[0]!
      : null;
  return soleAutoCandidate ?? soleClosingAction;
}

describe("auto-advance never ends the turn while a hidden action (attack) is still on offer", () => {
  function postMoveBesideACarrier() {
    const s = createGame({ seed: 3, colours: ["black", "red"], startPlayer: 0, upgradeAtStart: "none" });
    const attacker = s.players[0]!;
    const target = s.players[1]!;
    attacker.placed = true;
    attacker.turn.moved = true;
    attacker.turn.postMoveActionTaken = null;
    target.pose = { ...attacker.pose }; // neighbour math only needs to find them adjacent below
    // put the target one hex away from the attacker (any real neighbour direction works)
    target.pose = { current: { q: attacker.pose.current.q + 1, r: attacker.pose.current.r }, previous: { q: attacker.pose.current.q + 1, r: attacker.pose.current.r }, atRest: true };
    target.cargo = ["green"];
    s.phase = "moved";
    return s;
  }

  it("with autoEndTurn OFF: no candidate at all (both attack and endTurn hidden/blocked)", () => {
    const s = postMoveBesideACarrier();
    const legal = legalActions(s);
    expect(legal.some((a) => a.type === "attack")).toBe(true);
    expect(autoActionFor(legal, false)).toBeNull();
  });

  it("with autoEndTurn ON: still does not auto-end the turn while attack is legal", () => {
    const s = postMoveBesideACarrier();
    const legal = legalActions(s);
    expect(legal.some((a) => a.type === "attack")).toBe(true);
    expect(legal.some((a) => a.type === "endTurn")).toBe(true);
    // the old (buggy) logic would have auto-fired endTurn here, since it was the only
    // candidate left once attack was filtered out of the auto-fire set
    expect(autoActionFor(legal, true)).toBeNull();
  });
});

describe("auto-advance never ends the move while a stranded player could still play reserve fuel", () => {
  it("out of fuel, holding a reserve-fuel card, no burn targets: endMove must not auto-fire", () => {
    let s = createGame({ seed: 7, colours: ["red", "black"], startPlayer: 0, upgradeAtStart: "none" });
    s.players[0]!.placed = true;
    s.players[0]!.fuel = 0;
    const card = { id: "test-fuel", deck: "booster" as const, type: "reserveFuel" as const, value: 3, effect: "" };
    s = run(s, { type: "drawBooster" });
    s.players[0]!.hand = [...s.players[0]!.hand, card];
    while (s.players[0]!.hand.length > 4) s = run(s, { type: "discardBooster", cardId: s.players[0]!.hand[0]!.id });
    s = run(s, { type: "drift" }); // reaches driftDone:true, moved:false — the reported stall point
    // a fresh ship drifts off its OWN base, which grants a free (fuel-less) departure cell —
    // irrelevant to the reported bug (a ship stranded mid-field, nowhere near home) and would
    // give it a free 1-cell burn regardless of fuel, defeating the "truly no burn targets"
    // premise this test needs
    s.players[0]!.turn.moveStartedOnOwnBase = false;
    const legal = legalActions(s);
    expect(legal.some((a) => a.type === "useReserveFuel")).toBe(true);
    expect(legal.some((a) => a.type === "endMove")).toBe(true);
    expect(legal.some((a) => a.type === "burn")).toBe(false); // confirms the premise: truly no fuel to burn with
    // the old (buggy) logic would have auto-fired endMove here — it was the only candidate
    // left once useReserveFuel was filtered out of the auto-fire set — finalizing the move
    // (and soon the turn) before the player ever got to play the card, leaving scrapping the
    // ship as the only way out
    expect(autoActionFor(legal, true)).toBeNull();
  });
});
