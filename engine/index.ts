import { type Hex, add, hexKey, hexEq, areNeighbours, distance, parseHexKey } from "./hex.js";
import { makeRng, type Rng } from "./rng.js";
import {
  createGame,
  applyAction,
  boardFor,
  statsOf,
  score,
  provideGameData,
  setupLegalActions,
  type CreateGameOptions,
} from "./game.js";
import { movementInputs } from "./ship.js";
import type { Action, GameState, PlayerState } from "./types.js";

export { createGame, applyAction, score, statsOf, boardFor, provideGameData };
export type { Hex } from "./hex.js";
export type { GameState, Action, PlayerState, CreateGameOptions };
export * from "./types.js";

// ---------------------------------------------------------------------------
// legal actions — enough for a bot to always have a move and reach game end
// ---------------------------------------------------------------------------

const DIR_KEYS: Hex[] = [
  { q: 1, r: 0 },
  { q: 1, r: -1 },
  { q: 0, r: -1 },
  { q: -1, r: 0 },
  { q: -1, r: 1 },
  { q: 0, r: 1 },
];


export interface LegalOpts {
  /** engine-booster value the player intends to arm this burn (widens the reachable disc) */
  extraEngines?: number;
  /** reserve-fuel-booster value the player intends to arm (raises the affordable range) */
  extraFuel?: number;
}

