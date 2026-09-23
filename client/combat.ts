/** Combat-outcome previews: is a fight's result already certain before any dice are rolled? Pure. */
import type { Config } from "../engine/index.js";

export type DecisiveCombat = "win" | "loss" | null;

export interface CombatDiceFaces {
  attack: { faces: readonly number[] };
  defence: { faces: readonly number[] };
}

/**
 * Given the attacker's laser total and the defender's shield total (both already include any
 * played boosters), is the fight's outcome certain regardless of how the dice land? `null`
 * means a real roll could still go either way. Derived from the configured dice faces and
 * win test, not hardcoded — resolveCombat (engine/combat.ts) computes
 * `attackTotal = attackerLasers + attackRoll` and `defenceTotal = defenderShields +
 * defenceRoll`, attacker winning when `attackTotal > defenceTotal` (strict) or `>=`
 * (greater-or-equal); the worst/best case for the attacker is simply the lowest/highest roll
 * they could get paired with the highest/lowest roll the defender could get.
 */
export function decisiveCombat(
  attackerLasers: number,
  defenderShields: number,
  dice: CombatDiceFaces,
  winTest: Config["modes"]["prospector"]["combat"]["winTest"],
): DecisiveCombat {
  const handicap = attackerLasers - defenderShields;
  const minAttack = Math.min(...dice.attack.faces);
  const maxAttack = Math.max(...dice.attack.faces);
  const minDefence = Math.min(...dice.defence.faces);
  const maxDefence = Math.max(...dice.defence.faces);
  const wins = (diff: number): boolean => (winTest === "strict-greater" ? diff > 0 : diff >= 0);
  if (wins(handicap + minAttack - maxDefence)) return "win"; // worst possible roll still wins
  if (!wins(handicap + maxAttack - minDefence)) return "loss"; // best possible roll still loses
  return null;
}

/** The attacker/defender/handicap breakdown shown in both the pre-roll and reveal combat boxes. */
export function combatStatsLines(attackerLasers: number, defenderShields: number): string[] {
  const handicap = attackerLasers - defenderShields;
  return [
    `Attacker: ${attackerLasers} laser${attackerLasers === 1 ? "" : "s"}`,
    `Defender: ${defenderShields} shield${defenderShields === 1 ? "" : "s"}`,
    `Handicap: ${handicap > 0 ? "+" : ""}${handicap}`,
  ];
}
