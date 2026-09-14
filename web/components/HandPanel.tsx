/**
 * The player's hand — docked beside the board's own zoom/pan/rotate control stack
 * (bottom-left), matching its height. One visible frame throughout: collapsed, it's just a
 * thin bar (the toggle chevron, pointing right); expanded, the frame widens to actually
 * contain the revealed cards, and the toggle slides along with it to sit at the frame's
 * *far* edge (now pointing left, "collapse") — never a fixed button with cards floating
 * past it.
 *
 * Two independent reasons the panel can be open: the player asked for it (`userOpen`, free
 * to toggle whenever nothing needs their attention), or the game forced it (`forceOpen` —
 * over the hand limit, an armable card during a burn, a card staged for combat, a freshly
 * drawn card). While forced, the toggle is disabled outright — a forced hand isn't the
 * player's to dismiss. The instant the force clears, the panel reverts to whatever the
 * player's own toggle was already set to (open if they'd deliberately expanded it earlier,
 * collapsed otherwise) — "auto-collapses" is really just that reversion, not a separate rule.
 */
import { useEffect, useState } from "react";
import type { BoosterCard } from "../../engine/index.js";
import { BoosterCardFace } from "./kit.js";

/** a button in a board-native hex box (combat, confirms, ...) — shared shape, not this
   panel's own; kept here since it was here before combat moved out to CombatBox */
export interface PanelButton {
  label: string;
  kind?: "primary" | "danger";
  onClick: () => void;
}

export interface HandPanelProps {
  /** cards to show (empty = none — the whole panel disappears, same as before) */
  cards: BoosterCard[];
  cardHint: string | null;
  cardState: (id: string) => {
    clickable: boolean;
    selected: boolean;
    onClick?: (() => void) | undefined;
    pulse?: "urgent" | "new" | "ready" | null;
  };
  /** over the hand limit — redden the frame and keep every card pulsing until resolved */
  urgent?: boolean;
  /** true while a forced action is pending on this hand — expands the panel regardless of
     the player's own toggle, and disables that toggle until this clears */
  forceOpen: boolean;
  /** whose hand this is — collapses (and resets the player's own toggle) whenever it
     changes, so the next player doesn't inherit the last one's open panel */
  ownerId: number;
}

function Chevron() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 5l7 7-7 7" />
    </svg>
  );
}

export function HandPanel({ cards, cardHint, cardState, urgent, forceOpen, ownerId }: HandPanelProps) {
  const [userOpen, setUserOpen] = useState(false);
  useEffect(() => setUserOpen(false), [ownerId]);
  if (!cards.length) return null;
  const open = forceOpen || userOpen;
  return (
    <div className={`handpanel${open ? " open" : ""}${urgent ? " urgent" : ""}`}>
      <div className="handpanel-body">
        {cardHint && <div className="hint">{cardHint}</div>}
        <div className="handpanel-cards">
          {cards.map((c) => {
            const s = cardState(c.id);
            return (
              <BoosterCardFace
                key={c.id}
                card={c}
                clickable={s.clickable}
                selected={s.selected}
                onClick={s.onClick}
                pulse={s.pulse}
              />
            );
          })}
        </div>
      </div>
      <button
        type="button"
        className="handpanel-toggle"
        aria-label={open ? "Collapse hand" : "Expand hand"}
        disabled={forceOpen}
        tabIndex={-1}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setUserOpen((o) => !o)}
      >
        <Chevron />
      </button>
    </div>
  );
}
