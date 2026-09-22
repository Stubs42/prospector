import { describe, it, expect } from "vitest";
import { simulate, greedyBot, randomBot } from "./index.js";

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
