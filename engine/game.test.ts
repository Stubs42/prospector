import { describe, it, expect } from "vitest";
import { createGame, applyAction, score, boardFor, equipmentRerollEligible } from "./game.js";
import { legalActions, randomBot } from "./index.js";
import { makeRng } from "./rng.js";
import type { Action, GameState, SeatKind } from "./types.js";

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

  it("logs each seeded tile's 3 coordinate dice, for a GUI to replay as a spin animation", () => {
    const seeded = g.log.filter((l) => l.event === "resourceSeeded");
    expect(seeded.length).toBeGreaterThan(0);
    for (const entry of seeded) {
      const dice = entry.detail!.dice as { step: number; colour: string }[];
      expect(dice).toHaveLength(3);
      expect(dice.map((d) => d.step).sort()).toEqual([1, 2, 3]);
      expect(entry.detail!.cell).toBeDefined();
    }
  });

  it("builds full decks", () => {
    expect(g.decks.booster.draw).toHaveLength(45);
    // 36 equipment minus 4 players * 3 drawn (default upgradeAtStart "select" — pending until chosen)
    expect(g.decks.equipment.draw).toHaveLength(36 - 4 * 3);
  });

  it("defaults homeBase to colour (the classic fixed pairing) when `bases` is omitted", () => {
    for (const p of g.players) expect(p.homeBase).toBe(p.colour);
  });
});

describe("base picked independently of ship colour", () => {
  const board = boardFor(createGame({ seed: 1 }));
  // black's ship stats/visuals, but sitting at the blue base — a permutation with no overlap
  const s0 = createGame({ seed: 5, colours: ["black", "red"], bases: ["blue", "white"] });
  const P = () => s0.players[0]!;

  it("starts on its home base's cells, not its ship colour's", () => {
    const blueCells = board.baseCells("blue");
    const blackCells = board.baseCells("black");
    expect(blueCells.some((c) => c.q === P().pose.current.q && c.r === P().pose.current.r)).toBe(true);
    expect(blackCells.some((c) => c.q === P().pose.current.q && c.r === P().pose.current.r)).toBe(false);
  });

  it("still uses its ship colour's stats", () => {
    const mode = s0.config.modes.prospector;
    for (const key of ["shields", "lasers", "fuelTanks", "cargo", "engines", "booster"] as const) {
      expect(mode.ships[P().colour][key]).toBe(mode.ships.black[key]);
    }
  });

  it("offers the home-base cells (not the ship-colour cells) as launch choices", () => {
    let s = s0;
    const opts = legalActions(s).filter((a) => a.type === "placeShip") as Extract<Action, { type: "placeShip" }>[];
    const blueCells = board.baseCells("blue");
    expect(opts).toHaveLength(blueCells.length);
    for (const o of opts) expect(blueCells.some((c) => c.q === o.cell.q && c.r === o.cell.r)).toBe(true);
    s = run(s, { type: "placeShip", cell: opts[0]!.cell });
    expect(s.players[0]!.placed).toBe(true);
  });

  it("rejects a placeShip on the ship-colour's (non-home) base cells", () => {
    const blackCells = board.baseCells("black");
    const r = applyAction(s0, { type: "placeShip", cell: blackCells[0]! });
    expect(r.ok).toBe(false);
  });
});

