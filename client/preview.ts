/** Move-planning previews: where a drift lands, what a burn costs. Pure. */
import { driftTarget } from "../engine/movement.js";
import type { GameState, Hex } from "../engine/index.js";

/** Free base-departure cells still available to the active player this turn. */
export function freeBurnCells(state: GameState): number {
  const p = state.players[state.activePlayerIndex]!;
  return p.turn.moveStartedOnOwnBase
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
