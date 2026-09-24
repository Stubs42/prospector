/**
 * Event cards mixed into the booster deck (engine/game.ts's `drawBooster`): drawing one runs a
 * workflow instead of joining the drawer's hand. Each definition composes the same primitives
 * real gameplay already uses — a quake jump is exactly the hyperspace-flee logic combat already
 * has, a pirate ambush is exactly a real combat roll against a synthetic defender, a reseeded
 * ore is exactly what `loseShip` already does for a whole cargo hold, narrowed to one item.
 *
 * Deliberately NOT a declarative JSON interpreter: the events below have irreducibly different
 * shapes (dice-gated single-target, unconditional AOE, choice-gated single-target), so a shared
 * "target+condition+action" schema would need nearly as many special cases as there are events.
 * The real reuse is at the primitive level (below); a new event composes them in a few lines
 * rather than fighting a one-size-fits-all interpreter.
 *
 * Every event pauses on `state.pendingEventChoice` before its effect actually commits — even
 * one with no real decision to make. `resolve()` computes whatever needs to be known up front
 * (a dice roll, an epicentre) and calls `ctx.requestChoice(...)`; for a plain "read the card and
 * continue" event this means passing the shared `ACCEPT_OPTION` (a single {id:"accept"} choice)
 * instead of real options. `onChoice()` performs the actual mutation once the drawer answers.
 * This is what lets the client show one unified, spectator-visible card box for every event
 * (not just the ones with a real choice like salvage-cache) — see web/components/EventCardBox.
 */
import { type Hex, ORIGIN, distance, hexKey, parseHexKey, spiral } from "./hex.js";
import { rollCoordinateUntil, rollCombat } from "./dice.js";
import { resolveCombat, pickSpoil } from "./combat.js";
import { hyperspaceLand } from "./movement.js";
import { log, loseShip, resourceKeySet, freeFor, rollCoordinateUntilSafeOrAny, statsOf, equipCard } from "./game.js";
import { drawN, bottomCards } from "./cards.js";
import { canEquip } from "./ship.js";
import type { EventCondition, GameState, OreColour, PendingEventChoice, PlayerState } from "./types.js";
import type { BoardModel } from "./board.js";
import type { Rng } from "./rng.js";

// ---------------------------------------------------------------------------
// shared primitives
// ---------------------------------------------------------------------------

/** Every player (not eliminated) within `radius` hex cells of `center`. */
export function playersInRadius(state: GameState, center: Hex, radius: number): PlayerState[] {
  return state.players.filter((p) => !p.eliminated && distance(p.pose.current, center) <= radius);
}

function readField(state: GameState, p: PlayerState, field: EventCondition["field"]): number | string {
  switch (field) {
    case "fuel":
      return p.fuel;
    case "cargoCount":
      return p.cargo.length;
    case "colour":
      return p.colour;
    case "shipName":
      return state.config.modes.prospector.ships[p.colour]!.name;
    default:
      return statsOf(state, p)[field];
  }
}

export function evalCondition(state: GameState, p: PlayerState, cond: EventCondition): boolean {
  const actual = readField(state, p, cond.field);
  if (typeof actual === "number" && typeof cond.value === "number") {
    switch (cond.op) {
      case "lt":
        return actual < cond.value;
      case "lte":
        return actual <= cond.value;
      case "gt":
        return actual > cond.value;
      case "gte":
        return actual >= cond.value;
      case "eq":
        return actual === cond.value;
      case "neq":
        return actual !== cond.value;
    }
  }
  // string-valued fields (colour, shipName) only sensibly support equality
  if (cond.op === "eq") return actual === cond.value;
  if (cond.op === "neq") return actual !== cond.value;
  return false;
}

/** Run this ship through a real hyperspace jump — same roll, same reveal log, same real risk
   of losing the ship on a bad landing as any other hyperspace jump in the game. */
export function jumpToHyperspace(state: GameState, board: BoardModel, p: PlayerState, rng: Rng, reason: string): void {
  const { roll, target } = rollCoordinateUntilSafeOrAny(state, board, rng);
  log(state, "hyperspaceRoll", { player: p.id, dice: roll.dice, cell: target });
  const land = hyperspaceLand(target, board, freeFor(state, board, p.id));
  if (land.lost) {
    loseShip(state, board, p, reason);
  } else {
    p.pose = land.pose;
  }
}

/** Put one ore back on the board at a random free inner cell — the same reseed mechanic
   `loseShip` already runs per cargo item, narrowed to a single one. */
export function reseedOneOre(state: GameState, board: BoardModel, colour: OreColour, rng: Rng): void {
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
    /* board full — drop it, matches loseShip's own fallback for the same situation */
  }
}

