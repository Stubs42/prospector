import {
  type Hex,
  add,
  hexKey,
  hexEq,
  areNeighbours,
  ORIGIN,
} from "./hex.js";
import { makeBoard, type BoardModel } from "./board.js";
import type { BoardJson, ContentJson } from "./data-types.js";

// The engine is data-driven but framework/host-agnostic: the host injects the three
// generated JSON blobs once at startup (node tests via a setup file, browser via bundled
// JSON imports). No fs access here.
let _config: Config | null = null;
let _boardJson: BoardJson | null = null;
let _content: ContentJson | null = null;
let boardSingleton: BoardModel | null = null;

export function provideGameData(d: { config: Config; boardJson: BoardJson; content: ContentJson }): void {
  _config = d.config;
  _boardJson = d.boardJson;
  _content = d.content;
  boardSingleton = null;
}

function requireData(): { config: Config; boardJson: BoardJson; content: ContentJson } {
  if (!_config || !_boardJson || !_content) {
    throw new Error("engine data not provided — call provideGameData({ config, boardJson, content }) first");
  }
  return { config: _config, boardJson: _boardJson, content: _content };
}
import { makeRng, type Rng } from "./rng.js";
import { drawN, discardCards, bottomCards } from "./cards.js";
import { drift, burn, atRestPose, straightPath, hyperspaceLand } from "./movement.js";
import { resolveStats, movementInputs } from "./ship.js";
import { rollCoordinateUntil, rollCombat } from "./dice.js";
import { resolveCombat, pickSpoil } from "./combat.js";
import type {
  Action,
  BoosterCard,
  Colour,
  Config,
  GameState,
  OreColour,
  PlayerState,
  ProspectorConfig,
  ShipStats,
  StepResult,
} from "./types.js";

// ---------------------------------------------------------------------------

export interface CreateGameOptions {
  seed?: number;
  /** player colours, in seating order; 2..6 of them */
  colours?: Colour[];
  variant?: "standard" | "short" | "long";
  config?: Config;
  /** force the start player (seat index); default: rolled */
  startPlayer?: number;
}

const CONE_COLOURS: Colour[] = ["black", "red", "blue", "white", "green", "yellow"];

export function createGame(opts: CreateGameOptions = {}): GameState {
  const data = requireData();
  const config = opts.config ?? data.config;
  const board = makeBoard(data.boardJson);
  const content = data.content;
  const mode = config.modes.prospector;

  const colours = opts.colours ?? CONE_COLOURS.slice(0, 4);
  if (colours.length < mode.players.min || colours.length > mode.players.max) {
    throw new Error(`player count ${colours.length} out of range`);
  }
  const seed = opts.seed ?? 1;
  const rng = makeRng(seed);

  const perColour =
    mode.resources.perColour.base +
    mode.resources.perColour.perPlayer * colours.length +
    (opts.variant === "short"
      ? mode.resources.gameLengthAdjust.short
      : opts.variant === "long"
        ? mode.resources.gameLengthAdjust.long
        : 0);

  // decks
  let boosterDraw = rng.shuffle(content.decks.booster.cards);
  let equipmentDraw = rng.shuffle(content.decks.equipment.cards);
  const equipmentDiscard: (typeof equipmentDraw)[number][] = [];

  const players: PlayerState[] = colours.map((colour, i) => {
    const ship = mode.ships[colour];
    const bases = board.baseCells(colour);
    const start = bases[0]!;
    // setup equipment: draw 3, keep the first (choice not modelled at setup), bottom the rest
    const drawn = equipmentDraw.slice(0, mode.homeBase.setupEquipmentDraw);
    equipmentDraw = equipmentDraw.slice(mode.homeBase.setupEquipmentDraw);
    const kept = drawn.slice(0, mode.homeBase.setupEquipmentKeep);
    equipmentDraw = [...equipmentDraw, ...drawn.slice(mode.homeBase.setupEquipmentKeep)];

    const fuelMax = ship.fuelTanks + kept.filter((c) => c.stat === "fuelTanks").reduce((a, c) => a + c.amount, 0);
    return {
      id: i,
      colour,
      eliminated: false,
      placed: false,
      pose: atRestPose(start),
      fuel: fuelMax,
      fuelMax,
      equipment: kept,
      hand: [],
      cargo: [],
      delivered: [],
      turn: freshTurn(),
    };
  });

  const state: GameState = {
    config,
    seed,
    rngState: rng.state(),
    turnNumber: 1,
    activePlayerIndex: 0,
    players,
    board: { resources: {} },
    supply: { green: perColour, yellow: perColour, red: perColour },
    initialPlayerCount: colours.length,
    decks: {
      booster: { draw: boosterDraw, discard: [] },
      equipment: { draw: equipmentDraw, discard: equipmentDiscard },
    },
    phase: "start",
    pendingCombat: null,
    log: [],
    gameOver: false,
    winnerIds: null,
  };

  // initial green seeding: players + setupExtraGreen
  withRng(state, (r) => {
    const count = colours.length + mode.resources.setupExtraGreen;
    for (let i = 0; i < count; i++) seedOne(state, board, r, "green");
  });

  const rolled = pickStartPlayer(state);
  state.activePlayerIndex =
    opts.startPlayer !== undefined ? opts.startPlayer % state.players.length : rolled;
  state.players[state.activePlayerIndex]!.turn = freshTurn();
  return state;
}

