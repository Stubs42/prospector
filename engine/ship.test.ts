import { describe, it, expect } from "vitest";
import { resolveStats, canEquip, movementInputs } from "./ship.js";
import { loadConfig } from "./data.js";
import type { EquipmentCard, ShipStats } from "./types.js";

const mode = loadConfig().modes.prospector;
const joe = mode.ships.yellow;
const baseStats: ShipStats = {
  shields: joe.shields,
  lasers: joe.lasers,
  fuelTanks: joe.fuelTanks,
  cargo: joe.cargo,
  engines: joe.engines,
  booster: joe.booster,
};

const eq = (stat: EquipmentCard["stat"], amount: number): EquipmentCard => ({
  id: `x-${stat}-${amount}`,
  deck: "equipment",
  stat,
  amount,
  effect: "",
});

describe("ship stat resolution", () => {
  it("adds equipment on top of base", () => {
    const s = resolveStats(baseStats, [eq("engines", 1), eq("cargo", 1)], mode.upgradeCaps);
    expect(s.engines).toBe(joe.engines + 1);
    expect(s.cargo).toBe(joe.cargo + 1);
  });

  it("clamps to upgrade caps", () => {
    const s = resolveStats(baseStats, [eq("engines", 1), eq("engines", 1), eq("engines", 1)], mode.upgradeCaps);
    expect(s.engines).toBe(mode.upgradeCaps.engines); // cap 3
  });

  it("canEquip is false at the cap", () => {
    expect(canEquip({ ...baseStats, engines: 3 }, "engines", mode.upgradeCaps)).toBe(false);
    expect(canEquip({ ...baseStats, engines: 2 }, "engines", mode.upgradeCaps)).toBe(true);
  });

  it("movementInputs maps stats via the mode config", () => {
    const mi = movementInputs(baseStats, mode);
    expect(mi.burnCap).toBe(joe.engines);
    expect(mi.fuelCapacity).toBe(joe.fuelTanks);
  });
});
