import { describe, it, expect } from "vitest";
import { simulate, greedyBot, randomBot, createGame, applyAction, boardFor } from "./index.js";
import { makeRng } from "./rng.js";
import type { Action, GameState } from "./index.js";

function run(s: GameState, a: Action): GameState {
  const r = applyAction(s, a);
  if (!r.ok) throw new Error(`${a.type}: ${r.error}`);
  return r.state;
}

describe("simulate", () => {
  it("greedy bots drive most games to a real finish and produce a result", () => {
    const s = simulate({
      games: 12,
      colours: ["black", "red", "blue"],
      bot: greedyBot,
      seed: 1,
    });
    expect(s.finished + s.stalled).toBe(12);
    // simple bot; a few games stall out — and since event cards were mixed into the booster
    // deck, a hyperspace-quake can now scatter or maroon ships mid-heuristic, so the greedy
    // bot (deliberately simple, doc'd as such) stalls out more often than before events
    // existed (was >=10/12; measured 7-11/12 across several seeds with events in the deck)
    expect(s.finished).toBeGreaterThanOrEqual(6);
    expect(s.avgTurns).toBeGreaterThan(0);
    const decided = Object.values(s.winsByColour).reduce((a, b) => a + b, 0);
    const draws = Math.round(s.drawRate * s.finished);
    expect(decided + draws).toBe(s.finished);
  });

  it("random bots terminate (finish or stall) without throwing", () => {
    const s = simulate({ games: 3, colours: ["black", "red"], bot: randomBot, seed: 7 });
    expect(s.finished + s.stalled).toBe(3);
  });

  it("is deterministic for a fixed seed", () => {
    const a = simulate({ games: 6, colours: ["black", "red", "blue"], seed: 4, bot: greedyBot });
    const b = simulate({ games: 6, colours: ["black", "red", "blue"], seed: 4, bot: greedyBot });
    expect(a).toEqual(b);
  });
});

describe("greedyBot", () => {
  it("leaves its own base instead of endlessly hopping between its own base cells when it already holds cargo there", () => {
    // reproduces a live bug: a salvage-cache event (or anything else that drops ore straight
    // into the hold without the ship ever having to travel for it) can leave a ship sitting
    // ON its own base, atRest, already "carrying" — the old scoreDest gave an unconditional
    // -1000 bonus to any base-cell destination whenever carrying, so hopping to a DIFFERENT
    // one of the ship's own 4 base cells scored as an irresistible "delivered!" every turn,
    // even though arriveHomeBaseIfAny (engine/game.ts) never actually delivers when the move
    // started on that same base — the bot sat bouncing in place forever, cargo undelivered.
    let s = createGame({ seed: 3, colours: ["yellow", "black"], startPlayer: 0, upgradeAtStart: "none" });
    s = run(s, { type: "placeShip", cell: s.players[0]!.pose.current });
    s = run(s, { type: "drawBooster" });
    while (s.players[0]!.hand.length > s.config.modes.prospector.ships.yellow.booster) {
      s = run(s, { type: "discardBooster", cardId: s.players[0]!.hand[0]!.id });
    }
    s.players[0]!.cargo = ["green"];
    const board = boardFor(s);
    const baseKeys = new Set(board.baseCells(s.players[0]!.homeBase).map((c) => `${c.q},${c.r}`));
    const startKey = `${s.players[0]!.pose.current.q},${s.players[0]!.pose.current.r}`;
    expect(baseKeys.has(startKey)).toBe(true); // confirms the premise: starting ON own base, carrying

    const action = greedyBot(s, makeRng(1));
    const next = run(s, action);
    const destKey = `${next.players[0]!.pose.current.q},${next.players[0]!.pose.current.r}`;
    expect(baseKeys.has(destKey)).toBe(false);
  });
});