function freshTurn(): PlayerState["turn"] {
  return {
    boosterDrawn: false,
    scrapped: false,
    driftDone: false,
    moveStarted: false,
    moveStartedOnOwnBase: false,
    freeBurnCellsUsed: 0,
    mustBurn: false,
    moved: false,
    postMoveActionTaken: null,
    engineBoostThisTurn: 0,
    boostersUsed: [],
  };
}

// ---------------------------------------------------------------------------
// rng plumbing — resume from saved state, save back
// ---------------------------------------------------------------------------

function withRng<T>(state: GameState, fn: (r: Rng) => T): T {
  const r = makeRng(state.rngState);
  const out = fn(r);
  state.rngState = r.state();
  return out;
}

function pickStartPlayer(state: GameState): number {
  return withRng(state, (r) => r.int(0, state.players.length - 1));
}

// ---------------------------------------------------------------------------
// occupancy / helpers
// ---------------------------------------------------------------------------

export function boardFor(_state: GameState): BoardModel {
  if (!boardSingleton) boardSingleton = makeBoard(requireData().boardJson);
  return boardSingleton;
}

export function statsOf(state: GameState, p: PlayerState): ShipStats {
  const mode = state.config.modes.prospector;
  const base = mode.ships[p.colour];
  const baseStats: ShipStats = {
    shields: base.shields,
    lasers: base.lasers,
    fuelTanks: base.fuelTanks,
    cargo: base.cargo,
    engines: base.engines,
    booster: base.booster,
  };
  return resolveStats(baseStats, p.equipment, mode.upgradeCaps);
}

function resourceKeySet(state: GameState): Set<string> {
  return new Set(Object.keys(state.board.resources));
}

function freeFor(state: GameState, board: BoardModel, playerId: number): (h: Hex) => boolean {
  const res = resourceKeySet(state);
  const currents = state.players
    .filter((p) => !p.eliminated && p.id !== playerId)
    .map((p) => p.pose.current);
  return (h: Hex) => {
    if (board.offField(h)) return false;
    if (res.has(hexKey(h))) return false;
    for (const c of currents) if (hexEq(c, h)) return false;
    return true;
  };
}

function activePlayer(state: GameState): PlayerState {
  return state.players[state.activePlayerIndex]!;
}

const LOG_CAP = 400;
function log(state: GameState, event: string, detail?: Record<string, unknown>): void {
  state.log.push({ turn: state.turnNumber, player: state.activePlayerIndex, event, ...(detail ? { detail } : {}) });
  if (state.log.length > LOG_CAP) state.log.splice(0, state.log.length - LOG_CAP);
}

// ---------------------------------------------------------------------------
// seeding
// ---------------------------------------------------------------------------

