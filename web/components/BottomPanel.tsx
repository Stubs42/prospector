import type { BoosterCard } from "../../engine/index.js";
import { BoosterCardFace } from "./kit.js";

export interface PanelButton {
  label: string;
  kind?: "primary" | "danger";
  onClick: () => void;
}

export interface BottomPanelProps {
  /** cards to show (empty = none) */
  cards: BoosterCard[];
  cardHint: string | null;
  cardState: (id: string) => { clickable: boolean; selected: boolean; onClick?: (() => void) | undefined };
  combatTitle: string | null;
  combatSub: string | null;
  buttons: PanelButton[];
}

export function BottomPanel({
  cards,
  cardHint,
  cardState,
  combatTitle,
  combatSub,
  buttons,
}: BottomPanelProps) {
  if (!cards.length && !combatTitle && !buttons.length) return null;
  return (
    <div className="bottompanel">
      {combatTitle && <div className="bp-title">{combatTitle}</div>}
      {combatSub && <div className="hint">{combatSub}</div>}
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
              />
            );
          })}
        </div>
      )}
      {buttons.length > 0 && (
        <div className="actions">
          {buttons.map((b, i) => (
            <button key={i} className={b.kind ?? ""} onClick={b.onClick}>
              {b.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
