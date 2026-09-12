/**
 * Combat's whole board-native UI: one hex box that follows whoever is deciding right now
 * (the attacker while staging lasers and declaring, the defender while staging shields or
 * fleeing, the loser while deciding a counter-attack). A staged booster card is pulled out
 * of the hand row entirely and shown here instead — tapping it here un-stages it back to
 * hand, tapping an eligible card in hand stages it here. Once both sides are committed, the
 * same box hosts the animated dice reveal before the outcome is folded back into the log.
 */
import type { BoosterType } from "../../engine/index.js";
import type { Hex } from "../../engine/index.js";
import { ASPECT_FILL, ASPECT_TAG } from "./aspects.js";
import type { PanelButton } from "./BottomPanel.js";
import { hexBackgroundPoints, hexButtonPoints } from "./HexPopup.js";
import { axialToPixel } from "./hexpx.js";

export interface CombatCardChip {
  id: string;
  type: Extract<BoosterType, "laser" | "shield">;
  value: number;
  onClick: () => void;
}

/** one die's reveal: cycles through `value` (a fresh face each animation tick) until
   `settled`, at which point `value` is the real roll and `total` prints alongside it */
export interface CombatDieView {
  value: number;
  settled: boolean;
  total: number;
}

export interface CombatRollView {
  attack: CombatDieView | null;
  defence: CombatDieView | null;
  /** shown once both dice are settled — the win/loss line (and any spoil taken) */
  outcome?: string | null;
}

export interface CombatBoxProps {
  center: Hex;
  title: string;
  sub?: string | null;
  cards: CombatCardChip[];
  buttons: PanelButton[];
  roll?: CombatRollView | null;
  rotation?: number;
}

const RADIUS = 6;
const CHIP_W = 34;
const CHIP_H = 46;
const CHIP_GAP = 8;

function DieFace({ x, y, value, tone }: { x: number; y: number; value: number; tone: "attack" | "defence" }) {
  const size = 30;
  const bg = tone === "attack" ? "var(--ship-red)" : "var(--ship-blue)";
  const pipsByValue: Record<number, [number, number][]> = {
    1: [[1, 1]],
    2: [[0, 0], [2, 2]],
    3: [[0, 0], [1, 1], [2, 2]],
    4: [[0, 0], [2, 0], [0, 2], [2, 2]],
    5: [[0, 0], [2, 0], [1, 1], [0, 2], [2, 2]],
    6: [[0, 0], [2, 0], [0, 1], [2, 1], [0, 2], [2, 2]],
  };
  const cell = size / 3;
  return (
    <g pointerEvents="none">
      <rect x={x - size / 2} y={y - size / 2} width={size} height={size} rx={5} fill={bg} stroke="rgba(0,0,0,0.4)" />
      {(pipsByValue[value] ?? []).map(([c, r], i) => (
        <circle
          key={i}
          cx={x - size / 2 + cell * c + cell / 2}
          cy={y - size / 2 + cell * r + cell / 2}
          r={2.4}
          fill="#fff"
        />
      ))}
    </g>
  );
}

export function CombatBox({ center, title, sub, cards, buttons, roll = null, rotation = 0 }: CombatBoxProps) {
  const pts = hexBackgroundPoints(center, RADIUS, rotation);
  const o = axialToPixel(center, rotation);

  const titleY = o.y - 118;
  const subY = titleY + 18;
  const cardsY = subY + (sub ? 34 : 20);
  const rollY = cardsY + (cards.length ? 50 : 10);
  const btnY = (roll ? rollY + 46 : cardsY + (cards.length ? 40 : 10)) + 24;

  const totalCardsW = cards.length ? cards.length * CHIP_W + (cards.length - 1) * CHIP_GAP : 0;

  const bh = 24;
  const gap = 10;
  const widths = buttons.map((b) => Math.max(56, b.label.length * 7 + 26));
  const totalBtnW = widths.reduce((a, b) => a + b, 0) + gap * Math.max(0, widths.length - 1);

  return (
    <g className="hexpopup combatbox-hex">
      <polygon points={pts} pointerEvents="none" />

      <text x={o.x} y={titleY} textAnchor="middle" fontWeight={700} pointerEvents="none">
        {title}
      </text>
      {sub && (
        <text x={o.x} y={subY} textAnchor="middle" fontSize={11} className="combatbox-sub" pointerEvents="none">
          {sub}
        </text>
      )}

      {cards.length > 0 && (
        <g>
          {cards.map((c, i) => {
            const cx = o.x - totalCardsW / 2 + i * (CHIP_W + CHIP_GAP);
            const fill = ASPECT_FILL[c.type === "laser" ? "lasers" : "shields"];
            return (
              <g key={c.id} className="combat-chip" onClick={c.onClick}>
                <rect
                  x={cx}
                  y={cardsY - CHIP_H / 2}
                  width={CHIP_W}
                  height={CHIP_H}
                  rx={5}
                  style={{ stroke: fill }}
                />
                <text x={cx + CHIP_W / 2} y={cardsY - 10} textAnchor="middle" fontSize={9} style={{ fill }}>
                  {ASPECT_TAG[c.type === "laser" ? "lasers" : "shields"]}
                </text>
                <text x={cx + CHIP_W / 2} y={cardsY + 14} textAnchor="middle" fontSize={15} fontWeight={700}>
                  +{c.value}
                </text>
              </g>
            );
          })}
        </g>
      )}

      {roll && (roll.attack || roll.defence) && (
        <g>
          {roll.attack && (
            <>
              <DieFace x={o.x - 46} y={rollY} value={roll.attack.value} tone="attack" />
              <text x={o.x - 46} y={rollY + 28} textAnchor="middle" fontSize={11} pointerEvents="none">
                {roll.attack.settled ? `= ${roll.attack.total}` : "attack"}
              </text>
            </>
          )}
          {roll.defence && (
            <>
              <DieFace x={o.x + 46} y={rollY} value={roll.defence.value} tone="defence" />
              <text x={o.x + 46} y={rollY + 28} textAnchor="middle" fontSize={11} pointerEvents="none">
                {roll.defence.settled ? `= ${roll.defence.total}` : "defence"}
              </text>
            </>
          )}
          {roll.outcome && (
            <text x={o.x} y={rollY + 46} textAnchor="middle" fontSize={13} fontWeight={700} pointerEvents="none">
              {roll.outcome}
            </text>
          )}
        </g>
      )}

      {buttons.length > 0 && (
        <g>
          {buttons.map((b, i) => {
            const bw = widths[i]!;
            const bx = o.x - totalBtnW / 2 + widths.slice(0, i).reduce((x, w) => x + w + gap, 0);
            return (
              <g key={i} className={`hexpopup-btn ${b.kind ?? ""}`} onClick={b.onClick}>
                <polygon points={hexButtonPoints(bx, btnY - bh / 2, bw, bh)} />
                <text x={bx + bw / 2} y={btnY + 4} textAnchor="middle">
                  {b.label}
                </text>
              </g>
            );
          })}
        </g>
      )}
    </g>
  );
}
