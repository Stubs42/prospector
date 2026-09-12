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
  colour: Colour;
  name: string;
  stats: ShipStats;
  /** false when only one ship remains — no point browsing */
  canBrowse: boolean;
  spinning: boolean;
  /** false during a bot's own turn: the card still shows (and spins), but there's nothing
     for the human to click on the bot's behalf, so the whole button row is hidden */
  interactive?: boolean | undefined;
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
  colour,
  name,
  stats,
  canBrowse,
  spinning,
  interactive = true,
  onPrev,
  onNext,
  onSelect,
  onRandom,
}: ShipPickerProps) {
  const pts = hexBackgroundPoints(center, RADIUS);
  const o = axialToPixel(center);

  const nameY = o.y - 78;
  const statTop = o.y - 46;
  const rowH = 20;
  const colX = [o.x - 58, o.x + 6];

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

      <circle cx={o.x} cy={nameY - 5} r={7} fill={`var(--ship-${colour})`} pointerEvents="none" />
      <text
        x={o.x + 12}
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
