import { describe, it, expect } from "vitest";
import { createGame, applyAction, boardFor } from "./game.js";
import { playersInRadius, evalCondition } from "./events.js";
import type { Action, BoosterCard, GameState } from "./types.js";

function run(state: GameState, action: Action): GameState {
  const r = applyAction(state, action);
  if (!r.ok) throw new Error(`action ${action.type} failed: ${r.error}`);
  return r.state;
}

function withEventOnTop(state: GameState, eventId: string): GameState {
  const card: BoosterCard = { id: "test-event", deck: "booster", type: "event", value: null, effect: "", eventId };
  return { ...state, decks: { ...state.decks, booster: { ...state.decks.booster, draw: [card, ...state.decks.booster.draw] } } };
}

describe("pirate-ambush", () => {
  function setup(seed: number): GameState {
    let s = createGame({ seed, colours: ["black", "white"], startPlayer: 0, upgradeAtStart: "none" });
    s.players[0]!.cargo = ["red", "green"];
    s = { ...s, phase: "start" };
    return withEventOnTop(s, "pirate-ambush");
  }

  it("pauses on a single-option accept gate before the raid actually happens — no roll logged yet", () => {
    const s = run(setup(1), { type: "drawBooster" });
    expect(s.pendingEventChoice).not.toBeNull();
    expect(s.pendingEventChoice!.options).toEqual([{ id: "accept", label: "Continue" }]);
    expect(s.log.some((e) => e.event === "pirateAmbushRoll")).toBe(false);
    const blocked = applyAction(s, { type: "drift" });
    expect(blocked.ok).toBe(false);
  });

  it("a losing roll removes one ore and reseeds it on the board", () => {
    // seed 1 happens to roll a pirate win against this drawer's shields
    const before = setup(1);
    const cargoBefore = before.players[0]!.cargo.length;
    const resourcesBefore = Object.keys(before.board.resources).length;
    let s = run(before, { type: "drawBooster" });
    expect(s.pendingEventChoice!.eventId).toBe("pirate-ambush");
    s = run(s, { type: "resolveEventChoice", optionId: "accept" });
    const ambush = s.log.find((e) => e.event === "pirateAmbushRoll")!;
    expect(ambush.detail!.pirateWins).toBe(true);
    expect(s.players[0]!.cargo).toHaveLength(cargoBefore - 1);
    expect(Object.keys(s.board.resources)).toHaveLength(resourcesBefore + 1);
    expect(s.log.some((e) => e.event === "eventOreLost")).toBe(true);
  });

  it("a winning roll is a no-op — cargo and the board are untouched", () => {
    // seed 3 happens to roll a pirate loss against this drawer's shields
    const before = setup(3);
    const cargoBefore = before.players[0]!.cargo.length;
    const resourcesBefore = Object.keys(before.board.resources).length;
    let s = run(before, { type: "drawBooster" });
    s = run(s, { type: "resolveEventChoice", optionId: "accept" });
    const ambush = s.log.find((e) => e.event === "pirateAmbushRoll")!;
    expect(ambush.detail!.pirateWins).toBe(false);
    expect(s.players[0]!.cargo).toHaveLength(cargoBefore);
    expect(Object.keys(s.board.resources)).toHaveLength(resourcesBefore);
    expect(s.log.some((e) => e.event === "eventOreLost")).toBe(false);
  });

  it("empty cargo is also a no-op, even on a pirate win", () => {
    const before = setup(1); // still a pirate win, but nothing aboard this time
    before.players[0]!.cargo = [];
    let s = run(before, { type: "drawBooster" });
    s = run(s, { type: "resolveEventChoice", optionId: "accept" });
    expect(s.log.find((e) => e.event === "pirateAmbushRoll")!.detail!.pirateWins).toBe(true);
    expect(s.players[0]!.cargo).toHaveLength(0);
    expect(s.log.some((e) => e.event === "eventOreLost")).toBe(false);
  });
});

