/**
 * The shared "lucky wheel" tick schedule: cycle a highlighted candidate backward from a
 * predetermined target for a couple of laps, decelerating (fast at the start, slow by the
 * landing), then settle on it. Used everywhere something spins to a known outcome — base
 * pick, ship pick, the start-player roll-off, and each of the 3 coordinate-dice rounds for
 * resource placement — so its timing lives in one place instead of four near-duplicates.
 */
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

/** Runs a built schedule, calling `onTick` with each candidate index in turn, resolving
   once the last one has shown. `cancelled()` is checked before every tick and timeout. */
export function runSpinSchedule(schedule: SpinSchedule, onTick: (index: number) => void, cancelled: () => boolean): Promise<void> {
  return new Promise((resolve) => {
    const tick = (k: number) => {
      if (cancelled()) return resolve();
      onTick(schedule.seq[k]!);
      if (k < schedule.seq.length - 1) {
        window.setTimeout(() => tick(k + 1), schedule.delays[k]!);
      } else {
        resolve();
      }
    };
    tick(0);
  });
}
