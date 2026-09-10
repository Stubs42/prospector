/**
 * The bridge between `legalActions` and a GUI: a structured summary of what the player can
 * do right now — click targets on the board, buttons, and the state of any fight.
 * Pure and framework-agnostic; a hot-seat client and a mobile client render the same shape.
 */
import { legalActions, statsOf } from "../engine/index.js";
import { hexKey } from "../engine/hex.js";
import type { Action, GameState, Hex } from "../engine/index.js";
import { burnCost } from "./preview.js";

/** actions rendered as ordinary buttons (not board clicks, not the combat panel, not discard) */
export const PLAIN_ACTION_TYPES: readonly Action["type"][] = [
  "drawBooster",
  "drift",
  "endMove",
  "endTurn",
  "scrapShip",
];

export interface BurnTarget {
  cell: Hex;
  cost: number;
  path: Hex[];
}

export interface CombatView {
  attackerId: number;
  defenderId: number;
  round: number;
  awaiting: "defend" | "resolve" | "counter";
  attackLasers: number;
  defenceShields: number;
}

export interface Affordances {
  legal: Action[];
  /** the player must discard down to the booster hand limit before anything else */
  overLimit: boolean;
  /** launch: base cells the player may start from */
  placeCells: Hex[];
  loadCells: Hex[];
  /** every reachable burn destination, deduped to its shortest (cheapest) path */
  burnTargets: BurnTarget[];
  attackTargetIds: number[];
  plainActions: Action[];
  /** the counter-attack option offered to a victorious defender */
  counterAttack: Extract<Action, { type: "attack" }> | null;
  combat: CombatView | null;
}

export interface AffordanceOpts {
  extraEngines?: number;
  extraFuel?: number;
}

export function affordances(state: GameState, opts: AffordanceOpts = {}): Affordances {
  const legal = legalActions(state, opts);
  const pc = state.pendingCombat;

  const burnByCell = new Map<string, Extract<Action, { type: "burn" }>>();
  for (const a of legal) {
    if (a.type !== "burn") continue;
    const k = hexKey(a.path[a.path.length - 1]!);
    const prev = burnByCell.get(k);
    if (!prev || a.path.length < prev.path.length) burnByCell.set(k, a);
  }

  const combat: CombatView | null = pc
    ? {
        attackerId: pc.attackerId,
        defenderId: pc.defenderId,
        round: pc.round,
        awaiting: pc.awaiting,
        attackLasers: statsOf(state, state.players[pc.attackerId]!).lasers + pc.attackerLaserBoost,
        defenceShields: pc.defShields ?? statsOf(state, state.players[pc.defenderId]!).shields,
      }
    : null;

  return {
    legal,
    overLimit: legal.length > 0 && legal.every((a) => a.type === "discardBooster"),
    placeCells: legal.flatMap((a) => (a.type === "placeShip" ? [a.cell] : [])),
    loadCells: legal.flatMap((a) => (a.type === "loadResource" ? [a.from] : [])),
    burnTargets: [...burnByCell.values()].map((a) => ({
      cell: a.path[a.path.length - 1]!,
      cost: burnCost(state, a.path.length),
      path: a.path,
    })),
    attackTargetIds: legal.flatMap((a) => (a.type === "attack" ? [a.targetPlayerId] : [])),
    plainActions: legal.filter((a) => PLAIN_ACTION_TYPES.includes(a.type)),
    counterAttack:
      pc?.awaiting === "counter"
        ? ((legal.find((a) => a.type === "attack") as Extract<Action, { type: "attack" }>) ?? null)
        : null,
    combat,
  };
}
