/**
 * The shared "lucky wheel" tick schedule: cycle a highlighted candidate backward from a
 * predetermined target for a couple of laps, decelerating (fast at the start, slow by the
 * landing), then settle on it. Used everywhere something spins to a known outcome — base
 * pick, ship pick, the start-player roll-off, and each of the 3 coordinate-dice rounds for
 * resource placement / a hyperspace jump — so its timing lives in one place instead of
 * several near-duplicates.
 */
import { add, scale } from "../engine/hex.js";
import type { Colour, Hex } from "../engine/index.js";

export interface SpinSchedule {
  /** the candidate index to display at each tick */
  seq: number[];
  /** delay (ms) to wait after tick k before showing tick k+1 — one shorter than `seq` */
  delays: number[];
}

/**
 * Builds a schedule over `n` candidates landing on `targetIndex`, aiming for a total
 * (start-to-landing) duration of `totalMs`, decelerating from `startMs` to `endMs` per tick.
 * Tick *count* is derived from those numbers (not fixed), so a longer `totalMs` naturally
 * means more laps, not just slower ones — always at least a bit over one full lap so the
 * spin reads as a spin even for a very short `totalMs`.
 */
export function buildSpinSchedule(n: number, targetIndex: number, cfg: { startMs: number; endMs: number; totalMs: number }): SpinSchedule {
  const { startMs, endMs, totalMs } = cfg;
  // mean tick delay for a quadratic (t^2) ease from startMs to endMs, t evenly spaced 0..1,
  // is startMs + (endMs - startMs)/3 (the average value of t^2 over [0,1] is 1/3)
  const meanDelay = Math.max(1, startMs + (endMs - startMs) / 3);
  const estTicks = Math.round(totalMs / meanDelay);
  const ticks = Math.max(n + 2, estTicks);
  const seq = Array.from({ length: ticks }, (_, k) => {
    const stepsFromEnd = ticks - 1 - k;
    return ((targetIndex - stepsFromEnd) % n + n) % n;
  });
  const span = Math.max(1, ticks - 1);
  const rawDelays = Array.from({ length: ticks - 1 }, (_, k) => {
    const t = k / span;
    return startMs + t * t * (endMs - startMs);
  });
  const rawTotal = rawDelays.reduce((a, b) => a + b, 0) || 1;
  const scale = totalMs / rawTotal; // corrects the estimate so the total lands close to totalMs
  const delays = rawDelays.map((d) => d * scale);
  return { seq, delays };
}

/**
 * A "skip the rest of this animation" gate. Every outcome here is already decided before
 * the animation starts (the dice/target are real, not rolled live) — a spin is purely
 * cosmetic suspense, so there's nothing wrong with cutting it short. `wait(ms)` behaves
 * like a plain sleep until `skip()` is called, at which point it (and every subsequent
 * `wait` on the same gate) resolves immediately — one click fast-forwards not just the
 * current tick but the rest of a whole multi-step reveal (e.g. all 3 coordinate-dice
 * rounds, or every remaining tile), since impatience rarely means "skip just one step."
 */
export class SkipGate {
  private skipped = false;
  private pending: (() => void) | null = null;

  wait(ms: number): Promise<void> {
    if (this.skipped) return Promise.resolve();
    return new Promise((resolve) => {
      const id = window.setTimeout(() => {
        this.pending = null;
        resolve();
      }, ms);
      this.pending = () => {
        window.clearTimeout(id);
        this.pending = null;
        resolve();
      };
    });
  }

  skip(): void {
    this.skipped = true;
    this.pending?.();
  }
}

/** Runs a built schedule, calling `onTick` with each candidate index in turn, resolving
   once the last one has shown. `cancelled()` is checked before every tick; `gate` lets the
   whole thing be fast-forwarded to its landing (see SkipGate). */
export async function runSpinSchedule(
  schedule: SpinSchedule,
  onTick: (index: number) => void,
  cancelled: () => boolean,
  gate: SkipGate,
): Promise<void> {
  for (let k = 0; k < schedule.seq.length; k++) {
    if (cancelled()) return;
    onTick(schedule.seq[k]!);
    if (k < schedule.seq.length - 1) await gate.wait(schedule.delays[k]!);
  }
}

/** A round-by-round settled point, plus the currently-cycling candidate (if this round is
   still spinning) — the "3 nested wheels" coordinate-dice reveal, i.e. Board.tsx's
   `spinPath` prop. Shared between resource seeding and a hyperspace jump reveal: both are
   the exact same coordinate-dice roll (engine/game.ts's rollCoordinateUntil, always from the
   golden origin), just landing on a different kind of thing. */
export interface CoordinateSpinPath {
  dots: Hex[];
  live: Hex | null;
}

/**
 * Replays an already-decided 3-round coordinate-dice roll (coarse-to-fine ring 3/2/1) as a
 * spin, calling `onFrame` with the path-so-far after every tick — same one continuous
 * fast→slow curve across all 3 rounds (round 2 picks up exactly as fast/slow as round 1 left
 * off), each round getting an equal time share of `totalMs`. Resolves to the final landed
 * cell once the last round settles. `gate` fast-forwards the whole thing on skip (see
 * SkipGate); `cancelled()` is checked before every tick, same as `runSpinSchedule`.
 */
export async function spinCoordinateDice(
  dice: readonly { step: number; colour: Colour }[],
  directionOf: (colour: Colour) => Hex,
  allColours: readonly Colour[],
  onFrame: (path: CoordinateSpinPath) => void,
  cancelled: () => boolean,
  gate: SkipGate,
  opts: { reducedMotion: boolean; totalMs: number; startIntervalMs: number; endIntervalMs: number },
): Promise<Hex> {
  let pt: Hex = { q: 0, r: 0 }; // the golden origin — see this fn's own doc comment
  let dotsSoFar = [pt];
  const rounds = dice.map((die) => {
    const candidates = allColours.map((c) => add(pt, scale(directionOf(c), die.step)));
    const targetIndex = allColours.indexOf(die.colour);
    const dotsPrefix = dotsSoFar;
    pt = candidates[targetIndex]!;
    dotsSoFar = [...dotsSoFar, pt];
    return { candidates, targetIndex, dotsPrefix };
  });
  if (opts.reducedMotion) {
    onFrame({ dots: dotsSoFar, live: null });
    await gate.wait(40);
    return pt;
  }
  const n = allColours.length;
  const perRoundMs = opts.totalMs / rounds.length;
  const delayAt = (t: number) => opts.startIntervalMs + t * t * (opts.endIntervalMs - opts.startIntervalMs);
  for (let roundIdx = 0; roundIdx < rounds.length; roundIdx++) {
    if (cancelled()) return pt;
    const { candidates, targetIndex, dotsPrefix } = rounds[roundIdx]!;
    const schedule = buildSpinSchedule(n, targetIndex, {
      startMs: delayAt(roundIdx / rounds.length),
      endMs: delayAt((roundIdx + 1) / rounds.length),
      totalMs: perRoundMs,
    });
    await runSpinSchedule(schedule, (i) => onFrame({ dots: dotsPrefix, live: candidates[i]! }), cancelled, gate);
    if (cancelled()) return pt;
    const landed = candidates[targetIndex]!;
    const isLastRound = roundIdx + 1 >= rounds.length;
    onFrame({ dots: [...dotsPrefix, landed], live: isLastRound ? null : landed });
  }
  return pt;
}
