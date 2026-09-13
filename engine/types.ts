import type { Hex } from "./hex.js";

// ---------------------------------------------------------------------------
// Config (subset of config/config.schema.json the engine actually reads)
// ---------------------------------------------------------------------------

export type Colour = "black" | "red" | "blue" | "white" | "green" | "yellow";
export type OreColour = "green" | "yellow" | "red";

export interface CoreConfig {
  board: {
    orientation: "pointy-top" | "flat-top";
    radius: number;
    innerRadius: number;
    originCell: [number, number];
    directions: [number, number][];
    colourOrder: Colour[];
    homeBase: { cellCount: number; anchorDistance: number; shape?: string };
  };
  dice: {
    coordinate: { count: number; steps: number[]; faces: "colourOrder" };
    combat: {
      attack: { faces: number[]; rolledBy: "attacker"; colour: string };
      defence: { faces: number[]; rolledBy: "defender"; colour: string };
    };
  };
  movement: {
    burnMaxCells: number;
    fuelPerCell: number;
    freeBaseDepartureCells: number;
    hyperspace: { engineThreshold: number; fuelCost: number };
  };
  fuel: { model: "pool"; refuelAtBase: "toMax" | "none"; reserveMayExceedMax: boolean };
  /** allowScrapBeforeDraw: the name is legacy — it now gates voluntary scrap for the whole move */
  turn: { boostersDrawnPerTurn: number; allowScrapBeforeDraw: boolean };
  cards: { reshuffleDiscardWhenEmpty: boolean };
}

export type StatKey = "shields" | "lasers" | "fuelTanks" | "cargo" | "engines" | "booster";
export type ShipStats = Record<StatKey, number>;

export interface ProspectorConfig {
  statSchema: StatKey[];
  players: { min: number; max: number };
  movementInputs: { burnCap: StatKey; fuelCapacity: StatKey };
  ships: Record<Colour, { name: string } & ShipStats>;
  upgradeCaps: Partial<Record<StatKey, number>>;
  startingFuel: "fuelMax" | "zero";
  resources: {
    colours: OreColour[];
    values: Record<OreColour, number>;
    perColour: { base: number; perPlayer: number };
    boxTilesPerColour: number;
    gameLengthAdjust: { short: number; long: number };
    seedOrder: OreColour[];
    inPlayInvariant: number;
    inPlayBasis: "initial-players" | "active-players";
    setupExtraGreen: number;
  };
  decks: {
    booster: {
      shield: Record<string, number>;
      laser: Record<string, number>;
      reserveFuel: Record<string, number>;
      engine: Record<string, number>;
      hyperspace: number;
    };
    equipment: {
      perType: number;
      types: Partial<Record<StatKey, number>>;
      fuelEquip: { tankIncrease: number; grantFuel: number };
    };
    fuel: { denominations: Record<string, number>; sharedFieldCards: number; sharedFieldValue: number };
  };
  combat: {
    winTest: "strict-greater" | "greater-or-equal";
    spoil: "most-valuable" | "least-valuable" | "random" | "attacker-choice";
    counterattackOnFailedAttack: boolean;
    attacksPerTurn: number;
    attackerNeedsFreeCargo: boolean;
    targetNeedsResource: boolean;
    laserBooster50SingleCardOnly: boolean;
    shieldBooster99AutoWin: boolean;
    hyperspaceDefenceAutoEscape: boolean;
  };
  loadRules: { maxPerTurn: number; swapMoreValuableWhenFull: boolean; noCombatSameTurnIfLoaded: boolean };
  homeBase: {
    refuel: boolean;
    equipmentDraw: number;
    equipmentKeep: number;
    setupEquipmentDraw: number;
    setupEquipmentKeep: number;
    deliveredResourcesSafe: boolean;
  };
  shipLoss: { rerollCargo: boolean; returnToBaseAtRest: boolean; eliminateIfSupplyEmpty: boolean };
  postMoveActions: ("load" | "attack")[];
}

