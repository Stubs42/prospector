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

describe("voluntary scrap", () => {
  it("is not offered before the ship is launched, but is at any point during the move after", () => {
    let s = createGame({ seed: 3, colours: ["yellow", "black"], startPlayer: 0 });
    const Y = () => s.players[0]!;

    // turn 1, before placeShip: no scrap yet
    expect(legalActions(s).some((a) => a.type === "scrapShip")).toBe(false);
    s = run(s, { type: "placeShip", cell: Y().pose.current });
    expect(legalActions(s).some((a) => a.type === "scrapShip")).toBe(true);

    s = run(s, { type: "drawBooster" });
    expect(legalActions(s).some((a) => a.type === "scrapShip")).toBe(true); // still, mid-move

    s = run(s, { type: "drift" }); // at rest -> no-op
    expect(legalActions(s).some((a) => a.type === "scrapShip")).toBe(true); // still, before burning

    const before = Y().pose.current;
    s = run(s, { type: "scrapShip" });
    expect(Y().pose.current).toEqual(before); // returned to (the same) base cell
    expect(Y().pose.atRest).toBe(true);
    expect(s.activePlayerIndex).toBe(1); // scrapping ends the turn
  });
});

describe("reserve fuel card", () => {
  it("is used up the instant it's played, not armed/staged for a later burn", () => {
    let s = createGame({ seed: 3, colours: ["yellow", "black"], startPlayer: 0 });
    const Y = () => s.players[0]!;

    s = run(s, { type: "placeShip", cell: Y().pose.current });
    s = run(s, { type: "drawBooster" });
    const card = { id: "test-fuel", deck: "booster" as const, type: "reserveFuel" as const, value: 3, effect: "" };
    Y().hand = [...Y().hand, card];
    Y().fuel = Math.max(0, Y().fuelMax - 2);
    const before = Y().fuel;
    const beforeDiscard = s.decks.booster.discard.length;

    expect(legalActions(s).some((a) => a.type === "useReserveFuel" && a.cardId === card.id)).toBe(true);
    s = run(s, { type: "useReserveFuel", cardId: card.id });

    expect(Y().fuel).toBe(Math.min(before + 3, Y().fuelMax));
    expect(Y().hand.some((c) => c.id === card.id)).toBe(false); // gone from hand
    expect(s.decks.booster.discard.length).toBe(beforeDiscard + 1); // ... into the discard pile
    expect(s.phase).toBe("start"); // playing it doesn't end/advance the move
  });

  it("isn't offered once fuel is already at max", () => {
    let s = createGame({ seed: 3, colours: ["yellow", "black"], startPlayer: 0 });
    const Y = () => s.players[0]!;
    s = run(s, { type: "placeShip", cell: Y().pose.current });
    s = run(s, { type: "drawBooster" });
    const card = { id: "test-fuel", deck: "booster" as const, type: "reserveFuel" as const, value: 3, effect: "" };
    Y().hand = [...Y().hand, card]; // fuel already at max from createGame

    expect(legalActions(s).some((a) => a.type === "useReserveFuel")).toBe(false);
    const r = applyAction(s, { type: "useReserveFuel", cardId: card.id });
    expect(r.ok).toBe(false);
  });
});

describe("homecoming upgrade pick", () => {
  it("a delivery pauses for a 3-card equipment choice, then applies it", () => {
    let s = createGame({ seed: 8, colours: ["yellow", "black"], startPlayer: 0 });
    const Y = () => s.players[0]!;
    Y().pose = { current: { q: -7, r: 7 }, previous: { q: -7, r: 7 }, atRest: true };
    Y().cargo = ["red"];
    s = run(s, { type: "drawBooster" });
    while (Y().hand.length > 3) s = run(s, { type: "discardBooster", cardId: Y().hand[0]!.id });
    s = run(s, { type: "drift" });
    s = run(s, { type: "burn", path: [{ q: -8, r: 8 }] }); // onto a yellow base cell
    s = run(s, { type: "endMove" });

    // paused on the choice — nothing else is legal
    expect(s.pendingEquipment).not.toBeNull();
    expect(s.pendingEquipment!.playerId).toBe(0);
    const acts = legalActions(s);
    expect(acts).toHaveLength(3);
    expect(acts.every((a) => a.type === "chooseEquipment")).toBe(true);
    expect(applyAction(s, { type: "endTurn" }).ok).toBe(false);

    const equipBefore = Y().equipment.length;
    const chosen = s.pendingEquipment!.cards[1]!;
    const others = s.pendingEquipment!.cards.filter((c) => c.id !== chosen.id).map((c) => c.id);
    s = run(s, { type: "chooseEquipment", cardId: chosen.id });

    expect(s.pendingEquipment).toBeNull();
    expect(s.phase).toBe("moved");
    expect(Y().equipment.length).toBe(equipBefore + 1);
    expect(Y().equipment.map((c) => c.id)).toContain(chosen.id);
    // the other two went to the bottom of the equipment draw pile
    const bottom = s.decks.equipment.draw.slice(-2).map((c) => c.id);
    expect(bottom.sort()).toEqual([...others].sort());
    // the choice resolved a real move — the turn can now end
    s = run(s, { type: "endTurn" });
    expect(s.activePlayerIndex).toBe(1);
  });
});