export function legalActions(state: GameState, opts?: LegalOpts): Action[] {
  if (state.setup) return setupLegalActions(state);
  if (state.gameOver) return [];
  const board = boardFor(state);
  const p = state.players[state.activePlayerIndex]!;
  const mode = state.config.modes.prospector;
  const pc = state.pendingCombat;

  if (pc) {
    if (pc.awaiting === "defend") return [{ type: "combatDefend" }];
    if (pc.awaiting === "resolve") return [{ type: "combatResolve" }];
    // awaiting counter: the victorious defender may attack back, or decline
    const out2: Action[] = [{ type: "declineCounter" }];
    const defender = state.players[pc.defenderId]!;
    const orig = state.players[pc.attackerId]!;
    const attCap = statsOf(state, defender).cargo;
    if (
      !orig.eliminated &&
      areNeighbours(defender.pose.current, orig.pose.current) &&
      orig.cargo.length >= (mode.combat.targetNeedsResource ? 1 : 0) &&
      defender.cargo.length < attCap
    ) {
      out2.push({ type: "attack", targetPlayerId: pc.attackerId });
    }
    return out2;
  }

  if (state.pendingEquipment) {
    return state.pendingEquipment.cards.map((c) => ({ type: "chooseEquipment", cardId: c.id }));
  }

  const out: Action[] = [];
  const resources = new Set(Object.keys(state.board.resources));
  const otherCurrents = state.players
    .filter((o) => !o.eliminated && o.id !== p.id)
    .map((o) => o.pose.current);
  const isFree = (h: Hex): boolean => {
    if (board.offField(h)) return false;
    if (resources.has(hexKey(h))) return false;
    return !otherCurrents.some((c) => hexEq(c, h));
  };

  if (state.phase === "start") {
    if (!p.turn.boosterDrawn && !p.placed) {
      // all four base cells are genuine choices — the ship isn't shown anywhere until one is picked
      for (const c of board.baseCells(p.homeBase)) out.push({ type: "placeShip", cell: c });
    }
    // voluntary scrap is available any time during the move, once the ship is launched
    if (p.placed && state.config.core.turn.allowScrapBeforeDraw) out.push({ type: "scrapShip" });
    // a reserve-fuel card can be played the instant it's useful — any time before this
    // turn's move is settled, not staged/armed like an engine booster
    if (p.placed && !p.turn.moved && p.fuel < p.fuelMax) {
      for (const c of p.hand) if (c.type === "reserveFuel") out.push({ type: "useReserveFuel", cardId: c.id });
    }

    if (!p.turn.boosterDrawn) {
      out.push({ type: "drawBooster" });
      return out;
    }
    if (p.hand.length > statsOf(state, p).booster) {
      for (const c of p.hand) out.push({ type: "discardBooster", cardId: c.id });
      return out;
    }
    if (!p.turn.driftDone) {
      out.push({ type: "drift" });
      return out;
    }
    if (!p.turn.moved) {
      const cap = movementInputs(statsOf(state, p), mode).burnCap + Math.max(0, opts?.extraEngines ?? 0);
      const freeCells = Math.max(
        0,
        p.turn.moveStartedOnOwnBase
          ? state.config.core.movement.freeBaseDepartureCells - p.turn.freeBurnCellsUsed
          : 0,
      );
      const hardCap = state.config.core.movement.burnMaxCells;
      const stepBudget = Math.min(cap, hardCap) + freeCells;
      const fuelBudget = Math.min(p.fuel + Math.max(0, opts?.extraFuel ?? 0), p.fuelMax);

      // A burn may turn. BFS over inner cells for the shortest (= cheapest) path to each;
      // it flies OVER other ships, so they don't block the path — only the destination
      // must be a clear cell. Resources and the field edge still wall it off.
      const startKey = hexKey(p.pose.current);
      const depth = new Map<string, number>([[startKey, 0]]);
      const parent = new Map<string, Hex>();
      const queue: Hex[] = [p.pose.current];
      for (let qi = 0; qi < queue.length; qi++) {
        const cell = queue[qi]!;
        const d = depth.get(hexKey(cell))!;
        if (d >= stepBudget) continue;
        for (const nb of board.neighbours(cell)) {
          const k = hexKey(nb);
          if (depth.has(k) || !board.isInner(nb) || resources.has(k)) continue;
          depth.set(k, d + 1);
          parent.set(k, cell);
          queue.push(nb);
        }
      }
      for (const [k, d] of depth) {
        if (d === 0) continue;
        if (d - Math.min(d, freeCells) > fuelBudget) continue; // can't fuel it
        if (!isFree(parseHexKey(k))) continue; // can't come to rest on another ship
        const path: Hex[] = [];
        for (let node: Hex | undefined = parseHexKey(k); node && hexKey(node) !== startKey; node = parent.get(hexKey(node))) {
          path.unshift(node);
        }
        out.push({ type: "burn", path });
      }
      // endMove is legal when the move settled cleanly, OR as the "ship lost" escape when a
      // mandatory burn cannot be afforded / reached.
      if (!p.turn.mustBurn || !out.some((a) => a.type === "burn")) out.push({ type: "endMove" });
      return out;
    }
    out.push({ type: "endMove" });
    return out;
  }

  // phase "moved"
  if (!p.turn.postMoveActionTaken) {
    const cargoCap = statsOf(state, p).cargo;
    const values = mode.resources.values;
    const weakest = p.cargo.length
      ? [...p.cargo].sort((a, b) => values[a] - values[b])[0]!
      : null;
    for (const d of DIR_KEYS) {
      const from = add(p.pose.current, d);
      const colour = state.board.resources[hexKey(from)];
      if (!colour) continue;
      const canLoad =
        p.cargo.length < cargoCap ||
        (mode.loadRules.swapMoreValuableWhenFull && weakest !== null && values[colour] > values[weakest]);
      if (canLoad) out.push({ type: "loadResource", from });
    }
    const attCap = statsOf(state, p).cargo;
    if (p.cargo.length < attCap) {
      for (const o of state.players) {
        if (o.eliminated || o.id === p.id) continue;
        if (o.cargo.length >= 1 && areNeighbours(p.pose.current, o.pose.current)) {
          out.push({ type: "attack", targetPlayerId: o.id });
        }
      }
    }
  }
  out.push({ type: "endTurn" });
  return out;
}

// ---------------------------------------------------------------------------
// bots
// ---------------------------------------------------------------------------

export type Bot = (state: GameState, rng: Rng) => Action;

export const randomBot: Bot = (state, rng) => {
  const acts = legalActions(state);
  return rng.pick(acts);
};

/**
 * A competent-but-simple heuristic: hunt the nearest resource, and once loaded (or low on
 * fuel) head home to deliver. Aims each burn to end adjacent to a resource (to load) or on
 * a base cell (to deliver + brake), while damping leftover velocity so it can stop. Never
 * starts combat.
 */
