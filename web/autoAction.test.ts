import { describe, it, expect } from "vitest";
import { AUTO_HIDE } from "./useSession.js";
import { createGame, legalActions } from "../engine/index.js";
import type { Action } from "../engine/index.js";

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
 * Regression coverage for "landed beside a carrier but was never offered attack": when
 * `attack` is legal but hidden from auto-fire, `endTurn` being the only thing LEFT after
 * hiding it must not make the turn end on its own either — that throws the attack choice
 * away just as much as auto-firing it would. Reimplements useSession's exact
 * soleAutoCandidate/soleEndTurn logic (see that file) against a real post-move state, the
 * same "isolate the exact pattern, don't render the hook" approach as AUTO_HIDE above.
 */
function autoActionFor(legal: Action[], autoEndTurn: boolean): Action | null {
  const nonHidden = legal.filter((a) => !AUTO_HIDE.has(a.type));
  const soleAutoCandidate = nonHidden.length === 1 && nonHidden[0]!.type !== "endTurn" ? nonHidden[0]! : null;
  const soleEndTurn = autoEndTurn && legal.length === 1 && legal[0]!.type === "endTurn" ? legal[0]! : null;
  return soleAutoCandidate ?? soleEndTurn;
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
