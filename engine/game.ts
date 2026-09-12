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
import { rollCoordinateUntil, rollCombat, type CoordinateRoll } from "./dice.js";
import { resolveCombat, pickSpoil } from "./combat.js";
import type {
  Action,
  BoosterCard,
  Colour,
  Config,
  EquipmentCard,
  GameState,
  OreColour,
  PlayerState,
  ProspectorConfig,
  SeatKind,
  SetupState,
  ShipStats,
  StepResult,
} from "./types.js";

// ---------------------------------------------------------------------------

export interface CreateGameOptions {
  seed?: number;
  /** player ship colours (stats + visual identity), in seating order; 2..6 of them.
     Ignored (and unnecessary) when `seats` is given instead — see below. */
  colours?: Colour[];
  /** player home-base positions, parallel to `colours`; defaults to the same array, i.e.
     the classic fixed colour-equals-base pairing. Pass a different permutation to let base
     and ship be chosen independently. Ignored when `seats` is given. */
  bases?: Colour[];
  /** interactive setup: base/ship aren't decided yet — the returned state starts with
     `setup` populated at the "pickBase" stage, to be resolved by pickBase/pickShip actions
     (the engine itself picks the start player the instant the last base is claimed).
     Mutually exclusive with `colours`/`bases`/`startPlayer`. */
  seats?: SeatKind[];
  variant?: "standard" | "short" | "long";
  config?: Config;
  /** force the start player (seat index); default: rolled. Ignored when `seats` is given —
     setup picks it the instant the last base is claimed. */
  startPlayer?: number;
}

const CONE_COLOURS: Colour[] = ["black", "red", "blue", "white", "green", "yellow"];

export function createGame(opts: CreateGameOptions = {}): GameState {
  const data = requireData();
  const config = opts.config ?? data.config;
  const board = makeBoard(data.boardJson);
  const mode = config.modes.prospector;
  const seed = opts.seed ?? 1;

  const emptyState = (playerCount: number): GameState => ({
    config,
    seed,
    rngState: makeRng(seed).state(),
    turnNumber: 0,
    activePlayerIndex: 0,
    players: [],
    setup: null,
    board: { resources: {} },
    supply: { green: 0, yellow: 0, red: 0 },
    initialPlayerCount: playerCount,
    decks: { booster: { draw: [], discard: [] }, equipment: { draw: [], discard: [] } },
    phase: "start",
    pendingCombat: null,
    pendingEquipment: null,
    log: [],
    gameOver: false,
    winnerIds: null,
  });

  if (opts.seats) {
    const seats = opts.seats;
    if (seats.length < mode.players.min || seats.length > mode.players.max) {
      throw new Error(`player count ${seats.length} out of range`);
    }
    const state = emptyState(seats.length);
    state.setup = {
      seats: [...seats],
      variant: opts.variant,
      stage: "pickBase",
      bases: seats.map(() => null),
      colours: seats.map(() => null),
      turnIndex: 0,
      startSeat: null,
      shipOrder: null,
    };
    return state;
  }

  const colours = opts.colours ?? CONE_COLOURS.slice(0, 4);
  if (colours.length < mode.players.min || colours.length > mode.players.max) {
    throw new Error(`player count ${colours.length} out of range`);
  }
  const homeBases = opts.bases ?? colours;
  if (homeBases.length !== colours.length) {
    throw new Error("bases must be the same length as colours");
  }

  const state = emptyState(colours.length);
  populateGame(state, board, colours, homeBases, opts.variant);

  // pickStartPlayer always runs (even when overridden below) so the rng stream position is
  // the same regardless of whether startPlayer is passed — keeps seeded games reproducible.
  const rolled = pickStartPlayer(state);
  state.activePlayerIndex = opts.startPlayer !== undefined ? opts.startPlayer % state.players.length : rolled;
  state.players[state.activePlayerIndex]!.turn = freshTurn();
  state.turnNumber = 1;
  return state;
}

/**
 * Fills in decks, players (with their setup-equipment draw) and initial resource seeding on
 * an otherwise-empty state. Shared by createGame's instant path and the interactive setup's
 * finalize step (see stepSetup) — the only difference is who picks the start player.
 */