describe("launch base-cell choice", () => {
  it("lets the player pick any of their base cells on the first turn, once", () => {
    let s = createGame({ seed: 8, colours: ["green", "black"], startPlayer: 0 });
    const G = () => s.players[0]!;
    expect(G().placed).toBe(false);
    const opts = legalActions(s).filter((a) => a.type === "placeShip") as Extract<Action, { type: "placeShip" }>[];
    expect(opts.length).toBeGreaterThan(0);

    s = run(s, opts[0]!);
    expect(G().placed).toBe(true);
    expect(G().pose.current).toEqual(opts[0]!.cell);
    expect(G().pose.atRest).toBe(true);

    // no second choice, and drawing locks it anyway
    expect(legalActions(s).some((a) => a.type === "placeShip")).toBe(false);
    s = run(s, { type: "drawBooster" });
    const r = applyAction(s, { type: "placeShip", cell: opts[0]!.cell });
    expect(r.ok).toBe(false);
  });

  it("drawing without choosing keeps the default cell and locks the choice", () => {
    let s = createGame({ seed: 2, colours: ["blue", "red"], startPlayer: 0 });
    const before = { ...s.players[0]!.pose.current };
    s = run(s, { type: "drawBooster" });
    expect(s.players[0]!.placed).toBe(true);
    expect(s.players[0]!.pose.current).toEqual(before);
  });
});

describe("departing the home base", () => {
  it("keeps velocity when accelerating within the base cluster (no wrongful brake)", () => {
    let s = createGame({ seed: 3, colours: ["blue", "black"], startPlayer: 0 });
    const B = () => s.players[0]!;
    const start = { ...B().pose.current }; // (9,-9)
    expect(B().pose.atRest).toBe(true);

    s = run(s, { type: "drawBooster" });
    while (B().hand.length > 3) s = run(s, { type: "discardBooster", cardId: B().hand[0]!.id });
    s = run(s, { type: "drift" }); // at rest -> no-op

    // free departure step onto another blue base cell
    s = run(s, { type: "burn", path: [{ q: 8, r: -8 }] });
    expect(B().fuel).toBe(B().fuelMax); // 1 cell, all free
    s = run(s, { type: "endMove" });

    // still departing -> ship is NOT braked, velocity is preserved
    expect(B().pose.atRest).toBe(false);
    expect(B().pose.current).toEqual({ q: 8, r: -8 });
    expect(B().pose.previous).toEqual(start);
    s = run(s, { type: "endTurn" });

    // next turn it actually coasts
    s = run(s, { type: "drawBooster" }); // black's turn
    while (s.players[1]!.hand.length > 3) s = run(s, { type: "discardBooster", cardId: s.players[1]!.hand[0]!.id });
    s = run(s, { type: "drift" });
    s = run(s, { type: "endMove" });
    s = run(s, { type: "endTurn" });

    s = run(s, { type: "drawBooster" }); // blue again
    s = run(s, { type: "drift" });
    expect(B().pose.current).toEqual({ q: 7, r: -7 }); // (8,-8) + velocity (-1,+1)
  });
});

describe("burn options can turn", () => {
  it("legalActions offers reachable cells off the straight lines", () => {
    let s = createGame({ seed: 7, colours: ["red", "black"], startPlayer: 0 });
    s.board.resources = {};
    const R = () => s.players[0]!;
    R().pose = { current: { q: 0, r: 0 }, previous: { q: 0, r: 0 }, atRest: true }; // at rest, mid-field
    R().placed = true;
    R().fuel = R().fuelMax;
    s = run(s, { type: "drawBooster" });
    while (R().hand.length > 3) s = run(s, { type: "discardBooster", cardId: R().hand[0]!.id });
    s = run(s, { type: "drift" });

    const burns = legalActions(s).filter((a) => a.type === "burn") as Extract<Action, { type: "burn" }>[];
    // Hermes has 2 engines -> reachable disc of radius 2 = 18 cells (minus none blocked)
    expect(burns.length).toBeGreaterThan(12);
    const bent = burns.find(
      (b) => b.path.length === 2 && !areColinear(b.path[0]!, b.path[1]!, R().pose.current),
    );
    expect(bent).toBeTruthy();
    // and the engine accepts the bent path
    const applied = applyAction(s, bent!);
    expect(applied.ok).toBe(true);
  });
});

function areColinear(a: { q: number; r: number }, b: { q: number; r: number }, from: { q: number; r: number }) {
  const d1 = { q: a.q - from.q, r: a.r - from.r };
  const d2 = { q: b.q - a.q, r: b.r - a.r };
  return d1.q === d2.q && d1.r === d2.r;
}

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
