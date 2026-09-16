import { describe, it, expect, vi, beforeEach } from "vitest";
import { logPose, resetPoseLog } from "./poseLog.js";
import type { GameState } from "../engine/index.js";

/**
 * Regression coverage for the continuity assertion added after manual log inspection turned
 * out not to help (see poseLog.ts's own header): every dispatch's `after` and the NEXT
 * dispatch's `before` are meant to be the same evolving state — this proves the assertion
 * actually fires when that's violated, and stays quiet when it isn't, without needing a real
 * GameState (logPose only ever reads .activePlayerIndex and .players[].pose).
 */
function fakeState(activePlayerIndex: number, poses: { current: { q: number; r: number }; previous: { q: number; r: number }; atRest: boolean }[]): GameState {
  return {
    activePlayerIndex,
    players: poses.map((pose, id) => ({ id, pose })),
  } as unknown as GameState;
}

describe("poseLog continuity assertion", () => {
  beforeEach(() => {
    resetPoseLog();
    vi.restoreAllMocks();
  });

  it("stays quiet across a normal dispatch chain (after_n === before_n+1)", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const s0 = fakeState(0, [{ current: { q: 0, r: 0 }, previous: { q: 0, r: 0 }, atRest: true }]);
    const s1 = fakeState(0, [{ current: { q: 1, r: 0 }, previous: { q: 0, r: 0 }, atRest: false }]);
    const s2 = fakeState(0, [{ current: { q: 2, r: 0 }, previous: { q: 1, r: 0 }, atRest: false }]);
    logPose("dispatch", "burn", s0, s1);
    logPose("dispatch", "burn", s1, s2); // s1 here === the previous call's `after`
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("fires when a dispatch's before doesn't match the previous dispatch's after", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const s0 = fakeState(0, [{ current: { q: 0, r: 0 }, previous: { q: 0, r: 0 }, atRest: true }]);
    const s1 = fakeState(0, [{ current: { q: 1, r: 0 }, previous: { q: 0, r: 0 }, atRest: false }]);
    // stale: built from s0 again instead of s1 — exactly the stale-closure double-dispatch
    // shape this is meant to catch (a second dispatch reducing from an already-superseded
    // state instead of the real latest one)
    const staleNext = fakeState(0, [{ current: { q: 0, r: 0 }, previous: { q: 0, r: 0 }, atRest: true }]);
    logPose("dispatch", "burn", s0, s1);
    logPose("dispatch", "endMove", s0, staleNext); // should have started from s1, not s0
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0]![0]).toContain("CONTINUITY BREAK");
  });

  it("resetPoseLog clears the baseline so a fresh game doesn't false-positive", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const oldGameEnd = fakeState(0, [{ current: { q: 5, r: 5 }, previous: { q: 4, r: 4 }, atRest: false }]);
    const oldGameNext = fakeState(0, [{ current: { q: 6, r: 5 }, previous: { q: 5, r: 5 }, atRest: false }]);
    logPose("dispatch", "burn", oldGameEnd, oldGameNext); // establishes a baseline for the old game
    resetPoseLog(); // a brand new game starts — that baseline no longer applies
    const freshGame = fakeState(0, [{ current: { q: 0, r: 0 }, previous: { q: 0, r: 0 }, atRest: true }]);
    const freshNext = fakeState(0, [{ current: { q: 1, r: 0 }, previous: { q: 0, r: 0 }, atRest: false }]);
    logPose("dispatch", "burn", freshGame, freshNext); // no prior baseline post-reset — nothing to compare
    expect(errorSpy).not.toHaveBeenCalled();
  });
});
