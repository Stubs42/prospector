import type { BoosterCard } from "../../engine/index.js";
import { BoosterCardFace } from "./kit.js";

/** a button in a board-native hex box (combat, confirms, ...) — shared shape, not
   BottomPanel's own; kept here since it was BottomPanel's before combat moved to CombatBox */
export interface PanelButton {
  label: string;
  kind?: "primary" | "danger";
  onClick: () => void;
}

export interface BottomPanelProps {
  /** cards to show (empty = none) */
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
}

export function BottomPanel({ cards, cardHint, cardState, urgent }: BottomPanelProps) {
  if (!cards.length) return null;
  return (
    <div className={`bottompanel${urgent ? " urgent" : ""}`}>
      {cardHint && <div className="hint">{cardHint}</div>}

      {cards.length > 0 && (
        <div className="hand">
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
      )}
    </div>
  );
}