function seedOne(state: GameState, board: BoardModel, rng: Rng, colour: OreColour): boolean {
  if (state.supply[colour] <= 0) return false;
  const res = resourceKeySet(state);
  const occupiedByShip = new Set(state.players.filter((p) => !p.eliminated).map((p) => hexKey(p.pose.current)));
  try {
    const { target } = rollCoordinateUntil(
      rng,
      board,
      state.config.core,
      ORIGIN,
      (t) => board.isInner(t) && !res.has(hexKey(t)) && !occupiedByShip.has(hexKey(t)),
    );
    state.board.resources[hexKey(target)] = colour;
    state.supply[colour] -= 1;
    return true;
  } catch {
    return false;
  }
}

function seedN(state: GameState, board: BoardModel, n: number): void {
  const order = state.config.modes.prospector.resources.seedOrder;
  withRng(state, (rng) => {
    let placed = 0;
    for (const colour of order) {
      while (placed < n && state.supply[colour] > 0) {
        if (!seedOne(state, board, rng, colour)) break;
        placed++;
      }
    }
  });
}

// ---------------------------------------------------------------------------
// scoring / end
// ---------------------------------------------------------------------------

export function score(state: GameState): { byPlayer: number[]; winnerIds: number[] } {
  const values = state.config.modes.prospector.resources.values;
  const byPlayer = state.players.map((p) => p.delivered.reduce((a, c) => a + values[c], 0));
  const max = Math.max(...byPlayer);
  const winnerIds = byPlayer.flatMap((v, i) => (v === max ? [i] : []));
  return { byPlayer, winnerIds };
}

function totalSupply(state: GameState): number {
  return state.supply.green + state.supply.yellow + state.supply.red;
}

function checkEnd(state: GameState): void {
  const active = state.players.filter((p) => !p.eliminated);
  const everythingHome =
    totalSupply(state) === 0 &&
    Object.keys(state.board.resources).length === 0 &&
    state.players.every((p) => p.cargo.length === 0);
  if (everythingHome || active.length === 0) {
    state.gameOver = true;
    state.winnerIds = score(state).winnerIds;
  }
}

// ---------------------------------------------------------------------------
// ship loss
// ---------------------------------------------------------------------------

function loseShip(state: GameState, board: BoardModel, p: PlayerState, reason: string): void {
  const mode = state.config.modes.prospector;
  // re-roll carried cargo back onto the board
  if (mode.shipLoss.rerollCargo) {
    withRng(state, (rng) => {
      for (const colour of p.cargo) {
        const res = resourceKeySet(state);
        try {
          const { target } = rollCoordinateUntil(
            rng,
            board,
            state.config.core,
            ORIGIN,
            (t) => board.isInner(t) && !res.has(hexKey(t)),
          );
          state.board.resources[hexKey(target)] = colour;
        } catch {
          /* board full — drop it (should not happen at this scale) */
        }
      }
    });
  }
  p.cargo = [];

  if (mode.shipLoss.eliminateIfSupplyEmpty && totalSupply(state) === 0) {
    p.eliminated = true;
    log(state, "shipEliminated", { player: p.id, reason });
  } else {
    p.pose = atRestPose(board.baseCells(p.colour)[0]!);
    if (mode.homeBase.refuel) p.fuel = p.fuelMax; // refit at base
    log(state, "shipLost", { player: p.id, reason });
  }
}

// ---------------------------------------------------------------------------
// home base arrival: brake, refuel, deliver, equip, seed
// ---------------------------------------------------------------------------

function arriveHomeBaseIfAny(state: GameState, board: BoardModel, p: PlayerState): void {
  const mode = state.config.modes.prospector;
  if (board.baseOwnerAt(p.pose.current) !== p.colour) return;
  // Only an *arrival* brakes the ship. A ship that began its move on its own base is
  // departing — moving within the base cluster keeps the velocity it has built up.
  if (p.turn.moveStartedOnOwnBase) return;

  p.pose = atRestPose(p.pose.current);
  if (mode.homeBase.refuel) p.fuel = p.fuelMax;

  if (p.cargo.length > 0) {
    const delivered = p.cargo.slice();
    p.delivered.push(...delivered);
    p.cargo = [];
    log(state, "delivered", { player: p.id, tiles: delivered });

    // choose one equipment: draw N, keep first, bottom the rest
    withRng(state, (rng) => {
      const { cards, deck } = drawN(
        state.decks.equipment,
        mode.homeBase.equipmentDraw,
        rng,
        state.config.core.cards.reshuffleDiscardWhenEmpty,
      );
      state.decks.equipment = deck;
      if (cards.length > 0) {
        const keep = cards[0]!;
        p.equipment.push(keep);
        if (keep.stat === "fuelTanks") {
          const grant = keep.grantFuel ?? keep.amount;
          p.fuelMax += keep.amount;
          p.fuel = Math.min(p.fuel + grant, p.fuelMax);
        }
        state.decks.equipment = bottomCards(state.decks.equipment, cards.slice(1));
        log(state, "equipped", { player: p.id, card: keep.id });
      }
    });

    // seed one new tile per tile delivered, while supply lasts
    seedN(state, board, delivered.length);
  }

  checkEnd(state);
}

