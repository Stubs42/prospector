import { describe, it, expect } from "vitest";
import { makeBoard } from "./board.js";
import { loadBoardJson, loadConfig } from "./data.js";
import { makeRng } from "./rng.js";
import { rollCoordinate, rollCombat } from "./dice.js";
import { add, scale, ORIGIN } from "./hex.js";

const core = loadConfig().core;
const board = makeBoard(loadBoardJson());

describe("coordinate dice", () => {
  it("produce three dice of steps 1,2,3 and a matching vector offset", () => {
    const rng = makeRng(123);
    for (let i = 0; i < 200; i++) {
      const roll = rollCoordinate(rng, board, core);
      expect(roll.dice.map((d) => d.step)).toEqual([1, 2, 3]);
      let expected = ORIGIN;
      for (const d of roll.dice) expected = add(expected, scale(board.directionOf(d.colour), d.step));
      expect(roll.offset).toEqual(expected);
    }
  });

  it("offset stays within a plausible range (|step| sum = 6)", () => {
    const rng = makeRng(7);
    for (let i = 0; i < 100; i++) {
      const { offset } = rollCoordinate(rng, board, core);
      const dist = (Math.abs(offset.q) + Math.abs(offset.r) + Math.abs(offset.q + offset.r)) / 2;
      expect(dist).toBeLessThanOrEqual(6);
    }
  });
});

describe("combat dice", () => {
  it("roll 1..6 on both dice", () => {
    const rng = makeRng(5);
    for (let i = 0; i < 500; i++) {
      const { attack, defence } = rollCombat(rng, core);
      expect(attack).toBeGreaterThanOrEqual(1);
      expect(attack).toBeLessThanOrEqual(6);
      expect(defence).toBeGreaterThanOrEqual(1);
      expect(defence).toBeLessThanOrEqual(6);
    }
  });
});
