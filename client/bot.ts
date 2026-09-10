/** Bot orchestration, decoupled from any UI timer. */
import { applyAction, greedyBot, legalActions } from "../engine/index.js";
import type { GameState } from "../engine/index.js";
import type { Rng } from "../engine/rng.js";

/**
 * Advance the game by one bot decision. Falls back to the first legal action if the bot
 * proposes something illegal (keeps a game moving even if the heuristic has a blind spot).
 */
export function stepBot(state: GameState, rng: Rng): GameState {
  const chosen = greedyBot(state, rng);
  const res = applyAction(state, chosen);
  if (res.ok) return res.state;
  const fallback = legalActions(state)[0];
  return fallback ? applyAction(state, fallback).state : state;
}
