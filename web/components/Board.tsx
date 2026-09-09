import { boardFor } from "../../engine/game.js";
import { hexKey } from "../../engine/hex.js";
import type { GameState, Hex, Colour, OreColour } from "../../engine/index.js";

const S = 26; // px per unit hex size (pointy-top, matches board.json x/y)

const SHIP_FILL: Record<Colour, string> = {
  black: "var(--ship-black)",
  red: "var(--ship-red)",
  blue: "var(--ship-blue)",
  white: "var(--ship-white)",
  green: "var(--ship-green)",
  yellow: "var(--ship-yellow)",
};
const ORE_FILL: Record<OreColour, string> = {
  green: "var(--ore-green)",
  yellow: "var(--ore-yellow)",
  red: "var(--ore-red)",
};

function hexPoints(cx: number, cy: number, size: number): string {
  const pts: string[] = [];
  for (let i = 0; i < 6; i++) {
    const a = ((60 * i - 90) * Math.PI) / 180; // pointy-top
    pts.push(`${(cx + size * Math.cos(a)).toFixed(2)},${(cy + size * Math.sin(a)).toFixed(2)}`);
  }
  return pts.join(" ");
}

function Cone({ x, y, fill, i }: { x: number; y: number; fill: string; i: number }) {
  const dy = -i * 5; // stack upward
  return (
    <path
      d={`M ${x} ${y - 9 + dy} L ${x - 6} ${y + 4 + dy} L ${x + 6} ${y + 4 + dy} Z`}
      fill={fill}
      stroke="rgba(0,0,0,0.55)"
      strokeWidth={1}
    />
  );
}

export function Board({
  state,
  highlight,
  onCell,
}: {
  state: GameState;
  highlight: { cells: Hex[]; kind: "burn" | "load" | null };
  onCell: (h: Hex) => void;
}) {
  const board = boardFor(state);
  const cells = board.allCells();
  const xs = cells.map((c) => c.x * S);
  const ys = cells.map((c) => c.y * S);
  const pad = S * 3;
  const minx = Math.min(...xs) - pad;
  const miny = Math.min(...ys) - pad;
  const w = Math.max(...xs) - Math.min(...xs) + pad * 2;
  const h = Math.max(...ys) - Math.min(...ys) + pad * 2;

  const hi = new Set(highlight.cells.map(hexKey));
  const centre = (hx: Hex) => {
    const c = board.cell(hx)!;
    return { cx: c.x * S, cy: c.y * S };
  };

  return (
    <svg viewBox={`${minx} ${miny} ${w} ${h}`} width={w} height={h}>
      <rect x={minx} y={miny} width={w} height={h} fill="none" />

      {cells.map((c) => {
        const cx = c.x * S;
        const cy = c.y * S;
        const key = hexKey(c);
        const isHi = hi.has(key);
        const fill = c.base
          ? SHIP_FILL[c.base as Colour]
          : c.region === "outer"
            ? "#1c2b25"
            : "#0e1b15";
        const stroke = c.origin
          ? "var(--gold)"
          : isHi
            ? "var(--gold)"
            : c.base
              ? SHIP_FILL[c.base as Colour]
              : "#2b4034";
        return (
          <polygon
            key={key}
            points={hexPoints(cx, cy, S * 0.94)}
            fill={fill}
            fillOpacity={c.base ? 0.85 : 1}
            stroke={stroke}
            strokeWidth={c.origin ? 2.5 : isHi ? 2.5 : c.base ? 1.6 : 1}
            strokeOpacity={c.base ? 0.9 : 1}
            className={isHi ? "cell-hit" : undefined}
            onClick={isHi ? () => onCell({ q: c.q, r: c.r }) : undefined}
          />
        );
      })}

      {/* resources */}
      {Object.entries(state.board.resources).map(([k, colour]) => {
        const [q, r] = k.split(",").map(Number) as [number, number];
        const { cx, cy } = centre({ q, r });
        return (
          <g key={`res-${k}`}>
            <circle cx={cx} cy={cy} r={S * 0.42} fill={ORE_FILL[colour]} stroke="rgba(0,0,0,0.4)" />
            <text
              x={cx}
              y={cy + 4}
              textAnchor="middle"
              fontSize={11}
              fontWeight={700}
              fill="rgba(0,0,0,0.55)"
            >
              {state.config.modes.prospector.resources.values[colour]}
            </text>
          </g>
        );
      })}

      {/* ships */}
      {state.players
        .filter((p) => !p.eliminated)
        .map((p) => {
          const cur = centre(p.pose.current);
          const prev = centre(p.pose.previous);
          const fill = SHIP_FILL[p.colour];
          return (
            <g key={`ship-${p.id}`}>
              {p.pose.atRest ? (
                [0, 1, 2].map((i) => <Cone key={i} x={cur.cx} y={cur.cy} fill={fill} i={i} />)
              ) : (
                <>
                  <Cone x={prev.cx} y={prev.cy} fill={fill} i={0} />
                  <Cone x={cur.cx} y={cur.cy} fill={fill} i={0} />
                  <Cone x={cur.cx} y={cur.cy} fill={fill} i={1} />
                  {!(prev.cx === cur.cx && prev.cy === cur.cy) && (
                    <line
                      x1={prev.cx}
                      y1={prev.cy}
                      x2={cur.cx}
                      y2={cur.cy}
                      stroke={fill}
                      strokeWidth={1.5}
                      strokeDasharray="3 3"
                      opacity={0.6}
                    />
                  )}
                </>
              )}
            </g>
          );
        })}

      {/* interaction markers */}
      {highlight.cells.map((hx) => {
        const { cx, cy } = centre(hx);
        return (
          <circle
            key={`hi-${hexKey(hx)}`}
            cx={cx}
            cy={cy}
            r={S * 0.5}
            fill="none"
            stroke={highlight.kind === "load" ? "var(--ok)" : "var(--gold)"}
            strokeWidth={2}
            strokeDasharray={highlight.kind === "load" ? "4 3" : undefined}
            className="cell-hit"
            onClick={() => onCell(hx)}
          />
        );
      })}
    </svg>
  );
}
