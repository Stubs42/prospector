/**
 * One colour per ship aspect, shared everywhere the aspect shows up: the base
 * info-cells on the board, booster cards, and (later) equipment/upgrade cards.
 * Keep these hexes in sync with the `.card.booster-*` borders in styles.css.
 */
import type { StatKey } from "../../engine/index.js";

export const ASPECT_FILL: Record<StatKey, string> = {
  engines: "#c8483b", // red
  cargo: "#3f9f63", // green (freight)
  lasers: "#8a929b", // steel grey
  shields: "#e9e9e9", // white
  fuelTanks: "#3f74c9", // blue
  booster: "#d9b53c", // yellow (cards)
};

/** readable text colour on top of a solid ASPECT_FILL swatch */
export const ASPECT_INK: Record<StatKey, string> = {
  engines: "#ffffff",
  cargo: "#08130c",
  lasers: "#0c1013",
  shields: "#1a1a1a",
  fuelTanks: "#ffffff",
  booster: "#1a1400",
};

export const ASPECT_LABEL: Record<StatKey, string> = {
  engines: "engines",
  cargo: "freight",
  lasers: "laser",
  shields: "shield",
  fuelTanks: "fuel",
  booster: "cards",
};

/** left-to-right order of the six stat cells around a base */
export const ASPECT_ORDER: StatKey[] = ["shields", "lasers", "engines", "fuelTanks", "cargo", "booster"];
