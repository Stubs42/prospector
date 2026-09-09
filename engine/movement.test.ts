import { describe, it, expect } from "vitest";
import { makeBoard } from "./board.js";
import { loadBoardJson } from "./data.js";
import { hex, hexEq, add } from "./hex.js";
import {
  atRestPose,
  drift,
  driftTarget,
  burn,
  hyperspaceLand,
  straightPath,
  velocity,
} from "./movement.js";

const board = makeBoard(loadBoardJson());
const freeEverywhere = () => true;

describe("drift", () => {
  it("is a no-op for an at-rest ship", () => {
    const p = atRestPose(hex(0, 0));
    const r = drift(p, board, freeEverywhere);
    expect(r.pose).toBe(p);
    expect(r.needsBurn).toBe(false);
    expect(r.offField).toBe(false);
  });

  it("carries velocity forward: next = current + (current - previous)", () => {
    const p = { previous: hex(0, 0), current: hex(1, 0), atRest: false };
    expect(driftTarget(p)).toEqual({ q: 2, r: 0 });
    const r = drift(p, board, freeEverywhere);
    expect(r.pose.current).toEqual({ q: 2, r: 0 });
    expect(r.pose.previous).toEqual({ q: 1, r: 0 });
    expect(velocity(r.pose)).toEqual({ q: 1, r: 0 });
  });

  it("flags offField when the drift leaves the board (ship lost)", () => {
    const p = { previous: hex(9, 0), current: hex(10, 0), atRest: false };
    // 10 -> 11 still on field (radius 11)
    expect(drift(p, board, freeEverywhere).offField).toBe(false);
    const p2 = { previous: hex(10, 0), current: hex(11, 0), atRest: false };
    expect(drift(p2, board, freeEverywhere).offField).toBe(true);
  });

  it("flags needsBurn when drift lands on the outer ring", () => {
    const p = { previous: hex(8, 0), current: hex(9, 0), atRest: false };
    const r = drift(p, board, freeEverywhere); // -> (10,0) outer
    expect(r.offField).toBe(false);
    expect(r.needsBurn).toBe(true);
  });

  it("flags needsBurn when drift lands on an occupied cell", () => {
    const p = { previous: hex(0, 0), current: hex(1, 0), atRest: false };
    const blocked = (h: { q: number; r: number }) => !hexEq(h, hex(2, 0));
    expect(drift(p, board, blocked).needsBurn).toBe(true);
  });
});

describe("burn", () => {
  const base: Parameters<typeof burn>[4] = {
    maxCells: 1,
    hardCap: 3,
    fuelAvailable: 10,
    freeCells: 0,
  };

  it("moves the current cone along the path, leaves previous in place, spends 1 fuel/cell", () => {
    const p = { previous: hex(0, 0), current: hex(1, 0), atRest: false };
    const r = burn(p, [hex(2, 0)], board, freeEverywhere, base);
    expect(r.ok).toBe(true);
    expect(r.pose!.current).toEqual({ q: 2, r: 0 });
    expect(r.pose!.previous).toEqual({ q: 0, r: 0 });
    expect(r.fuelSpent).toBe(1);
  });

  it("free base-departure cells cost no fuel", () => {
    const p = atRestPose(hex(-9, 0));
    const r = burn(p, [hex(-8, 0), hex(-7, 0)], board, freeEverywhere, {
      ...base,
      maxCells: 1,
      freeCells: 1,
    });
    expect(r.ok).toBe(true);
    expect(r.freeUsed).toBe(1);
    expect(r.fuelSpent).toBe(1);
  });

  it("rejects a burn longer than the cap", () => {
    const p = { previous: hex(0, 0), current: hex(1, 0), atRest: false };
    const r = burn(p, straightPath(hex(1, 0), hex(1, 0), 2), board, freeEverywhere, base);
    expect(r.ok).toBe(false);
  });

  it("rejects a non-adjacent path and a blocked cell", () => {
    const p = { previous: hex(0, 0), current: hex(1, 0), atRest: false };
    expect(burn(p, [hex(3, 0)], board, freeEverywhere, { ...base, maxCells: 3 }).ok).toBe(false);
    const blocked = (h: { q: number; r: number }) => !hexEq(h, hex(2, 0));
    expect(burn(p, [hex(2, 0)], board, blocked, base).ok).toBe(false);
  });

  it("rejects a burn it cannot fuel", () => {
    const p = { previous: hex(0, 0), current: hex(1, 0), atRest: false };
    const r = burn(p, [hex(2, 0)], board, freeEverywhere, { ...base, fuelAvailable: 0 });
    expect(r.ok).toBe(false);
  });

  it("a zero-cell burn is a valid no-op", () => {
    const p = { previous: hex(0, 0), current: hex(1, 0), atRest: false };
    const r = burn(p, [], board, freeEverywhere, base);
    expect(r.ok).toBe(true);
    expect(r.fuelSpent).toBe(0);
  });
});

describe("hyperspace landing", () => {
  it("lands at rest on a free cell", () => {
    const r = hyperspaceLand(hex(2, -1), board, freeEverywhere);
    expect(r.lost).toBe(false);
    expect(r.pose.atRest).toBe(true);
    expect(r.pose.current).toEqual({ q: 2, r: -1 });
  });

  it("is lost on an occupied cell", () => {
    const blocked = (h: { q: number; r: number }) => !hexEq(h, hex(2, -1));
    expect(hyperspaceLand(hex(2, -1), board, blocked).lost).toBe(true);
  });

  it("is lost off the field", () => {
    expect(hyperspaceLand(hex(0, 40), board, freeEverywhere).lost).toBe(true);
  });
});
