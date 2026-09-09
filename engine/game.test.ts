import { describe, it, expect } from "vitest";
import { createGame, applyAction, score } from "./game.js";
import { legalActions } from "./index.js";
import type { Action, GameState } from "./types.js";

function run(state: GameState, action: Action): GameState {
  const r = applyAction(state, action);
  if (!r.ok) throw new Error(`action ${action.type} failed: ${r.error}`);
  return r.state;
}

describe("createGame", () => {
  const g = createGame({ seed: 5, colours: ["black", "red", "blue", "white"] });

  it("seats every player at rest on its own base with full fuel", () => {
    expect(g.players).toHaveLength(4);
    for (const p of g.players) {
      expect(p.pose.atRest).toBe(true);
      expect(p.fuel).toBe(p.fuelMax);
      // fuelMax is the ship's tanks, possibly + a fuelTanks equipment kept at setup
      expect(p.fuelMax).toBeGreaterThanOrEqual(g.config.modes.prospector.ships[p.colour].fuelTanks);
    }
  });

  it("holds the seeding invariant: players + 1 resources in play, all green", () => {
    const onBoard = Object.values(g.board.resources);
    expect(onBoard).toHaveLength(4 + 1);
    expect(onBoard.every((c) => c === "green")).toBe(true);
    // green supply started at 3 + perPlayer*4 = 7, minus the 5 seeded
    expect(g.supply.green).toBe(7 - 5);
    expect(g.supply.yellow).toBe(7);
  });

  it("builds full decks", () => {
    expect(g.decks.booster.draw).toHaveLength(45);
    // 36 equipment minus 4 players * 1 kept
    expect(g.decks.equipment.draw).toHaveLength(36 - 4);
  });
});

describe("a hand-driven turn", () => {
  it("draw -> drift -> burn (free departure cell) -> endMove -> endTurn", () => {
    let s = createGame({ seed: 3, colours: ["yellow", "black"], startPlayer: 0 });
    const y = () => s.players[0]!;
    const start = { ...y().pose.current };

    s = run(s, { type: "drawBooster" });
    expect(y().hand.length).toBeGreaterThanOrEqual(1);

    s = run(s, { type: "drift" }); // at rest -> no-op
    expect(y().pose.current).toEqual(start);

    // NE two cells out of the SW-corner base: (-9,9) -> (-8,8) -> (-7,7)
    s = run(s, { type: "burn", path: [{ q: -8, r: 8 }, { q: -7, r: 7 }] });
    expect(y().pose.current).toEqual({ q: -7, r: 7 });
    expect(y().pose.previous).toEqual(start);
    expect(y().fuel).toBe(y().fuelMax - 1); // 2 cells, 1 free

    s = run(s, { type: "endMove" });
    expect(s.phase).toBe("moved");
    s = run(s, { type: "endTurn" });
    expect(s.activePlayerIndex).toBe(1);
  });
});

describe("legalActions always offers a move until the game ends", () => {
  it("never strands the active player over a 300-action random walk", () => {
    let s = createGame({ seed: 11, colours: ["black", "red", "blue"] });
    for (let i = 0; i < 300 && !s.gameOver; i++) {
      const acts = legalActions(s);
      expect(acts.length).toBeGreaterThan(0);
      // deterministic pick: first action
      const r = applyAction(s, acts[0]!);
      expect(r.ok).toBe(true);
      s = r.state;
    }
  });
});

describe("scoring", () => {
  it("sums delivered ore by value", () => {
    const s = createGame({ seed: 1, colours: ["black", "red"] });
    s.players[0]!.delivered = ["green", "yellow", "red"]; // 1 + 2 + 3
    s.players[1]!.delivered = ["red", "red"]; // 6
    const { byPlayer, winnerIds } = score(s);
    expect(byPlayer).toEqual([6, 6]);
    expect(winnerIds).toEqual([0, 1]);
  });
});
