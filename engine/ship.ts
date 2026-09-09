import type { EquipmentCard, ProspectorConfig, ShipStats, StatKey } from "./types.js";

const STAT_KEYS: StatKey[] = ["shields", "lasers", "fuelTanks", "cargo", "engines", "booster"];

/** Base ship stats + permanent equipment upgrades, clamped to the upgrade caps. */
export function resolveStats(
  base: ShipStats,
  equipment: readonly EquipmentCard[],
  caps: Partial<Record<StatKey, number>>,
): ShipStats {
  const out = { ...base };
  for (const card of equipment) {
    out[card.stat] = (out[card.stat] ?? 0) + card.amount;
  }
  for (const k of STAT_KEYS) {
    const cap = caps[k];
    if (cap !== undefined && out[k] > cap) out[k] = cap;
  }
  return out;
}

/** Whether another equipment card of `stat` may still be taken (strictly below cap). */
export function canEquip(
  stats: ShipStats,
  stat: StatKey,
  caps: Partial<Record<StatKey, number>>,
): boolean {
  const cap = caps[stat];
  return cap === undefined || stats[stat] < cap;
}

export interface MovementInputs {
  burnCap: number;
  fuelCapacity: number;
}

export function movementInputs(stats: ShipStats, mode: ProspectorConfig): MovementInputs {
  return {
    burnCap: stats[mode.movementInputs.burnCap],
    fuelCapacity: stats[mode.movementInputs.fuelCapacity],
  };
}

export { STAT_KEYS };
