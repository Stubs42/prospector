import { boardFor } from "../../engine/game.js";
import { hexKey } from "../../engine/hex.js";
import type { GameState, Hex, Colour, OreColour } from "../../engine/index.js";
import { Cone, SHIP_VAR, ORE_VAR } from "./kit.js";
import { BoardFurniture, panelAnchor, PANEL_W, PANEL_H } from "./BoardFurniture.js";
import type { Seat } from "../../client/index.js";

export const S = 26; // px per unit hex size (pointy-top, matches board.json x/y)

export interface RadialAction {
  id: string;
  label: string;
  kind?: "primary" | "danger" | undefined;
  onClick: () => void;
}

function hexPoints(cx: number, cy: number, size: number): string {
  const pts: string[] = [];
  for (let i = 0; i < 6; i++) {
    const a = ((60 * i - 90) * Math.PI) / 180; // pointy-top
    pts.push(`${(cx + size * Math.cos(a)).toFixed(2)},${(cy + size * Math.sin(a)).toFixed(2)}`);
  }
  return pts.join(" ");
}

export interface BoardProps {
  state: GameState;
  seats: readonly Seat[];
  scores: readonly number[];
  highlight: { cells: Hex[]; kind: "load" | "place" | null };
  burnTargets: { cell: Hex; cost: number }[];
  driftGhost: { at: Hex; from: Hex } | null;
  burnPreview: { path: Hex[]; cost: number } | null;
  radial: RadialAction[];
  reducedMotion: boolean;
  onCell: (h: Hex) => void;
  onCellHover: (h: Hex | null) => void;
}

/** cost 0 = free (green), 1 = yellow, 2 = orange, 3 = red */
const BURN_COST_COLOUR = ["var(--ok)", "#d7b13d", "#e08a3d", "#c1573c"];

