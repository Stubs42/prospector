/**
 * A hex-shaped guidance popup drawn in board space: a region of "radius 2" hexes,
 * so its six corners land exactly on cell centres and each edge spans two cells.
 * Position is caller-chosen (centre cell), so it can follow the action around the
 * board. Usually just a message (non-interactive) — pass `actions` to turn it into
 * a small confirm dialog instead.
 */
import { add, scale, DIRECTIONS } from "../../engine/hex.js";
import type { Hex } from "../../engine/index.js";
import { axialToPixel } from "./hexpx.js";

export interface HexPopupAction {
  label: string;
  kind?: "primary" | "danger";
  onClick: () => void;
}

/** the popup's own hex-shaped background, "radius" cells across each edge, centred on a
   board cell — shared with anything that wants the same hex silhouette (e.g. the ship
   picker) without duplicating the corner maths. */
export function hexBackgroundPoints(center: Hex, radius: number, rotation = 0): string {
  return DIRECTIONS.map((d) => {
    const p = axialToPixel(add(center, scale(d, radius)), rotation);
    return `${p.x.toFixed(1)},${p.y.toFixed(1)}`;
  }).join(" ");
}

/** a flattened hexagon (pointed left/right ends) sized to fit a button label. The diagonal
   edges are inclined at 60° from horizontal — a true hexagon's edge angle — rather than a
   45° chamfer; that means a *shorter* horizontal run for the same rise (steeper, sharper
   points), not a longer one, so this must stay independent of the label-driven width. */
export function hexButtonPoints(bx: number, by: number, bw: number, bh: number): string {
  const cut = bh / 2 / Math.tan(Math.PI / 3); // 60° from horizontal
  const pts: [number, number][] = [
    [bx, by + bh / 2],
    [bx + cut, by],
    [bx + bw - cut, by],
    [bx + bw, by + bh / 2],
    [bx + bw - cut, by + bh],
    [bx + cut, by + bh],
  ];
  return pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
}

export function HexPopup({
  center,
  lines,
  actions,
  radius = 2,
  rotation = 0,
}: {
  center: Hex;
  lines: string[];
  actions?: HexPopupAction[] | undefined;
  /** hex "radius" in cells — each edge spans this many cells. Bump it up when there are buttons to fit. */
  radius?: number | undefined;
  /** the board's current logical rotation (0..5, each step 60°) — see hexpx.ts's rotatePoint */
  rotation?: number | undefined;
}) {
  const pts = hexBackgroundPoints(center, radius, rotation);
  const o = axialToPixel(center, rotation);
  const lh = 17;
  const hasActions = !!actions?.length;
  const y0 = o.y - ((lines.length - 1) * lh) / 2 - (hasActions ? 16 : 0);

  const bh = 22;
  const gap = 10;
  const btnY = o.y + (lines.length - 1) * (lh / 2) + 26;
  // width follows the label — a fixed width was too narrow for anything longer than
  // "Cancel"/"Yes" (e.g. "🎲 Random"); ~7px/char at 11px bold is a safe overestimate,
  // plus room either side of the hex's pointed ends so the text never touches them
  const widths = (actions ?? []).map((a) => Math.max(56, a.label.length * 7 + 26));
  const totalW = hasActions ? widths.reduce((a, b) => a + b, 0) + gap * (widths.length - 1) : 0;

  return (
    <g className="hexpopup">
      <polygon points={pts} pointerEvents="none" />
      <text x={o.x} y={y0} textAnchor="middle" dominantBaseline="middle" pointerEvents="none">
        {lines.map((ln, i) => (
          <tspan key={i} x={o.x} dy={i === 0 ? 0 : lh}>
            {ln}
          </tspan>
        ))}
      </text>
      {hasActions && (
        <g>
          {actions!.map((a, i) => {
            const bw = widths[i]!;
            const bx = o.x - totalW / 2 + widths.slice(0, i).reduce((x, w) => x + w + gap, 0);
            return (
              <g key={i} className={`hexpopup-btn ${a.kind ?? ""}`} onClick={a.onClick}>
                <polygon points={hexButtonPoints(bx, btnY - bh / 2, bw, bh)} />
                <text x={bx + bw / 2} y={btnY + 4} textAnchor="middle">
                  {a.label}
                </text>
              </g>
            );
          })}
        </g>
      )}
    </g>
  );
}
