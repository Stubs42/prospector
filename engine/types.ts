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
  colour: Colour;
  eliminated: boolean;
  /** false until the player has taken their one-time launch base-cell choice */
  placed: boolean;
  pose: ShipPose;
  fuel: number;
  fuelMax: number;
  equipment: EquipmentCard[];
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

export type TurnPhase = "start" | "moved" | "done";

export interface GameState {
  config: Config;
  seed: number;
  rngState: number;
  turnNumber: number;
  activePlayerIndex: number;
  players: PlayerState[];
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
  /** a homecoming delivery is offering these equipment cards; one must be chosen */
  pendingEquipment: { playerId: number; cards: EquipmentCard[] } | null;
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
