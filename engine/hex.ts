/**
 * Axial hex coordinates. `q` runs one axis, `r` another; the third cube axis is
 * `s = -q - r`. The board is pointy-top but this math is orientation-independent —
 * orientation only matters when converting to pixels (renderer's job, not the engine's).
 */

export interface Hex {
  readonly q: number;
  readonly r: number;
}

export function hex(q: number, r: number): Hex {
  return { q, r };
}

export function hexEq(a: Hex, b: Hex): boolean {
  return a.q === b.q && a.r === b.r;
}

/** Stable string key for use in Map/Set. */
export function hexKey(h: Hex): string {
  return `${h.q},${h.r}`;
}

export function parseHexKey(key: string): Hex {
  const [q, r] = key.split(",").map(Number) as [number, number];
  return { q, r };
}

export function add(a: Hex, b: Hex): Hex {
  return { q: a.q + b.q, r: a.r + b.r };
}

export function sub(a: Hex, b: Hex): Hex {
  return { q: a.q - b.q, r: a.r - b.r };
}

export function scale(a: Hex, k: number): Hex {
  return { q: a.q * k, r: a.r * k };
}

/** Cube distance in hex steps. */
export function distance(a: Hex, b: Hex): number {
  const dq = a.q - b.q;
  const dr = a.r - b.r;
  const ds = -dq - dr;
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(ds)) / 2;
}

/** Distance from the origin (0,0). */
export function ring(h: Hex): number {
  return distance(h, ORIGIN);
}

export const ORIGIN: Hex = { q: 0, r: 0 };

/**
 * The six neighbour deltas, as an ordered list. The board config supplies the
 * canonical order + colour binding; this is only a fallback / sanity set.
 */
export const DIRECTIONS: readonly Hex[] = [
  { q: 1, r: 0 },
  { q: 1, r: -1 },
  { q: 0, r: -1 },
  { q: -1, r: 0 },
  { q: -1, r: 1 },
  { q: 0, r: 1 },
];

export function neighbours(h: Hex, dirs: readonly Hex[] = DIRECTIONS): Hex[] {
  return dirs.map((d) => add(h, d));
}

export function areNeighbours(a: Hex, b: Hex): boolean {
  return distance(a, b) === 1;
}

/** Linear interpolation on cube coords, then round back to a valid hex. */
export function lerp(a: Hex, b: Hex, t: number): Hex {
  return round({
    q: a.q + (b.q - a.q) * t,
    r: a.r + (b.r - a.r) * t,
  });
}

export function round(frac: Hex): Hex {
  const fs = -frac.q - frac.r;
  let q = Math.round(frac.q);
  let r = Math.round(frac.r);
  let s = Math.round(fs);
  const dq = Math.abs(q - frac.q);
  const dr = Math.abs(r - frac.r);
  const ds = Math.abs(s - fs);
  if (dq > dr && dq > ds) q = -r - s;
  else if (dr > ds) r = -q - s;
  else s = -q - r;
  return { q, r };
}

/** All hexes within `radius` steps of `center` (inclusive). */
export function spiral(center: Hex, radius: number): Hex[] {
  const out: Hex[] = [];
  for (let q = -radius; q <= radius; q++) {
    for (let r = Math.max(-radius, -q - radius); r <= Math.min(radius, -q + radius); r++) {
      out.push({ q: center.q + q, r: center.r + r });
    }
  }
  return out;
}
