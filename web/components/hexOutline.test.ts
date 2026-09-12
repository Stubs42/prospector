import { describe, it, expect } from "vitest";
import { clusterOutline, hexCorners } from "./hexOutline.js";

const SQRT3 = Math.sqrt(3);
const S = 26;
/** matches web/components/hexpx.ts's axialToPixel, without importing the engine */
function axialToPixel(q: number, r: number) {
  return { x: S * SQRT3 * (q + r / 2), y: S * 1.5 * r };
}

function loopLength(points: { x: number; y: number }[]): number {
  let d = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i]!;
    const b = points[(i + 1) % points.length]!;
    d += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return d;
}

describe("clusterOutline", () => {
  it("a single hex traces its own 6 corners", () => {
    const centre = axialToPixel(0, 0);
    const loop = clusterOutline([centre], S);
    expect(loop).toHaveLength(6);
    // every point should be a corner of the hex, within rounding
    const corners = hexCorners(centre.x, centre.y, S);
    for (const p of loop) {
      expect(corners.some((c) => Math.hypot(c.x - p.x, c.y - p.y) < 0.1)).toBe(true);
    }
  });

  it("two adjacent hexes share exactly one edge — the boundary drops from 12 to 10 points", () => {
    const centres = [axialToPixel(0, 0), axialToPixel(1, 0)];
    const loop = clusterOutline(centres, S);
    expect(loop).toHaveLength(10);
  });

  it("a real 4-cell base cluster (board.json's black base) closes into one loop with no zero-length edges", () => {
    // engine/board.json's `bases.black`
    const cells: [number, number][] = [
      [-9, 0],
      [-8, -1],
      [-9, 1],
      [-8, 0],
    ];
    const centres = cells.map(([q, r]) => axialToPixel(q, r));
    const loop = clusterOutline(centres, S);
    expect(loop.length).toBeGreaterThanOrEqual(6);
    for (let i = 0; i < loop.length; i++) {
      const a = loop[i]!;
      const b = loop[(i + 1) % loop.length]!;
      expect(Math.hypot(b.x - a.x, b.y - a.y)).toBeGreaterThan(1);
    }
    // the loop should enclose a sensible area — same order of magnitude as 4 hexes' worth
    // (shoelace formula)
    let area = 0;
    for (let i = 0; i < loop.length; i++) {
      const a = loop[i]!;
      const b = loop[(i + 1) % loop.length]!;
      area += a.x * b.y - b.x * a.y;
    }
    area = Math.abs(area) / 2;
    const oneHexArea = (3 * Math.sqrt(3) * S * S) / 2;
    expect(area).toBeGreaterThan(oneHexArea * 3);
    expect(area).toBeLessThan(oneHexArea * 5);
    expect(loopLength(loop)).toBeGreaterThan(0);
  });

  it("returns [] for an empty cluster", () => {
    expect(clusterOutline([], S)).toEqual([]);
  });
});
