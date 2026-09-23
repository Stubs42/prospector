/** Combat-outcome previews: is a fight's result already certain before any dice are rolled? Pure. */
import type { Config } from "../engine/index.js";

export type DecisiveCombat = "win" | "loss" | null;

export interface CombatDiceFaces {
  attack: { faces: readonly number[] };
  defence: { faces: readonly number[] };
}

/**
 * The fraction (0..1) of possible `(attackFace, defenceFace)` roll pairs, from the configured
 * dice faces, that the attacker wins — resolveCombat (engine/combat.ts) computes
 * `attackTotal = attackerLasers + attackRoll` and `defenceTotal = defenderShields +
 * defenceRoll`, attacker winning when `attackTotal > defenceTotal` (strict) or `>=`
 * (greater-or-equal). `attackerLasers`/`defenderShields` already include any played boosters.
 */
export function winProbability(
  attackerLasers: number,
  defenderShields: number,
  dice: CombatDiceFaces,
  winTest: Config["modes"]["prospector"]["combat"]["winTest"],
): number {
  const handicap = attackerLasers - defenderShields;
  const wins = (diff: number): boolean => (winTest === "strict-greater" ? diff > 0 : diff >= 0);
  let winning = 0;
  let total = 0;
  for (const a of dice.attack.faces) {
    for (const d of dice.defence.faces) {
      total++;
      if (wins(handicap + a - d)) winning++;
    }
  }
  return total > 0 ? winning / total : 0;
}

/**
 * Is the fight's outcome certain regardless of how the dice land? `null` means a real roll
 * could still go either way — derived from `winProbability` above, not hardcoded.
 */
export function decisiveCombat(
  attackerLasers: number,
  defenderShields: number,
  dice: CombatDiceFaces,
  winTest: Config["modes"]["prospector"]["combat"]["winTest"],
): DecisiveCombat {
  const p = winProbability(attackerLasers, defenderShields, dice, winTest);
  if (p === 1) return "win";
  if (p === 0) return "loss";
  return null;
}
