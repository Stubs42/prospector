import { describe, it, expect } from "vitest";
import { decisiveCombat, winProbability } from "./combat.js";

// the actual configured dice: both sides roll 1-6, win test is "strict-greater" (attack must
// exceed defence — a tie favours the defender) — see config/default.config.json
const DICE = { attack: { faces: [1, 2, 3, 4, 5, 6] }, defence: { faces: [1, 2, 3, 4, 5, 6] } } as const;
const WIN_TEST = "strict-greater" as const;

describe("decisiveCombat (strict-greater win test)", () => {
  it("is undecided in the ordinary middle range", () => {
    expect(decisiveCombat(4, 4, DICE, WIN_TEST)).toBeNull(); // handicap 0
    expect(decisiveCombat(9, 4, DICE, WIN_TEST)).toBeNull(); // handicap +5: worst roll (1 vs 6) ties, not a win yet
    expect(decisiveCombat(1, 5, DICE, WIN_TEST)).toBeNull(); // handicap -4: best roll (6 vs 1) wins (1+6=7 > 5+1=6)
  });

  it("a handicap of +6 or more is a guaranteed win regardless of the roll", () => {
    expect(decisiveCombat(10, 4, DICE, WIN_TEST)).toBe("win"); // handicap +6: even the worst roll (attack 1, defence 6) is 11 > 10
    expect(decisiveCombat(20, 4, DICE, WIN_TEST)).toBe("win");
  });

  it("a handicap of -5 or less is a guaranteed loss regardless of the roll", () => {
    expect(decisiveCombat(0, 5, DICE, WIN_TEST)).toBe("loss"); // handicap -5: best case (6 vs 1) ties, not a win
    expect(decisiveCombat(0, 20, DICE, WIN_TEST)).toBe("loss");
  });

  it("greater-or-equal shifts both boundaries by one (a tie now favours the attacker)", () => {
    expect(decisiveCombat(9, 4, DICE, "greater-or-equal")).toBe("win"); // handicap +5: worst case ties, and a tie now wins
    expect(decisiveCombat(8, 4, DICE, "greater-or-equal")).toBeNull(); // handicap +4 is not quite enough
    expect(decisiveCombat(0, 6, DICE, "greater-or-equal")).toBe("loss"); // handicap -6: even the best case (6 vs 1) falls one short
    expect(decisiveCombat(0, 5, DICE, "greater-or-equal")).toBeNull(); // handicap -5: best case (6 vs 1) ties, and now a tie wins
  });
});

describe("winProbability", () => {
  it("handicap 0, strict-greater: only a strictly higher attack roll wins (15 of 36 pairs)", () => {
    expect(winProbability(4, 4, DICE, WIN_TEST)).toBeCloseTo(15 / 36);
  });
  it("handicap 0, greater-or-equal: a tie also wins the attacker (21 of 36 pairs)", () => {
    expect(winProbability(4, 4, DICE, "greater-or-equal")).toBeCloseTo(21 / 36);
  });
  it("is exactly 1 for a guaranteed win and exactly 0 for a guaranteed loss", () => {
    expect(winProbability(10, 4, DICE, WIN_TEST)).toBe(1); // handicap +6
    expect(winProbability(0, 5, DICE, WIN_TEST)).toBe(0); // handicap -5
  });
  it("a +1 handicap under strict-greater matches the same handicap under greater-or-equal", () => {
    // strict needs a-d > -1 i.e. a >= d; greater-or-equal at handicap 0 needs the same a >= d
    expect(winProbability(5, 4, DICE, WIN_TEST)).toBeCloseTo(winProbability(4, 4, DICE, "greater-or-equal"));
  });
});

describe("decisiveCombat is winProbability's 0/1 boundary", () => {
  it("returns null whenever winProbability is strictly between 0 and 1", () => {
    const p = winProbability(4, 4, DICE, WIN_TEST);
    expect(p).toBeGreaterThan(0);
    expect(p).toBeLessThan(1);
    expect(decisiveCombat(4, 4, DICE, WIN_TEST)).toBeNull();
  });
});
