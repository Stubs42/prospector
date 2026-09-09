import { type Hex, add, scale, ORIGIN } from "./hex.js";
import type { BoardModel } from "./board.js";
import type { Rng } from "./rng.js";
import type { Colour, CoreConfig } from "./types.js";

export interface CoordinateRoll {
  dice: { step: number; colour: Colour }[];
  offset: Hex;
}

/**
 * The three coordinate dice: one of step 1, one of step 2, one of step 3; every face is a
 * board colour = that colour's base direction. Result is the vector sum from the origin.
 */
export function rollCoordinate(rng: Rng, board: BoardModel, core: CoreConfig): CoordinateRoll {
  const colours = core.board.colourOrder;
  const dice = core.dice.coordinate.steps.map((step) => ({
    step,
    colour: rng.pick(colours) as Colour,
  }));
  let offset: Hex = ORIGIN;
  for (const d of dice) offset = add(offset, scale(board.directionOf(d.colour), d.step));
  return { dice, offset };
}

/**
 * Roll until the target cell (origin + offset) satisfies `accept`. Used for resource
 * seeding (accept = empty inner cell) and hyperspace (accept = free cell, else ship lost —
 * caller handles the "lost" case, so pass accept that only rejects genuinely invalid rolls
 * when a retry is wanted).
 */
export function rollCoordinateUntil(
  rng: Rng,
  board: BoardModel,
  core: CoreConfig,
  origin: Hex,
  accept: (target: Hex) => boolean,
  maxTries = 500,
): { roll: CoordinateRoll; target: Hex } {
  for (let i = 0; i < maxTries; i++) {
    const roll = rollCoordinate(rng, board, core);
    const target = add(origin, roll.offset);
    if (accept(target)) return { roll, target };
  }
  throw new Error("rollCoordinateUntil: no acceptable cell after retries");
}

export interface CombatRoll {
  attack: number;
  defence: number;
}

export function rollCombat(rng: Rng, core: CoreConfig): CombatRoll {
  const a = core.dice.combat.attack.faces;
  const d = core.dice.combat.defence.faces;
  return { attack: rng.pick(a), defence: rng.pick(d) };
}
