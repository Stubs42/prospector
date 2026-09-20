import type { OreColour, ProspectorConfig } from "./types.js";

export interface CombatInputs {
  /** ship lasers + played laser boosters */
  attackerLasers: number;
  /** ship shields + played shield boosters */
  defenderShields: number;
  /** defender played a shield +99 or a hyperspace card */
  autoRepel: boolean;
}

export interface CombatOutcome {
  attackerWins: boolean;
  attackTotal: number;
  defenceTotal: number;
}

export function resolveCombat(
  inp: CombatInputs,
  roll: { attack: number; defence: number },
  winTest: ProspectorConfig["combat"]["winTest"],
): CombatOutcome {
  // always compute the real totals, even under autoRepel — a GUI showing "0+0=0" for what
  // was actually e.g. "2 lasers + roll 4 = 6" vs "99 shield + roll 1 = 100" is just wrong,
  // not simplified; autoRepel only needs to override the WIN check, not the numbers
  const attackTotal = inp.attackerLasers + roll.attack;
  const defenceTotal = inp.defenderShields + roll.defence;
  const attackerWins =
    !inp.autoRepel && (winTest === "strict-greater" ? attackTotal > defenceTotal : attackTotal >= defenceTotal);
  return { attackerWins, attackTotal, defenceTotal };
}

/** Pick the resource the winner takes from the loser's cargo. */
export function pickSpoil(
  cargo: readonly OreColour[],
  values: Record<OreColour, number>,
  rule: ProspectorConfig["combat"]["spoil"],
  rngPick: <T>(items: readonly T[]) => T,
): OreColour | null {
  if (cargo.length === 0) return null;
  switch (rule) {
    case "least-valuable":
      return [...cargo].sort((a, b) => values[a] - values[b])[0]!;
    case "random":
      return rngPick(cargo);
    case "most-valuable":
    case "attacker-choice": // engine default: treat as most-valuable
    default:
      return [...cargo].sort((a, b) => values[b] - values[a])[0]!;
  }
}
