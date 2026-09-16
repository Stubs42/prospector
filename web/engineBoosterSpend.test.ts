import { describe, it, expect } from "vitest";
import { applyAction, createGame, legalActions } from "../engine/index.js";
import type { Action, GameState } from "../engine/index.js";

function run(s: GameState, a: Action): GameState {
  const r = applyAction(s, a);
  if (!r.ok) throw new Error(`${a.type}: ${r.error}`);
  return r.state;
}

/**
 * Regression coverage for "an armed engine card got spent on a burn that didn't need it":
 * useSession.dispatchBurn used to attach EVERY currently-armed engine card to whatever burn
 * the player clicked, even a short one well within the ship's unboosted range — silently
 * wasting the card for zero benefit (reported after live play: "the card was just played and
 * discarded... I did not get additional burn targets"). This doesn't render the real hook (no
 * jsdom/RTL here) — it isolates the exact "try an increasing prefix of the armed cards,
 * stopping at the first count that's actually legal" logic dispatchBurn now uses, the same
 * "don't render the hook" approach as dispatchRace.test.ts.
 */
function dispatchBurnLikeUseSession(
  state: GameState,
  burn: Extract<Action, { type: "burn" }>,
  armedEngineCardIds: string[],
): { state: GameState; engineBoosters: string[] } {
  const active = state.players[state.activePlayerIndex]!;
  const armedEngineCards = active.hand
    .filter((c) => c.type === "engine" && armedEngineCardIds.includes(c.id))
    .sort((a, b) => (a.value ?? 0) - (b.value ?? 0));
  for (let n = 0; n <= armedEngineCards.length; n++) {
    const engineBoosters = armedEngineCards.slice(0, n).map((c) => c.id);
    const attempt = engineBoosters.length ? { ...burn, engineBoosters } : burn;
    const r = applyAction(state, attempt);
    if (r.ok) return { state: r.state, engineBoosters };
  }
  const engineBoosters = armedEngineCards.map((c) => c.id);
  return { state: run(state, engineBoosters.length ? { ...burn, engineBoosters } : burn), engineBoosters };
}

describe("dispatchBurn: an armed engine card is only spent if the chosen burn actually needed it", () => {
  function setup(): { state: GameState; cardId: string } {
    let s = createGame({ seed: 11, colours: ["black", "red"], startPlayer: 0, upgradeAtStart: "none" });
    // black's base engine stat is 1 -> an unboosted burn can reach at most 1 cell
    expect(s.config.modes.prospector.ships.black.engines).toBe(1);
    const card = { id: "test-engine", deck: "booster" as const, type: "engine" as const, value: 2, effect: "" };
    s = run(s, { type: "drawBooster" });
    s.players[0]!.hand = [...s.players[0]!.hand, card];
    while (s.players[0]!.hand.length > s.config.modes.prospector.ships.black.booster) {
      s = run(s, { type: "discardBooster", cardId: s.players[0]!.hand[0]!.id });
    }
    s = run(s, { type: "drift" });
    return { state: s, cardId: card.id };
  }

  it("does not spend the card on a burn that's already legal unboosted", () => {
    const { state, cardId } = setup();
    const burns = legalActions(state).filter((a) => a.type === "burn") as Extract<Action, { type: "burn" }>[];
    const shortBurn = burns.find((b) => b.path.length === 1);
    expect(shortBurn).toBeDefined();

    const { state: next, engineBoosters } = dispatchBurnLikeUseSession(state, shortBurn!, [cardId]);
    expect(engineBoosters).toEqual([]); // armed, but never actually attached
    expect(next.players[0]!.hand.some((c) => c.id === cardId)).toBe(true); // still in hand
    expect(next.decks.booster.discard.some((c) => c.id === cardId)).toBe(false);
  });

  it("does spend the card on a burn that genuinely needs the boost", () => {
    const { state, cardId } = setup();
    const legal = legalActions(state);
    const burns = legal.filter((a) => a.type === "burn") as Extract<Action, { type: "burn" }>[];
    // reuse a known 1-cell target's direction and extend it further in the same line, past
    // both the unboosted engine cap AND the free base-departure cell, until it's genuinely
    // out of unboosted reach
    const oneCell = burns.find((b) => b.path.length === 1)!;
    const dir = { q: oneCell.path[0]!.q - state.players[0]!.pose.current.q, r: oneCell.path[0]!.r - state.players[0]!.pose.current.r };
    let longBurn: Extract<Action, { type: "burn" }> | null = null;
    for (let len = 2; len <= 6; len++) {
      const path = Array.from({ length: len }, (_, i) => ({
        q: state.players[0]!.pose.current.q + dir.q * (i + 1),
        r: state.players[0]!.pose.current.r + dir.r * (i + 1),
      }));
      const candidate: Extract<Action, { type: "burn" }> = { type: "burn", path };
      if (!applyAction(state, candidate).ok) {
        longBurn = candidate;
        break;
      }
    }
    expect(longBurn).not.toBeNull(); // confirms the premise: some length along this line needs the boost

    const { state: next, engineBoosters } = dispatchBurnLikeUseSession(state, longBurn!, [cardId]);
    expect(engineBoosters).toEqual([cardId]);
    expect(next.players[0]!.hand.some((c) => c.id === cardId)).toBe(false); // consumed
    expect(next.decks.booster.discard.some((c) => c.id === cardId)).toBe(true);
    expect(next.players[0]!.pose.current).toEqual(longBurn!.path[longBurn!.path.length - 1]);
  });
});
