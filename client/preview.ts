/** Move-planning previews: where a drift lands, what a burn costs. Pure. */
import { driftTarget } from "../engine/movement.js";
import { boardFor } from "../engine/index.js";
import type { GameState, Hex } from "../engine/index.js";

/** Free base-departure cells still available to the active player this turn. */
export function freeBurnCells(state: GameState): number {
  const p = state.players[state.activePlayerIndex]!;
  // pre-drift, `moveStartedOnOwnBase` is still false — it's only a real side effect of
  // ensureDrifted (engine/game.ts), which hasn't run for real yet. Speculate it the same way
  // engine/index.ts's legalActions does, or every burn target's displayed cost is wrong for
  // the whole pre-drift decision window (almost every turn, now that drift/burn are one
  // decision) — found live: a genuinely free 1-cell departure burn was shown costing 1 fuel.
  const moveStartedOnOwnBase = p.turn.driftDone
    ? p.turn.moveStartedOnOwnBase
    : boardFor(state).baseOwnerAt(p.pose.current) === p.homeBase;
  return moveStartedOnOwnBase
    ? Math.max(0, state.config.core.movement.freeBaseDepartureCells - p.turn.freeBurnCellsUsed)
    : 0;
}

/** Fuel a burn of `steps` cells would cost the active player (free cells discounted). */
export function burnCost(state: GameState, steps: number): number {
  const free = freeBurnCells(state);
  return Math.max(0, steps - Math.min(steps, free));
}

/**
 * Where the active ship will coast to if it drifts now — only meaningful for a ship that
 * is actually moving (an at-rest ship's drift is a no-op).
 */
export function driftPreview(state: GameState): { at: Hex; from: Hex } | null {
  const p = state.players[state.activePlayerIndex]!;
  if (p.pose.atRest) return null;
  return { at: driftTarget(p.pose), from: p.pose.current };
}
