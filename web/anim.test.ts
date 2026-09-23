import { describe, it, expect } from "vitest";
import { deriveMoveAnim, coastAnim } from "./anim.js";
import type { GameState, Hex } from "../engine/index.js";

function stateWithPose(current: Hex, previous: Hex, atRest = false): GameState {
  return {
    players: [{ pose: { current, previous, atRest } }],
    config: { core: { movement: { burnMaxCells: 3, freeBaseDepartureCells: 1 } } },
  } as unknown as GameState;
}

/**
 * Regression coverage for two live-reported bugs after the drift/burn merge (engine/game.ts's
 * ensureDrifted is now called from inside burn/endMove/hyperspace whenever driftDone is still
 * false — i.e. on almost every ordinary first click of a turn, not just via a separate "drift"
 * dispatch): a plain burn snapped with no animation at all, and the 0-cost coast target left
 * the ship visually frozen at its old spot (while the real state had already moved on) until
 * some unrelated later dispatch snapped it to the correct position.
 */
describe("deriveMoveAnim across a combined implicit-drift + burn dispatch", () => {
  it("still derives a slide when ensureDrifted rewrites `previous` before the burn moves further", () => {
    // before: ship in flight, current (0,0) previous (-1,0) — a real burn dispatch with
    // driftDone still false first drifts (previous -> old current, current -> drift target
    // (1,0)), THEN burns further to (3,0), all in one dispatch. The pose that reaches
    // deriveMoveAnim therefore has previous = (0,0) [the PRE-dispatch current], not the
    // pre-dispatch previous (-1,0) — the pattern a lone "burn" case used to require.
    const before = stateWithPose({ q: 0, r: 0 }, { q: -1, r: 0 });
    const after = stateWithPose({ q: 3, r: 0 }, { q: 0, r: 0 });
    const anim = deriveMoveAnim(before, after, 300, null);
    expect(anim).not.toBeNull();
    expect(anim!.kind).toBe("slide");
    // the tail belongs at the dispatch's true starting previous, and the ring slides from
    // the ship's actual pre-dispatch position all the way to the final burn target — not
    // through the intermediate (never-shown) drift waypoint
    expect(anim!.p0).toEqual({ q: -1, r: 0 });
    expect(anim!.c0).toEqual({ q: 0, r: 0 });
    expect(anim!.target).toEqual({ q: 3, r: 0 });
  });

  it("a bare drift (no further burn) still holds, not slides", () => {
    const before = stateWithPose({ q: 0, r: 0 }, { q: -1, r: 0 });
    const after = stateWithPose({ q: 1, r: 0 }, { q: 0, r: 0 }); // exactly the drift target
    const anim = deriveMoveAnim(before, after, 300, null);
    expect(anim).not.toBeNull();
    expect(anim!.kind).toBe("drift");
  });
});

describe("deriveMoveAnim when a burn brakes the ship to a full stop", () => {
  it("slides both dot and ring to the landing cell, instead of snapping", () => {
    // arriving exactly on the player's own base (or anywhere else that zeroes velocity)
    // collapses previous to equal the new current — engine/game.ts's atRestPose — a shape
    // that used to fall through deriveMoveAnim's other cases and snap instead of animate
    const before = stateWithPose({ q: 0, r: 0 }, { q: -1, r: 0 });
    const after = stateWithPose({ q: 2, r: 0 }, { q: 2, r: 0 }); // atRest: previous === current
    const anim = deriveMoveAnim(before, after, 300, null);
    expect(anim).not.toBeNull();
    expect(anim!.kind).toBe("slide");
    expect(anim!.p0).toEqual({ q: -1, r: 0 });
    expect(anim!.c0).toEqual({ q: 0, r: 0 });
    expect(anim!.target).toEqual({ q: 2, r: 0 });
    // the dot must converge on the SAME cell the ring lands at (both fields already equal
    // that cell in the real post-animation state) — not stop at c0, or the hand-off from the
    // tween to plain state-driven rendering would itself be a visible jump
    expect(anim!.dotTarget).toEqual({ q: 2, r: 0 });
  });

  it("still snaps for a jump too far to ever be an ordinary burn (hyperspace)", () => {
    const before = stateWithPose({ q: 0, r: 0 }, { q: -1, r: 0 });
    const after = stateWithPose({ q: 20, r: 0 }, { q: 20, r: 0 }); // far past burnMaxCells+free
    expect(deriveMoveAnim(before, after, 300, null)).toBeNull();
  });

  it("animates the dot alone when braking happens on a LATER dispatch that doesn't move the ring", () => {
    // the actual, common shape: arriveHomeBaseIfAny (engine/game.ts) is only ever called from
    // the "endMove" case, never from "burn" itself — a burn landing exactly on the player's
    // own base does NOT brake there (lands with atRest still false, an ordinary slide). The
    // real braking happens on the SEPARATE endMove dispatch that follows: it collapses
    // `previous` onto the `current` the ring already sits at, moving the ring nowhere. The
    // first attempt at this fix only covered the rarer same-dispatch case above (e.g. a
    // hyperspace-flee landing) and missed this one entirely — found live, still snapping.
    const before = stateWithPose({ q: 2, r: 0 }, { q: 1, r: 0 }, false); // just landed via burn, still in motion
    const after = stateWithPose({ q: 2, r: 0 }, { q: 2, r: 0 }, true); // endMove brakes: ring unchanged, tether collapses
    const anim = deriveMoveAnim(before, after, 300, null);
    expect(anim).not.toBeNull();
    expect(anim!.kind).toBe("slide");
    expect(anim!.p0).toEqual({ q: 1, r: 0 });
    expect(anim!.c0).toEqual({ q: 2, r: 0 });
    expect(anim!.target).toEqual({ q: 2, r: 0 }); // the ring doesn't move at all
  });
});

describe("coastAnim resolves a held drift into a real slide", () => {
  it("converts a 'drift' hold into a 'slide' ending at the same target", () => {
    const held = deriveMoveAnim(
      stateWithPose({ q: 0, r: 0 }, { q: -1, r: 0 }),
      stateWithPose({ q: 1, r: 0 }, { q: 0, r: 0 }),
      300,
      null,
    )!;
    expect(held.kind).toBe("drift");
    const resolved = coastAnim(held);
    expect(resolved.kind).toBe("slide");
    expect(resolved.target).toEqual(held.target);
    expect(resolved.p0).toEqual(held.p0);
    expect(resolved.c0).toEqual(held.c0);
  });
});
