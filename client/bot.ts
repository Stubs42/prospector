/** Bot orchestration, decoupled from any UI timer. */
import { applyAction, greedyBot, legalActions, randomBot } from "../engine/index.js";
import type { GameState } from "../engine/index.js";
import type { Rng } from "../engine/rng.js";

/**
 * Advance the game by one bot decision. Falls back to the first legal action if the bot
 * proposes something illegal (keeps a game moving even if the heuristic has a blind spot).
 *
 * During interactive setup (`state.setup`) there's no strategy to speak of — a bot seat just
 * needs *a* pick — and `greedyBot` isn't setup-safe (it indexes `state.players`, empty until
 * setup finishes), so `randomBot` (a plain legal-action pick) is used instead.
 */
export function stepBot(state: GameState, rng: Rng): GameState {
  const chosen = state.setup ? randomBot(state, rng) : greedyBot(state, rng);
  const res = applyAction(state, chosen);
  if (res.ok) return res.state;
  const fallback = legalActions(state)[0];
  return fallback ? applyAction(state, fallback).state : state;
}
