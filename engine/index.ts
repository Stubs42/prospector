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
  equipmentRerollEligible,
  freeFor,
  type CreateGameOptions,
} from "./game.js";
import { drift } from "./movement.js";
import { movementInputs, canEquip } from "./ship.js";
import type { Action, GameState, PlayerState } from "./types.js";

export { createGame, applyAction, score, statsOf, boardFor, provideGameData, equipmentRerollEligible, canEquip };
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

  if (state.pendingEventChoice) {
    return state.pendingEventChoice.options.map((o) => ({ type: "resolveEventChoice", optionId: o.id }));
  }

  if (state.pendingEquipment) {
    const pe = state.pendingEquipment;
    const caps = state.config.modes.prospector.upgradeCaps;
    const stats = statsOf(state, state.players[pe.playerId]!);
    // a maxed stat's card is never a legal pick (offerEquipment already keeps an ALL-maxed
    // offer from ever being shown at all, but a partial mix — e.g. 2 of 3 maxed — can still
    // reach here, and each of those 2 must be excluded individually)
    const out: Action[] = pe.cards
      .filter((c) => canEquip(stats, c.stat, caps))
      .map((c) => ({ type: "chooseEquipment", cardId: c.id }));
    if (equipmentRerollEligible(pe)) out.push({ type: "rerollEquipment" });
    return out;
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
    if (!p.turn.moved) {
      const stats = statsOf(state, p);
      // hyperspace: an alternative to a normal move entirely, offered at the same decision
      // point regardless of where a drift would land — any hyperspace card in hand, or the
      // engine-power jump if the ship qualifies outright
      for (const c of p.hand) {
        if (c.type === "hyperspace") out.push({ type: "hyperspace", via: "booster", boosterId: c.id });
      }
      const hs = state.config.core.movement.hyperspace;
      if (stats.engines >= hs.engineThreshold && p.fuel >= hs.fuelCost) {
        out.push({ type: "hyperspace", via: "engines" });
      }

      // drift and burn are one decision, not two: reachable cells (0-cost included) are
      // computed up front from wherever the ship would land, whether or not the real "drift"
      // action has actually been dispatched yet — see engine/game.ts's ensureDrifted, which
      // burn/endMove/hyperspace all call to perform this same drift for real the moment any
      // of them is actually chosen. Speculating it here (via the same pure `drift()`) is what
      // lets a 0-fuel player see a real, clickable "stay here for free" option from turn one,
      // instead of nothing at all until an invisible auto-fired drift happened to succeed.
      const speculative = p.turn.driftDone ? null : drift(p.pose, board, freeFor(state, board, p.id));
      const landing = speculative ? speculative.pose : p.pose;
      const wouldNeedBurn = speculative ? speculative.needsBurn : p.turn.mustBurn;
      const offField = speculative?.offField ?? false;
      // ensureDrifted (engine/game.ts) only sets this real side-effect once the drift actually
      // happens — speculate it the same way here so a not-yet-drifted player starting from
      // their own base still sees their free departure cells, not zero
      const moveStartedOnOwnBase = p.turn.driftDone
        ? p.turn.moveStartedOnOwnBase
        : board.baseOwnerAt(p.pose.current) === p.homeBase;

      if (!offField) {
        const cap = movementInputs(stats, mode).burnCap + Math.max(0, opts?.extraEngines ?? 0);
        const freeCells = Math.max(
          0,
          moveStartedOnOwnBase
            ? state.config.core.movement.freeBaseDepartureCells - p.turn.freeBurnCellsUsed
            : 0,
        );
        const hardCap = state.config.core.movement.burnMaxCells;
        const stepBudget = Math.min(cap, hardCap) + freeCells;
        const fuelBudget = Math.min(p.fuel + Math.max(0, opts?.extraFuel ?? 0), p.fuelMax);

        // A burn may turn and may pass through outer cells — and resource/ship-occupied
        // cells — on its way in; only the destination must be inner and clear (matches
        // movement.ts's burn(), which only checks offField for intermediate cells, and inner
        // + isFreeAt for the LAST path cell only). Flying over an obstacle instead of being
        // walled off by it means a target's reachability is just its real hex distance, never
        // inflated by however many extra steps a detour around that obstacle would need.
        const startKey = hexKey(landing.current);
        const depth = new Map<string, number>([[startKey, 0]]);
        const parent = new Map<string, Hex>();
        const queue: Hex[] = [landing.current];
        for (let qi = 0; qi < queue.length; qi++) {
          const cell = queue[qi]!;
          const d = depth.get(hexKey(cell))!;
          if (d >= stepBudget) continue;
          for (const nb of board.neighbours(cell)) {
            const k = hexKey(nb);
            if (depth.has(k) || board.offField(nb)) continue;
            depth.set(k, d + 1);
            parent.set(k, cell);
            queue.push(nb);
          }
        }
        for (const [k, d] of depth) {
          if (d === 0) continue; // the landing cell itself is the free "endMove here" option below
          const cell = parseHexKey(k);
          if (!board.isInner(cell)) continue; // a burn must end on an inner cell
          if (d - Math.min(d, freeCells) > fuelBudget) continue; // can't fuel it
          if (!isFree(cell)) continue; // can't come to rest on another ship
          const path: Hex[] = [];
          for (let node: Hex | undefined = cell; node && hexKey(node) !== startKey; node = parent.get(hexKey(node))) {
            path.unshift(node);
          }
          out.push({ type: "burn", path });
        }
      }
      // endMove is legal when the (real or would-be) landing settled cleanly — the free,
      // always-available "stay right here" choice — OR, when it's off-field or otherwise
      // forces a burn nothing can afford, as the "ship lost" escape hatch (its handler
      // performs the real drift, discovers the loss, and resolves it).
      if (offField || !wouldNeedBurn || !out.some((a) => a.type === "burn")) out.push({ type: "endMove" });
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
 * a base cell (to deliver + brake), while damping leftover velocity so it can stop.
 * Household fuel proactively (refuel and turn for home before the tank is empty, not
 * after), gives up a ship that genuinely can't make it home any more, and — mixed in with
 * loading — occasionally raids an adjacent carrier for its cargo.
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
  const baseCells = board.baseCells(p.homeBase);
  const baseKeys = new Set(baseCells.map(hexKey));
  const home = baseCells[0]!;
  const homeDistFrom = (h: Hex) => Math.min(...baseCells.map((c) => distance(h, c)));
  const onOwnBase = board.baseOwnerAt(p.pose.current) === p.homeBase;
  const homeDist = homeDistFrom(p.pose.current);
  const hasReserveCard = p.hand.some((c) => c.type === "reserveFuel");
  // "stranded" used to mean only a literal empty tank — broadened to "the fuel in the tank
  // can't cover the distance home even in a straight line", which is the actual question a
  // player asks before deciding to keep pushing on. Carrying cargo no longer exempts a
  // ship from this: a scrap re-rolls that cargo back into play (mode.shipLoss.rerollCargo)
  // rather than losing it, which beats it sitting forever aboard a ship that can never
  // reach home anyway.
  const stranded = p.pose.atRest && !onOwnBase && !hasReserveCard && p.fuel < homeDist;

  if (byType("scrapShip").length && stranded) return { type: "scrapShip" };
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

  // head home once anything is aboard, or once the tank can no longer be trusted to cover
  // the trip back from here — not a flat "<=3" any more, so a ship that strays far while
  // hunting still turns for home in time instead of running the tank dry out in the field.
  // "carrying" alone doesn't count while already sitting ON the ship's own base, though: a
  // real delivery needs a genuine arrival (see engine/game.ts's arriveHomeBaseIfAny — moving
  // within the base cluster while departing never brakes/delivers, on purpose), so a ship
  // that picked up cargo without ever having to travel for it (e.g. a salvage-cache event
  // landing ore straight into the hold) has nothing to "go home" for — it's already there.
  // Without this, goHome stayed permanently true while onOwnBase, aiming every "nearest"
  // search at the base cluster itself instead of any real resource, and the ship never
  // actually departed at all — found live: a bot sat bouncing between its own base cells
  // forever, cargo never delivered, never leaving home.
  const fuelMargin = 1; // a little slack so it doesn't shave things razor-thin
  const fuelLow = p.fuel <= homeDist + fuelMargin;
  const goHome = (carrying && !onOwnBase) || fuelLow;
  const reserveFuelIds = fuelLow ? p.hand.filter((c) => c.type === "reserveFuel").map((c) => c.id) : [];

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
    const scoreDest = (dest: Hex, fuelSpent: number): number => {
      // landing on a base cell only actually delivers when the move is a genuine arrival —
      // engine/game.ts's arriveHomeBaseIfAny explicitly does NOT brake/deliver when the move
      // started on the ship's own base (moving within the base cluster while departing keeps
      // its velocity, on purpose, so a real departure can freely pass across its own base
      // without accidentally re-triggering a delivery). A bot already sitting on its own base
      // this turn (e.g. cargo it never had to travel for, like a salvage-cache event) doesn't
      // know that distinction — the OLD unconditional bonus here made "hop to a different one
      // of my own 4 base cells" score as an irresistible "delivered!" every single turn, a
      // real dead end found live: a bot sat bouncing between its own base cells forever,
      // fuel full, cargo never delivered, never actually leaving home.
      if (goHome && !onOwnBase && baseKeys.has(hexKey(dest))) return -1000; // land on base: deliver + brake
      if (!goHome && board.neighbours(dest).some((n) => state.board.resources[hexKey(n)])) {
        return -100; // end adjacent to a resource: can load this turn
      }
      const d = goal ? distance(dest, goal) : 0;
      const speed = distance(dest, p.pose.previous); // leftover velocity after this move
      const runaway = board.isOuter(dest) ? 40 : 0; // don't coast into the outer ring
      // fuel household: while still hunting (not already heading home), a destination that
      // would leave less fuel in the tank than the trip home from THERE costs is a real
      // risk of getting stranded next turn — a soft penalty, scaled to how big the shortfall
      // actually is (not a flat cliff), so a ship only marginally over the safe line still
      // makes real progress instead of freezing in place; goHome is the hard safety net that
      // actually turns it around once the margin gets genuinely bad, this just nudges it
      // toward the safer of otherwise-similar options
      const deficit = goHome ? 0 : Math.max(0, homeDistFrom(dest) - (p.fuel - fuelSpent));
      const overextends = deficit * 8;
      // progress first, but always keep some brake pressure so it can actually stop —
      // then brake hard once we're basically there
      return d * 6 + speed * 2 + (d <= 3 ? speed * 4 : 0) + runaway + overextends;
    };
    type Opt = { action: Action; score: number };
    const opts: Opt[] = burns.map((a) => ({ action: a, score: scoreDest(a.path[a.path.length - 1]!, a.path.length) }));
    if (endMove) opts.push({ action: endMove, score: scoreDest(p.pose.current, 0) });
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

  // post-move: load if there's ore in reach, or occasionally raid a neighbour's hold
  // instead — a coin-flip against loading (when both are on offer) keeps this "sometimes",
  // not a reflex; when only a target is available (nothing to load) it always takes the
  // free shot. Plain attacks only (no laser-boost spend) — a simple bot risking its whole
  // hand on a raid would be worse than just never attacking at all.
  const loads = byType("loadResource") as Extract<Action, { type: "loadResource" }>[];
  const attacks = byType("attack") as Extract<Action, { type: "attack" }>[];
  if (attacks.length) {
    const values = state.config.modes.prospector.resources.values;
    const richestSpoil = (targetId: number): number =>
      state.players[targetId]!.cargo.reduce((m, c) => Math.max(m, values[c] ?? 0), 0);
    const bestAttack = attacks.reduce((b, a) => (richestSpoil(a.targetPlayerId) > richestSpoil(b.targetPlayerId) ? a : b));
    if (!loads.length || rng.next() < 0.4) return bestAttack;
  }
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
