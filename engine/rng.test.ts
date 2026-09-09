import { describe, it, expect } from "vitest";
import { makeRng } from "./rng.js";

describe("rng", () => {
  it("is deterministic for a given seed", () => {
    const a = makeRng(42);
    const b = makeRng(42);
    const seqA = Array.from({ length: 20 }, () => a.next());
    const seqB = Array.from({ length: 20 }, () => b.next());
    expect(seqA).toEqual(seqB);
  });

  it("different seeds diverge", () => {
    const a = makeRng(1);
    const b = makeRng(2);
    expect(a.next()).not.toBe(b.next());
  });

  it("die(6) stays in 1..6 and covers every face", () => {
    const r = makeRng(7);
    const seen = new Set<number>();
    for (let i = 0; i < 2000; i++) {
      const v = r.die(6);
      expect(v).toBeGreaterThanOrEqual(1);
      expect(v).toBeLessThanOrEqual(6);
      seen.add(v);
    }
    expect(seen.size).toBe(6);
  });

  it("shuffle is a permutation and does not mutate input", () => {
    const src = [1, 2, 3, 4, 5, 6, 7, 8];
    const r = makeRng(99);
    const out = r.shuffle(src);
    expect(out).toHaveLength(src.length);
    expect(out.slice().sort((a, b) => a - b)).toEqual(src);
    expect(src).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it("int(min,max) is inclusive on both ends", () => {
    const r = makeRng(3);
    let lo = false;
    let hi = false;
    for (let i = 0; i < 500; i++) {
      const v = r.int(5, 8);
      expect(v).toBeGreaterThanOrEqual(5);
      expect(v).toBeLessThanOrEqual(8);
      if (v === 5) lo = true;
      if (v === 8) hi = true;
    }
    expect(lo && hi).toBe(true);
  });
});
