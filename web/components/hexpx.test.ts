import { describe, it, expect } from "vitest";
import { axialToPixel, rotatePoint } from "./hexpx.js";

function near(a: number, b: number, eps = 1e-6) {
  return Math.abs(a - b) < eps;
}

describe("rotatePoint", () => {
  it("0 and 6 steps are no-ops", () => {
    expect(rotatePoint(12, -34, 0)).toEqual({ x: 12, y: -34 });
    const r6 = rotatePoint(12, -34, 6);
    expect(near(r6.x, 12)).toBe(true);
    expect(near(r6.y, -34)).toBe(true);
  });

  it("preserves distance from the origin at every step", () => {
    const mag = Math.hypot(50, -20);
    for (let k = 0; k < 6; k++) {
      const p = rotatePoint(50, -20, k);
      expect(near(Math.hypot(p.x, p.y), mag)).toBe(true);
    }
  });

  it("6 steps of 1 return to the start (full turn)", () => {
    let p = { x: 17, y: 4 };
    for (let i = 0; i < 6; i++) p = rotatePoint(p.x, p.y, 1);
    expect(near(p.x, 17)).toBe(true);
    expect(near(p.y, 4)).toBe(true);
  });

  it("3 steps is a half-turn (negation)", () => {
    const p = rotatePoint(9, -5, 3);
    expect(near(p.x, -9)).toBe(true);
    expect(near(p.y, 5)).toBe(true);
  });

  it("negative steps wrap the same as their positive equivalent", () => {
    const a = rotatePoint(30, 10, -1);
    const b = rotatePoint(30, 10, 5);
    expect(near(a.x, b.x)).toBe(true);
    expect(near(a.y, b.y)).toBe(true);
  });
});

describe("axialToPixel with rotation", () => {
  it("a full 6-step turn lands every base-region hex back on its own pixel position", () => {
    // board/board.json's black base cells, real coordinates already used elsewhere this session
    const cells = [
      { q: -9, r: 0 },
      { q: -8, r: -1 },
      { q: -9, r: 1 },
      { q: -8, r: 0 },
    ];
    for (const h of cells) {
      const original = axialToPixel(h);
      let p = original;
      for (let i = 0; i < 6; i++) p = rotatePoint(p.x, p.y, 1);
      expect(near(p.x, original.x, 1e-6)).toBe(true);
      expect(near(p.y, original.y, 1e-6)).toBe(true);
    }
  });

  it("rotation fixes the origin", () => {
    for (let k = 0; k < 6; k++) {
      const p = axialToPixel({ q: 0, r: 0 }, k);
      expect(near(p.x, 0)).toBe(true);
      expect(near(p.y, 0)).toBe(true);
    }
  });
});