// ---------------------------------------------------------------------------
// registry
// ---------------------------------------------------------------------------

export interface EventCtx {
  state: GameState;
  board: BoardModel;
  rng: Rng;
  drawer: PlayerState;
  /** an event that needs the drawer to pick something calls this and returns immediately
     instead of finishing — state.pendingEventChoice is set, and `onChoice` picks up from here
     once the drawer answers (see engine/game.ts's `resolveEventChoice` action). */
  requestChoice: (
    stage: string,
    prompt: string,
    options: { id: string; label: string }[],
    context?: Record<string, unknown>,
  ) => void;
}

export interface EventDefinition {
  id: string;
  title: string;
  text: string;
  resolve: (ctx: EventCtx) => void;
  onChoice?: (ctx: EventCtx, choice: PendingEventChoice, optionId: string) => void;
}

function eventParams<T>(state: GameState, eventId: string): Partial<T> {
  return (state.config.modes.prospector.events[eventId] ?? {}) as Partial<T>;
}

/** the single option every accept-gated (no real choice) event offers — see ACCEPT_OPTION's
   use below and the module doc comment on the accept-gate convention. */
const ACCEPT_OPTION = [{ id: "accept", label: "Continue" }];

const PIRATE_AMBUSH: EventDefinition = {
  id: "pirate-ambush",
  title: "Pirate Ambush",
  text: "A raider drops out of the dark and opens fire before you can react.",
  resolve(ctx) {
    ctx.requestChoice("accept", PIRATE_AMBUSH.text, ACCEPT_OPTION);
  },
  onChoice(ctx, _choice, optionId) {
    if (optionId !== "accept") return;
    const { state, drawer, rng } = ctx;
    const mode = state.config.modes.prospector;
    const { pirateLasers = 2 } = eventParams<{ pirateLasers: number }>(state, "pirate-ambush");
    const shields = statsOf(state, drawer).shields;
    const roll = rollCombat(rng, state.config.core);
    const outcome = resolveCombat({ attackerLasers: pirateLasers, defenderShields: shields, autoRepel: false }, roll, mode.combat.winTest);
    log(state, "pirateAmbushRoll", {
      player: drawer.id,
      pirateLasers,
      shields,
      attackDie: roll.attack,
      defenceDie: roll.defence,
      pirateWins: outcome.attackerWins,
    });
    if (!outcome.attackerWins) return; // shields held
    const lost = pickSpoil(drawer.cargo, mode.resources.values, mode.combat.spoil, (items) => rng.pick(items));
    if (!lost) return; // nothing aboard to take
    const idx = drawer.cargo.indexOf(lost);
    drawer.cargo = drawer.cargo.filter((_, i) => i !== idx);
    reseedOneOre(state, ctx.board, lost, rng);
    log(state, "eventOreLost", { player: drawer.id, colour: lost });
  },
};

const HYPERSPACE_QUAKE: EventDefinition = {
  id: "hyperspace-quake",
  title: "Hyperspace Quake",
  text: "Local spacetime buckles — every ship caught nearby is thrown into a blind jump.",
  resolve(ctx) {
    const { state, board, rng } = ctx;
    const { radius = 2 } = eventParams<{ radius: number; conditions: EventCondition[] }>(state, "hyperspace-quake");
    // the epicentre is picked now (not in onChoice) so the client can reveal/highlight it
    // before the player accepts — see PR E's radius-highlight animation
    const { roll, target: epicentre } = rollCoordinateUntilSafeOrAny(state, board, rng);
    log(state, "hyperspaceQuakeEpicentre", { dice: roll.dice, cell: epicentre, radius });
    ctx.requestChoice("accept", HYPERSPACE_QUAKE.text, ACCEPT_OPTION, { epicentre });
  },
  onChoice(ctx, choice, optionId) {
    if (optionId !== "accept") return;
    const { state, board, rng } = ctx;
    const { radius = 2, conditions = [] } = eventParams<{ radius: number; conditions: EventCondition[] }>(state, "hyperspace-quake");
    const epicentre = choice.context!.epicentre as Hex;
    const affected = playersInRadius(state, epicentre, radius).filter((p) => conditions.every((c) => evalCondition(state, p, c)));
    for (const p of affected) jumpToHyperspace(state, board, p, rng, "hyperspace quake");
  },
};