// ---------------------------------------------------------------------------
// the reducer
// ---------------------------------------------------------------------------

export function applyAction(prev: GameState, action: Action): StepResult {
  if (prev.gameOver) return { state: prev, ok: false, error: "game is over" };
  // clone everything except the immutable config tree (cloning it every action is what
  // made board caching miss and re-read board.json from disk in a tight loop)
  const state: GameState = structuredClone({ ...prev, config: undefined as unknown as Config });
  state.config = prev.config;
  const board = boardFor(state);
  const mode = state.config.modes.prospector;
  const p = activePlayer(state);

  const fail = (error: string): StepResult => ({ state: prev, ok: false, error });
  const done = (): StepResult => ({ state, ok: true });

  const useBoosters = (ids: string[] | undefined, type: BoosterCard["type"]): BoosterCard[] | null => {
    if (!ids || ids.length === 0) return [];
    const picked: BoosterCard[] = [];
    for (const id of ids) {
      const card = p.hand.find((c) => c.id === id);
      if (!card || card.type !== type) return null;
      picked.push(card);
    }
    p.hand = p.hand.filter((c) => !ids.includes(c.id));
    state.decks.booster = discardCards(state.decks.booster, picked);
    p.turn.boostersUsed.push(...ids);
    return picked;
  };

  switch (action.type) {
    // ---- start phase -------------------------------------------------------
    case "placeShip": {
      if (state.phase !== "start" || p.turn.boosterDrawn) return fail("too late to choose a launch cell");
      if (p.placed) return fail("launch cell already chosen");
      const owns = board.baseCells(p.colour).some((c) => hexEq(c, action.cell));
      if (!owns) return fail("not one of your base cells");
      p.pose = atRestPose(action.cell);
      p.placed = true;
      log(state, "shipPlaced", { player: p.id, cell: action.cell });
      return done();
    }

    case "scrapShip": {
      if (state.phase !== "start" || p.turn.boosterDrawn) return fail("can only scrap at the very start of the turn");
      if (!state.config.core.turn.allowScrapBeforeDraw) return fail("scrapping disabled");
      loseShip(state, board, p, "voluntary scrap");
      return advanceTurn(state, board);
    }

    case "drawBooster": {
      if (state.phase !== "start" || p.turn.boosterDrawn) return fail("already drew this turn");
      withRng(state, (rng) => {
        const { cards, deck } = drawN(
          state.decks.booster,
          state.config.core.turn.boostersDrawnPerTurn,
          rng,
          state.config.core.cards.reshuffleDiscardWhenEmpty,
        );
        state.decks.booster = deck;
        p.hand.push(...cards);
      });
      p.turn.boosterDrawn = true;
      p.placed = true; // launch cell choice is locked once the turn proper begins
      return done();
    }

    case "discardBooster": {
      const card = p.hand.find((c) => c.id === action.cardId);
      if (!card) return fail("no such card in hand");
      p.hand = p.hand.filter((c) => c.id !== action.cardId);
      state.decks.booster = discardCards(state.decks.booster, [card]);
      return done();
    }

    case "drift": {
      if (state.phase !== "start" || !p.turn.boosterDrawn) return fail("draw a booster first");
      if (overHandLimit(state, p)) return fail("discard down to the booster hand limit first");
      if (p.turn.driftDone) return fail("already drifted");
      p.turn.moveStarted = true;
      p.turn.moveStartedOnOwnBase = board.baseOwnerAt(p.pose.current) === p.colour;
      const res = drift(p.pose, board, freeFor(state, board, p.id));
      p.turn.driftDone = true;
      if (res.offField) {
        loseShip(state, board, p, "drifted off the field");
        return advanceTurn(state, board);
      }
      p.pose = res.pose;
      p.turn.mustBurn = res.needsBurn;
      return done();
    }

    case "burn": {
      if (state.phase !== "start" || !p.turn.driftDone) return fail("drift first");
      if (p.turn.moved) return fail("already burned this turn");

      const engineCards = useBoosters(action.engineBoosters, "engine");
      if (engineCards === null) return fail("bad engine booster id");
      const reserveCards = useBoosters(action.reserveFuelBoosters, "reserveFuel");
      if (reserveCards === null) return fail("bad reserve-fuel booster id");

      const engineBoost = engineCards.reduce((a, c) => a + (c.value ?? 0), 0);
      for (const c of reserveCards) p.fuel = Math.min(p.fuel + (c.value ?? 0), p.fuelMax);

      const stats = statsOf(state, p);
      const maxCells = movementInputs(stats, mode).burnCap + engineBoost;
      const freeCells = p.turn.moveStartedOnOwnBase
        ? state.config.core.movement.freeBaseDepartureCells - p.turn.freeBurnCellsUsed
        : 0;

      const r = burn(p.pose, action.path, board, freeFor(state, board, p.id), {
        maxCells,
        hardCap: state.config.core.movement.burnMaxCells,
        fuelAvailable: p.fuel,
        freeCells,
      });
      if (!r.ok) return fail(r.error ?? "illegal burn");
      p.pose = r.pose!;
      p.fuel -= r.fuelSpent!;
      p.turn.freeBurnCellsUsed += r.freeUsed!;
      p.turn.moved = true;
      p.turn.mustBurn = false;
      return done();
    }

    case "hyperspace": {
      if (state.phase !== "start" || !p.turn.driftDone) return fail("drift first");
      if (p.turn.moved) return fail("already moved");
      if (action.via === "booster") {
        const card = p.hand.find((c) => c.id === action.boosterId && c.type === "hyperspace");
        if (!card) return fail("no hyperspace booster with that id");
        p.hand = p.hand.filter((c) => c.id !== card.id);
        state.decks.booster = discardCards(state.decks.booster, [card]);
      } else {
        const stats = statsOf(state, p);
        const hs = state.config.core.movement.hyperspace;
        if (stats.engines < hs.engineThreshold || p.fuel < hs.fuelCost) {
          return fail("need 4 engines and 4 fuel for an engine hyperspace jump");
        }
        p.fuel -= hs.fuelCost;
      }
      withRng(state, (rng) => {
        const { target } = rollCoordinateUntilSafeOrAny(state, board, rng);
        const land = hyperspaceLand(target, board, freeFor(state, board, p.id));
        if (land.lost) {
          loseShip(state, board, p, "failed hyperspace jump");
        } else {
          p.pose = land.pose;
        }
      });
      p.turn.moved = true;
      p.turn.mustBurn = false;
      return p.eliminated || board.baseOwnerAt(p.pose.current) === p.colour ? advanceOrMoved(state, board) : done();
    }

    case "endMove": {
      if (state.phase !== "start" || !p.turn.driftDone) return fail("nothing to end");
      if (p.turn.mustBurn) {
        loseShip(state, board, p, "no free inner cell reachable after drift");
        return advanceTurn(state, board);
      }
      arriveHomeBaseIfAny(state, board, p);
      if (state.gameOver) return done();
      state.phase = "moved";
      return done();
    }

    // ---- post-move phase -------------------------------------------------
    case "loadResource": {
      if (state.phase !== "moved") return fail("finish moving first");
      if (p.turn.postMoveActionTaken) return fail("post-move action already taken");
      const key = hexKey(action.from);
      const colour = state.board.resources[key];
      if (!colour) return fail("no resource there");
      if (!areNeighbours(p.pose.current, action.from)) return fail("resource is not adjacent");

      const cap = statsOf(state, p).cargo;
      const values = mode.resources.values;
      if (p.cargo.length < cap) {
        delete state.board.resources[key];
        p.cargo.push(colour);
      } else if (mode.loadRules.swapMoreValuableWhenFull) {
        const weakest = [...p.cargo].sort((a, b) => values[a] - values[b])[0]!;
        if (values[colour] <= values[weakest]) return fail("cargo full and this tile is not more valuable");
        p.cargo.splice(p.cargo.indexOf(weakest), 1);
        p.cargo.push(colour);
        state.board.resources[key] = weakest; // less valuable tile stays on the board
      } else {
        return fail("cargo full");
      }
      p.turn.postMoveActionTaken = "load";
      log(state, "loaded", { player: p.id, colour });
      return done();
    }

    case "attack": {
      const counter = state.pendingCombat?.awaiting === "counter";
      if (!counter) {
        if (state.phase !== "moved") return fail("finish moving first");
        if (p.turn.postMoveActionTaken) return fail("post-move action already taken");
      }
      const attacker = counter ? state.players[state.pendingCombat!.defenderId]! : p;
      const target = state.players[action.targetPlayerId];
      if (!target || target.eliminated) return fail("no such target");
      if (target.id === attacker.id) return fail("cannot attack yourself");
      if (!areNeighbours(attacker.pose.current, target.pose.current)) return fail("target not adjacent");
      if (mode.combat.targetNeedsResource && target.cargo.length < 1) return fail("target carries no resource");
      const attCargoCap = statsOf(state, attacker).cargo;
      if (mode.combat.attackerNeedsFreeCargo && attacker.cargo.length >= attCargoCap) {
        return fail("attacker has no free cargo slot");
      }

      const laserIds = action.laserBoosters ?? [];
      const lasers = laserIds.map((id) => attacker.hand.find((c) => c.id === id));
      if (lasers.some((c) => !c || c.type !== "laser")) return fail("bad laser booster id");
      const has50 = lasers.some((c) => c!.value === 50);
      if (has50 && lasers.length > 1 && mode.combat.laserBooster50SingleCardOnly) {
        return fail("a laser +50 must be played alone");
      }
      const boost = lasers.reduce((a, c) => a + (c!.value ?? 0), 0);
      attacker.hand = attacker.hand.filter((c) => !laserIds.includes(c.id));
      state.decks.booster = discardCards(state.decks.booster, lasers as BoosterCard[]);

      state.pendingCombat = {
        attackerId: attacker.id,
        defenderId: target.id,
        round: (state.pendingCombat?.round ?? 0) + 1,
        attackerLaserBoost: boost,
        awaiting: "defend",
        lastAttackFailed: false,
      };
      if (!counter) p.turn.postMoveActionTaken = "attack";
      log(state, "attackDeclared", { attacker: attacker.id, defender: target.id });
      return done();
    }

    case "combatDefend": {
      const pc = state.pendingCombat;
      if (!pc || pc.awaiting !== "defend") return fail("no attack to defend");
      const defender = state.players[pc.defenderId]!;

      if (action.hyperspaceBoosterId && mode.combat.hyperspaceDefenceAutoEscape) {
        const card = defender.hand.find((c) => c.id === action.hyperspaceBoosterId && c.type === "hyperspace");
        if (!card) return fail("no hyperspace booster with that id");
        defender.hand = defender.hand.filter((c) => c.id !== card.id);
        state.decks.booster = discardCards(state.decks.booster, [card]);
        withRng(state, (rng) => {
          const { target } = rollCoordinateUntilSafeOrAny(state, board, rng);
          const land = hyperspaceLand(target, board, freeFor(state, board, defender.id));
          if (land.lost) loseShip(state, board, defender, "failed hyperspace flight");
          else defender.pose = land.pose;
        });
        state.pendingCombat = null;
        log(state, "defenderFled", { defender: defender.id });
        return done();
      }

      const shieldIds = action.shieldBoosters ?? [];
      const shields = shieldIds.map((id) => defender.hand.find((c) => c.id === id));
      if (shields.some((c) => !c || c!.type !== "shield")) return fail("bad shield booster id");
      const autoRepel = shields.some((c) => c!.value === 99) && mode.combat.shieldBooster99AutoWin;
      const boost = shields.reduce((a, c) => a + (c!.value ?? 0), 0);
      defender.hand = defender.hand.filter((c) => !shieldIds.includes(c.id));
      state.decks.booster = discardCards(state.decks.booster, shields as BoosterCard[]);

      pc.awaiting = "resolve";
      pc.defShields = statsOf(state, defender).shields + boost;
      pc.autoRepel = autoRepel;
      return done();
    }

    case "combatResolve": {
      const pc = state.pendingCombat;
      if (!pc || pc.awaiting !== "resolve") return fail("combat not ready to resolve");
      const attacker = state.players[pc.attackerId]!;
      const defender = state.players[pc.defenderId]!;
      const attackerLasers = statsOf(state, attacker).lasers + pc.attackerLaserBoost;

      const { outcome, roll } = withRng(state, (rng) => {
        const r = rollCombat(rng, state.config.core);
        return {
          roll: r,
          outcome: resolveCombat(
            { attackerLasers, defenderShields: pc.defShields ?? 0, autoRepel: pc.autoRepel ?? false },
            r,
            mode.combat.winTest,
          ),
        };
      });
      const rollDetail = {
        attackDie: roll.attack,
        defenceDie: roll.defence,
        attackTotal: outcome.attackTotal,
        defenceTotal: outcome.defenceTotal,
        autoRepel: pc.autoRepel ?? false,
      };

      if (outcome.attackerWins) {
        const spoil = withRng(state, (rng) =>
          pickSpoil(defender.cargo, mode.resources.values, mode.combat.spoil, (items) => rng.pick(items)),
        );
        if (spoil) {
          defender.cargo.splice(defender.cargo.indexOf(spoil), 1);
          attacker.cargo.push(spoil);
        }
        state.pendingCombat = null;
        log(state, "attackSucceeded", { attacker: attacker.id, defender: defender.id, spoil, ...rollDetail });
      } else {
        log(state, "attackFailed", { attacker: attacker.id, defender: defender.id, ...rollDetail });
        if (mode.combat.counterattackOnFailedAttack) {
          pc.awaiting = "counter";
          pc.lastAttackFailed = true;
        } else {
          state.pendingCombat = null;
        }
      }
      return done();
    }

    case "declineCounter": {
      if (state.pendingCombat?.awaiting !== "counter") return fail("nothing to decline");
      state.pendingCombat = null;
      return done();
    }

    case "endTurn": {
      if (state.pendingCombat) return fail("resolve combat first");
      if (state.phase !== "moved") return fail("cannot end turn before moving");
      return advanceTurn(state, board);
    }

    default:
      return fail(`unhandled action ${(action as { type: string }).type}`);
  }
}

