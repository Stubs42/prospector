/**
 * Everything the physical table shows around a base, laid straight into the
 * board's outer-ring cells (nothing floats off the board):
 *
 *   near ring  — identity in the corner cell, the six aspect hexes flanking it
 *   far ring   — score, carried & saved ore, cards in hand, fuel
 *
 * Each aspect keeps its shared colour (see aspects.ts): a coloured hexagon with
 * the installed count, shown as "2" or "2+1" when an upgrade is stacked on top.
 */
import { type ReactNode, type MouseEvent as RMouseEvent } from "react";
import { statsOf } from "../../engine/index.js";
import type { GameState, Colour, OreColour, StatKey } from "../../engine/index.js";
import type { BoardModel, BoardCell } from "../../engine/board.js";
import { distance } from "../../engine/hex.js";
import type { Seat } from "../../client/index.js";
import { S } from "./geo.js";
import { SHIP_VAR, ORE_VAR } from "./kit.js";
import { ASPECT_FILL, ASPECT_LABEL, ASPECT_TAG } from "./aspects.js";

const GOLD = "#e6b03c";
const norm = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

function hexPts(cx: number, cy: number, size: number): string {
  const p: string[] = [];
  for (let i = 0; i < 6; i++) {
    const a = ((60 * i - 90) * Math.PI) / 180;
    p.push(`${(cx + size * Math.cos(a)).toFixed(2)},${(cy + size * Math.sin(a)).toFixed(2)}`);
  }
  return p.join(" ");
}

/** outer cells hugging a base: near (dist 10) & far (dist 11) arcs sorted left→right, plus each arc's corner index */
function outerArcs(board: BoardModel, colour: Colour) {
  const bc = board.baseCells(colour);
  const centres = bc.map((h) => board.cell(h)!).filter(Boolean);
  const base0 = Math.atan2(
    centres.reduce((a, c) => a + c.y, 0) / centres.length,
    centres.reduce((a, c) => a + c.x, 0) / centres.length,
  );
  const near2 = (c: BoardCell) => Math.min(...bc.map((b) => distance(b, c))) <= 2;
  const arc = (dist: number) => {
    const cells = board
      .allCells()
      .filter((c) => c.region === "outer" && c.dist === dist && near2(c))
      .sort((p, q) => norm(Math.atan2(p.y, p.x) - base0) - norm(Math.atan2(q.y, q.x) - base0));
    // the corner cell = the one pointing most directly away from the origin, along the base's axis
    let corner = 0;
    for (let i = 1; i < cells.length; i++) {
      if (Math.abs(norm(Math.atan2(cells[i]!.y, cells[i]!.x) - base0)) <
          Math.abs(norm(Math.atan2(cells[corner]!.y, cells[corner]!.x) - base0))) corner = i;
    }
    return { cells, corner };
  };
  return { near: arc(board.innerRadius + 1), far: arc(board.radius) };
}

const TOK = S * 0.72; // token hexagon radius — sits inside its board cell with a gap
const DARK = "#0a120e";

export type TipFn = (text: string | null, e: RMouseEvent) => void;

/** green (plenty) → amber → red (empty), for the "available" half of a ratio */
function grade(t: number): string {
  t = Math.max(0, Math.min(1, t));
  const A = [193, 87, 60], M = [215, 177, 61], G = [63, 159, 99];
  const [lo, hi, k] = t < 0.5 ? [A, M, t * 2] : [M, G, (t - 0.5) * 2];
  return `rgb(${lo.map((c, i) => Math.round(c + (hi[i]! - c) * k)).join(",")})`;
}

/** hover target that reports its tooltip text up to the board */
function Hoverable({ tip, onTip, children }: { tip: string; onTip: TipFn; children: ReactNode }) {
  return (
    <g onMouseMove={(e) => onTip(tip, e)} onMouseLeave={(e) => onTip(null, e)} style={{ cursor: "help" }}>
      {children}
    </g>
  );
}

/** shell: dark backing + coloured hex ring + tag label. children draw the value. */
function Shell({ x, y, col, ink, active }: {
  x: number; y: number; col: string; ink?: string | undefined; active: boolean;
}) {
  return (
    <>
      <polygon points={hexPts(x, y, TOK + 2.5)} fill={DARK} />
      <polygon points={hexPts(x, y, TOK)} fill={ink ? col : DARK} stroke={col} strokeWidth={active ? 2.6 : 1.4} />
    </>
  );
}

function Tag({ x, y, text, col }: { x: number; y: number; text: string; col: string }) {
  return (
    <text x={x} y={y - TOK * 0.42} textAnchor="middle" fill={col} opacity={0.85}
      fontSize={S * 0.23} fontWeight={700} style={{ letterSpacing: "0.04em" }}>
      {text}
    </text>
  );
}

