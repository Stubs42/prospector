/**
 * Seat management: who is playing which slot, and whose input the game is waiting on.
 * GUI-agnostic — a hot-seat client, a bot-runner, or a network client all share this.
 */
import type { GameState } from "../engine/index.js";

export type Seat = "human" | "bot";

export function mkSeats(humans: number, bots: number): Seat[] {
  return [...Array<Seat>(Math.max(0, humans)).fill("human"), ...Array<Seat>(Math.max(0, bots)).fill("bot")];
}

export const humansIn = (seats: readonly Seat[]): number => seats.filter((s) => s === "human").length;

/**
 * The player index whose decision the game is currently waiting on. During combat this is
 * the defender (defend / counter steps) or the attacker (the dice roll); otherwise the
 * active player.
 */
export function waitingOn(state: GameState): number {
  const pc = state.pendingCombat;
  if (!pc) return state.activePlayerIndex;
  return pc.awaiting === "resolve" ? pc.attackerId : pc.defenderId;
}

/** Is the party the game is waiting on a bot? */
export function waitingOnBot(state: GameState, seats: readonly Seat[]): boolean {
  return !state.gameOver && seats[waitingOn(state)] === "bot";
}

/** Is it currently a bot's normal turn (ignoring combat)? */
export function activeIsBot(state: GameState, seats: readonly Seat[]): boolean {
  return seats[state.activePlayerIndex] === "bot";
}
