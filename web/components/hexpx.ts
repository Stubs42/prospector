/**
 * Axial-hex ⇄ pixel conversion for the board renderer. Pointy-top layout, unit
 * hex size scaled by `S`. Matches the x/y baked into board.json
 * (x = √3·(q + r/2), y = 1.5·r). Kept separate from Board.tsx so components can
 * share it without an import cycle.
 */
import { round } from "../../engine/hex.js";
import type { Hex } from "../../engine/index.js";
import { S } from "./geo.js";

const SQRT3 = Math.sqrt(3);

/**
 * Rotate a point by a multiple of 60° around the board's origin. This is the whole board
 * rotation feature: a regular hex tile is unchanged by a 60° turn, so rotating every cell's
 * *centre* this way — and nothing else — re-tiles the board correctly with every hex still
 * drawn upright. It's a purely visual/logical relabelling: click targets are the rendered
 * shapes themselves, so nothing downstream of "where does this hex end up on screen" needs
 * to know rotation happened at all.
 */
export function rotatePoint(x: number, y: number, steps: number): { x: number; y: number } {
  const k = ((steps % 6) + 6) % 6;
  if (k === 0) return { x, y };
  const theta = (k * Math.PI) / 3;
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  return { x: x * cos - y * sin, y: x * sin + y * cos };
}

export function axialToPixel(h: Hex, rotationSteps = 0): { x: number; y: number } {
  const x = S * SQRT3 * (h.q + h.r / 2);
  const y = S * 1.5 * h.r;
  return rotationSteps ? rotatePoint(x, y, rotationSteps) : { x, y };
}

export function pixelToAxial(x: number, y: number): Hex {
  const r = y / S / 1.5;
  const q = x / (S * SQRT3) - r / 2;
  return round({ q, r });
}

/** Pull a point toward the board origin by `px` pixels (for placing furniture / popups). */
export function towardOrigin(x: number, y: number, px: number): { x: number; y: number } {
  const mag = Math.hypot(x, y) || 1;
  const k = Math.max(0, (mag - px) / mag);
  return { x: x * k, y: y * k };
}
