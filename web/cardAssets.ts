/**
 * The hand-drawn card/icon artwork (res/cards-artwork.svg, sliced into individual files —
 * see that file's own history for how) — raw SVG text, inlined (not <img src>) so its
 * `.icon-*` classes can be theme-coloured via CSS (see styles.css's card-art rules).
 * Every icon comes in 3 tiers (drawn at increasing size/complexity, not just recoloured) —
 * a ship stat of 0 shows no icon at all, 1-3 picks the matching tier.
 */
import type { Colour, StatKey } from "../engine/index.js";
import { theme } from "./theme.js";

import iconShield1 from "../res/icon-shield-1.svg?raw";
import iconShield2 from "../res/icon-shield-2.svg?raw";
import iconShield3 from "../res/icon-shield-3.svg?raw";
import iconLaser1 from "../res/icon-laser-1.svg?raw";
import iconLaser2 from "../res/icon-laser-2.svg?raw";
import iconLaser3 from "../res/icon-laser-3.svg?raw";
import iconEngine1 from "../res/icon-engine-1.svg?raw";
import iconEngine2 from "../res/icon-engine-2.svg?raw";
import iconEngine3 from "../res/icon-engine-3.svg?raw";
import iconCargo1 from "../res/icon-cargo-1.svg?raw";
import iconCargo2 from "../res/icon-cargo-2.svg?raw";
import iconCargo3 from "../res/icon-cargo-3.svg?raw";
import iconFuelTank1 from "../res/icon-fuel-tank-1.svg?raw";
import iconFuelTank2 from "../res/icon-fuel-tank-2.svg?raw";
import iconFuelTank3 from "../res/icon-fuel-tank-3.svg?raw";
import iconCard1 from "../res/icon-card-1.svg?raw";
import iconCard2 from "../res/icon-card-2.svg?raw";
import iconCard3 from "../res/icon-card-3.svg?raw";

import framePortraitOuter from "../res/frame-portrait-outer.svg?raw";
import framePortraitInner from "../res/frame-portrait-inner.svg?raw";
import frameSquareOuter from "../res/frame-square-outer.svg?raw";
import frameSquareInner from "../res/frame-square-inner.svg?raw";

import boosterBack from "../res/Booster-card-backside.svg?raw";
import upgradeBack from "../res/Upgrade-card-backside.svg?raw";

import shipScreenBg from "../res/ship-screen-bg.svg?raw";
import shipCellBg from "../res/ship-cell-bg.svg?raw";
import shipNose from "../res/ship-nose.svg?raw";

/** a raw file starts with an XML prologue, invalid inside dangerouslySetInnerHTML's HTML
   parse context — harmless in practice (parsed as a bogus comment) but stripped for
   cleanliness; every file also carries its own (currently-empty) <style> block, redundant
   once real theming lives in styles.css's card-art rules, so that's dropped too */
function clean(raw: string): string {
  return raw.replace(/<\?xml[^>]*\?>/, "").replace(/<style>[\s\S]*?<\/style>/, "");
}

/** one stat's 3 tiers, tier index 0..2 = "1 pip".."3 pips"; index -1 (stat value 0) means
   no icon at all — callers should check that themselves before indexing in */
const TIERS: Partial<Record<StatKey, [string, string, string]>> = {
  shields: [iconShield1, iconShield2, iconShield3].map(clean) as [string, string, string],
  lasers: [iconLaser1, iconLaser2, iconLaser3].map(clean) as [string, string, string],
  engines: [iconEngine1, iconEngine2, iconEngine3].map(clean) as [string, string, string],
  cargo: [iconCargo1, iconCargo2, iconCargo3].map(clean) as [string, string, string],
  fuelTanks: [iconFuelTank1, iconFuelTank2, iconFuelTank3].map(clean) as [string, string, string],
  // the ship card's hand-limit ("booster") stat renders as a star rating, not its own icon
  // shape — same 3-tier idea, just themed via icon-card-fill instead of an aspect colour
  booster: [iconCard1, iconCard2, iconCard3].map(clean) as [string, string, string],
};

/** raw markup for `stat` at 1-3 pips, or null for 0 (no icon shown) or an out-of-range tier */
export function tierIconFor(stat: StatKey, value: number): string | null {
  const set = TIERS[stat];
  if (!set || value <= 0) return null;
  return set[Math.min(value, 3) - 1]!;
}

export const CARD_ART = {
  framePortraitOuter: clean(framePortraitOuter),
  framePortraitInner: clean(framePortraitInner),
  frameSquareOuter: clean(frameSquareOuter),
  frameSquareInner: clean(frameSquareInner),
  boosterBack: clean(boosterBack),
  upgradeBack: clean(upgradeBack),
  shipScreenBg: clean(shipScreenBg),
  shipCellBg: clean(shipCellBg),
};

/** #rrggbb -> #rrggbb, mixed toward `toward` by `amt` (0 = unchanged, 1 = `toward`) */
function mix(hex: string, toward: [number, number, number], amt: number): string {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  const ch = (c: number, t: number) => Math.round(c + (t - c) * amt);
  return `#${[ch(r, toward[0]), ch(g, toward[1]), ch(b, toward[2])].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}
const lighten = (hex: string, amt: number) => mix(hex, [255, 255, 255], amt);
const darken = (hex: string, amt: number) => mix(hex, [0, 0, 0], amt);

/** the ship nose (only one silhouette exists yet, measured off the Atlas example, reused for
   every ship colour), shaded per colour as a light-to-dark diagonal sweep instead of one flat
   fill — the same "cast, beveled volume" convention as the board grid / hex message boxes
   (theme.board.gridBright/gridDark), just derived per ship from theme.colors.ship instead of
   one shared pair, so it reads as a lit 3D cone rather than a flat paper triangle. Baked as a
   literal 2-stop <linearGradient> per colour (CSS `currentColor` can only ever be ONE shade,
   not two), built once at module load — never hand-redrawn, still the same source path. */
export const SHIP_NOSE_BY_COLOUR: Record<Colour, string> = Object.fromEntries(
  (Object.keys(theme.colors.ship) as Colour[]).map((colour) => {
    const base = theme.colors.ship[colour];
    const gradId = `nose-grad-${colour}`;
    const defs =
      `<defs><linearGradient id="${gradId}" x1="0" y1="0" x2="1" y2="1">` +
      `<stop offset="0%" stop-color="${lighten(base, 0.45)}"/>` +
      `<stop offset="100%" stop-color="${darken(base, 0.4)}"/>` +
      `</linearGradient></defs>`;
    const withGrad = clean(shipNose)
      .replace(/(<svg[^>]*>)/, `$1${defs}`)
      .replace("fill:currentColor", `fill:url(#${gradId})`);
    return [colour, withGrad];
  }),
) as Record<Colour, string>;

/** the physical card's own aspect ratio (width / height) — booster and ship cards share the
   same portrait shape; upgrade cards are square. Baked into the art, not themeable. */
export const PORTRAIT_ASPECT = 793.7 / 1134.2;