export interface Config {
  core: CoreConfig;
  modes: { prospector: ProspectorConfig };
}

// ---------------------------------------------------------------------------
// Cards
// ---------------------------------------------------------------------------

export type BoosterType = "shield" | "laser" | "reserveFuel" | "engine" | "hyperspace";

export interface BoosterCard {
  id: string;
  deck: "booster";
  type: BoosterType;
  value: number | null;
  effect: string;
}

export interface EquipmentCard {
  id: string;
  deck: "equipment";
  stat: StatKey;
  amount: number;
  grantFuel?: number;
  effect: string;
}

// ---------------------------------------------------------------------------
// Runtime state
// ---------------------------------------------------------------------------

/** Three cones. At rest: current === previous. In flight: velocity = current - previous. */
export interface ShipPose {
  current: Hex;
  previous: Hex;
  atRest: boolean;
}

export interface PlayerState {
  id: number;
  /** ship type — drives stats (mode.ships[colour]) and visual identity everywhere */
  colour: Colour;
  /** which of the board's six base regions this player's home is — a separate choice from
     `colour` when base and ship are picked independently; defaults to the same value as
     `colour` for the classic fixed pairing (see createGame's `bases` option) */
  homeBase: Colour;
  eliminated: boolean;
  /** false until the player has taken their one-time launch base-cell choice */
  placed: boolean;
  pose: ShipPose;
  fuel: number;
  fuelMax: number;
  equipment: EquipmentCard[];
  /** an unresolved "upgrade at game start" draw (see CreateGameOptions.upgradeAtStart) —
     3 candidates and which mode picked them, surfaced as pendingEquipment the moment this
     player finishes their first drift (i.e. right before they'd choose a burn target).
     Null once resolved, or from the start if upgradeAtStart is "none". */
  startEquipment: { cards: EquipmentCard[]; mode: "random" | "select" } | null;
  hand: BoosterCard[];
  cargo: OreColour[];
  delivered: OreColour[];
  /** transient, cleared at the start of each of this player's turns */
  turn: {
    boosterDrawn: boolean;
    scrapped: boolean;
    driftDone: boolean;
    moveStarted: boolean;
    moveStartedOnOwnBase: boolean;
    freeBurnCellsUsed: number;
    mustBurn: boolean;
    moved: boolean;
    postMoveActionTaken: null | "load" | "attack";
    engineBoostThisTurn: number;
    /** booster card ids already consumed this turn (can't be replayed) */
    boostersUsed: string[];
  };
}

export interface PendingCombat {
  attackerId: number;
  defenderId: number;
  round: number;
  attackerLaserBoost: number;
  awaiting: "defend" | "resolve" | "counter";
  lastAttackFailed: boolean;
  /** set by combatDefend, read by combatResolve */
  defShields?: number;
  autoRepel?: boolean;
}

/** why a chooseEquipment choice is pending, and what phase to resume once it resolves —
   a homecoming reward interrupts the post-move phase (resumes "moved"); the start-of-game
   upgrade interrupts the pre-burn moment of the "start" phase (resumes "start", so burn is
   still available right after). `mode` only exists for "start": a GUI spins to a random
   card itself for "random" (the engine doesn't roll it — same as any other lucky-wheel
   pick in this game, the "randomness" is cosmetic/client-side), or lets the player choose
   for "select"; a homecoming reward is always an interactive choice. */
export type PendingEquipment =
  | { playerId: number; cards: EquipmentCard[]; reason: "start"; mode: "random" | "select" }
  | { playerId: number; cards: EquipmentCard[]; reason: "homecoming" };

export type TurnPhase = "start" | "moved" | "done";

export type SeatKind = "human" | "bot";