describe("a hand-driven turn", () => {
  it("draw -> drift -> burn (free departure cell) -> endMove -> endTurn", () => {
    let s = createGame({ seed: 3, colours: ["yellow", "black"], startPlayer: 0, upgradeAtStart: "none" });
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
    let s = createGame({ seed: 3, colours: ["yellow", "black"], startPlayer: 0, upgradeAtStart: "none" });
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
    let s = createGame({ seed: 8, colours: ["yellow", "black"], startPlayer: 0, upgradeAtStart: "none" });
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

describe("equipment reroll", () => {
  it("offers a reroll only when all 3 offered cards are identical, and it's capped at 1 use", () => {
    let s = createGame({ seed: 8, colours: ["yellow", "black"], startPlayer: 0, upgradeAtStart: "none" });
    const Y = () => s.players[0]!;
    Y().pose = { current: { q: -7, r: 7 }, previous: { q: -7, r: 7 }, atRest: true };
    Y().cargo = ["red"];
    s = run(s, { type: "drawBooster" });
    while (Y().hand.length > 3) s = run(s, { type: "discardBooster", cardId: Y().hand[0]!.id });
    s = run(s, { type: "drift" });
    s = run(s, { type: "burn", path: [{ q: -8, r: 8 }] }); // onto a yellow base cell
    s = run(s, { type: "endMove" });
    expect(s.pendingEquipment).not.toBeNull();

    // force the 3-card offer into 3 identical cards
    const dupe = { ...s.pendingEquipment!.cards[0]!, stat: "cargo" as const, amount: 1 };
    s = {
      ...s,
      pendingEquipment: {
        ...s.pendingEquipment!,
        cards: [dupe, { ...dupe, id: "dupe-2" }, { ...dupe, id: "dupe-3" }],
      },
    };
    expect(equipmentRerollEligible(s.pendingEquipment!)).toBe(true);
    expect(legalActions(s).some((a) => a.type === "rerollEquipment")).toBe(true);

    const before = s.pendingEquipment!.cards.map((c) => c.id);
    s = run(s, { type: "rerollEquipment" });
    expect(s.pendingEquipment).not.toBeNull();
    expect(s.pendingEquipment!.rerollsUsed).toBe(1);
    // the 3 rejected duplicates went to the bottom of the deck
    expect(s.decks.equipment.draw.slice(-3).map((c) => c.id)).toEqual(before);
    // still a real 3-card choice
    expect(legalActions(s).filter((a) => a.type === "chooseEquipment")).toHaveLength(3);

    // even if the reroll also comes up identical, no second reroll is offered
    const dupe2 = { ...s.pendingEquipment!.cards[0]! };
    s = { ...s, pendingEquipment: { ...s.pendingEquipment!, cards: [dupe2, { ...dupe2, id: "d2" }, { ...dupe2, id: "d3" }] } };
    expect(equipmentRerollEligible(s.pendingEquipment!)).toBe(false);
    expect(legalActions(s).some((a) => a.type === "rerollEquipment")).toBe(false);
    expect(applyAction(s, { type: "rerollEquipment" }).ok).toBe(false);
  });

  it("isn't offered when the 3 cards differ", () => {
    let s = createGame({ seed: 3, colours: ["yellow", "black"], startPlayer: 0 });
    const Y = () => s.players[0]!;
    s = run(s, { type: "drawBooster" });
    while (Y().hand.length > 3) s = run(s, { type: "discardBooster", cardId: Y().hand[0]!.id });
    s = run(s, { type: "drift" });
    expect(s.pendingEquipment).not.toBeNull();
    // seed 3's start-equipment draw isn't 3 identical cards
    expect(equipmentRerollEligible(s.pendingEquipment!)).toBe(false);
    expect(legalActions(s).some((a) => a.type === "rerollEquipment")).toBe(false);
  });
});

describe("upgrade at game start", () => {
  it("defaults to \"select\": drift raises a pending 3-card choice before burn is offered", () => {
    let s = createGame({ seed: 3, colours: ["yellow", "black"], startPlayer: 0 });
    const Y = () => s.players[0]!;
    s = run(s, { type: "drawBooster" });
    while (Y().hand.length > 3) s = run(s, { type: "discardBooster", cardId: Y().hand[0]!.id });
    expect(Y().equipment).toHaveLength(0); // nothing auto-granted yet

    s = run(s, { type: "drift" });
    expect(s.pendingEquipment).not.toBeNull();
    expect(s.pendingEquipment).toMatchObject({ playerId: 0, reason: "start", mode: "select" });
    const acts = legalActions(s);
    expect(acts).toHaveLength(3);
    expect(acts.every((a) => a.type === "chooseEquipment")).toBe(true);
    expect(applyAction(s, { type: "burn", path: [{ q: -8, r: 8 }] }).ok).toBe(false);

    const chosen = s.pendingEquipment!.cards[0]!;
    s = run(s, { type: "chooseEquipment", cardId: chosen.id });
    expect(s.pendingEquipment).toBeNull();
    expect(s.phase).toBe("start"); // resumed right where drift left off — burn is available again
    expect(Y().equipment.map((c) => c.id)).toContain(chosen.id);
    expect(applyAction(s, { type: "burn", path: [{ q: -8, r: 8 }] }).ok).toBe(true);
  });

  it("\"none\" never grants or pends any starting equipment", () => {
    let s = createGame({ seed: 3, colours: ["yellow", "black"], startPlayer: 0, upgradeAtStart: "none" });
    const Y = () => s.players[0]!;
    s = run(s, { type: "drawBooster" });
    while (Y().hand.length > 3) s = run(s, { type: "discardBooster", cardId: Y().hand[0]!.id });
    s = run(s, { type: "drift" });
    expect(s.pendingEquipment).toBeNull();
    expect(Y().equipment).toHaveLength(0);
    expect(applyAction(s, { type: "burn", path: [{ q: -8, r: 8 }] }).ok).toBe(true);
  });

  it("\"random\" pends the same 3-card draw, tagged so a GUI knows to auto-spin", () => {
    let s = createGame({ seed: 3, colours: ["yellow", "black"], startPlayer: 0, upgradeAtStart: "random" });
    const Y = () => s.players[0]!;
    s = run(s, { type: "drawBooster" });
    while (Y().hand.length > 3) s = run(s, { type: "discardBooster", cardId: Y().hand[0]!.id });
    s = run(s, { type: "drift" });
    expect(s.pendingEquipment).toMatchObject({ playerId: 0, reason: "start", mode: "random" });
    expect(s.pendingEquipment!.cards).toHaveLength(3);
    // resolution is still a plain chooseEquipment — the client just picks which one to dispatch
    s = run(s, { type: "chooseEquipment", cardId: s.pendingEquipment!.cards[2]!.id });
    expect(s.pendingEquipment).toBeNull();
    expect(Y().equipment).toHaveLength(1);
  });

  it("interactive setup (finishSetup) threads upgradeAtStart through too", () => {
    let s = createGame({ seed: 4, seats: ["human", "human"], upgradeAtStart: "none" });
    while (s.setup) {
      const acts = legalActions(s);
      s = run(s, acts[0]!);
    }
    for (const p of s.players) expect(p.startEquipment).toBeNull();
    s = run(s, { type: "drawBooster" });
    while (s.players[0]!.hand.length > 3) {
      s = run(s, { type: "discardBooster", cardId: s.players[0]!.hand[0]!.id });
    }
    s = run(s, { type: "drift" });
    expect(s.pendingEquipment).toBeNull(); // "none" carried through the interactive setup path too
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
    let s = createGame({ seed: 3, colours: ["blue", "black"], startPlayer: 0, upgradeAtStart: "none" });
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
    let s = createGame({ seed: 7, colours: ["red", "black"], startPlayer: 0, upgradeAtStart: "none" });
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

describe("burn can cross outer cells on the way to an inner destination", () => {
  it("doesn't strand a ship that drifted into the outer ring", () => {
    // (10,0) is one ring outside the inner/outer boundary (innerRadius 9). Regression for a
    // bug where a drift landing in the outer ring wrongly scrapped the ship even when an
    // inner cell was perfectly reachable: legalActions' burn BFS only ever expanded through
    // INNER cells, so any path that had to pass through another outer cell first (even just
    // to turn a corner) was never found.
    let s = createGame({ seed: 7, colours: ["red", "black"], startPlayer: 0, upgradeAtStart: "none" });
    s.board.resources = {};
    const R = () => s.players[0]!;
    R().pose = { current: { q: 10, r: 0 }, previous: { q: 10, r: 0 }, atRest: true };
    R().placed = true;
    R().fuel = R().fuelMax;
    s = run(s, { type: "drawBooster" });
    while (R().hand.length > 3) s = run(s, { type: "discardBooster", cardId: R().hand[0]!.id });
    s = run(s, { type: "drift" }); // at rest -> no-op, still at (10,0)

    const board = boardFor(s);
    const burns = legalActions(s).filter((a) => a.type === "burn") as Extract<Action, { type: "burn" }>[];
    expect(burns.length).toBeGreaterThan(0);
    expect(burns.every((b) => board.isInner(b.path[b.path.length - 1]!))).toBe(true);

    // an outer cell is still accepted as an intermediate path step, not just tolerated as a
    // starting point — apply a path that deliberately detours through one
    const applied = applyAction(s, { type: "burn", path: [{ q: 10, r: -1 }, { q: 9, r: -1 }] });
    expect(applied.ok).toBe(true);
    expect(applied.state.players[0]!.pose.current).toEqual({ q: 9, r: -1 });
  });

  it("flies over a resource blocking the direct route, at the target's true (shorter) distance", () => {
    // Regression: legalActions' burn BFS used to treat a resource cell as an impassable
    // wall for TRAVERSAL (not just as an illegal destination), even though movement.ts's own
    // burn() never enforced that — a resource directly in a burn's path forced a detour (or
    // made the cell behind it unreachable within the step budget entirely), when a real
    // burn straight over that resource would have succeeded. Ships already fly over other
    // ships the same way; resources now do too — only the destination cell must be clear.
    let s = createGame({ seed: 7, colours: ["red", "black"], startPlayer: 0, upgradeAtStart: "none" });
    s.board.resources = { "1,0": "green" }; // directly between the ship and its target
    const R = () => s.players[0]!;
    R().pose = { current: { q: 0, r: 0 }, previous: { q: 0, r: 0 }, atRest: true };
    R().placed = true;
    R().fuel = R().fuelMax;
    s = run(s, { type: "drawBooster" });
    while (R().hand.length > 3) s = run(s, { type: "discardBooster", cardId: R().hand[0]!.id });
    s = run(s, { type: "drift" });

    const burns = legalActions(s).filter((a) => a.type === "burn") as Extract<Action, { type: "burn" }>[];
    // the resource cell itself is never a legal destination
    expect(burns.some((b) => b.path[b.path.length - 1]!.q === 1 && b.path[b.path.length - 1]!.r === 0)).toBe(false);
    // (2,0) is genuinely 2 cells away in a straight line through the resource — reachable
    // at that true distance/fuel cost, not some inflated detour-around-it cost
    const target = burns.find((b) => b.path[b.path.length - 1]!.q === 2 && b.path[b.path.length - 1]!.r === 0);
    expect(target).toBeTruthy();
    expect(target!.path).toHaveLength(2);
    expect(target!.path[0]).toEqual({ q: 1, r: 0 }); // flies straight over the resource
    const applied = applyAction(s, target!);
    expect(applied.ok).toBe(true);
    expect(applied.state.players[0]!.fuel).toBe(R().fuelMax - 2); // paid for 2 cells, not more
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

describe("interactive setup: per seat, pickBase -> pickShip; then rollOff -> finishSetup", () => {
  const seats: SeatKind[] = ["human", "human", "bot"];

  it("createGame({ seats }) starts pending at pickBase, no players yet", () => {
    const s = createGame({ seed: 1, seats });
    expect(s.setup).not.toBeNull();
    expect(s.setup!.stage).toBe("pickBase");
    expect(s.players).toHaveLength(0);
    const acts = legalActions(s);
    expect(acts).toHaveLength(6); // all 6 base colours free
    expect(acts.every((a) => a.type === "pickBase")).toBe(true);
  });

  it("each seat picks its base then immediately its ship, before the next seat's turn", () => {
    let s = createGame({ seed: 7, seats });

    for (let i = 0; i < seats.length; i++) {
      expect(s.setup!.stage).toBe("pickBase");
      expect(s.setup!.turnIndex).toBe(i);
      const baseActs = legalActions(s).filter((a) => a.type === "pickBase") as Extract<Action, { type: "pickBase" }>[];
      expect(baseActs).toHaveLength(6 - i);
      s = run(s, baseActs[0]!);
      expect(s.setup!.bases[i]).toBe(baseActs[0]!.base);
      // the same seat's ship pick is offered next, not the next seat's base
      expect(s.setup!.stage).toBe("pickShip");
      expect(s.setup!.turnIndex).toBe(i);
      expect(s.setup!.colours[i]).toBeNull();

      const shipActs = legalActions(s).filter((a) => a.type === "pickShip") as Extract<Action, { type: "pickShip" }>[];
      expect(shipActs).toHaveLength(6 - i);
      s = run(s, shipActs[0]!);
      expect(s.setup!.colours[i]).toBe(shipActs[0]!.colour);
    }

    // every seat has both now — parked in rollOff with an already-decided winner
    expect(s.setup!.stage).toBe("rollOff");
    expect(s.setup!.bases.every((b) => b !== null)).toBe(true);
    expect(s.setup!.colours.every((c) => c !== null)).toBe(true);
    const winner = s.setup!.startSeat!;
    expect(winner).toBeGreaterThanOrEqual(0);
    expect(winner).toBeLessThan(seats.length);
    expect(s.log.some((l) => l.event === "startPlayerChosen")).toBe(true);
    expect(legalActions(s)).toEqual([{ type: "finishSetup" }]);

    // finishSetup finalizes into a real game
    s = run(s, { type: "finishSetup" });
    expect(s.setup).toBeNull();
    expect(s.phase).toBe("start");
    expect(s.turnNumber).toBe(1);
    expect(s.activePlayerIndex).toBe(winner);
    expect(s.players).toHaveLength(seats.length);
    for (const p of s.players) {
      expect(p.pose.atRest).toBe(true);
      expect(p.fuel).toBe(p.fuelMax);
    }
  });

  it("rejects picking an already-taken base or ship", () => {
    let s = createGame({ seed: 2, seats: ["human", "human"] });
    const base = (legalActions(s)[0] as Extract<Action, { type: "pickBase" }>).base;
    s = run(s, { type: "pickBase", base });
    // seat 0 is now picking its ship — seat 1 can't have that base either, later
    s = run(s, (legalActions(s)[0] as Extract<Action, { type: "pickShip" }>));
    expect(applyAction(s, { type: "pickBase", base }).ok).toBe(false);
  });

  it("activePlayerIndex always points at whoever is up next, for a client's bot-turn check", () => {
    let s = createGame({ seed: 4, seats: ["human", "bot", "human"] });
    for (let i = 0; i < seats.length; i++) {
      expect(s.activePlayerIndex).toBe(i); // base then ship, same seat both times
      const baseActs = legalActions(s).filter((a) => a.type === "pickBase") as Extract<Action, { type: "pickBase" }>[];
      s = run(s, baseActs[0]!);
      expect(s.activePlayerIndex).toBe(i);
      const shipActs = legalActions(s).filter((a) => a.type === "pickShip") as Extract<Action, { type: "pickShip" }>[];
      s = run(s, shipActs[0]!);
    }
    expect(s.setup!.stage).toBe("rollOff");
    s = run(s, { type: "finishSetup" });
    expect(s.setup).toBeNull();
  });

  it("randomBot can play an entire setup to completion without crashing", () => {
    const rng = makeRng(99);
    for (let seed = 1; seed <= 5; seed++) {
      let s = createGame({ seed, seats: ["human", "bot", "bot", "human"] });
      let guard = 0;
      while (s.setup && guard++ < 200) {
        const r = applyAction(s, randomBot(s, rng));
        expect(r.ok).toBe(true);
        s = r.state;
      }
      expect(s.setup).toBeNull();
      expect(s.players).toHaveLength(4);
    }
  });
});
