/**
 * The pickShip stage's whole UI: one ship card at a time, with ‹ › to browse the still-free
 * ships, a Select to confirm, and a Random that spins the same browsing motion (fast, then
 * decelerating) to land on one — same shape as the pickBase stage's "🎲 Random" lucky wheel,
 * just cycling ship cards instead of board regions. A fixed screen overlay (see HexPopup's
 * note on why this moved out of board space).
 *
 * During a bot's own turn the card still shows and spins (so the pick is watchable), but
 * `interactive: false` hides the whole button row — there's nothing for the human to do.
 */
import type { Colour, ShipStats } from "../../engine/index.js";
import { ActionBox, HexButton } from "./ActionBox.js";
import { ShipCardArt } from "./CardArt.js";

/** a plain shape in a fixed viewBox, not a "‹"/"›" text glyph — a font's own baseline/
   descender metrics never quite centre a character in its box (see Board.tsx's zoom
   controls, which hit exactly this and were switched to SVG icons for the same reason) */
function Chevron({ dir }: { dir: "prev" | "next" }) {
  const d = dir === "prev" ? "M15 5l-7 7 7 7" : "M9 5l7 7-7 7";
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
      <path d={d} />
    </svg>
  );
}

export interface ShipPickerProps {
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
  onPrev: () => void;
  onNext: () => void;
  onSelect: () => void;
  onRandom: () => void;
}

export function ShipPickerPopup({
  title,
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
  return (
    <ActionBox className="shippicker-box">
      <div className="actionbox-title">{title}</div>
      <div className="shippicker-row">
        {interactive && canBrowse && !spinning && (
          <HexButton className="ship-arrow" onClick={onPrev} aria-label="previous ship">
            <Chevron dir="prev" />
          </HexButton>
        )}
        <ShipCardArt colour={colour} name={name} stats={stats} />
        {interactive && canBrowse && !spinning && (
          <HexButton className="ship-arrow" onClick={onNext} aria-label="next ship">
            <Chevron dir="next" />
          </HexButton>
        )}
      </div>
      {interactive && (
        <div className="actionbox-buttons">
          {canBrowse && (
            <HexButton disabled={spinning} onClick={onRandom}>
              🎲 Random
            </HexButton>
          )}
          <HexButton kind="primary" disabled={spinning} onClick={onSelect}>
            Select
          </HexButton>
        </div>
      )}
    </ActionBox>
  );
}