const SALVAGE_CACHE: EventDefinition = {
  id: "salvage-cache",
  title: "Salvage Cache",
  text: "Your sensors ping a stray cache drifting nearby — worth a detour?",
  resolve(ctx) {
    const { state, board, drawer, rng } = ctx;
    const { radius = 2, maxOptions = 3 } = eventParams<{ radius: number; maxOptions: number }>(state, "salvage-cache");
    const res = resourceKeySet(state);
    const empties = spiral(drawer.pose.current, radius).filter((h) => board.isInner(h) && !res.has(hexKey(h)) && !board.baseOwnerAt(h));
    const candidates = rng.shuffle(empties).slice(0, maxOptions);
    if (candidates.length === 0) {
      // nothing nearby this time — still show the card (unified with every other event) so it
      // isn't silently swallowed, just with nothing to pick
      ctx.requestChoice("pick-cell", "The cache has already drifted out of range.", ACCEPT_OPTION);
      return;
    }
    const options = candidates.map((h, i) => ({ id: hexKey(h), label: `Cache site ${i + 1}` }));
    options.push({ id: "skip", label: "Let it drift" });
    ctx.requestChoice("pick-cell", "A salvage cache drifts nearby. Investigate?", options, { cells: candidates.map(hexKey) });
  },
  onChoice(ctx, _choice, optionId) {
    if (optionId === "skip" || optionId === "accept") return;
    const { state, board, drawer, rng } = ctx;
    const mode = state.config.modes.prospector;
    const cell = parseHexKey(optionId);
    // re-validate: state may have moved on (another event, a delivery) since resolve() offered it
    const res = resourceKeySet(state);
    if (!board.isInner(cell) || res.has(hexKey(cell))) return;
    const colour = rng.pick(mode.resources.colours);
    const capacity = statsOf(state, drawer).cargo;
    if (drawer.cargo.length < capacity) {
      drawer.cargo.push(colour);
      log(state, "eventOreLoaded", { player: drawer.id, colour });
    } else {
      state.board.resources[hexKey(cell)] = colour;
      log(state, "eventOreSeeded", { player: drawer.id, colour, cell: hexKey(cell) });
    }
  },
};

/** Asteroid Field / Helium Cloud come as 3 separate physical cards each (X = 1/2/3), not one
   card with a configurable amount — so this is a small factory, not a config-driven single
   definition, mirroring how the content pipeline mints one distinct id per amount. */
function makeAsteroidField(amount: 1 | 2 | 3): EventDefinition {
  const text = `Your ship has to manoeuvre through an asteroid field. You lose ${amount} fuel.`;
  return {
    id: `asteroid-field-${amount}`,
    title: "Asteroid Field",
    text,
    resolve(ctx) {
      ctx.requestChoice("accept", text, ACCEPT_OPTION);
    },
    onChoice(ctx, _choice, optionId) {
      if (optionId !== "accept") return;
      ctx.drawer.fuel = Math.max(0, ctx.drawer.fuel - amount); // the first unchecked fuel loss
      // in the codebase — every other loss is gated by an affordability check beforehand
      log(ctx.state, "eventFuelLost", { player: ctx.drawer.id, amount });
    },
  };
}

function makeHeliumCloud(amount: 1 | 2 | 3): EventDefinition {
  const text = `You crossed a helium cloud. Collect ${amount} fuel.`;
  return {
    id: `helium-cloud-${amount}`,
    title: "Helium Cloud",
    text,
    resolve(ctx) {
      ctx.requestChoice("accept", text, ACCEPT_OPTION);
    },
    onChoice(ctx, _choice, optionId) {
      if (optionId !== "accept") return;
      const { drawer } = ctx;
      drawer.fuel = Math.min(drawer.fuel + amount, drawer.fuelMax); // same idiom as useReserveFuel
      log(ctx.state, "eventFuelGained", { player: drawer.id, amount });
    },
  };
}

const ENGINE_FAILURE: EventDefinition = {
  id: "engine-failure",
  title: "Engine Failure",
  text: "Your engines fail to fire. You may only drift this turn.",
  resolve(ctx) {
    ctx.requestChoice("accept", ENGINE_FAILURE.text, ACCEPT_OPTION);
  },
  onChoice(ctx, _choice, optionId) {
    if (optionId !== "accept") return;
    ctx.drawer.turn.engineFailure = true; // cleared by the next freshTurn(), same as every
    // other per-turn transient flag — see engine/index.ts's legalActions for where this bites
    log(ctx.state, "eventEngineFailure", { player: ctx.drawer.id });
  },
};

