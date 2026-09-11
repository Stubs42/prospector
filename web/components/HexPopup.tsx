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

export function HexPopup({
  center,
  lines,
  actions,
  radius = 2,
}: {
  center: Hex;
  lines: string[];
  actions?: HexPopupAction[];
  /** hex "radius" in cells — each edge spans this many cells. Bump it up when there are buttons to fit. */
  radius?: number;
}) {
  const pts = DIRECTIONS.map((d) => {
    const p = axialToPixel(add(center, scale(d, radius)));
    return `${p.x.toFixed(1)},${p.y.toFixed(1)}`;
  }).join(" ");
  const o = axialToPixel(center);
  const lh = 17;
  const hasActions = !!actions?.length;
  const y0 = o.y - ((lines.length - 1) * lh) / 2 - (hasActions ? 16 : 0);

  const bw = 56;
  const bh = 22;
  const gap = 10;
  const btnY = o.y + (lines.length - 1) * (lh / 2) + 26;
  const totalW = hasActions ? actions!.length * bw + (actions!.length - 1) * gap : 0;

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
            const bx = o.x - totalW / 2 + i * (bw + gap);
            return (
              <g key={i} className={`hexpopup-btn ${a.kind ?? ""}`} onClick={a.onClick}>
                <rect x={bx} y={btnY - bh / 2} width={bw} height={bh} rx={7} />
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
