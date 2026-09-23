/**
 * The bridge between `legalActions` and a GUI: a structured summary of what the player can
 * do right now — click targets on the board, buttons, and the state of any fight.
 * Pure and framework-agnostic; a hot-seat client and a mobile client render the same shape.
 */
import { legalActions, statsOf, equipmentRerollEligible } from "../engine/index.js";
import { hexKey } from "../engine/hex.js";
import type { Action, GameState, Hex, PendingEquipment } from "../engine/index.js";
import { burnCost } from "./preview.js";

/** actions rendered as ordinary buttons (not board clicks, not the combat panel, not discard) */
export const PLAIN_ACTION_TYPES: readonly Action["type"][] = [
  "drawBooster",
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
  /** a pending equipment choice — either a homecoming reward or the one-time start-of-game
     upgrade (whose `mode` tells a GUI whether to auto-spin to a random pick or let the
     player choose); null when nothing is pending */
  equipmentChoice: PendingEquipment | null;
  /** true when the current equipmentChoice may be rerolled once (all 3 cards identical) */
  canRerollEquipment: boolean;
  /** true when the only progress available right now is the free "stay here" endMove — no
     real burn target is currently reachable — while a card in hand (a reserve-fuel card with
     room to use it, already reflected as its own legal `useReserveFuel`; or an unplayed
     engine card, which never appears as its own legal action since it's only ever a `burn`
     parameter) could still open up real burn targets, or even avoid losing the ship outright
     if the landing was unsafe. Covers this both once actually drifted AND before (drift is
     now folded into burn/endMove/hyperspace — see engine/index.ts's legalActions — so this
     same signal already applies pre-drift too, without needing a separate flag for that case).
     A GUI's auto-advance must never fire that endMove on its own here — the player needs a
     real chance to play the card first. (A hyperspace alternative doesn't need its own check
     here: it's always its own separate legal action, which already keeps endMove from being
     the sole thing on offer.) */
  avoidableShipLoss: boolean;
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
    // discardBooster only ever appears when over the hand limit (scrapShip may be legal
    // alongside it now, since scrapping is available throughout the move)
    overLimit: legal.some((a) => a.type === "discardBooster"),
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
    equipmentChoice: state.pendingEquipment ?? null,
    canRerollEquipment: legal.some((a) => a.type === "rerollEquipment"),
    avoidableShipLoss: (() => {
      const active = state.players[state.activePlayerIndex];
      if (!active || active.turn.moved) return false;
      // relevant whenever a move decision (a burn OR the free "stay/land here" endMove) is
      // actually on offer — NOT just when endMove is the sole option: a forced single 0-cost
      // burn (an unsafe landing with only one afforded escape) is every bit as "no real choice
      // yet" as a lone endMove would be, and an unplayed reserve-fuel/engine card could still
      // widen that same forced set into a real one — found live: a 0-fuel ship with an unused
      // reserve-fuel card auto-fired its only reachable (free) burn target before the player
      // ever got a chance to play the card and see if it opened up anything better.
      if (!legal.some((a) => a.type === "endMove" || a.type === "burn")) return false;
      if (legal.some((a) => a.type === "useReserveFuel")) return true;
      return active.hand.some((c) => c.type === "engine");
    })(),
  };
}
