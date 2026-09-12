/**
 * The pickShip stage's whole UI: one ship card at a time, inside a big hex, with ‹ ›
 * to browse the still-free ships, a Select to confirm, and a Random that spins the same
 * browsing motion (fast, then decelerating) to land on one — same shape as the pickBase
 * stage's "🎲 Random" lucky wheel, just cycling ship cards instead of board regions.
 *
 * During a bot's own turn the card still shows and spins (so the pick is watchable), but
 * `interactive: false` hides the whole button row — there's nothing for the human to do.
 */
import type { Colour, ShipStats, StatKey } from "../../engine/index.js";
import { ASPECT_ORDER, ASPECT_TAG } from "./aspects.js";
import { hexBackgroundPoints, hexButtonPoints } from "./HexPopup.js";
import { axialToPixel } from "./hexpx.js";
import type { Hex } from "../../engine/index.js";

export interface ShipPickerProps {
  center: Hex;
  /** heading shown above the card, e.g. "Select your ship" (+ whose turn, in multi-human) */
  title: string;
  colour: Colour;
  name: string;
  stats: ShipStats;
  /** false when only one ship remains — no point browsing */
  canBrowse: boolean;
  spinning: boolean;
  /** false during a bot's own turn: the card still shows (and spins), but there's nothing
     for the human to click on the bot's behalf, so the whole button row is hidden */
  interactive?: boolean | undefined;
  /** the board's current logical rotation (0..5, each step 60°) — see hexpx.ts's rotatePoint */
  rotation?: number | undefined;
  onPrev: () => void;
  onNext: () => void;
  onSelect: () => void;
  onRandom: () => void;
}

const RADIUS = 5;

function arrowButton(cx: number, cy: number, dir: "prev" | "next", onClick: () => void, disabled: boolean) {
  const r = 16;
  const dx = dir === "prev" ? -1 : 1;
  return (
    <g
      className={`hexpopup-btn ship-arrow${disabled ? " disabled" : ""}`}
      onClick={disabled ? undefined : onClick}
    >
      <polygon points={hexButtonPoints(cx - r, cy - r, r * 2, r * 2)} />
      <text x={cx} y={cy + 5} textAnchor="middle" fontSize={16}>
        {dir === "prev" ? "‹" : "›"}
      </text>
    </g>
  );
}

export function ShipPickerPopup({
  center,
  title,
  colour,
  name,
  stats,
  canBrowse,
  spinning,
  interactive = true,
  rotation = 0,
  onPrev,
  onNext,
  onSelect,
  onRandom,
}: ShipPickerProps) {
  const pts = hexBackgroundPoints(center, RADIUS, rotation);
  const o = axialToPixel(center, rotation);

  const titleY = o.y - 108;
  const cardTop = o.y - 96;
  const cardBottom = o.y - 6;
  const cardLeft = o.x - 95;
  const cardRight = o.x + 95;
  const nameY = cardTop + 22;
  const statTop = nameY + 24;
  const rowH = 18;
  const colX = [cardLeft + 14, o.x + 8];

  const bh = 24;
  const btnY = o.y + 78;
  const selectW = 78;
  const randomW = Math.max(56, "🎲 Random".length * 7 + 26);
  const gap = 12;
  const totalW = canBrowse ? selectW + randomW + gap : selectW;
  const randomX = o.x - totalW / 2;
  const selectX = canBrowse ? randomX + randomW + gap : randomX;

  return (
    <g className="hexpopup shippicker">
      <polygon points={pts} pointerEvents="none" />

      <text x={o.x} y={titleY} textAnchor="middle" fontWeight={700} pointerEvents="none">
        {title}
      </text>

      {/* the card itself gets a frame — a placeholder for real art later, but it should
         already read as "this is the thing being picked", not just floating text */}
      <rect
        x={cardLeft}
        y={cardTop}
        width={cardRight - cardLeft}
        height={cardBottom - cardTop}
        rx={10}
        className="shippicker-card"
        style={{ stroke: `var(--ship-${colour})` }}
        pointerEvents="none"
      />

      <circle cx={cardLeft + 20} cy={nameY - 4} r={7} fill={`var(--ship-${colour})`} pointerEvents="none" />
      <text
        x={cardLeft + 34}
        y={nameY}
        textAnchor="start"
        dominantBaseline="middle"
        fontSize={15}
        fontWeight={700}
        pointerEvents="none"
      >
        {name}
      </text>

      <g pointerEvents="none">
        {ASPECT_ORDER.map((stat: StatKey, i) => {
          const col = i % 2;
          const row = Math.floor(i / 2);
          return (
            <text
              key={stat}
              x={colX[col]}
              y={statTop + row * rowH}
              textAnchor="start"
              fontSize={12}
              className="shippicker-stat"
            >
              {ASPECT_TAG[stat]} {stats[stat]}
            </text>
          );
        })}
      </g>

      {interactive && canBrowse && !spinning && arrowButton(o.x - 130, o.y, "prev", onPrev, false)}
      {interactive && canBrowse && !spinning && arrowButton(o.x + 130, o.y, "next", onNext, false)}

      {interactive && (
        <g>
          {canBrowse && (
            <g className={`hexpopup-btn${spinning ? " disabled" : ""}`} onClick={spinning ? undefined : onRandom}>
              <polygon points={hexButtonPoints(randomX, btnY - bh / 2, randomW, bh)} />
              <text x={randomX + randomW / 2} y={btnY + 4} textAnchor="middle">
                🎲 Random
              </text>
            </g>
          )}
          <g className={`hexpopup-btn primary${spinning ? " disabled" : ""}`} onClick={spinning ? undefined : onSelect}>
            <polygon points={hexButtonPoints(selectX, btnY - bh / 2, selectW, bh)} />
            <text x={selectX + selectW / 2} y={btnY + 4} textAnchor="middle">
              Select
            </text>
          </g>
        </g>
      )}
    </g>
  );
}
