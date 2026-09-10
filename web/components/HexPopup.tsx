/**
 * A hex-shaped guidance popup drawn in board space: a region of "radius 2" hexes,
 * so its six corners land exactly on cell centres and each edge spans two cells.
 * Position is caller-chosen (centre cell), so it can follow the action around the
 * board. Non-interactive — it only tells the player what to do next.
 */
import { add, scale, DIRECTIONS } from "../../engine/hex.js";
import type { Hex } from "../../engine/index.js";
import { axialToPixel } from "./hexpx.js";

export function HexPopup({ center, lines }: { center: Hex; lines: string[] }) {
  const pts = DIRECTIONS.map((d) => {
    const p = axialToPixel(add(center, scale(d, 2)));
    return `${p.x.toFixed(1)},${p.y.toFixed(1)}`;
  }).join(" ");
  const o = axialToPixel(center);
  const lh = 17;
  const y0 = o.y - ((lines.length - 1) * lh) / 2;

  return (
    <g className="hexpopup" pointerEvents="none">
      <polygon points={pts} />
      <text x={o.x} y={y0} textAnchor="middle" dominantBaseline="middle">
        {lines.map((ln, i) => (
          <tspan key={i} x={o.x} dy={i === 0 ? 0 : lh}>
            {ln}
          </tspan>
        ))}
      </text>
    </g>
  );
}
