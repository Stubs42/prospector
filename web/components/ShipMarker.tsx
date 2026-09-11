/**
 * The abstract ship marker: a shape at the current position, a dot at the
 * previous position, and a line joining them while the ship is in flight.
 * `shape` is deliberately a switch so the current-position glyph can change
 * later without touching the movement code.
 */
import type { Colour } from "../../engine/index.js";
import { SHIP_VAR } from "./kit.js";
import { S } from "./geo.js";
import type { TipFn } from "./BaseInfo.js";

export type ShipShape = "ring";

interface XY {
  x: number;
  y: number;
}

/** makes the ring itself a click target — e.g. "attack this ship" or "end turn" */
export interface ShipInteraction {
  tip: string;
  onClick: () => void;
}

function CurrentShape({ shape, x, y, colour, active, pulse, interact, onTip }: {
  shape: ShipShape; x: number; y: number; colour: string; active: boolean;
  pulse?: boolean | undefined;
  interact?: ShipInteraction | null | undefined;
  onTip?: TipFn | undefined;
}) {
  const r = S * 0.42;
  const props = interact
    ? {
        style: { cursor: "pointer", pointerEvents: "all" as const },
        onClick: interact.onClick,
        onMouseMove: onTip ? (e: Parameters<TipFn>[1]) => onTip(interact.tip, e) : undefined,
        onMouseLeave: onTip ? (e: Parameters<TipFn>[1]) => onTip(null, e) : undefined,
      }
    : {};
  switch (shape) {
    case "ring":
    default:
      return (
        <circle cx={x} cy={y} r={r} fill={colour} fillOpacity={0.12}
          stroke={colour} strokeWidth={active ? 3.4 : 2.4}
          className={pulse ? "pulse-avail" : undefined}
          {...props} />
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

export function ShipMarker({ colour, ring, dot, tether, active, shape = "ring", pulse, interact, onTip }: {
  colour: Colour;
  ring: XY;
  dot: XY;
  /** dot ↔ ring — [dot end, ring end]; trimmed so it meets each glyph's edge */
  tether: [XY, XY] | null;
  active: boolean;
  shape?: ShipShape;
  /** show the "you can act here" breathing highlight on the ring */
  pulse?: boolean;
  /** makes the ring clickable (attack this ship / end turn on your own) with a hover tooltip */
  interact?: ShipInteraction | null;
  onTip?: TipFn;
}) {
  const c = SHIP_VAR[colour];
  const t = tether
    ? [backOff(tether[0], tether[1], DOT_R), backOff(tether[1], tether[0], RING_R)]
    : null;
  return (
    <g className="ship-marker" pointerEvents="none">
      {t && (
        <line x1={t[0]!.x} y1={t[0]!.y} x2={t[1]!.x} y2={t[1]!.y}
          stroke={c} strokeWidth={2} strokeLinecap="round" opacity={0.85} />
      )}
      {active && <circle cx={ring.x} cy={ring.y} r={S * 0.72} fill={c} fillOpacity={0.09} />}
      <CurrentShape shape={shape} x={ring.x} y={ring.y} colour={c} active={active} pulse={pulse} interact={interact} onTip={onTip} />
      {/* previous position — a dot in the middle of its cell (centre of the ring at rest) */}
      <circle cx={dot.x} cy={dot.y} r={DOT_R} fill={c} />
    </g>
  );
}
