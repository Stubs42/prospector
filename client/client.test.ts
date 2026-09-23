import { describe, it, expect } from "vitest";
import { createGame, applyAction, boardFor } from "../engine/index.js";
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
  it("summarises the launch turn: place cells + plain draw, no scrap before launch", () => {
    const g = createGame({ seed: 3, colours: ["yellow", "black"], startPlayer: 0 });
    const a = affordances(g);
    expect(a.placeCells.length).toBeGreaterThan(0);
    // an unlaunched ship can't be scrapped — that option only appears once placed
    expect(a.plainActions.map((x) => x.type).sort()).toEqual(["drawBooster"]);
    expect(a.burnTargets).toHaveLength(0);
    expect(a.combat).toBeNull();
  });

  it("flags overLimit even though scrapShip is also legal (voluntary scrap is always available)", () => {
    let g = createGame({ seed: 3, colours: ["yellow", "black"], startPlayer: 0 });
    g = run(g, { type: "placeShip", cell: g.players[0]!.pose.current });
    g = run(g, { type: "drawBooster" });
    // force the hand well over the limit
    g.players[0]!.hand = [...g.players[0]!.hand, ...g.decks.booster.draw.slice(0, 5)];
    const a = affordances(g);
    expect(a.overLimit).toBe(true);
    expect(a.legal.some((x) => x.type === "scrapShip")).toBe(true);
    expect(a.legal.some((x) => x.type === "discardBooster")).toBe(true);
  });

  it("produces burn targets with cost + path after drift", () => {
    let g = createGame({ seed: 7, colours: ["red", "black"], startPlayer: 0, upgradeAtStart: "none" });
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

  it("prices a free base-departure burn correctly BEFORE the implicit drift has actually run", () => {
    // drift/burn are one decision now (see engine/index.ts's legalActions) — driftDone is
    // still false for almost this whole window, so p.turn.moveStartedOnOwnBase (a real side
    // effect of ensureDrifted, engine/game.ts) hasn't been set yet either, even though the
    // ship is plainly sitting on its own base right now. burnCost/freeBurnCells (client/
    // preview.ts) must speculate that the same way legalActions itself does, or a genuinely
    // free 1-cell departure burn prices as costing real fuel — found live: a 0-fuel ship on
    // its own base showed every reachable cell as a paid burn target (no "◇" diamond) instead
    // of the free departure cells the engine was actually offering them for free.
    const g = createGame({ seed: 3, colours: ["yellow", "black"], startPlayer: 0, upgradeAtStart: "none" });
    const placed = run(g, { type: "placeShip", cell: g.players[0]!.pose.current });
    let s = run(placed, { type: "drawBooster" });
    while (s.players[0]!.hand.length > s.config.modes.prospector.ships.yellow.booster) {
      s = run(s, { type: "discardBooster", cardId: s.players[0]!.hand[0]!.id });
    }
    s.players[0]!.fuel = 0; // no fuel at all — only the free base-departure cell can move it
    expect(s.players[0]!.turn.driftDone).toBe(false);
    expect(boardFor(s).baseOwnerAt(s.players[0]!.pose.current) === s.players[0]!.homeBase).toBe(true);
    const a = affordances(s);
    expect(a.burnTargets.length).toBeGreaterThan(0);
    for (const t of a.burnTargets) expect(t.cost).toBe(0);
  });

  it("extraEngines widens the reachable set", () => {
    let g = createGame({ seed: 9, colours: ["yellow", "black"], startPlayer: 0, upgradeAtStart: "none" });
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

  it("flags avoidableShipLoss when out of fuel but a reserve-fuel card could still reach a burn target", () => {
    let g = createGame({ seed: 7, colours: ["red", "black"], startPlayer: 0, upgradeAtStart: "none" });
    g.board.resources = {};
    // moving at velocity (1,0) from the inner boundary drifts one ring further out, onto
    // (10,0) — an outer cell, so this drift itself forces mustBurn
    g.players[0]!.pose = { current: { q: 9, r: 0 }, previous: { q: 8, r: 0 }, atRest: false };
    g.players[0]!.placed = true;
    g.players[0]!.fuel = 0;
    const card = { id: "test-fuel", deck: "booster" as const, type: "reserveFuel" as const, value: 3, effect: "" };
    g = run(g, { type: "drawBooster" });
    // drawBooster may have already dealt a real reserve-fuel card of its own — filter it out
    // first, so the only one in hand after adding ours is the one this test actually plays
    // (otherwise a second, still-unplayed reserve-fuel card legitimately keeps
    // avoidableShipLoss flagged below, since it could genuinely still help too)
    g.players[0]!.hand = [...g.players[0]!.hand.filter((c) => c.type !== "reserveFuel"), card];
    while (g.players[0]!.hand.length > 4) g = run(g, { type: "discardBooster", cardId: g.players[0]!.hand.find((c) => c.id !== card.id)!.id });
    g = run(g, { type: "drift" }); // carries the ship onto the outer cell (10,0) -> mustBurn

    let a = affordances(g);
    expect(g.players[0]!.turn.mustBurn).toBe(true);
    expect(a.burnTargets).toHaveLength(0); // 0 fuel, no free cells here -> nothing affordable yet
    expect(a.legal.some((x) => x.type === "useReserveFuel")).toBe(true);
    expect(a.avoidableShipLoss).toBe(true); // a GUI's auto-advance must not fire endMove here

    g = run(g, { type: "useReserveFuel", cardId: card.id });
    a = affordances(g);
    expect(a.burnTargets.length).toBeGreaterThan(0); // refuelling opened up real burn targets
    expect(a.avoidableShipLoss).toBe(false); // resolved — safe to auto-advance again if forced
  });

  it("flags avoidableShipLoss BEFORE drift too, when the tank is empty and a reserve-fuel card could still open up burn targets", () => {
    // drift and burn are one decision now (see engine/index.ts's legalActions) — a 0-fuel
    // player must see this same protection before the (now implicit) drift has even run,
    // not just after — this is exactly the deadlock reported live: driftDone was false, the
    // old avoidableZeroFuelDrift blocked auto-advance, but nothing else offered a way forward.
    // At rest, off their own base (no free departure cells), so 0 fuel truly means 0 burn
    // targets until a card helps — isolates this from the free-departure-cell case below.
    let g = createGame({ seed: 7, colours: ["red", "black"], startPlayer: 0, upgradeAtStart: "none" });
    g.players[0]!.pose = { current: { q: 9, r: 0 }, previous: { q: 9, r: 0 }, atRest: true };
    g.players[0]!.placed = true;
    g.players[0]!.fuel = 0;
    const card = { id: "test-fuel", deck: "booster" as const, type: "reserveFuel" as const, value: 3, effect: "" };
    g = run(g, { type: "drawBooster" });
    g.players[0]!.hand = [...g.players[0]!.hand.filter((c) => c.type !== "reserveFuel"), card];
    while (g.players[0]!.hand.length > 4) {
      g = run(g, { type: "discardBooster", cardId: g.players[0]!.hand.find((c) => c.id !== card.id)!.id });
    }

    let a = affordances(g);
    expect(g.players[0]!.turn.driftDone).toBe(false);
    // the free "stay here" option is already offered, pre-drift — this is the fix
    expect(a.legal.some((x) => x.type === "endMove")).toBe(true);
    expect(a.legal.some((x) => x.type === "burn")).toBe(false); // nothing affordable yet
    expect(a.legal.some((x) => x.type === "useReserveFuel")).toBe(true);
    expect(a.avoidableShipLoss).toBe(true); // a GUI's auto-advance must not fire endMove here

    g = run(g, { type: "useReserveFuel", cardId: card.id });
    a = affordances(g);
    expect(g.players[0]!.fuel).toBeGreaterThan(0);
    expect(a.burnTargets.length).toBeGreaterThan(0); // refuelling opened up real burn targets
    expect(a.avoidableShipLoss).toBe(false); // resolved — safe to auto-advance again if forced
  });

  it("lets the free option auto-fire for a 0-fuel player with no helpful card", () => {
    let g = createGame({ seed: 7, colours: ["red", "black"], startPlayer: 0, upgradeAtStart: "none" });
    g.players[0]!.pose = { current: { q: 9, r: 0 }, previous: { q: 9, r: 0 }, atRest: true };
    g.players[0]!.placed = true;
    g.players[0]!.fuel = 0;
    g = run(g, { type: "drawBooster" });
    g.players[0]!.hand = g.players[0]!.hand.filter((c) => c.type !== "reserveFuel" && c.type !== "engine");
    const a = affordances(g);
    expect(g.players[0]!.turn.driftDone).toBe(false);
    expect(a.legal.some((x) => x.type === "endMove")).toBe(true);
    expect(a.legal.some((x) => x.type === "useReserveFuel")).toBe(false);
    // no card could change the outcome — safe for a GUI's auto-advance to just proceed
    expect(a.avoidableShipLoss).toBe(false);
  });

  it("flags avoidableShipLoss for a FORCED sole 0-cost burn too, not just a sole endMove", () => {
    // reported live: an unsafe landing (blocked by another ship) with 0 fuel left exactly one
    // free (base-departure-cell) burn target reachable and no endMove at all — the old check
    // only ever looked at "is endMove the sole option", so this forced-but-still-improvable
    // single burn auto-fired instantly, never giving the player a chance to play their unused
    // reserve-fuel card first and see if it opened up a real (non-forced) choice instead
    let g = createGame({ seed: 3, colours: ["yellow", "black"], startPlayer: 0, upgradeAtStart: "none" });
    const base = g.players[0]!.pose.current;
    const board = boardFor(g);
    const before = board.neighbours(base)[0]!; // a real neighbour, "behind" the base
    const driftTarget = { q: base.q + (base.q - before.q), r: base.r + (base.r - before.r) };
    g.players[0]!.pose = { current: base, previous: before, atRest: false }; // still moving, on own base
    g.players[0]!.placed = true;
    g.players[0]!.fuel = 0;
    const card = { id: "test-fuel", deck: "booster" as const, type: "reserveFuel" as const, value: 3, effect: "" };
    g = run(g, { type: "drawBooster" });
    g.players[0]!.hand = [...g.players[0]!.hand.filter((c) => c.type !== "reserveFuel"), card];
    while (g.players[0]!.hand.length > 4) g = run(g, { type: "discardBooster", cardId: g.players[0]!.hand.find((c) => c.id !== card.id)!.id });
    // block the natural drift landing with the other ship, forcing a burn away from it
    g.players[1]!.pose = { current: driftTarget, previous: driftTarget, atRest: true };
    g.players[1]!.placed = true;

    const a = affordances(g);
    expect(a.legal.some((x) => x.type === "endMove")).toBe(false); // landing unsafe, no free "stay"
    expect(a.legal.some((x) => x.type === "useReserveFuel")).toBe(true);
    expect(a.burnTargets.some((t) => t.cost === 0)).toBe(true); // a real, free escape burn exists
    expect(a.avoidableShipLoss).toBe(true); // must not auto-fire that forced burn yet
  });

  it("does NOT flag avoidableShipLoss once a real burn already happened, even holding an unplayed engine card", () => {
    // found live: a completed move (a real burn already happened) sat showing a stray "0"
    // coast ring instead of auto-advancing to end the turn, because the player still held an
    // unplayed engine card — irrelevant once turn.moved is true (set only by a real burn/
    // hyperspace, not by endMove's own "coast" use), since arming it can no longer change
    // anything about a move that's already finished
    let g = createGame({ seed: 3, colours: ["yellow", "black"], startPlayer: 0, upgradeAtStart: "none" });
    const Y = () => g.players[0]!;
    g = run(g, { type: "placeShip", cell: Y().pose.current });
    g = run(g, { type: "drawBooster" });
    const engineCard = { id: "test-engine", deck: "booster" as const, type: "engine" as const, value: 1, effect: "" };
    Y().hand = [...Y().hand, engineCard];
    const target = boardFor(g).neighbours(Y().pose.current).find((h) => boardFor(g).isInner(h))!;
    g = run(g, { type: "burn", path: [target] }); // implicitly drifts (at-rest, no-op), then a real burn
    expect(Y().turn.moved).toBe(true);
    expect(Y().hand.some((c) => c.type === "engine")).toBe(true); // still holding it, unplayed
    const a = affordances(g);
    expect(a.legal.some((x) => x.type === "endMove")).toBe(true);
    expect(a.legal.some((x) => x.type === "burn")).toBe(false); // already moved — nothing left to burn
    expect(a.avoidableShipLoss).toBe(false);
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
