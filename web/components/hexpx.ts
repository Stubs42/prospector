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

export function axialToPixel(h: Hex): { x: number; y: number } {
  return { x: S * SQRT3 * (h.q + h.r / 2), y: S * 1.5 * h.r };
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
