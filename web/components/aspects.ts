/**
 * One colour per ship aspect, shared everywhere the aspect shows up: the base
 * info-cells on the board, booster cards, and (later) equipment/upgrade cards.
 * The actual colour values live in theme.ts (edit them there) — the `.card.booster-*`
 * borders in styles.css read the same values via the `--aspect-*` custom properties
 * theme.ts's applyTheme sets, so there's only one place to change a colour.
 */
import type { StatKey } from "../../engine/index.js";
import { theme } from "../theme.js";

const aspectKeys = Object.keys(theme.colors.aspect) as StatKey[];

export const ASPECT_FILL: Record<StatKey, string> = Object.fromEntries(
  aspectKeys.map((k) => [k, theme.colors.aspect[k].fill]),
) as Record<StatKey, string>;

/** readable text colour on top of a solid ASPECT_FILL swatch */
export const ASPECT_INK: Record<StatKey, string> = Object.fromEntries(
  aspectKeys.map((k) => [k, theme.colors.aspect[k].ink]),
) as Record<StatKey, string>;

export const ASPECT_LABEL: Record<StatKey, string> = {
  engines: "engines",
  cargo: "freight",
  lasers: "laser",
  shields: "shield",
  fuelTanks: "fuel",
  booster: "cards",
};

/** 3-letter tag printed on the board token */
export const ASPECT_TAG: Record<StatKey, string> = {
  engines: "ENG",
  cargo: "FRT",
  lasers: "LAS",
  shields: "SHD",
  fuelTanks: "FUE",
  booster: "CRD",
};

/** left-to-right order of the six stat cells around a base */
export const ASPECT_ORDER: StatKey[] = ["shields", "lasers", "engines", "fuelTanks", "cargo", "booster"];
