import { describe, it, expect } from "vitest";
import { createGame, applyAction } from "../engine/index.js";
import type { Action, GameState } from "../engine/index.js";
import { affordances, mkSeats, humansIn, waitingOn, formatLogEntry, driftPreview, burnCost } from "./index.js";

function run(s: GameState, a: Action): GameState {
  const r = applyAction(s, a);
  if (!r.ok) throw new Error(`${a.type}: ${r.error}`);
  return r.state;
}

describe("seats", () => {
  it("mkSeats / humansIn", () => {
    expect(mkSeats(1, 2)).toEqual(["human", "bot", "bot"]);
    expect(humansIn(mkSeats(3, 1))).toBe(3);
  });
  it("waitingOn is the active player outside combat", () => {
    const g = createGame({ seed: 1, colours: ["black", "red"] });
    expect(waitingOn(g)).toBe(g.activePlayerIndex);
  });
});

describe("affordances", () => {
  it("summarises the launch turn: place cells + plain draw/scrap, no burns yet", () => {
    const g = createGame({ seed: 3, colours: ["yellow", "black"], startPlayer: 0 });
    const a = affordances(g);
    expect(a.placeCells.length).toBeGreaterThan(0);
    expect(a.plainActions.map((x) => x.type).sort()).toEqual(["drawBooster", "scrapShip"]);
    expect(a.burnTargets).toHaveLength(0);
    expect(a.combat).toBeNull();
  });

  it("produces burn targets with cost + path after drift", () => {
    let g = createGame({ seed: 7, colours: ["red", "black"], startPlayer: 0 });
    g.board.resources = {};
    g.players[0]!.pose = { current: { q: 0, r: 0 }, previous: { q: 0, r: 0 }, atRest: true };
    g.players[0]!.placed = true;
    g.players[0]!.fuel = g.players[0]!.fuelMax;
    g = run(g, { type: "drawBooster" });
    while (g.players[0]!.hand.length > 3) g = run(g, { type: "discardBooster", cardId: g.players[0]!.hand[0]!.id });
    g = run(g, { type: "drift" });

    const a = affordances(g);
    expect(a.burnTargets.length).toBeGreaterThan(6);
    for (const t of a.burnTargets) {
      expect(t.path[t.path.length - 1]).toEqual(t.cell);
      expect(t.cost).toBe(burnCost(g, t.path.length));
    }
  });

  it("extraEngines widens the reachable set", () => {
    let g = createGame({ seed: 9, colours: ["yellow", "black"], startPlayer: 0 });
    g.board.resources = {};
    g.players[0]!.pose = { current: { q: 0, r: 0 }, previous: { q: 0, r: 0 }, atRest: true };
    g.players[0]!.placed = true;
    g = run(g, { type: "drawBooster" });
    while (g.players[0]!.hand.length > 3) g = run(g, { type: "discardBooster", cardId: g.players[0]!.hand[0]!.id });
    g = run(g, { type: "drift" });
    const base = affordances(g).burnTargets.length;
    const boosted = affordances(g, { extraEngines: 2 }).burnTargets.length;
    expect(boosted).toBeGreaterThan(base);
  });
});

describe("driftPreview", () => {
  it("is null for an at-rest ship, a coast target for a moving one", () => {
    const g = createGame({ seed: 1, colours: ["black", "red"] });
    expect(driftPreview(g)).toBeNull();
    g.players[g.activePlayerIndex]!.pose = {
      previous: { q: 0, r: 0 },
      current: { q: 1, r: 0 },
      atRest: false,
    };
    expect(driftPreview(g)).toEqual({ from: { q: 1, r: 0 }, at: { q: 2, r: 0 } });
  });
});

describe("formatLogEntry", () => {
  it("renders combat and burn lines", () => {
    const g = createGame({ seed: 1, colours: ["black", "red"] });
    expect(
      formatLogEntry(g, { turn: 3, player: 0, event: "burned", detail: { player: 0, cells: 2, fuelSpent: 2 } }),
    ).toBe("black burned 2 cells, 2 fuel");
    expect(
      formatLogEntry(g, {
        turn: 4,
        player: 1,
        event: "attackSucceeded",
        detail: { attacker: 1, defender: 0, attackTotal: 7, defenceTotal: 4, spoil: "green" },
      }),
    ).toContain("red takes a green from black");
  });
});