function populateGame(
  state: GameState,
  board: BoardModel,
  colours: Colour[],
  bases: Colour[],
  variant: CreateGameOptions["variant"],
): void {
  const content = requireData().content;
  const mode = state.config.modes.prospector;

  const perColour =
    mode.resources.perColour.base +
    mode.resources.perColour.perPlayer * colours.length +
    (variant === "short"
      ? mode.resources.gameLengthAdjust.short
      : variant === "long"
        ? mode.resources.gameLengthAdjust.long
        : 0);

  withRng(state, (rng) => {
    let boosterDraw = rng.shuffle(content.decks.booster.cards);
    let equipmentDraw = rng.shuffle(content.decks.equipment.cards);
    const equipmentDiscard: EquipmentCard[] = [];

    state.players = colours.map((colour, i) => {
      const homeBase = bases[i]!;
      const ship = mode.ships[colour];
      const baseCells = board.baseCells(homeBase);
      const start = baseCells[0]!;
      // setup equipment: draw 3, keep the first (choice not modelled at setup), bottom the rest
      const drawn = equipmentDraw.slice(0, mode.homeBase.setupEquipmentDraw);
      equipmentDraw = equipmentDraw.slice(mode.homeBase.setupEquipmentDraw);
      const kept = drawn.slice(0, mode.homeBase.setupEquipmentKeep);
      equipmentDraw = [...equipmentDraw, ...drawn.slice(mode.homeBase.setupEquipmentKeep)];

      const fuelMax = ship.fuelTanks + kept.filter((c) => c.stat === "fuelTanks").reduce((a, c) => a + c.amount, 0);
      return {
        id: i,
        colour,
        homeBase,
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

    state.supply = { green: perColour, yellow: perColour, red: perColour };
    state.initialPlayerCount = colours.length;
    state.decks = {
      booster: { draw: boosterDraw, discard: [] },
      equipment: { draw: equipmentDraw, discard: equipmentDiscard },
    };
  });

  // initial green seeding: players + setupExtraGreen
  withRng(state, (r) => {
    const count = colours.length + mode.resources.setupExtraGreen;
    for (let i = 0; i < count; i++) seedOne(state, board, r, "green");
  });
}

// ---------------------------------------------------------------------------
// interactive setup: pickBase -> (engine picks the start player) -> pickShip
// ---------------------------------------------------------------------------

export function setupLegalActions(state: GameState): Action[] {
  const setup = state.setup!;
  const colourOrder = state.config.core.board.colourOrder;
  if (setup.stage === "pickBase") {
    return colourOrder.filter((c) => !setup.bases.includes(c)).map((base) => ({ type: "pickBase", base }));
  }
  return colourOrder.filter((c) => !setup.colours.includes(c)).map((colour) => ({ type: "pickShip", colour }));
}

function stepSetup(state: GameState, prev: GameState, board: BoardModel, action: Action): StepResult {
  const setup = state.setup!;
  const fail = (error: string): StepResult => ({ state: prev, ok: false, error });
  const done = (): StepResult => ({ state, ok: true });

  if (setup.stage === "pickBase") {
    if (action.type !== "pickBase") return fail("pick a base first");
    if (setup.bases.includes(action.base)) return fail("that base is already taken");
    const seat = setup.turnIndex;
    setup.bases[seat] = action.base;
    state.activePlayerIndex = seat;
    log(state, "basePicked", { seat, base: action.base });
    setup.turnIndex += 1;
    if (setup.turnIndex === setup.seats.length) {
      // the engine just hands back a result here — a single, immediate random pick, with no
      // per-seat action to resolve. Any "everyone rolls, it comes down to the wire" moment is
      // purely a GUI animation landing on this seat, not something the engine plays out.
      const winner = withRng(state, (r) => r.int(0, setup.seats.length - 1));
      setup.startSeat = winner;
      setup.shipOrder = setup.seats.map((_, i) => (winner + i) % setup.seats.length);
      setup.stage = "pickShip";
      setup.turnIndex = 0;
      log(state, "startPlayerChosen", { seat: winner });
    }
    return done();
  }

  // pickShip
  if (action.type !== "pickShip") return fail("pick a ship");
  if (setup.colours.includes(action.colour)) return fail("that ship is already taken");
  const seat = setup.shipOrder![setup.turnIndex]!;
  setup.colours[seat] = action.colour;
  state.activePlayerIndex = seat;
  log(state, "shipPicked", { seat, colour: action.colour });
  setup.turnIndex += 1;
  if (setup.turnIndex === setup.seats.length) {
    const colours = setup.colours.map((c) => c!);
    const bases = setup.bases.map((b) => b!);
    const winner = setup.shipOrder![0]!;
    const variant = setup.variant;
    populateGame(state, board, colours, bases, variant);
    state.activePlayerIndex = winner;
    state.players[winner]!.turn = freshTurn();
    state.turnNumber = 1;
    state.setup = null;
  }
  return done();
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
    const { roll, target } = rollCoordinateUntil(
      rng,
      board,
      state.config.core,
      ORIGIN,
      (t) => board.isInner(t) && !res.has(hexKey(t)) && !occupiedByShip.has(hexKey(t)),
    );
    state.board.resources[hexKey(target)] = colour;
    state.supply[colour] -= 1;
    // the 3 coordinate dice that produced this cell (step 1/2/3, each a direction) — a GUI
    // can replay them (largest step first reads best) as a "spin down to a cell" animation
    // instead of the tile just appearing
    log(state, "resourceSeeded", { colour, cell: target, dice: roll.dice });
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
    p.pose = atRestPose(board.baseCells(p.homeBase)[0]!);
    if (mode.homeBase.refuel) p.fuel = p.fuelMax; // refit at base
    log(state, "shipLost", { player: p.id, reason });
  }
}

// ---------------------------------------------------------------------------
// home base arrival: brake, refuel, deliver, equip, seed
// ---------------------------------------------------------------------------

function arriveHomeBaseIfAny(state: GameState, board: BoardModel, p: PlayerState): void {
  const mode = state.config.modes.prospector;
  if (board.baseOwnerAt(p.pose.current) !== p.homeBase) return;
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

    // seed one new tile per tile delivered, while supply lasts
    seedN(state, board, delivered.length);
    checkEnd(state);

    // homecoming reward: draw N equipment cards and let the player pick one
    // (resolved by the `chooseEquipment` action). If the game just ended, skip it.
    if (!state.gameOver) {
      withRng(state, (rng) => {
        const { cards, deck } = drawN(
          state.decks.equipment,
          mode.homeBase.equipmentDraw,
          rng,
          state.config.core.cards.reshuffleDiscardWhenEmpty,
        );
        state.decks.equipment = deck;
        if (cards.length > 0) {
          state.pendingEquipment = { playerId: p.id, cards };
        }
      });
    }
    return;
  }

  checkEnd(state);
}

/** apply a chosen equipment card to a player's ship — permanent stat bump + fuel-tank refit */
function equipCard(p: PlayerState, card: EquipmentCard): void {
  p.equipment.push(card);
  if (card.stat === "fuelTanks") {
    const grant = card.grantFuel ?? card.amount;
    p.fuelMax += card.amount;
    p.fuel = Math.min(p.fuel + grant, p.fuelMax);
  }
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

  if (state.setup) return stepSetup(state, prev, board, action);

  const p = activePlayer(state);

  const fail = (error: string): StepResult => ({ state: prev, ok: false, error });
  const done = (): StepResult => ({ state, ok: true });

  const logBoosters = (who: PlayerState, cards: readonly BoosterCard[], context: string): void => {
    if (cards.length === 0) return;
    log(state, "boosterPlayed", {
      player: who.id,
      context,
      cards: cards.map((c) => ({ type: c.type, value: c.value })),
    });
  };

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

  if (state.pendingEquipment && action.type !== "chooseEquipment") {
    return fail("choose an upgrade first");
  }

  switch (action.type) {
    // ---- homecoming upgrade pick -----------------------------------------
    case "chooseEquipment": {
      const pe = state.pendingEquipment;
      if (!pe) return fail("no upgrade choice pending");
      const keep = pe.cards.find((c) => c.id === action.cardId);
      if (!keep) return fail("not one of the offered upgrades");
      const pl = state.players[pe.playerId]!;
      equipCard(pl, keep);
      state.decks.equipment = bottomCards(
        state.decks.equipment,
        pe.cards.filter((c) => c.id !== action.cardId),
      );
      log(state, "equipped", { player: pe.playerId, card: keep.id, stat: keep.stat, amount: keep.amount });
      state.pendingEquipment = null;
      state.phase = "moved";
      return done();
    }

    // ---- start phase -------------------------------------------------------
    case "placeShip": {
      if (state.phase !== "start" || p.turn.boosterDrawn) return fail("too late to choose a launch cell");
      if (p.placed) return fail("launch cell already chosen");
      const owns = board.baseCells(p.homeBase).some((c) => hexEq(c, action.cell));
      if (!owns) return fail("not one of your base cells");
      p.pose = atRestPose(action.cell);
      p.placed = true;
      log(state, "shipPlaced", { player: p.id, cell: action.cell });
      return done();
    }

    case "scrapShip": {
      if (state.phase !== "start" || !p.placed) return fail("can only scrap during your own move");
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
      p.turn.moveStartedOnOwnBase = board.baseOwnerAt(p.pose.current) === p.homeBase;
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

    case "useReserveFuel": {
      // stand-alone card play: unlike engine boosters (which only mean something bundled
      // with a specific burn), a reserve-fuel card just tops up the tank — it's used up the
      // moment it's clicked, not staged/armed for a later burn.
      if (state.phase !== "start" || !p.placed) return fail("not your move to make");
      if (p.turn.moved) return fail("already moved");
      const card = p.hand.find((c) => c.id === action.cardId);
      if (!card || card.type !== "reserveFuel") return fail("no such reserve-fuel card in hand");
      if (p.fuel >= p.fuelMax) return fail("fuel already at max");
      p.hand = p.hand.filter((c) => c.id !== action.cardId);
      state.decks.booster = discardCards(state.decks.booster, [card]);
      p.turn.boostersUsed.push(action.cardId);
      p.fuel = Math.min(p.fuel + (card.value ?? 0), p.fuelMax);
      logBoosters(p, [card], "refuel");
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
      logBoosters(p, [...engineCards, ...reserveCards], "burn");
      log(state, "burned", {
        player: p.id,
        cells: action.path.length,
        fuelSpent: r.fuelSpent,
        freeUsed: r.freeUsed,
        ...(engineBoost ? { engineBoost } : {}),
      });
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
        logBoosters(p, [card], "hyperspace");
      } else {
        const stats = statsOf(state, p);
        const hs = state.config.core.movement.hyperspace;
        if (stats.engines < hs.engineThreshold || p.fuel < hs.fuelCost) {
          return fail("need 4 engines and 4 fuel for an engine hyperspace jump");
        }
        p.fuel -= hs.fuelCost;
      }
      withRng(state, (rng) => {
        const { roll, target } = rollCoordinateUntilSafeOrAny(state, board, rng);
        log(state, "hyperspaceRoll", { player: p.id, dice: roll.dice, cell: target });
        const land = hyperspaceLand(target, board, freeFor(state, board, p.id));
        if (land.lost) {
          loseShip(state, board, p, "failed hyperspace jump");
        } else {
          p.pose = land.pose;
        }
      });
      p.turn.moved = true;
      p.turn.mustBurn = false;
      return p.eliminated || board.baseOwnerAt(p.pose.current) === p.homeBase ? advanceOrMoved(state, board) : done();
    }

    case "endMove": {
      if (state.phase !== "start" || !p.turn.driftDone) return fail("nothing to end");
      if (p.turn.mustBurn) {
        loseShip(state, board, p, "no free inner cell reachable after drift");
        return advanceTurn(state, board);
      }
      arriveHomeBaseIfAny(state, board, p);
      if (state.gameOver) return done();
      if (state.pendingEquipment) return done(); // wait for the upgrade pick
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
      logBoosters(attacker, lasers as BoosterCard[], "attack");
      log(state, "attackDeclared", { attacker: attacker.id, defender: target.id, laserBoost: boost });
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
          const { roll, target } = rollCoordinateUntilSafeOrAny(state, board, rng);
          log(state, "hyperspaceRoll", { player: defender.id, dice: roll.dice, cell: target });
          const land = hyperspaceLand(target, board, freeFor(state, board, defender.id));
          if (land.lost) loseShip(state, board, defender, "failed hyperspace flight");
          else defender.pose = land.pose;
        });
        state.pendingCombat = null;
        logBoosters(defender, [card], "defence");
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
      logBoosters(defender, shields as BoosterCard[], "defence");
      if (shields.length || autoRepel) log(state, "defence", { defender: defender.id, shieldBoost: boost, autoRepel });
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
  if (state.pendingEquipment) return { state, ok: true }; // wait for the upgrade pick
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
): { roll: CoordinateRoll; target: Hex } {
  // hyperspace: any inner cell is a candidate; landing on an occupied one loses the ship,
  // so accept the first inner roll and let hyperspaceLand judge it.
  return rollCoordinateUntil(rng, board, state.config.core, ORIGIN, (t) => board.isInner(t));
}

export { add, straightPath, hexKey };