/**
 * Game start as a real, driven sequence instead of createGame resolving everything at once:
 * each seat, in turn, picks a free base and then immediately a free ship (so a player's
 * base and ship are settled back-to-back, not in two separate all-players passes). Once the
 * last seat picks its ship, the engine decides the start player itself (one RNG draw — no
 * per-seat action, nothing to resolve a tie for) and parks in stage "rollOff" holding that
 * result; a `finishSetup` action (whenever the GUI is done showing it) does the same finalize
 * work createGame always did (decks, equipment, initial resource seeding) and clears this
 * field. `state.players` stays empty the entire time.
 *
 * The engine only ever hands back the *result* of a random pick, never how to animate it — a
 * GUI is free to show the start-player choice as a spinning wheel landing on `startSeat`
 * before ever calling `finishSetup`.
 */
export interface SetupState {
  /** fixed at creation; index = the eventual player id */
  seats: SeatKind[];
  variant?: "standard" | "short" | "long" | undefined;
  /** whether each player gets a random draw-3-keep-1 upgrade before their first burn;
     see CreateGameOptions.upgradeAtStart. Default (also the type's default): "select" */
  upgradeAtStart?: "none" | "random" | "select" | undefined;
  stage: "pickBase" | "pickShip" | "rollOff";
  /** per seat index; null until that seat has picked */
  bases: (Colour | null)[];
  colours: (Colour | null)[];
  /** the seat currently picking (its base, then its ship) — irrelevant once stage is "rollOff" */
  turnIndex: number;
  /** the start player; null until stage is "rollOff" */
  startSeat: number | null;
}

export interface GameState {
  config: Config;
  seed: number;
  rngState: number;
  turnNumber: number;
  activePlayerIndex: number;
  players: PlayerState[];
  /** non-null while start-of-game picks are still in progress; see SetupState */
  setup: SetupState | null;
  /** ore tiles on the board, by hex key */
  board: {
    resources: Record<string, OreColour>;
  };
  supply: Record<OreColour, number>;
  initialPlayerCount: number;
  decks: {
    booster: { draw: BoosterCard[]; discard: BoosterCard[] };
    equipment: { draw: EquipmentCard[]; discard: EquipmentCard[] };
  };
  phase: TurnPhase;
  pendingCombat: PendingCombat | null;
  /** one must be chosen from `cards` before anything else can happen — either a homecoming
     delivery reward (always an interactive choice) or the start-of-game upgrade (whose
     `mode` tells a GUI whether to auto-spin to a random one or let the player pick) */
  pendingEquipment: PendingEquipment | null;
  log: LogEntry[];
  gameOver: boolean;
  winnerIds: number[] | null;
}

export interface LogEntry {
  turn: number;
  player: number;
  event: string;
  detail?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export type Action =
  // --- setup: per seat, base -> ship; then the engine picks the start player and parks in
  // stage "rollOff" until finishSetup, before any turn begins ---
  | { type: "pickBase"; base: Colour }
  | { type: "pickShip"; colour: Colour }
  | { type: "finishSetup" }
  | { type: "placeShip"; cell: Hex }
  | { type: "scrapShip" }
  | { type: "drawBooster" }
  | { type: "discardBooster"; cardId: string }
  | { type: "drift" }
  | { type: "useReserveFuel"; cardId: string }
  | { type: "burn"; path: Hex[]; engineBoosters?: string[]; reserveFuelBoosters?: string[] }
  | { type: "hyperspace"; via: "booster" | "engines"; boosterId?: string }
  | { type: "endMove" }
  | { type: "loadResource"; from: Hex }
  | { type: "attack"; targetPlayerId: number; laserBoosters?: string[] }
  | { type: "combatDefend"; shieldBoosters?: string[]; hyperspaceBoosterId?: string }
  | { type: "combatResolve" }
  | { type: "declineCounter" }
  | { type: "chooseEquipment"; cardId: string }
  | { type: "endTurn" };

export interface StepResult {
  state: GameState;
  ok: boolean;
  error?: string;
}
