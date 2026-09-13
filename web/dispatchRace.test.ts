import { describe, it, expect } from "vitest";
import { applyAction, createGame } from "../engine/index.js";
import type { Action, GameState } from "../engine/index.js";

/**
 * Regression coverage for the "prev-cell reverts after a burn" bug: useSession's dispatch
 * must always reduce against the LATEST state, never the state a stale render closed over —
 * otherwise a second dispatch fired in the same tick (a real possibility: an auto-advance
 * timer racing a manual click, react-strict-mode's double effect-invoke, ...) silently
 * discards whatever the first one just did. This doesn't render the real hook (no jsdom/RTL
 * in this project) — it isolates the exact pattern useSession.dispatch now follows and proves
 * it survives two same-tick dispatches, then proves the OLD (closure-only) pattern it replaced
 * did not.
 */
function run(s: GameState, a: Action): GameState {
  const r = applyAction(s, a);
  if (!r.ok) throw new Error(`${a.type}: ${r.error}`);
  return r.state;
}

describe("dispatch race: same-tick double dispatch must not lose an update", () => {
  function setup(): GameState {
    let s = createGame({ seed: 3, colours: ["yellow", "black"], startPlayer: 0, upgradeAtStart: "none" });
    s = run(s, { type: "drawBooster" });
    while (s.players[0]!.hand.length > 3) s = run(s, { type: "discardBooster", cardId: s.players[0]!.hand[0]!.id });
    return run(s, { type: "drift" }); // at rest -> no-op, but marks driftDone
  }

  it("a stale-closure dispatch (the old bug) drops the first action's result", () => {
    const s0 = setup();
    // simulate two "renders" each capturing s0 as `state` at render time (the bug: neither
    // sees the other's update, since neither reads from a shared, live source of truth)
    const renderAState = s0;
    const renderBState = s0;
    const afterA = run(renderAState, { type: "burn", path: [{ q: -8, r: 8 }] });
    // renderB's dispatch still reduces from the pre-burn snapshot it closed over — exactly
    // the old useSession.dispatch(a) { applyAction(state, a) } bug
    const afterB = run(renderBState, { type: "endMove" });
    // afterB "wins" (it was applied last) and has NO idea the burn ever happened — the ship
    // is right back at its pre-move pose, precisely the reported "prev reverts" symptom
    expect(afterB.players[0]!.pose.current).toEqual(s0.players[0]!.pose.current);
    expect(afterB.players[0]!.pose).not.toEqual(afterA.players[0]!.pose);
  });

  it("a ref-based dispatch (the fix) always builds on the latest result", () => {
    const s0 = setup();
    const stateRef = { current: s0 };
    function dispatch(a: Action) {
      const r = applyAction(stateRef.current, a);
      if (!r.ok) throw new Error(r.error);
      stateRef.current = r.state; // committed before the caller can fire a second dispatch
      return r.state;
    }
    const afterBurn = dispatch({ type: "burn", path: [{ q: -8, r: 8 }] });
    const afterEndMove = dispatch({ type: "endMove" }); // same-tick "second render's" dispatch
    // the burn is never lost: endMove's result still reflects the ship having actually moved
    expect(afterEndMove.players[0]!.pose.current).toEqual(afterBurn.players[0]!.pose.current);
    expect(afterEndMove.players[0]!.pose.current).not.toEqual(s0.players[0]!.pose.current);
  });
});
