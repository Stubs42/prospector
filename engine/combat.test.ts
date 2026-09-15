import { describe, it, expect } from "vitest";
import { resolveCombat, pickSpoil } from "./combat.js";
import { createGame, applyAction } from "./game.js";
import type { Action, GameState, OreColour } from "./types.js";

describe("resolveCombat", () => {
  it("attacker wins on strictly greater total", () => {
    const o = resolveCombat(
      { attackerLasers: 3, defenderShields: 1, autoRepel: false },
      { attack: 4, defence: 5 },
      "strict-greater",
    );
    expect(o.attackTotal).toBe(7);
    expect(o.defenceTotal).toBe(6);
    expect(o.attackerWins).toBe(true);
  });

  it("ties go to the defender under strict-greater", () => {
    const o = resolveCombat(
      { attackerLasers: 2, defenderShields: 2, autoRepel: false },
      { attack: 3, defence: 3 },
      "strict-greater",
    );
    expect(o.attackerWins).toBe(false);
  });

  it("autoRepel always fails the attack", () => {
    const o = resolveCombat(
      { attackerLasers: 99, defenderShields: 0, autoRepel: true },
      { attack: 6, defence: 1 },
      "strict-greater",
    );
    expect(o.attackerWins).toBe(false);
  });
});

describe("pickSpoil", () => {
  const values = { green: 1, yellow: 2, red: 3 } as Record<OreColour, number>;
  it("takes the most valuable by default", () => {
    expect(pickSpoil(["green", "red", "yellow"], values, "most-valuable", (x) => x[0]!)).toBe("red");
  });
  it("takes the least valuable when configured", () => {
    expect(pickSpoil(["red", "yellow"], values, "least-valuable", (x) => x[0]!)).toBe("yellow");
  });
  it("returns null for empty cargo", () => {
    expect(pickSpoil([], values, "most-valuable", (x) => x[0]!)).toBeNull();
  });
});

function run(s: GameState, a: Action): GameState {
  const r = applyAction(s, a);
  if (!r.ok) throw new Error(`${a.type}: ${r.error}`);
  return r.state;
}

describe("full attack through the reducer", () => {
  it("adjacent ships fight and the winner takes a resource", () => {
    let s = createGame({ seed: 2, colours: ["black", "white"], startPlayer: 0, upgradeAtStart: "none" });
    // stage: put black (attacker) next to white (defender); white carries red; black lasers=2.
    s.players[0]!.pose = { current: { q: 0, r: 0 }, previous: { q: 0, r: 0 }, atRest: true };
    s.players[1]!.pose = { current: { q: 1, r: 0 }, previous: { q: 1, r: 0 }, atRest: true };
    s.players[1]!.cargo = ["red"];
    s.players[0]!.cargo = [];
    // fast-forward black's turn to the post-move phase
    s = run(s, { type: "drawBooster" });
    while (s.players[0]!.hand.length > 3) s = run(s, { type: "discardBooster", cardId: s.players[0]!.hand[0]!.id });
    s = run(s, { type: "drift" });
    s = run(s, { type: "endMove" });
    expect(s.phase).toBe("moved");

    s = run(s, { type: "attack", targetPlayerId: 1 });
    expect(s.pendingCombat?.awaiting).toBe("defend");
    s = run(s, { type: "combatDefend" });
    expect(s.pendingCombat?.awaiting).toBe("resolve");
    s = run(s, { type: "combatResolve" });

    const attackerGot = s.players[0]!.cargo.length === 1;
    const defenderKept = s.players[1]!.cargo.length === 1;
    // exactly one of these is true, depending on the (seeded) dice
    expect(attackerGot !== defenderKept).toBe(true);
    if (attackerGot) {
      expect(s.players[0]!.cargo).toEqual(["red"]);
      expect(s.pendingCombat).toBeNull();
    }
  });
});