export const greedyBot: Bot = (state, rng) => {
  const acts = legalActions(state);
  const p = state.players[state.activePlayerIndex]!;
  const board = boardFor(state);
  const byType = (t: Action["type"]) => acts.filter((a) => a.type === t);

  // homecoming upgrade pick: take the biggest bump, avoiding a stat already at its cap
  const eq = byType("chooseEquipment") as Extract<Action, { type: "chooseEquipment" }>[];
  if (eq.length && state.pendingEquipment) {
    const caps = state.config.modes.prospector.upgradeCaps;
    const cur = statsOf(state, p);
    const cardOf = (id: string) => state.pendingEquipment!.cards.find((c) => c.id === id)!;
    const worth = (id: string) => {
      const c = cardOf(id);
      const cap = caps[c.stat];
      const room = cap === undefined ? c.amount : Math.max(0, cap - cur[c.stat]);
      return Math.min(c.amount, room);
    };
    return eq.reduce((b, a) => (worth(a.cardId) > worth(b.cardId) ? a : b));
  }

  const carrying = p.cargo.length > 0;
  const onOwnBase = board.baseOwnerAt(p.pose.current) === p.homeBase;
  const stranded =
    p.pose.atRest && p.fuel === 0 && !onOwnBase && !p.hand.some((c) => c.type === "reserveFuel");

  // give up a hopelessly stranded, empty ship — it refits at base
  if (byType("scrapShip").length && !carrying && stranded) return { type: "scrapShip" };
  const draw = byType("drawBooster")[0];
  if (draw) return draw;

  const disc = byType("discardBooster") as Extract<Action, { type: "discardBooster" }>[];
  if (disc.length) {
    // drop combat/hyperspace cards before movement helpers
    const rank = (id: string): number => {
      const c = p.hand.find((h) => h.id === id)!;
      return c.type === "shield" || c.type === "laser" ? 0 : c.type === "hyperspace" ? 1 : 2;
    };
    return disc.reduce((b, a) => (rank(a.cardId) < rank(b.cardId) ? a : b));
  }

  const drift = byType("drift")[0];
  if (drift) return drift;

  // head home as soon as anything is aboard, or when fuel is getting low
  const goHome = carrying || p.fuel <= 3;
  const reserveFuelIds =
    p.fuel <= 3 ? p.hand.filter((c) => c.type === "reserveFuel").map((c) => c.id) : [];

  const baseCells = board.baseCells(p.homeBase);
  const baseKeys = new Set(baseCells.map(hexKey));
  const home = baseCells[0]!;
  const resourceCells = Object.keys(state.board.resources).map(parseHexKey);
  const targets = goHome ? baseCells : resourceCells;
  // when hunting, lock onto the resource nearest HOME (a fixed reference) so the target
  // doesn't flip as the ship drifts between two roughly-equidistant tiles
  const anchor = goHome ? p.pose.current : home;
  const nearest = (): Hex | null =>
    targets.length
      ? targets.reduce((b, g) => {
          const dg = distance(anchor, g) * 100 + Math.abs(g.q) + Math.abs(g.r);
          const db = distance(anchor, b) * 100 + Math.abs(b.q) + Math.abs(b.r);
          return dg < db ? g : b;
        })
      : null;

  const burns = byType("burn") as Extract<Action, { type: "burn" }>[];
  const endMove = byType("endMove")[0];

  const resourceSet = new Set(Object.keys(state.board.resources));
  const otherShips = state.players.filter((o) => !o.eliminated && o.id !== p.id).map((o) => o.pose.current);
  const free = (h: Hex) =>
    !board.offField(h) && !resourceSet.has(hexKey(h)) && !otherShips.some((c) => hexEq(c, h));

  const withFuel = <T extends Action>(a: T): T =>
    a.type === "burn" && reserveFuelIds.length ? { ...a, reserveFuelBoosters: reserveFuelIds } : a;

  if (burns.length || endMove) {
    const goal = nearest();
    const scoreDest = (dest: Hex): number => {
      if (goHome && baseKeys.has(hexKey(dest))) return -1000; // land on base: deliver + brake
      if (!goHome && board.neighbours(dest).some((n) => state.board.resources[hexKey(n)])) {
        return -100; // end adjacent to a resource: can load this turn
      }
      const d = goal ? distance(dest, goal) : 0;
      const speed = distance(dest, p.pose.previous); // leftover velocity after this move
      const runaway = board.isOuter(dest) ? 40 : 0; // don't coast into the outer ring
      // progress first, but always keep some brake pressure so it can actually stop —
      // then brake hard once we're basically there
      return d * 6 + speed * 2 + (d <= 3 ? speed * 4 : 0) + runaway;
    };
    type Opt = { action: Action; score: number };
    const opts: Opt[] = burns.map((a) => ({ action: a, score: scoreDest(a.path[a.path.length - 1]!) }));
    if (endMove) opts.push({ action: endMove, score: scoreDest(p.pose.current) });
    if (opts.length) return withFuel(opts.reduce((b, o) => (o.score < b.score ? o : b)).action);
  }

  // out of fuel but holding a reserve-fuel booster: hand-build a 1-step burn that plays it
  if (reserveFuelIds.length && p.turn.driftDone && !p.turn.moved && state.phase === "start") {
    const goal = nearest();
    let best: Hex | null = null;
    for (const d of DIR_KEYS) {
      const step = add(p.pose.current, d);
      if (!board.isInner(step) || !free(step)) continue;
      if (!best || (goal && distance(step, goal) < distance(best, goal))) best = step;
    }
    if (best) return { type: "burn", path: [best], reserveFuelBoosters: reserveFuelIds };
  }

  const loads = byType("loadResource") as Extract<Action, { type: "loadResource" }>[];
  if (loads.length) {
    const values = state.config.modes.prospector.resources.values;
    return loads.reduce((b, a) =>
      values[state.board.resources[hexKey(a.from)]!]! > values[state.board.resources[hexKey(b.from)]!]! ? a : b,
    );
  }
  return byType("endTurn")[0] ?? rng.pick(acts);
};

