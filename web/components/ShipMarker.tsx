/**
 * The abstract ship marker: a shape at the current position, a dot at the
 * previous position, and a line joining them while the ship is in flight.
 * `shape` is deliberately a switch so the current-position glyph can change
 * later without touching the movement code.
 */
import type { Colour } from "../../engine/index.js";
import { SHIP_VAR } from "./kit.js";
import { S } from "./geo.js";

export type ShipShape = "ring";

interface XY {
  x: number;
  y: number;
}

function CurrentShape({ shape, x, y, colour, active }: {
  shape: ShipShape; x: number; y: number; colour: string; active: boolean;
}) {
  const r = S * 0.42;
  switch (shape) {
    case "ring":
    default:
      return (
        <circle cx={x} cy={y} r={r} fill={colour} fillOpacity={0.12}
          stroke={colour} strokeWidth={active ? 3.4 : 2.4} />
      );
  }
}

export function ShipMarker({ colour, ring, dot, line, active, shape = "ring" }: {
  colour: Colour;
  ring: XY;
  dot: XY;
  line: [XY, XY] | null;
  active: boolean;
  shape?: ShipShape;
}) {
  const c = SHIP_VAR[colour];
  return (
    <g className="ship-marker" pointerEvents="none">
      {line && (
        <line x1={line[0].x} y1={line[0].y} x2={line[1].x} y2={line[1].y}
          stroke={c} strokeWidth={2} strokeLinecap="round" opacity={0.8} />
      )}
      {active && <circle cx={ring.x} cy={ring.y} r={S * 0.72} fill={c} fillOpacity={0.09} />}
      <CurrentShape shape={shape} x={ring.x} y={ring.y} colour={c} active={active} />
      {/* previous position — a dot in the middle of its cell (centre of the ring at rest) */}
      <circle cx={dot.x} cy={dot.y} r={S * 0.16} fill={c} />
    </g>
  );
}
