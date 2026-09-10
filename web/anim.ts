/**
 * Move animation for the abstract ship marker (ring at current, dot at previous,
 * line between them). The engine jumps straight to the new pose; this describes
 * how to play the jump out over time.
 *
 *   drift  — phase 1: the line grows from (prev→cur) out to the drift target.
 *            phase 2: dot and ring slide forward along that line by one step.
 *   burn   — the ring slides straight from its start cell to the burn target;
 *            the dot (previous) stays put and the line drags along.
 *
 * Each phase lasts `phaseMs`; drift is therefore two phases long, burn one.
 */
import type { GameState, Hex } from "../engine/index.js";
import { hexEq } from "../engine/hex.js";

export interface MoveAnim {
  playerId: number;
  kind: "drift" | "burn";
  p0: Hex; // dot anchor (previous), fixed for the whole animation
  c0: Hex; // where the ring starts
  target: Hex; // where the ring ends
  startedAt: number; // performance.now() when it began
  phaseMs: number;
}

const driftTarget = (cur: Hex, prev: Hex): Hex => ({ q: cur.q + (cur.q - prev.q), r: cur.r + (cur.r - prev.r) });

/** Compare the poses before/after an action and describe the move to animate, or null for a snap. */
export function deriveMoveAnim(before: GameState, after: GameState, phaseMs: number): MoveAnim | null {
  if (phaseMs <= 0) return null;
  for (let i = 0; i < before.players.length; i++) {
    const b = before.players[i]!.pose;
    const a = after.players[i]?.pose;
    if (!a) continue;
    if (hexEq(a.current, b.current) && hexEq(a.previous, b.previous)) continue;

    // drift: previous becomes the old current, current advances by one velocity step
    if (hexEq(a.previous, b.current) && hexEq(a.current, driftTarget(b.current, b.previous))) {
      return { playerId: i, kind: "drift", p0: b.previous, c0: b.current, target: a.current, startedAt: performance.now(), phaseMs };
    }
    // burn: previous is unchanged, current jumps to the burn target
    if (hexEq(a.previous, b.previous) && !hexEq(a.current, b.current)) {
      return { playerId: i, kind: "burn", p0: b.previous, c0: b.current, target: a.current, startedAt: performance.now(), phaseMs };
    }
    // launch / hyperspace / loss — no tween, let it snap
    return null;
  }
  return null;
}

export const animTotalMs = (a: MoveAnim): number => (a.kind === "drift" ? 2 : 1) * a.phaseMs;
export const animDone = (a: MoveAnim, now: number): boolean => now - a.startedAt >= animTotalMs(a);

const easeInOut = (t: number): number => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);

export interface XY {
  x: number;
  y: number;
}
const lerp = (a: XY, b: XY, t: number): XY => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

export interface MoveFrame {
  dot: XY;
  ring: XY;
  line: [XY, XY] | null;
}

/** Ring / dot / line positions for `anim` at time `now`, given a hex→pixel projector. */
export function moveFrame(anim: MoveAnim, now: number, px: (h: Hex) => XY): MoveFrame {
  const P0 = px(anim.p0);
  const C0 = px(anim.c0);
  const T = anim.phaseMs;
  const elapsed = now - anim.startedAt;

  if (anim.kind === "drift") {
    const D = px(anim.target);
    if (elapsed < T) {
      // phase 1 — the far end of the line reaches out to the drift target
      const u = easeInOut(clamp01(elapsed / T));
      return { dot: P0, ring: C0, line: [P0, lerp(C0, D, u)] };
    }
    // phase 2 — the whole dot–ring structure slides forward one step
    const u = easeInOut(clamp01((elapsed - T) / T));
    const dot = lerp(P0, C0, u);
    const ring = lerp(C0, D, u);
    return { dot, ring, line: [dot, ring] };
  }

  // burn — ring slides straight to the target, dot fixed, line drags along
  const u = easeInOut(clamp01(elapsed / T));
  const ring = lerp(C0, px(anim.target), u);
  return { dot: P0, ring, line: [P0, ring] };
}