// ---------------------------------------------------------------------------

function overHandLimit(state: GameState, p: PlayerState): boolean {
  return p.hand.length > statsOf(state, p).booster;
}

function advanceOrMoved(state: GameState, board: BoardModel): StepResult {
  const p = activePlayer(state);
  if (p.eliminated) return advanceTurn(state, board);
  arriveHomeBaseIfAny(state, board, p);
  if (state.gameOver) return { state, ok: true };
  state.phase = "moved";
  return { state, ok: true };
}

function advanceTurn(state: GameState, board: BoardModel): StepResult {
  checkEnd(state);
  if (state.gameOver) return { state, ok: true };

  let next = state.activePlayerIndex;
  for (let i = 0; i < state.players.length; i++) {
    next = (next + 1) % state.players.length;
    if (!state.players[next]!.eliminated) break;
  }
  state.activePlayerIndex = next;
  state.turnNumber += 1;
  state.players[next]!.turn = freshTurn();
  state.phase = "start";
  return { state, ok: true };
}

function rollCoordinateUntilSafeOrAny(
  state: GameState,
  board: BoardModel,
  rng: Rng,
): { target: Hex } {
  // hyperspace: any inner cell is a candidate; landing on an occupied one loses the ship,
  // so accept the first inner roll and let hyperspaceLand judge it.
  const { target } = rollCoordinateUntil(rng, board, state.config.core, ORIGIN, (t) => board.isInner(t));
  return { target };
}

export { add, straightPath, hexKey };
