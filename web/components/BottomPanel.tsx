import type { BoosterCard, StatKey } from "../../engine/index.js";
import { BoosterCardFace } from "./kit.js";
import { ASPECT_FILL, ASPECT_TAG, ASPECT_LABEL } from "./aspects.js";

/** a button in a board-native hex box (combat, confirms, ...) — shared shape, not
   BottomPanel's own; kept here since it was BottomPanel's before combat moved to CombatBox */
export interface PanelButton {
  label: string;
  kind?: "primary" | "danger";
  onClick: () => void;
}

export interface EquipChoice {
  id: string;
  stat: StatKey;
  amount: number;
  effect: string;
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
  /** homecoming upgrade offer — pick one */
  equipment: EquipChoice[];
  onEquip: (id: string) => void;
  /** over the hand limit — redden the frame and keep every card pulsing until resolved */
  urgent?: boolean;
}

export function BottomPanel({ cards, cardHint, cardState, equipment, onEquip, urgent }: BottomPanelProps) {
  if (!cards.length && !equipment.length) return null;
  return (
    <div className={`bottompanel${urgent ? " urgent" : ""}`}>
      {equipment.length > 0 && <div className="bp-title">Delivered — choose an upgrade</div>}
      {cardHint && <div className="hint">{cardHint}</div>}

      {equipment.length > 0 && (
        <div className="equip-choice">
          {equipment.map((e) => (
            <button
              key={e.id}
              type="button"
              className="equip-card"
              style={{ borderColor: ASPECT_FILL[e.stat] }}
              onClick={() => onEquip(e.id)}
            >
              <span className="et" style={{ color: ASPECT_FILL[e.stat] }}>{ASPECT_TAG[e.stat]}</span>
              <span className="ev" style={{ color: ASPECT_FILL[e.stat] }}>+{e.amount}</span>
              <span className="ee">{e.effect || `${ASPECT_LABEL[e.stat]} upgrade`}</span>
            </button>
          ))}
        </div>
      )}

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
