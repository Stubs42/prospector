import { statsOf } from "../../engine/index.js";
import type { GameState, Colour, OreColour } from "../../engine/index.js";
import type { BoardModel } from "../../engine/board.js";
import type { Seat } from "../../client/index.js";
import { S } from "./Board.js";
import { ORE_VAR, SHIP_VAR } from "./kit.js";

export const PANEL_W = 196;
export const PANEL_H = 90;

/** where a player's ship panel is centred — just outside the field, radially from the base. */
export function panelAnchor(board: BoardModel, colour: Colour): { x: number; y: number } {
  const cells = board.baseCells(colour).map((h) => board.cell(h)!);
  const cx = (cells.reduce((a, c) => a + c.x, 0) / cells.length) * S;
  const cy = (cells.reduce((a, c) => a + c.y, 0) / cells.length) * S;
  const mag = Math.hypot(cx, cy) || 1;
  const k = (mag + 128) / mag;
  return { x: cx * k, y: cy * k };
}

/** everything the physical table shows around the field: a ship panel per base, deck counts. */
export function BoardFurniture({
  board,
  state,
  seats,
  scores,
}: {
  board: BoardModel;
  state: GameState;
  seats: readonly Seat[];
  scores: readonly number[];
}) {
  const mode = state.config.modes.prospector;
  const val = (c: OreColour) => mode.resources.values[c];

  return (
    <g className="furniture" pointerEvents="none">
      {state.players.map((p) => {
        const { x: ax, y: ay } = panelAnchor(board, p.colour);
        const w = PANEL_W;
        const h = PANEL_H;
        const x = ax - w / 2;
        const y = ay - h / 2;
        const st = statsOf(state, p);
        const fuelPct = p.fuelMax ? p.fuel / p.fuelMax : 0;
        const dim = p.id !== state.activePlayerIndex;

        return (
          <g key={`panel-${p.id}`} opacity={p.eliminated ? 0.3 : dim ? 0.72 : 1}>
            <rect
              x={x}
              y={y}
              width={w}
              height={h}
              rx={8}
              fill="#111b17"
              stroke={SHIP_VAR[p.colour]}
              strokeWidth={p.id === state.activePlayerIndex ? 2.4 : 1.2}
            />
            {/* name row */}
            <circle cx={x + 12} cy={y + 14} r={5} fill={SHIP_VAR[p.colour]} />
            <text x={x + 22} y={y + 18} fontSize={13} fontWeight={700} fill="#e8ede9">
              {mode.ships[p.colour].name}
            </text>
            <text x={x + 22} y={y + 30} fontSize={9} fill="#94a89d" style={{ letterSpacing: "0.06em" }}>
              {seats[p.id] === "bot" ? "BOT" : "YOU"}
            </text>
            <text x={x + w - 10} y={y + 20} textAnchor="end" fontSize={15} fontWeight={800} fill="var(--gold)">
              {scores[p.id]}
            </text>

            {/* stat line */}
            <text
              x={x + 10}
              y={y + 48}
              fontSize={11}
              fontFamily="ui-monospace, monospace"
              fill="#b7c3bb"
              letterSpacing="0.02em"
            >
              {`S${st.shields}  L${st.lasers}  F${st.fuelTanks}  C${st.cargo}  E${st.engines}  B${st.booster}`}
            </text>

            {/* fuel bar */}
            <rect x={x + 10} y={y + 56} width={w - 20} height={7} rx={3.5} fill="#3a2320" />
            <rect x={x + 10} y={y + 56} width={(w - 20) * fuelPct} height={7} rx={3.5} fill="var(--ore-green)" />

            {/* cargo (bright) + delivered (dim) chips */}
            {p.cargo.map((c, i) => (
              <circle key={`c${i}`} cx={x + 16 + i * 15} cy={y + 78} r={6} fill={ORE_VAR[c]} stroke="#000" strokeOpacity={0.3} />
            ))}
            {p.delivered.map((c, i) => (
              <circle
                key={`d${i}`}
                cx={x + w - 14 - i * 12}
                cy={y + 78}
                r={5}
                fill={ORE_VAR[c]}
                opacity={0.5}
              />
            ))}
            {p.cargo.length === 0 && (
              <text x={x + 12} y={y + 82} fontSize={9} fill="#5c6a62">
                hold empty
              </text>
            )}
          </g>
        );
      })}

      {/* shared supply / deck counts — small text block in the bottom-centre gap */}
      {(() => {
        const y0 = 1.5 * board.innerRadius * S * 0.62;
        const badges = [
          `booster deck ${state.decks.booster.draw.length}`,
          `equipment deck ${state.decks.equipment.draw.length}`,
          `supply  ${state.supply.green} / ${state.supply.yellow} / ${state.supply.red}`,
        ];
        return (
          <g>
            {badges.map((t, i) => (
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