export function Board({
  state,
  seats,
  scores,
  highlight,
  burnTargets,
  driftGhost,
  burnPreview,
  radial,
  reducedMotion,
  onCell,
  onCellHover,
}: BoardProps) {
  const board = boardFor(state);
  const cells = board.allCells();
  const xs = cells.map((c) => c.x * S);
  const ys = cells.map((c) => c.y * S);
  // viewBox = field bbox ∪ every ship-panel bbox, + a small margin
  const bx: number[] = [Math.min(...xs), Math.max(...xs)];
  const by: number[] = [Math.min(...ys), Math.max(...ys)];
  for (const pl of state.players) {
    const a = panelAnchor(board, pl.colour);
    bx.push(a.x - PANEL_W / 2, a.x + PANEL_W / 2);
    by.push(a.y - PANEL_H / 2, a.y + PANEL_H / 2);
  }
  const m = 24;
  const minx = Math.min(...bx) - m;
  const miny = Math.min(...by) - m;
  const w = Math.max(...bx) - Math.min(...bx) + m * 2;
  const h = Math.max(...by) - Math.min(...by) + m * 2;

  const hi = new Set(highlight.cells.map(hexKey));
  const px = (hx: Hex) => {
    const c = board.cell(hx)!;
    return { x: c.x * S, y: c.y * S };
  };
  const shipTransition = reducedMotion ? "none" : "transform 320ms cubic-bezier(.4,0,.2,1)";

  const active = state.players[state.activePlayerIndex]!;
  const activeAt = px(active.pose.current);

  return (
    <svg
      viewBox={`${minx} ${miny} ${w} ${h}`}
      width="100%"
      height="100%"
      preserveAspectRatio="xMidYMid meet"
    >
      {cells.map((c) => {
        const cx = c.x * S;
        const cy = c.y * S;
        const key = hexKey(c);
        const isHi = hi.has(key);
        const fill = c.base
          ? SHIP_VAR[c.base as Colour]
          : c.region === "outer"
            ? "#1c2b25"
            : "#0e1b15";
        const stroke = c.origin
          ? "var(--gold)"
          : isHi
            ? "var(--gold)"
            : c.base
              ? SHIP_VAR[c.base as Colour]
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
            onMouseEnter={isHi ? () => onCellHover({ q: c.q, r: c.r }) : undefined}
            onMouseLeave={isHi ? () => onCellHover(null) : undefined}
          />
        );
      })}

      {/* resources */}
      {Object.entries(state.board.resources).map(([k, colour]) => {
        const [q, r] = k.split(",").map(Number) as [number, number];
        const { x, y } = px({ q, r });
        return (
          <g key={`res-${k}`} className="ore-chip">
            <circle cx={x} cy={y} r={S * 0.42} fill={ORE_VAR[colour as OreColour]} stroke="rgba(0,0,0,0.4)" />
            <text x={x} y={y + 4} textAnchor="middle" fontSize={11} fontWeight={700} fill="rgba(0,0,0,0.55)">
              {state.config.modes.prospector.resources.values[colour as OreColour]}
            </text>
          </g>
        );
      })}

      {/* drift preview: where the ship will coast if it drifts now */}
      {driftGhost && (
        <g pointerEvents="none">
          {(() => {
            const a = px(driftGhost.from);
            const b = px(driftGhost.at);
            return (
              <>
                <line
                  x1={a.x}
                  y1={a.y}
                  x2={b.x}
                  y2={b.y}
                  stroke="var(--gold)"
                  strokeWidth={1.5}
                  strokeDasharray="2 4"
                  opacity={0.7}
                />
                <polygon points={hexPoints(b.x, b.y, S * 0.9)} fill="var(--gold)" fillOpacity={0.09} stroke="var(--gold)" strokeDasharray="3 3" strokeWidth={1.5} />
                <g transform={`translate(${b.x} ${b.y})`}>
                  <Cone fill="var(--gold)" ghost />
                  <Cone fill="var(--gold)" ghost lift={5} />
                </g>
              </>
            );
          })()}
        </g>
      )}

      {/* burn hover: the path and its fuel cost */}
      {burnPreview && burnPreview.path.length > 0 && (
        <g pointerEvents="none">
          <polyline
            points={[state.players[state.activePlayerIndex]!.pose.current, ...burnPreview.path]
              .map((hx) => {
                const p = px(hx);
                return `${p.x},${p.y}`;
              })
              .join(" ")}
            fill="none"
            stroke="var(--gold)"
            strokeWidth={2.5}
            strokeLinejoin="round"
          />
          {(() => {
            const end = px(burnPreview.path[burnPreview.path.length - 1]!);
            return (
              <g transform={`translate(${end.x} ${end.y - S * 0.9})`}>
                <rect x={-16} y={-11} width={32} height={20} rx={4} fill="#111" stroke="var(--gold)" />
                <text x={0} y={4} textAnchor="middle" fontSize={11} fill="var(--gold)" fontWeight={700}>
                  ⛽{burnPreview.cost}
                </text>
              </g>
            );
          })()}
        </g>
      )}

      {/* ships — each in a translated group so position changes tween */}
      {state.players
        .filter((p) => !p.eliminated)
        .map((p) => {
          const cur = px(p.pose.current);
          const prev = px(p.pose.previous);
          const fill = SHIP_VAR[p.colour];
          const moving = !p.pose.atRest && !(prev.x === cur.x && prev.y === cur.y);
          return (
            <g key={`ship-${p.id}`}>
              {moving && (
                <line
                  x1={prev.x}
                  y1={prev.y}
                  x2={cur.x}
                  y2={cur.y}
                  stroke={fill}
                  strokeWidth={1.5}
                  strokeDasharray="3 3"
                  opacity={0.55}
                />
              )}
              {!p.pose.atRest && (
                <g style={{ transition: shipTransition }} transform={`translate(${prev.x} ${prev.y})`}>
                  <Cone fill={fill} />
                </g>
              )}
              <g style={{ transition: shipTransition }} transform={`translate(${cur.x} ${cur.y})`}>
                <ellipse cx={0} cy={4} rx={9} ry={4} fill="rgba(255,255,255,0.10)" />
                <Cone fill={fill} />
                {(p.pose.atRest ? [1, 2] : [1]).map((l) => (
                  <Cone key={l} fill={fill} lift={l * 5} />
                ))}
              </g>
            </g>
          );
        })}

      {/* burn targets — colour = fuel cost (green free, yellow 1, orange 2, red 3) */}
      {burnTargets.map(({ cell, cost }) => {
        const { x, y } = px(cell);
        const col = BURN_COST_COLOUR[Math.min(cost, 3)]!;
        return (
          <g key={`burn-${hexKey(cell)}`} className="cell-hit burn-target"
             onClick={() => onCell(cell)}
             onMouseEnter={() => onCellHover(cell)}
             onMouseLeave={() => onCellHover(null)}>
            <circle cx={x} cy={y} r={S * 0.6} fill={col} fillOpacity={0.14} stroke={col} strokeWidth={2.6} />
            <text x={x} y={y + 4} textAnchor="middle" fontSize={11} fontWeight={700} fill={col}>
              {cost === 0 ? "◇" : cost}
            </text>
          </g>
        );
      })}

      {/* load / launch markers */}
      {highlight.cells.map((hx) => {
        const { x, y } = px(hx);
        return (
          <circle
            key={`hi-${hexKey(hx)}`}
            cx={x}
            cy={y}
            r={S * 0.5}
            fill="none"
            stroke={highlight.kind === "load" ? "var(--ok)" : "var(--gold)"}
            strokeWidth={2}
            strokeDasharray={highlight.kind === "load" ? "4 3" : "3 3"}
            className="cell-hit"
            onClick={() => onCell(hx)}
            onMouseEnter={() => onCellHover(hx)}
            onMouseLeave={() => onCellHover(null)}
          />
        );
      })}

      {/* table furniture (ship panels, deck counts) — drawn on top so text stays legible */}
      <BoardFurniture board={board} state={state} seats={seats} scores={scores} />

      {/* radial action menu around the active ship */}
      {radial.length > 0 && (
        <g className="radial">
          {radial.map((a, i) => {
            // fan the chips across the top-right quadrant so they clear the piece & trail
            const n = radial.length;
            const spread = Math.min(150, 44 * Math.max(1, n - 1));
            const ang = (-90 - (n > 1 ? spread / 2 : 0) + (n > 1 ? (spread * i) / (n - 1) : 0)) * (Math.PI / 180);
            const R = S * 2.7;
            const cx = activeAt.x + R * Math.cos(ang);
            const cy = activeAt.y + R * Math.sin(ang);
            return (
              <g key={a.id} className={`chip ${a.kind ?? ""}`} onClick={a.onClick}>
                <line x1={activeAt.x} y1={activeAt.y} x2={cx} y2={cy} className="chip-stem" />
                <circle cx={cx} cy={cy} r={S * 0.92} />
                <text x={cx} y={cy + 4} textAnchor="middle">
                  {a.label}
                </text>
              </g>
            );
          })}
        </g>
      )}
    </svg>
  );
}
