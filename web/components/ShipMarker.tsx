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

const RING_R = S * 0.42;
const DOT_R = S * 0.16;

/** pull `p` back toward `q` by `by` px, so a line stops at a glyph's edge not its centre */
function backOff(p: XY, q: XY, by: number): XY {
  const dx = q.x - p.x;
  const dy = q.y - p.y;
  const len = Math.hypot(dx, dy) || 1;
  return { x: p.x + (dx / len) * by, y: p.y + (dy / len) * by };
}

export function ShipMarker({ colour, ring, dot, line, active, shape = "ring" }: {
  colour: Colour;
  ring: XY;
  dot: XY;
  /** [outer end, ring end] — trimmed here so it meets the ring's edge, not its centre */
  line: [XY, XY] | null;
  active: boolean;
  shape?: ShipShape;
}) {
  const c = SHIP_VAR[colour];
  const seg = line
    ? [backOff(line[0], line[1], DOT_R), backOff(line[1], line[0], RING_R)]
    : null;
  return (
    <g className="ship-marker" pointerEvents="none">
      {seg && (
        <line x1={seg[0]!.x} y1={seg[0]!.y} x2={seg[1]!.x} y2={seg[1]!.y}
          stroke={c} strokeWidth={2} strokeLinecap="round" opacity={0.85} />
      )}
      {active && <circle cx={ring.x} cy={ring.y} r={S * 0.72} fill={c} fillOpacity={0.09} />}
      <CurrentShape shape={shape} x={ring.x} y={ring.y} colour={c} active={active} />
      {/* previous position — a dot in the middle of its cell (centre of the ring at rest) */}
      <circle cx={dot.x} cy={dot.y} r={DOT_R} fill={c} />
    </g>
  );
}