describe("hyperspace-quake", () => {
  it("honours a configured condition (and, separately below, playersInRadius proves the radius math)", () => {
    let s = createGame({ seed: 2, colours: ["black", "white", "blue"], startPlayer: 0, upgradeAtStart: "none" });
    s = { ...s, phase: "start" };
    s.players[1]!.fuel = 1; // will fail a "fuel >= 5" condition regardless of position
    s = {
      ...s,
      config: {
        ...s.config,
        modes: {
          ...s.config.modes,
          prospector: {
            ...s.config.modes.prospector,
            events: {
              ...s.config.modes.prospector.events,
              // radius huge on purpose — every player is always geometrically "in range" here,
              // isolating this test to just the condition filter (the radius math itself is
              // covered by the playersInRadius unit test right below)
              "hyperspace-quake": { radius: 999, conditions: [{ field: "fuel", op: "gte", value: 5 }] },
            },
          },
        },
      },
    };
    s = withEventOnTop(s, "hyperspace-quake");

    let result = run(s, { type: "drawBooster" });
    result = run(result, { type: "resolveEventChoice", optionId: "accept" });
    const jumped = new Set(
      result.log.filter((e) => e.event === "hyperspaceRoll").map((e) => e.detail!.player as number),
    );
    expect(jumped.has(0)).toBe(true);
    expect(jumped.has(1)).toBe(false); // excluded by the fuel condition
    expect(jumped.has(2)).toBe(true);
  });

  it("playersInRadius and evalCondition compose the way the event expects", () => {
    const s = createGame({ seed: 1, colours: ["black", "white", "blue"] });
    const center = s.players[0]!.pose.current;
    const near = playersInRadius(s, center, 0);
    expect(near.map((p) => p.id)).toEqual([0]); // radius 0 = only a ship standing exactly there

    const p0 = s.players[0]!;
    expect(evalCondition(s, p0, { field: "colour", op: "eq", value: p0.colour })).toBe(true);
    expect(evalCondition(s, p0, { field: "colour", op: "eq", value: "not-a-colour" })).toBe(false);
    expect(evalCondition(s, p0, { field: "cargoCount", op: "eq", value: 0 })).toBe(true);
  });
});

describe("salvage-cache", () => {
  function setup(seed: number): GameState {
    let s = createGame({ seed, colours: ["black", "white"], startPlayer: 0, upgradeAtStart: "none" });
    s = { ...s, phase: "start" };
    return withEventOnTop(s, "salvage-cache");
  }

  it("sets a pendingEventChoice and blocks other actions until it's resolved", () => {
    const s = run(setup(1), { type: "drawBooster" });
    expect(s.pendingEventChoice).not.toBeNull();
    expect(s.pendingEventChoice!.eventId).toBe("salvage-cache");
    expect(s.pendingEventChoice!.playerId).toBe(0);
    expect(s.pendingEventChoice!.options.length).toBeGreaterThan(1); // at least one site + skip
    expect(s.pendingEventChoice!.options.some((o) => o.id === "skip")).toBe(true);

    const blocked = applyAction(s, { type: "drift" });
    expect(blocked.ok).toBe(false);
  });

  it("picking a site seeds and immediately loads a resource for the drawer", () => {
    const s0 = run(setup(1), { type: "drawBooster" });
    const site = s0.pendingEventChoice!.options.find((o) => o.id !== "skip")!;
    const cargoBefore = s0.players[0]!.cargo.length;
    const s = run(s0, { type: "resolveEventChoice", optionId: site.id });
    expect(s.pendingEventChoice).toBeNull();
    expect(s.players[0]!.cargo).toHaveLength(cargoBefore + 1);
    expect(s.log.some((e) => e.event === "eventOreLoaded")).toBe(true);
  });

  it("skipping leaves cargo and the board untouched", () => {
    const s0 = run(setup(1), { type: "drawBooster" });
    const cargoBefore = s0.players[0]!.cargo.length;
    const resourcesBefore = Object.keys(s0.board.resources).length;
    const s = run(s0, { type: "resolveEventChoice", optionId: "skip" });
    expect(s.pendingEventChoice).toBeNull();
    expect(s.players[0]!.cargo).toHaveLength(cargoBefore);
    expect(Object.keys(s.board.resources)).toHaveLength(resourcesBefore);
  });
});

describe("drawBooster with an event card", () => {
  it("never adds the event card to the drawer's hand, and still counts as this turn's draw", () => {
    let s = createGame({ seed: 1, colours: ["black", "white"], startPlayer: 0, upgradeAtStart: "none" });
    s = { ...s, phase: "start" };
    s = withEventOnTop(s, "pirate-ambush");
    const handBefore = s.players[0]!.hand.length;
    const result = run(s, { type: "drawBooster" });
    expect(result.players[0]!.hand).toHaveLength(handBefore); // event card never joins the hand
    expect(result.players[0]!.turn.boosterDrawn).toBe(true);
    expect(result.log.some((e) => e.event === "eventDrawn")).toBe(true);
  });
});