/** a plain single-number stat token */
function Token({ c, col, tag, value, ink, active, tip, onTip }: {
  c: BoardCell; col: string; tag: string; value: string; ink?: string; active: boolean; tip: string; onTip: TipFn;
}) {
  const x = c.x * S;
  const y = c.y * S;
  return (
    <Hoverable tip={tip} onTip={onTip}>
      <Shell x={x} y={y} col={col} ink={ink} active={active} />
      <Tag x={x} y={y} text={tag} col={ink ?? col} />
      <text x={x} y={y + TOK * 0.2} textAnchor="middle" dominantBaseline="central"
        fill={ink ?? col} fontWeight={800} fontSize={value.length > 2 ? S * 0.44 : S * 0.6}>
        {value}
      </text>
    </Hoverable>
  );
}

/** a "have / max" token; the "have" digit is colour-graded when `gradeCur` */
function RatioToken({ c, col, tag, cur, max, active, tip, onTip, gradeCur, warnOver }: {
  c: BoardCell; col: string; tag: string; cur: number; max: number; active: boolean;
  tip: string; onTip: TipFn; gradeCur?: boolean; warnOver?: boolean;
}) {
  const x = c.x * S;
  const y = c.y * S;
  const curCol = warnOver && cur > max ? "#c1573c" : gradeCur ? grade(max ? cur / max : 0) : col;
  const txt = `${cur}/${max}`;
  return (
    <Hoverable tip={tip} onTip={onTip}>
      <Shell x={x} y={y} col={col} active={active} />
      <Tag x={x} y={y} text={tag} col={col} />
      <text x={x} y={y + TOK * 0.2} textAnchor="middle" dominantBaseline="central"
        fontWeight={800} fontSize={txt.length > 3 ? S * 0.38 : S * 0.5}>
        <tspan fill={curCol}>{cur}</tspan>
        <tspan fill={col} opacity={0.6}>/{max}</tspan>
      </text>
    </Hoverable>
  );
}

function OreHex({ c, ores, tag, tip, onTip }: {
  c: BoardCell; ores: OreColour[]; tag: string; tip: string; onTip: TipFn;
}) {
  const x = c.x * S;
  const y = c.y * S;
  const n = Math.min(ores.length, 6);
  return (
    <Hoverable tip={`${tip}: ${ores.length ? ores.join(", ") : "none"}`} onTip={onTip}>
      <polygon points={hexPts(x, y, TOK + 2.5)} fill={DARK} />
      <polygon points={hexPts(x, y, TOK)} fill={DARK} stroke="#3a4a41" strokeWidth={1.3} />
      <Tag x={x} y={y} text={tag} col="#8b9a91" />
      {n === 0 ? (
        <text x={x} y={y + TOK * 0.2} textAnchor="middle" fill="#4b574f" fontSize={S * 0.34}>–</text>
      ) : (
        ores.slice(0, 6).map((o, i) => (
          <circle key={i} cx={x + (i - (n - 1) / 2) * S * 0.32} cy={y + TOK * 0.18}
            r={S * 0.14} fill={ORE_VAR[o]} stroke="#000" strokeOpacity={0.3} />
        ))
      )}
    </Hoverable>
  );
}

function IdentityHex({ c, name, seat, colour, active, onTip }: {
  c: BoardCell; name: string; seat: Seat; colour: Colour; active: boolean; onTip: TipFn;
}) {
  const x = c.x * S;
  const y = c.y * S;
  return (
    <Hoverable tip={`${name} — ${seat === "bot" ? "bot" : "you"}${active ? " · to move" : ""}`} onTip={onTip}>
      <polygon points={hexPts(x, y, S * 0.92)} fill={DARK}
        stroke={SHIP_VAR[colour]} strokeWidth={active ? 3.2 : 1.6} />
      <circle cx={x} cy={y - S * 0.46} r={S * 0.12} fill={SHIP_VAR[colour]} />
      <text x={x} y={y + S * 0.06} textAnchor="middle" fill="#eef2ef" fontWeight={800} fontSize={S * 0.32}>
        {name}
      </text>
      <text x={x} y={y + S * 0.46} textAnchor="middle" fill="#9fb0a6" fontSize={S * 0.22}
        style={{ letterSpacing: "0.14em" }}>
        {seat === "bot" ? "BOT" : "YOU"}
      </text>
    </Hoverable>
  );
}

