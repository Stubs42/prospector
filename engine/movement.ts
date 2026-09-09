import { type Hex, add, sub, hexEq, areNeighbours } from "./hex.js";
import type { BoardModel } from "./board.js";
import type { ShipPose } from "./types.js";

export const atRestPose = (at: Hex): ShipPose => ({ current: at, previous: at, atRest: true });

export const velocity = (p: ShipPose): Hex => sub(p.current, p.previous);

/** The cell a coasting ship arrives at: current + (current - previous). */
export const driftTarget = (p: ShipPose): Hex => add(p.current, velocity(p));

export interface DriftResult {
  pose: ShipPose;
  landed: Hex;
  /** left the outer field entirely — ship is lost regardless of any burn */
  offField: boolean;
  /** did not settle on a free inner cell — the burn phase is now mandatory */
  needsBurn: boolean;
}

/**
 * Drift phase. An at-rest ship skips it (returns unchanged). Otherwise the top cone of the
 * current position is carried forward by the velocity vector; the old current becomes the
 * new previous.
 */
export function drift(
  pose: ShipPose,
  board: BoardModel,
  isFreeAt: (h: Hex) => boolean,
): DriftResult {
  if (pose.atRest) {
    return { pose, landed: pose.current, offField: false, needsBurn: false };
  }
  const target = driftTarget(pose);
  const offField = board.offField(target);
  const nextPose: ShipPose = { current: target, previous: pose.current, atRest: false };
  const needsBurn = !offField && !(board.isInner(target) && isFreeAt(target));
  return { pose: nextPose, landed: target, offField, needsBurn };
}

export interface BurnOptions {
  /** engine rating + any engine-boost this turn */
  maxCells: number;
  /** hard cap from core.movement.burnMaxCells */
  hardCap: number;
  /** fuel points the player can spend */
  fuelAvailable: number;
  /** free base-departure cells still available this turn */
  freeCells: number;
}

export interface BurnResult {
  ok: boolean;
  error?: string;
  pose?: ShipPose;
  fuelSpent?: number;
  freeUsed?: number;
}

/**
 * Burn phase. `path` is the ordered list of cells the current position moves through,
 * NOT including the starting cell. Moving the current position leaves the previous cone
 * in place, so this both accelerates and steers.
 */
export function burn(
  pose: ShipPose,
  path: readonly Hex[],
  board: BoardModel,
  isFreeAt: (h: Hex) => boolean,
  opts: BurnOptions,
): BurnResult {
  const cells = path.length;
  if (cells === 0) {
    return { ok: true, pose, fuelSpent: 0, freeUsed: 0 };
  }

  // engine + boosters bound the fuel-burned portion; free base-departure cells add on top.
  const freeAvail = Math.max(0, opts.freeCells);
  const engineCap = Math.min(opts.maxCells, opts.hardCap);
  const cap = engineCap + freeAvail;
  if (cells > cap) return { ok: false, error: `burn of ${cells} exceeds cap ${cap}` };

  // The burn may turn — the path is any chain of adjacent cells, each a free inner-field
  // cell — not necessarily a straight line.
  let prev = pose.current;
  for (const step of path) {
    if (!areNeighbours(prev, step)) {
      return { ok: false, error: "burn path is not a chain of adjacent cells" };
    }
    if (!board.isInner(step) || !isFreeAt(step)) {
      return { ok: false, error: `burn passes through blocked cell ${step.q},${step.r}` };
    }
    prev = step;
  }

  const freeUsed = Math.min(cells, freeAvail);
  const fuelSpent = cells - freeUsed;
  if (fuelSpent > opts.fuelAvailable) {
    return { ok: false, error: `burn needs ${fuelSpent} fuel, have ${opts.fuelAvailable}` };
  }

  return {
    ok: true,
    pose: { current: path[cells - 1]!, previous: pose.previous, atRest: false },
    fuelSpent,
    freeUsed,
  };
}

/** Hyperspace landing: placed at rest on `target`; lost if `target` is not a free field cell. */
export function hyperspaceLand(
  target: Hex,
  board: BoardModel,
  isFreeAt: (h: Hex) => boolean,
): { pose: ShipPose; lost: boolean } {
  const ok = board.onField(target) && isFreeAt(target);
  return ok ? { pose: atRestPose(target), lost: false } : { pose: atRestPose(target), lost: true };
}

/** Convenience: is `b` reachable from `a` by exactly `n` single steps in a straight line? */
export function straightPath(a: Hex, dir: Hex, n: number): Hex[] {
  const out: Hex[] = [];
  let cur = a;
  for (let i = 0; i < n; i++) {
    cur = add(cur, dir);
    out.push(cur);
  }
  return out;
}

export { hexEq };
