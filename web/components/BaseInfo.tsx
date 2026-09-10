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
import { statsOf } from "../../engine/index.js";
import type { GameState, Colour, OreColour, StatKey } from "../../engine/index.js";
import type { BoardModel, BoardCell } from "../../engine/board.js";
import { distance } from "../../engine/hex.js";
import type { Seat } from "../../client/index.js";
import { S } from "./geo.js";
import { SHIP_VAR, ORE_VAR } from "./kit.js";
import { ASPECT_FILL, ASPECT_LABEL, ASPECT_ORDER } from "./aspects.js";

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

const TOK = S * 0.66; // token hexagon radius — sits inside its board cell with a gap
const DARK = "#0a120e";

/** a coloured-outline token: dark hex, aspect-colour ring + number */
function Token({ c, col, main, sub, active, title }: {
  c: BoardCell; col: string; main: string; sub?: string; active: boolean; title: string;
}) {
  const x = c.x * S;
  const y = c.y * S;
  return (
    <g>
      <title>{title}</title>
      <polygon points={hexPts(x, y, TOK)} fill={DARK} stroke={col} strokeWidth={active ? 2.4 : 1.5} />
      <text x={x} y={sub ? y - S * 0.08 : y} textAnchor="middle" dominantBaseline="central"
        fill={col} fontWeight={800} fontSize={main.length > 2 ? S * 0.4 : S * 0.58}>
        {main}
      </text>
      {sub && (
        <text x={x} y={y + S * 0.34} textAnchor="middle" fill={col} opacity={0.75} fontSize={S * 0.24}>
          {sub}
        </text>
      )}
    </g>
  );
}

function AspectHex({ c, stat, base, delta, active }: {
  c: BoardCell; stat: StatKey; base: number; delta: number; active: boolean;
}) {
  return (
    <Token c={c} col={ASPECT_FILL[stat]} active={active}
      main={delta > 0 ? `${base}+${delta}` : `${base + delta}`}
      title={`${ASPECT_LABEL[stat]}: ${base}${delta > 0 ? ` +${delta} upgrade` : ""}`} />
  );
}

function OreHex({ c, ores, label }: { c: BoardCell; ores: OreColour[]; label: string }) {
  const x = c.x * S;
  const y = c.y * S;
  const n = Math.min(ores.length, 6);
  return (
    <g>
      <title>{`${label}: ${ores.length ? ores.join(", ") : "none"}`}</title>
      <polygon points={hexPts(x, y, TOK)} fill={DARK} stroke="#3a4a41" strokeWidth={1.4} />
      <text x={x} y={y - S * 0.32} textAnchor="middle" fill="#7c8b83" fontSize={S * 0.2}>{label}</text>
      {n === 0 ? (
        <text x={x} y={y + S * 0.16} textAnchor="middle" fill="#4b574f" fontSize={S * 0.34}>–</text>
      ) : (
        ores.slice(0, 6).map((o, i) => (
          <circle key={i} cx={x + (i - (n - 1) / 2) * S * 0.34} cy={y + S * 0.14}
            r={S * 0.13} fill={ORE_VAR[o]} stroke="#000" strokeOpacity={0.3} />
        ))
      )}
    </g>
  );
}

function IdentityHex({ c, name, seat, colour, active }: {
  c: BoardCell; name: string; seat: Seat; colour: Colour; active: boolean;
}) {
  const x = c.x * S;
  const y = c.y * S;
  return (
    <g>
      <polygon points={hexPts(x, y, S * 0.86)} fill={DARK}
        stroke={SHIP_VAR[colour]} strokeWidth={active ? 3 : 1.6} />
      <circle cx={x} cy={y - S * 0.44} r={S * 0.12} fill={SHIP_VAR[colour]} />
      <text x={x} y={y + S * 0.04} textAnchor="middle" fill="#eef2ef" fontWeight={800} fontSize={S * 0.3}>
        {name}
      </text>
      <text x={x} y={y + S * 0.42} textAnchor="middle" fill="#9fb0a6" fontSize={S * 0.22}
        style={{ letterSpacing: "0.14em" }}>
        {seat === "bot" ? "BOT" : "YOU"}
      </text>
    </g>
  );
}

export function BaseInfo({ board, state, seats, scores }: {
  board: BoardModel; state: GameState; seats: readonly Seat[]; scores: readonly number[];
}) {
  const mode = state.config.modes.prospector;

  return (
    <g className="baseinfo" pointerEvents="none">
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
          const statCells = near.cells.filter((_, i) => i !== nm);
          const farAt = (off: number) => far.cells[fm + off];

          const scoreVal = scores[p.id] ?? 0;

          return (
            <g key={`bi-${p.id}`}>
              <IdentityHex c={near.cells[nm]!} name={baseShip.name} seat={seats[p.id]!} colour={p.colour} active={active} />

              {ASPECT_ORDER.map((stat, i) => {
                const cell = statCells[i];
                if (!cell) return null;
                return (
                  <AspectHex key={stat} c={cell} stat={stat} base={baseShip[stat]}
                    delta={stats[stat] - baseShip[stat]} active={active} />
                );
              })}

              {farAt(-3) && <OreHex c={farAt(-3)!} ores={p.delivered} label="saved" />}
              {farAt(-2) && <OreHex c={farAt(-2)!} ores={p.cargo} label="carried" />}
              {farAt(-1) && (
                <Token c={farAt(-1)!} col={ASPECT_FILL.booster} active={active}
                  main={`${p.hand.length}`} sub={`/${stats.booster}`} title={`cards in hand ${p.hand.length} of ${stats.booster}`} />
              )}
              {farAt(0) && (
                <g>
                  <title>{`score ${scoreVal}`}</title>
                  <polygon points={hexPts(farAt(0)!.x * S, farAt(0)!.y * S, TOK)}
                    fill={GOLD} stroke={active ? "#fff" : "#8a6a1e"} strokeWidth={active ? 2 : 1.2} />
                  <text x={farAt(0)!.x * S} y={farAt(0)!.y * S} textAnchor="middle" dominantBaseline="central"
                    fill="#1a1400" fontWeight={800} fontSize={S * 0.58}>
                    {scoreVal}
                  </text>
                </g>
              )}
              {farAt(1) && (
                <Token c={farAt(1)!} col={ASPECT_FILL.fuelTanks} active={active}
                  main={`${p.fuel}`} sub={`/${p.fuelMax}`} title={`fuel ${p.fuel} of ${p.fuelMax}`} />
              )}
            </g>
          );
        })}

      {/* shared supply / deck counts — small text block in the bottom-centre gap */}
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
  );
}
