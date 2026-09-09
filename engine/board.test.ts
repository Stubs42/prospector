import { describe, it, expect } from "vitest";
import { makeBoard, isFree } from "./board.js";
import { loadBoardJson } from "./data.js";
import { hex, hexKey, ring } from "./hex.js";
import type { Colour } from "./types.js";

const board = makeBoard(loadBoardJson());
const COLOURS: Colour[] = ["black", "red", "blue", "white", "green", "yellow"];

describe("board model", () => {
  it("has radius 11 / inner 9 and 397 cells", () => {
    expect(board.radius).toBe(11);
    expect(board.innerRadius).toBe(11 - 2);
    expect(board.allCells()).toHaveLength(397);
  });

  it("classifies regions by distance", () => {
    expect(board.isInner(hex(0, 0))).toBe(true);
    expect(board.isInner(hex(0, 9))).toBe(true);
    expect(board.isOuter(hex(0, 9))).toBe(false);
    expect(board.isOuter(hex(0, 10))).toBe(true);
    expect(board.onField(hex(0, 11))).toBe(true);
    expect(board.offField(hex(0, 12))).toBe(true);
  });

  it("gives each colour a base of 4 inner cells and a direction", () => {
    for (const c of COLOURS) {
      const cells = board.baseCells(c);
      expect(cells).toHaveLength(4);
      for (const cell of cells) {
        expect(board.isInner(cell)).toBe(true);
        expect(board.baseOwnerAt(cell)).toBe(c);
      }
      expect(ring(board.directionOf(c))).toBe(1);
    }
  });

  it("black and white directions are opposite", () => {
    const b = board.directionOf("black");
    const w = board.directionOf("white");
    expect({ q: b.q + w.q, r: b.r + w.r }).toEqual({ q: 0, r: 0 });
  });

  it("isFree respects field bounds, resources and ships", () => {
    const occ = { shipCurrents: [hex(2, 0)], resources: new Set([hexKey(hex(3, 0))]) };
    expect(isFree(board, hex(1, 0), occ)).toBe(true);
    expect(isFree(board, hex(2, 0), occ)).toBe(false); // ship
    expect(isFree(board, hex(3, 0), occ)).toBe(false); // resource
    expect(isFree(board, hex(0, 20), occ)).toBe(false); // off field
  });
});
