/**
 * Move animation for the abstract ship marker (ring at current, dot at previous,
 * line between them). The engine jumps straight to the new pose; this plays the
 * jump out over time.
 *
 *   drift  — no motion: the ship is *held* at its pre-drift spot (ring + dot +
 *            tether) while the player picks a burn target or coasts. The green "0"
 *            ring already marks where the drift would carry it.
 *   slide  — resolves the held drift over `phaseMs`: ring and dot both move one
 *            step, keeping the tether between them. Burn slides the ring to the
 *            chosen target; coast slides it to the drift target.
 */
import type { GameState, Hex } from "../engine/index.js";
import { hexEq, distance } from "../engine/hex.js";

export interface MoveAnim {
  playerId: number;
  kind: "drift" | "slide";
  p0: Hex; // dot start
  c0: Hex; // ring start
  target: Hex; // ring end (drift target for a reach, burn/coast target for a slide)
  /** dot end, if different from c0 — only set when the ship brakes to a full stop this same
     move (see deriveMoveAnim's braking case): the dot needs to converge on the SAME cell the
     ring ends at (previous and current end up equal, atRest), not just catch up to where the
     ring started, or the real post-animation pose (both fields already collapsed to the
     final cell) wouldn't match where the animation actually left the dot — a visible jump
     right as the tween hands off to plain state-driven rendering. Undefined everywhere else:
     the dot always ends at c0, as before. */
  dotTarget?: Hex;
  startedAt: number;
  phaseMs: number;
}

const driftTarget = (cur: Hex, prev: Hex): Hex => ({ q: cur.q + (cur.q - prev.q), r: cur.r + (cur.r - prev.r) });

/**
 * Describe the animation for the transition `before`→`after`, or null for a snap.
 * `held` is the current (possibly frozen) drift anim, which supplies the ring's
 * real visual position when a burn follows a drift.
 */
export function deriveMoveAnim(
  before: GameState,
  after: GameState,
  phaseMs: number,
  held: MoveAnim | null,
): MoveAnim | null {
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
    // burn: previous is unchanged, current jumps to the burn target. Also matches a burn
    // that implicitly drifted first in this same dispatch (the common case now that drift/
    // burn are one decision — see engine/game.ts's ensureDrifted): that rewrites `previous`
    // to the pre-dispatch `current` before the real burn move happens, so `a.previous` lands
    // on `b.current` instead of `b.previous`. Either way the tail (dot) belongs at the
    // dispatch's true starting previous (b.previous, via p0 below) and the ring slides
    // straight from the ship's pre-dispatch position to the final target — found live: a
    // compound drift+burn matched neither this nor the drift case above and fell through to
    // an unanimated snap.
    if ((hexEq(a.previous, b.previous) || hexEq(a.previous, b.current)) && !hexEq(a.current, b.current)) {
      const from = held && held.playerId === i ? held : null;
      return {
        playerId: i,
        kind: "slide",
        p0: from ? from.p0 : b.previous,
        c0: from ? from.c0 : b.current,
        target: a.current,
        startedAt: performance.now(),
        phaseMs,
      };
    }
    // braked to a full stop (atRest) — e.g. landing exactly on the player's own base, which
    // zeroes velocity (previous snaps to equal the new current) instead of leaving a real
    // trailing previous behind. That exact shape (a.previous === a.current) is indistinguishable
    // from a hyperspace jump's landing pose by shape alone, so distance is the only reliable
    // state-only signal: no ordinary burn can ever travel further than the hard cap + free
    // cells in one dispatch, while a hyperspace jump can land anywhere in the inner field —
    // found live: the dot just snapped to the new position instead of animating the
    // deceleration when a burn target happened to brake the ship to a stop.
    if (hexEq(a.previous, a.current) && !hexEq(a.current, b.current)) {
      const maxBurnDistance =
        after.config.core.movement.burnMaxCells + after.config.core.movement.freeBaseDepartureCells;
      if (distance(a.current, b.current) <= maxBurnDistance) {
        const from = held && held.playerId === i ? held : null;
        return {
          playerId: i,
          kind: "slide",
          p0: from ? from.p0 : b.previous,
          c0: from ? from.c0 : b.current,
          target: a.current,
          dotTarget: a.current, // braking: dot converges on the same cell the ring lands at
          startedAt: performance.now(),
          phaseMs,
        };
      }
    }
    // launch / hyperspace / loss — no tween, let it snap
    return null;
  }
  return null;
}

/** The slide that resolves a held drift when the player coasts instead of burning. */
export function coastAnim(held: MoveAnim): MoveAnim {
  return { ...held, kind: "slide", startedAt: performance.now() };
}

export const animTotalMs = (a: MoveAnim): number => a.phaseMs;
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
  /** dot ↔ ring — [dot end, ring end]; the marker trims each end to its glyph */
  tether: [XY, XY] | null;
}

/** Ring / dot / tether for `anim` at time `now`, given a hex→pixel projector. */
export function moveFrame(anim: MoveAnim, now: number, px: (h: Hex) => XY): MoveFrame {
  const P0 = px(anim.p0);
  const C0 = px(anim.c0);

  if (anim.kind === "drift") {
    // held: nothing moves, the tether just stays between the fixed dot and ring
    return { dot: P0, ring: C0, tether: [P0, C0] };
  }
  // slide: both ends move one step, tether stays between them — unless braking to a stop
  // (dotTarget set), where the dot's own end is the ring's landing cell too, not c0
  const u = easeInOut(clamp01((now - anim.startedAt) / anim.phaseMs));
  const dot = lerp(P0, anim.dotTarget ? px(anim.dotTarget) : C0, u);
  const ring = lerp(C0, px(anim.target), u);
  return { dot, ring, tether: [dot, ring] };
}
