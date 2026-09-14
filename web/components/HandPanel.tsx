/**
 * The player's hand — docked beside the board's own zoom/pan/rotate control stack
 * (bottom-left), matching its height. Collapsed: a thin vertical bar with a chevron to
 * expand. Expanded: the full hand, one row. Pinned open by the player (clicking the
 * chevron) stays open no matter what, until they collapse it again; otherwise it only opens
 * automatically while `forceOpen` is true (a forced action is pending — over the hand
 * limit, an armable card during a burn, a card staged for combat, a freshly drawn card) and
 * closes again the instant that clears — same "show only when there's something to do"
 * behaviour the old always-centred panel had, just collapsible instead of vanishing outright.
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
  /** over the hand limit — redden the toggle and keep every card pulsing until resolved */
  urgent?: boolean;
  /** true while a forced action is pending on this hand — expands the panel even if the
     player hasn't pinned it open, and keeps it open until this clears */
  forceOpen: boolean;
  /** whose hand this is — collapses (and un-pins) whenever it changes, so the next player
     doesn't inherit the last one's pinned-open panel */
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
  const [pinned, setPinned] = useState(false);
  useEffect(() => setPinned(false), [ownerId]);
  if (!cards.length) return null;
  const open = pinned || forceOpen;
  return (
    <div className={`handpanel${open ? " open" : ""}${urgent ? " urgent" : ""}`}>
      <button
        type="button"
        className="handpanel-toggle"
        aria-label={open ? "Collapse hand" : "Expand hand"}
        onClick={() => setPinned((p) => !p)}
      >
        <Chevron />
      </button>
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
    </div>
  );
}
