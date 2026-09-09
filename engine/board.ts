import { type Hex, hexKey, add, ring, hexEq } from "./hex.js";
import type { Colour } from "./types.js";
import type { BoardJson } from "./data-types.js";

export interface BoardCell {
  readonly q: number;
  readonly r: number;
  readonly dist: number;
  readonly region: "inner" | "outer";
  readonly origin: boolean;
  readonly base: Colour | null;
  readonly x: number;
  readonly y: number;
}

export interface BoardModel {
  readonly radius: number;
  readonly innerRadius: number;
  readonly directions: readonly Hex[];
  cell(h: Hex): BoardCell | undefined;
  onField(h: Hex): boolean;
  offField(h: Hex): boolean;
  isInner(h: Hex): boolean;
  isOuter(h: Hex): boolean;
  baseCells(colour: Colour): readonly Hex[];
  baseOwnerAt(h: Hex): Colour | null;
  /** unit direction vector bound to a colour (from the board's die mapping) */
  directionOf(colour: Colour): Hex;
  neighbours(h: Hex): Hex[];
  allCells(): readonly BoardCell[];
}

export function makeBoard(json: BoardJson): BoardModel {
  const cells = new Map<string, BoardCell>();
  for (const c of json.cells) {
    cells.set(hexKey(c), { ...c, base: (c.base as Colour | null) ?? null });
  }

  const directions: Hex[] = json.cells.length
    ? // canonical order comes from directionsByColour keys' insertion order in board.json,
      // which build_board.py writes in config colourOrder order
      Object.values(json.directionsByColour).map(([q, r]) => ({ q, r }))
    : [];

  const dirByColour = new Map<Colour, Hex>();
  for (const [col, [q, r]] of Object.entries(json.directionsByColour)) {
    dirByColour.set(col as Colour, { q, r });
  }

  const bases = new Map<Colour, Hex[]>();
  for (const [col, list] of Object.entries(json.bases)) {
    bases.set(
      col as Colour,
      list.map(([q, r]) => ({ q, r })),
    );
  }

  const model: BoardModel = {
    radius: json.radius,
    innerRadius: json.innerRadius,
    directions,
    cell: (h) => cells.get(hexKey(h)),
    onField: (h) => ring(h) <= json.radius,
    offField: (h) => ring(h) > json.radius,
    isInner: (h) => ring(h) <= json.innerRadius,
    isOuter: (h) => {
      const d = ring(h);
      return d > json.innerRadius && d <= json.radius;
    },
    baseCells: (colour) => bases.get(colour) ?? [],
    baseOwnerAt: (h) => cells.get(hexKey(h))?.base ?? null,
    directionOf: (colour) => {
      const d = dirByColour.get(colour);
      if (!d) throw new Error(`no direction for colour ${colour}`);
      return d;
    },
    neighbours: (h) => directions.map((d) => add(h, d)),
    allCells: () => [...cells.values()],
  };
  return model;
}

/** A cell is free if it is on the field and holds no ship position and no resource. */
export function isFree(
  board: BoardModel,
  h: Hex,
  occupied: { shipCurrents: readonly Hex[]; resources: ReadonlySet<string> },
): boolean {
  if (board.offField(h)) return false;
  if (occupied.resources.has(hexKey(h))) return false;
  for (const c of occupied.shipCurrents) if (hexEq(c, h)) return false;
  return true;
}
