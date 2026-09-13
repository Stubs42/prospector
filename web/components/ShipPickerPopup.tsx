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
import type { Colour, ShipStats, StatKey } from "../../engine/index.js";
import { ActionBox } from "./ActionBox.js";
import { ASPECT_ORDER, ASPECT_TAG } from "./aspects.js";

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
          <button className="ship-arrow" onClick={onPrev} aria-label="previous ship">
            ‹
          </button>
        )}
        {/* the card itself — a placeholder for real art later, but it should already read
           as "this is the thing being picked", not just floating text */}
        <div className="shippicker-card" style={{ borderColor: `var(--ship-${colour})` }}>
          <div className="shippicker-name">
            <i className="status-dot" style={{ background: `var(--ship-${colour})`, borderColor: `var(--ship-${colour})` }} />
            {name}
          </div>
          <div className="shippicker-stats">
            {ASPECT_ORDER.map((stat: StatKey) => (
              <span key={stat} className="shippicker-stat">
                {ASPECT_TAG[stat]} {stats[stat]}
              </span>
            ))}
          </div>
        </div>
        {interactive && canBrowse && !spinning && (
          <button className="ship-arrow" onClick={onNext} aria-label="next ship">
            ›
          </button>
        )}
      </div>
      {interactive && (
        <div className="actionbox-buttons">
          {canBrowse && (
            <button disabled={spinning} onClick={onRandom}>
              🎲 Random
            </button>
          )}
          <button className="primary" disabled={spinning} onClick={onSelect}>
            Select
          </button>
        </div>
      )}
    </ActionBox>
  );
}
