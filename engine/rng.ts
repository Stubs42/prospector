/**
 * Deterministic RNG so games and simulations replay exactly. Mulberry32 —
 * tiny, fast, good enough for dice and shuffles. Never use Math.random in the engine.
 */

export interface Rng {
  /** float in [0, 1) */
  next(): number;
  /** integer in [min, max] inclusive */
  int(min: number, max: number): number;
  /** roll an n-sided die: 1..n */
  die(sides: number): number;
  /** pick one element */
  pick<T>(items: readonly T[]): T;
  /** Fisher–Yates copy */
  shuffle<T>(items: readonly T[]): T[];
  /** opaque state for snapshotting */
  state(): number;
}

export function makeRng(seed: number): Rng {
  let s = seed >>> 0;

  const next = (): number => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const int = (min: number, max: number): number => min + Math.floor(next() * (max - min + 1));

  const rng: Rng = {
    next,
    int,
    die: (sides) => int(1, sides),
    pick: (items) => {
      if (items.length === 0) throw new Error("pick from empty list");
      return items[int(0, items.length - 1)]!;
    },
    shuffle: (items) => {
      const a = items.slice();
      for (let i = a.length - 1; i > 0; i--) {
        const j = int(0, i);
        [a[i], a[j]] = [a[j]!, a[i]!];
      }
      return a;
    },
    state: () => s,
  };
  return rng;
}