export function BaseInfo({ board, state, seats, scores, onTip }: {
  board: BoardModel; state: GameState; seats: readonly Seat[]; scores: readonly number[]; onTip: TipFn;
}) {
  const mode = state.config.modes.prospector;

  return (
    <g className="baseinfo">
      {state.players
        .filter((p) => !p.eliminated)
        .map((p) => {
          const { near, far } = outerArcs(board, p.colour);
          if (near.cells.length < 7 || far.cells.length < 5) return null;
          const active = p.id === state.activePlayerIndex;
          const stats = statsOf(state, p);
          const baseShip = mode.ships[p.colour];
          const nm = near.corner;
          const fm = far.corner;
          const scoreVal = scores[p.id] ?? 0;

          // two logical branches fanning off the corner identity cell, each ordered
          // identity-outward: freight group (cargo · laser · shield) on one side,
          // drive group (engine · fuel · cards) on the other.
          const leftBranch = near.cells.slice(0, nm).reverse(); // nm-1, nm-2, nm-3
          const rightBranch = near.cells.slice(nm + 1); // nm+1, nm+2, nm+3
          const FREIGHT_GROUP: StatKey[] = ["cargo", "lasers", "shields"];
          const DRIVE_GROUP: StatKey[] = ["engines", "fuelTanks", "booster"];

          const aspect = (cell: BoardCell | undefined, stat: StatKey) => {
            if (!cell) return null;
            const col = ASPECT_FILL[stat];
            const total = stats[stat];
            const up = total - baseShip[stat];
            if (stat === "fuelTanks")
              return (
                <RatioToken key={stat} c={cell} col={col} tag="FUEL" cur={p.fuel} max={p.fuelMax}
                  active={active} onTip={onTip} gradeCur
                  tip={`fuel — ${p.fuel} of ${p.fuelMax}${up ? ` (tank ${total}, +${up} upgrade)` : ""}`} />
              );
            if (stat === "cargo")
              return (
                <RatioToken key={stat} c={cell} col={col} tag="CARGO" cur={p.cargo.length} max={total}
                  active={active} onTip={onTip}
                  tip={`cargo — ${p.cargo.length} of ${total} held${up ? ` (+${up} upgrade)` : ""}`} />
              );
            if (stat === "booster")
              return (
                <RatioToken key={stat} c={cell} col={col} tag="CARDS" cur={p.hand.length} max={total}
                  active={active} onTip={onTip} warnOver
                  tip={`cards — ${p.hand.length} in hand of ${total} limit${up ? ` (+${up} upgrade)` : ""}`} />
              );
            return (
              <Token key={stat} c={cell} col={col} tag={ASPECT_TAG[stat]} value={`${total}`} active={active} onTip={onTip}
                tip={`${ASPECT_LABEL[stat]} — ${total}${up ? ` (${baseShip[stat]} + ${up} upgrade)` : ""}`} />
            );
          };

          return (
            <g key={`bi-${p.id}`}>
              <IdentityHex c={near.cells[nm]!} name={baseShip.name} seat={seats[p.id]!} colour={p.colour} active={active} onTip={onTip} />

              {FREIGHT_GROUP.map((s, i) => aspect(leftBranch[i], s))}
              {DRIVE_GROUP.map((s, i) => aspect(rightBranch[i], s))}

              {/* freight family in the far ring, just outside the cargo cell */}
              {far.cells[fm - 1] && <OreHex c={far.cells[fm - 1]!} ores={p.cargo} tag="FREIGHT" tip="freight in hold" onTip={onTip} />}
              {far.cells[fm - 2] && <OreHex c={far.cells[fm - 2]!} ores={p.delivered} tag="SAVED" tip="delivered to base" onTip={onTip} />}
              {far.cells[fm] && (
                <Token c={far.cells[fm]!} col={GOLD} ink="#1a1400" tag="PTS" active={active} onTip={onTip}
                  value={`${scoreVal}`} tip={`score — ${scoreVal}`} />
              )}
            </g>
          );
        })}

      {/* shared supply / deck counts — small text block in the bottom-centre gap */}
      <g pointerEvents="none">
      {(() => {
        const y0 = 1.5 * board.innerRadius * S * 0.62;
        const rows = [
          `booster deck ${state.decks.booster.draw.length}`,
          `equipment deck ${state.decks.equipment.draw.length}`,
          `supply  ${state.supply.green} / ${state.supply.yellow} / ${state.supply.red}`,
        ];
        return (
          <g>
            {rows.map((t, i) => (
              <text key={i} x={0} y={y0 + i * 15} textAnchor="middle" fontSize={11} fill="#7c8b83">
                {t}
              </text>
            ))}
          </g>
        );
      })()}
      </g>
    </g>
  );
}
