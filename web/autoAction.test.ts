import { describe, it, expect } from "vitest";
import { AUTO_HIDE } from "./useSession.js";

/**
 * Regression coverage for "attack fired with no confirmation and no chance to pick laser
 * boosters": useSession's auto-advance timer fires the sole legal action automatically when
 * exactly one is on offer (e.g. drawing the only booster, or ending a turn with nothing else
 * to do). `attack` must never be that sole auto-fired action — starting combat is staged
 * through an attack-target click + CombatBox (booster picker) first, and skipping straight to
 * the raw engine action skips that whole flow. See web/dispatchRace.test.ts for why this
 * doesn't render the real hook (no jsdom/RTL here) — it asserts the exact set the hook filters
 * auto-fire candidates through instead.
 */
describe("auto-advance never fires a combat/voluntary action on its own", () => {
  it("excludes attack, alongside the other already-voluntary actions", () => {
    expect(AUTO_HIDE.has("attack")).toBe(true);
    expect(AUTO_HIDE.has("scrapShip")).toBe(true);
    expect(AUTO_HIDE.has("useReserveFuel")).toBe(true);
  });
});
