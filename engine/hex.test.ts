import { describe, it, expect } from "vitest";
import {
  add,
  sub,
  scale,
  distance,
  ring,
  neighbours,
  areNeighbours,
  hex,
  hexKey,
  parseHexKey,
  spiral,
  round,
} from "./hex.js";

describe("hex math", () => {
  it("adds, subtracts, scales", () => {
    expect(add(hex(1, 2), hex(3, -1))).toEqual({ q: 4, r: 1 });
    expect(sub(hex(4, 1), hex(1, 2))).toEqual({ q: 3, r: -1 });
    expect(scale(hex(2, -1), 3)).toEqual({ q: 6, r: -3 });
  });

  it("computes cube distance", () => {
    expect(distance(hex(0, 0), hex(0, 0))).toBe(0);
    expect(distance(hex(0, 0), hex(3, 0))).toBe(3);
    expect(distance(hex(0, 0), hex(-2, 2))).toBe(2);
    expect(distance(hex(1, -3), hex(-2, 1))).toBe(4);
  });

  it("ring = distance from origin", () => {
    expect(ring(hex(0, 0))).toBe(0);
    expect(ring(hex(0, 9))).toBe(9);
    expect(ring(hex(-9, 9))).toBe(9);
  });

  it("has exactly six unique neighbours at distance 1", () => {
    const ns = neighbours(hex(0, 0));
    expect(ns).toHaveLength(6);
    expect(new Set(ns.map(hexKey)).size).toBe(6);
    for (const n of ns) expect(distance(hex(0, 0), n)).toBe(1);
    expect(areNeighbours(hex(0, 0), hex(1, 0))).toBe(true);
    expect(areNeighbours(hex(0, 0), hex(2, 0))).toBe(false);
  });

  it("key round-trips", () => {
    expect(parseHexKey(hexKey(hex(-3, 7)))).toEqual({ q: -3, r: 7 });
  });

  it("spiral(radius) has 3r^2+3r+1 cells, all within radius", () => {
    for (const radius of [0, 1, 2, 5, 11]) {
      const cells = spiral(hex(0, 0), radius);
      expect(cells).toHaveLength(3 * radius * radius + 3 * radius + 1);
      for (const c of cells) expect(ring(c)).toBeLessThanOrEqual(radius);
    }
  });

  it("round snaps fractional cube coords to a valid hex", () => {
    const r = round({ q: 0.4, r: -0.2 });
    expect(r.q + r.r + -r.q - r.r).toBe(0);
    expect(round({ q: 2, r: -1 })).toEqual({ q: 2, r: -1 });
  });
});
