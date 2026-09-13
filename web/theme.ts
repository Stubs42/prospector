/**
 * All tunable visual parameters, in one place: ship colours, ore colours, ship-aspect
 * colours (engines/cargo/lasers/shields/fuel/booster), the general UI palette, the
 * starfield backdrop, and the board's own look (cell transparency, grid "rod" styling).
 *
 * How it's wired up:
 * - Colour TOKENS (ship/ore/UI) are applied as CSS custom properties on <html> once, at
 *   startup (see `applyTheme`, called from main.tsx) — every existing `var(--ship-red)`
 *   etc. reference across the app keeps working unchanged; this file is just what now
 *   *defines* those values instead of the hardcoded numbers in styles.css's :root
 *   (which still carries the same values as a fallback in case this ever fails to run).
 * - Aspect colours are consumed directly as plain values (see aspects.ts) — used in a lot
 *   of places that need an actual hex string (SVG fills, inline styles), not just CSS.
 * - Starfield/board parameters are consumed directly by Starfield.tsx/Board.tsx — they
 *   drive canvas drawing and SVG attributes, not CSS, so a custom property wouldn't help.
 *
 * To make a second theme: copy this file's `theme` object under a new name (e.g.
 * `theme.crimson.ts`), tweak it, and swap which one `theme.ts` re-exports as `theme` —
 * everything downstream only ever imports `theme` from here.
 */
import type { Colour, OreColour, StatKey } from "../engine/index.js";

export interface Theme {
  colors: {
    ship: Record<Colour, string>;
    ore: Record<OreColour, string>;
    /** one aspect's colour + a readable ink colour for text/icons drawn on top of it */
    aspect: Record<StatKey, { fill: string; ink: string }>;
    ui: {
      panel: string;
      panel2: string;
      line: string;
      ink: string;
      muted: string;
      gold: string;
      danger: string;
      ok: string;
    };
    /** one-off booster-card colours that don't belong to a ship-stat aspect */
    special: {
      hyperspace: string;
    };
  };
  starfield: {
    /** roughly one star per this many square pixels — smaller = denser */
    densityDivisor: number;
    sizeMin: number;
    sizeMax: number;
    /** >1 skews the size distribution toward `sizeMin` (most stars small, a few big) */
    sizeSkew: number;
    brightnessMin: number;
    brightnessMax: number;
    /** 0 = pure white stars, 1 = fully saturated tint */
    colorSaturation: number;
    nebulaCountMin: number;
    nebulaCountMax: number;
    nebulaHueMin: number;
    nebulaHueMax: number;
    nebulaOpacity: number;
    bgInner: string;
    bgOuter: string;
  };
  board: {
    /** unassigned field cells: how much of their fill colour shows through, so the
       starfield reads through the board's interior instead of a solid dark tile */
    cellFillOpacity: number;
    innerFill: string;
    outerFill: string;
    /** the plain grid edge's "metal rod" gradient, light to dark */
    gridGradient: [string, string, string];
    gridShadowOffset: number;
    gridShadowBlur: number;
    gridShadowOpacity: number;
  };
}

export const theme: Theme = {
  colors: {
    ship: {
      black: "#3b3b3b",
      red: "#c8483b",
      blue: "#3f74c9",
      white: "#e9e9e9",
      green: "#3f9f63",
      yellow: "#d9b53c",
    },
    ore: {
      green: "#4faf7c",
      yellow: "#d7b13d",
      red: "#c1573c",
    },
    aspect: {
      engines: { fill: "#c8483b", ink: "#ffffff" },
      cargo: { fill: "#3f9f63", ink: "#08130c" },
      lasers: { fill: "#8a929b", ink: "#0c1013" },
      shields: { fill: "#e9e9e9", ink: "#1a1a1a" },
      fuelTanks: { fill: "#3f74c9", ink: "#ffffff" },
      booster: { fill: "#d9b53c", ink: "#1a1400" },
    },
    ui: {
      panel: "#17251f",
      panel2: "#1e2f28",
      line: "#2c4238",
      ink: "#e8ede9",
      muted: "#94a89d",
      gold: "#e6b03c",
      danger: "#d5674a",
      ok: "#57b985",
    },
    special: {
      hyperspace: "#9a6fd0",
    },
  },
  starfield: {
    densityDivisor: 1600,
    sizeMin: 0.3,
    sizeMax: 1.8,
    sizeSkew: 2,
    brightnessMin: 0.3,
    brightnessMax: 1.0,
    colorSaturation: 0.35,
    nebulaCountMin: 2,
    nebulaCountMax: 3,
    nebulaHueMin: 140,
    nebulaHueMax: 280,
    nebulaOpacity: 0.12,
    bgInner: "#0e1e18",
    bgOuter: "#030705",
  },
  board: {
    cellFillOpacity: 0.14,
    innerFill: "#0e1b15",
    outerFill: "#1c2b25",
    gridGradient: ["#7c8f85", "#3c4f45", "#1a2620"],
    gridShadowOffset: 0.6,
    gridShadowBlur: 0.5,
    gridShadowOpacity: 0.45,
  },
};

/** pushes the theme's colour tokens onto <html> as CSS custom properties — call once,
   before the app renders (see main.tsx). Board/starfield parameters aren't CSS-driven,
   so they're just imported directly wherever they're used. */
export function applyTheme(t: Theme): void {
  const root = document.documentElement.style;
  for (const [k, v] of Object.entries(t.colors.ship)) root.setProperty(`--ship-${k}`, v);
  for (const [k, v] of Object.entries(t.colors.ore)) root.setProperty(`--ore-${k}`, v);
  for (const [k, v] of Object.entries(t.colors.aspect)) {
    root.setProperty(`--aspect-${k}`, v.fill);
    root.setProperty(`--aspect-${k}-ink`, v.ink);
  }
  root.setProperty("--card-hyperspace", t.colors.special.hyperspace);
  // explicit, not a naming-convention loop — CSS var names don't all match their JS
  // key 1:1 (panel2 -> --panel-2)
  const ui = t.colors.ui;
  root.setProperty("--panel", ui.panel);
  root.setProperty("--panel-2", ui.panel2);
  root.setProperty("--line", ui.line);
  root.setProperty("--ink", ui.ink);
  root.setProperty("--muted", ui.muted);
  root.setProperty("--gold", ui.gold);
  root.setProperty("--danger", ui.danger);
  root.setProperty("--ok", ui.ok);
}