// ---------------------------------------------------------------------------
// simulate
// ---------------------------------------------------------------------------

export interface SimSummary {
  games: number;
  /** reached the real end condition (all ore delivered) */
  finished: number;
  /** ended by the stall guard — the bots stopped making progress */
  stalled: number;
  avgTurns: number;
  winsByColour: Record<string, number>;
  winsBySeat: number[];
  drawRate: number;
}

export function simulate(
  opts: CreateGameOptions & { games?: number; bot?: Bot; maxActions?: number } = {},
): SimSummary {
  const games = opts.games ?? 100;
  const bot = opts.bot ?? greedyBot;
  const maxActions = opts.maxActions ?? 20000;

  const STALL_TURNS = 60; // turns without any delivered/lost tile or board change => give up
  const winsByColour: Record<string, number> = {};
  const winsBySeat: number[] = [];
  let finished = 0;
  let stalled = 0;
  let totalTurns = 0;
  let draws = 0;

  for (let g = 0; g < games; g++) {
    let state = createGame({ ...opts, seed: (opts.seed ?? 1) + g });
    const rng = makeRng((opts.seed ?? 1) * 7919 + g);
    let guard = 0;
    let lastProgressTurn = 0;
    let progressKey = "";

    while (!state.gameOver && guard++ < maxActions) {
      if (legalActions(state).length === 0) break;
      const res = applyAction(state, bot(state, rng));
      state = res.ok ? res.state : applyAction(state, randomBot(state, rng)).state;

      const key =
        state.players.reduce((a, p) => a + p.delivered.length, 0) +
        ":" +
        Object.keys(state.board.resources).length;
      if (key !== progressKey) {
        progressKey = key;
        lastProgressTurn = state.turnNumber;
      } else if (state.turnNumber - lastProgressTurn > STALL_TURNS) {
        break; // stalemate
      }
    }

    if (state.gameOver) {
      finished++;
      totalTurns += state.turnNumber;
      const winners = state.winnerIds ?? [];
      if (winners.length === 1) {
        const w = state.players[winners[0]!]!;
        winsByColour[w.colour] = (winsByColour[w.colour] ?? 0) + 1;
        winsBySeat[winners[0]!] = (winsBySeat[winners[0]!] ?? 0) + 1;
      } else {
        draws++;
      }
    } else {
      stalled++;
    }
  }

  return {
    games,
    finished,
    stalled,
    avgTurns: finished ? totalTurns / finished : 0,
    winsByColour,
    winsBySeat,
    drawRate: finished ? draws / finished : 0,
  };
}