const SHIP_WRECK: EventDefinition = {
  id: "ship-wreck",
  title: "Ship Wreck",
  text: "You found a ship wreck. Collect a random upgrade.",
  resolve(ctx) {
    ctx.requestChoice("accept", SHIP_WRECK.text, ACCEPT_OPTION);
  },
  onChoice(ctx, _choice, optionId) {
    if (optionId !== "accept") return;
    const { state, drawer, rng } = ctx;
    const caps = state.config.modes.prospector.upgradeCaps;
    const { cards, deck } = drawN(state.decks.equipment, 1, rng, state.config.core.cards.reshuffleDiscardWhenEmpty);
    state.decks.equipment = deck;
    const card = cards[0];
    if (!card) return; // deck ran dry — nothing to grant
    if (!canEquip(statsOf(state, drawer), card.stat, caps)) {
      // already at cap for this stat — mirrors offerEquipment's own all-maxed fallback
      state.decks.equipment = bottomCards(state.decks.equipment, [card]);
      log(state, "equipmentDiscarded", { player: drawer.id, reason: "shipWreck" });
      return;
    }
    equipCard(drawer, card);
    log(state, "equipped", { player: drawer.id, card: card.id, stat: card.stat, amount: card.amount, reason: "shipWreck" });
  },
};

const HIDDEN_ORE: EventDefinition = {
  id: "hidden-ore",
  title: "Hidden Ore",
  text: "Your sensors detected an unknown ore. Pick it up if you have room.",
  resolve(ctx) {
    ctx.requestChoice("accept", HIDDEN_ORE.text, ACCEPT_OPTION);
  },
  onChoice(ctx, _choice, optionId) {
    if (optionId !== "accept") return;
    const { state, drawer } = ctx;
    const mode = state.config.modes.prospector;
    const tiles = Object.entries(state.board.resources);
    if (tiles.length === 0) return; // nothing on the board right now
    const [key, colour] = tiles.reduce((a, b) => (mode.resources.values[b[1]]! < mode.resources.values[a[1]]! ? b : a));
    if (drawer.cargo.length >= statsOf(state, drawer).cargo) return; // no room
    delete state.board.resources[key];
    drawer.cargo.push(colour);
    log(state, "eventOreLoaded", { player: drawer.id, colour });
  },
};

export const EVENTS: Record<string, EventDefinition> = {
  [PIRATE_AMBUSH.id]: PIRATE_AMBUSH,
  [HYPERSPACE_QUAKE.id]: HYPERSPACE_QUAKE,
  [SALVAGE_CACHE.id]: SALVAGE_CACHE,
  [makeAsteroidField(1).id]: makeAsteroidField(1),
  [makeAsteroidField(2).id]: makeAsteroidField(2),
  [makeAsteroidField(3).id]: makeAsteroidField(3),
  [makeHeliumCloud(1).id]: makeHeliumCloud(1),
  [makeHeliumCloud(2).id]: makeHeliumCloud(2),
  [makeHeliumCloud(3).id]: makeHeliumCloud(3),
  [ENGINE_FAILURE.id]: ENGINE_FAILURE,
  [SHIP_WRECK.id]: SHIP_WRECK,
  [HIDDEN_ORE.id]: HIDDEN_ORE,
};

// ---------------------------------------------------------------------------
// entry points called from engine/game.ts
// ---------------------------------------------------------------------------

function makeCtx(state: GameState, board: BoardModel, rng: Rng, drawer: PlayerState, eventId: string): EventCtx {
  return {
    state,
    board,
    rng,
    drawer,
    requestChoice: (stage, prompt, options, context) => {
      const def = EVENTS[eventId]!;
      state.pendingEventChoice = {
        eventId,
        playerId: drawer.id,
        stage,
        title: def.title,
        text: def.text,
        prompt,
        options,
        ...(context ? { context } : {}),
      };
    },
  };
}

/** Called once when an event card is drawn (engine/game.ts's `drawBooster`). */
export function runEvent(state: GameState, board: BoardModel, drawer: PlayerState, eventId: string, rng: Rng): void {
  const def = EVENTS[eventId];
  if (!def) return; // unknown id — defensive no-op, shouldn't happen with valid content data
  log(state, "eventDrawn", { player: drawer.id, eventId: def.id, title: def.title, text: def.text });
  def.resolve(makeCtx(state, board, rng, drawer, eventId));
}

/** Called from engine/game.ts's `resolveEventChoice` action once the drawer answers a pending
   event choice. */
export function continueEvent(state: GameState, board: BoardModel, choice: PendingEventChoice, optionId: string, rng: Rng): void {
  state.pendingEventChoice = null; // clear first — an onChoice that chains into another requestChoice can set it again
  const def = EVENTS[choice.eventId];
  const drawer = state.players[choice.playerId];
  if (!def?.onChoice || !drawer) return;
  def.onChoice(makeCtx(state, board, rng, drawer, choice.eventId), choice, optionId);
}
