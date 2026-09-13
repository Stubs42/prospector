/**
 * The 3-card equipment offer, as a hex popup — same primitives as CombatBox/HexPopup, and
 * the one component behind BOTH cases pendingEquipment ever represents: a homecoming
 * delivery reward, and the one-time "upgrade at game start" draw (see engine's
 * PendingEquipment). The two only ever differ in `title`/`spinningId`, never in shape.
 *
 * "select" mode (and homecoming, which is always a choice): every card is a live HexButton,
 * clicking one dispatches chooseEquipment. "random" mode: the caller drives a lucky-wheel
 * cycle through the 3 cards via `spinningId` (the currently-lit candidate) and no `onChoose`
 * at all — same "already-decided, just cosmetic suspense" pattern as every other spin in the
 * app (see spin.ts's SkipGate), landing on the card it's about to dispatch itself.
 */
import type { StatKey } from "../../engine/index.js";
import { ActionBox, HexButton } from "./ActionBox.js";
import { ASPECT_FILL, ASPECT_TAG } from "./aspects.js";
import { theme } from "../theme.js";

export interface EquipmentOption {
  id: string;
  stat: StatKey;
  amount: number;
}

export interface EquipmentPopupProps {
  title: string;
  options: EquipmentOption[];
  /** the candidate currently lit up mid-spin (random mode) — gold accent, not clickable */
  spinningId?: string | null;
  /** absent while spinning: the popup is a pure reveal, nothing to click yet */
  onChoose?: ((id: string) => void) | undefined;
}

export function EquipmentPopup({ title, options, spinningId = null, onChoose }: EquipmentPopupProps) {
  return (
    <ActionBox className="equipbox-box">
      <div className="actionbox-title">{title}</div>
      <div className="equip-choice">
        {options.map((o) => {
          const spinningHere = spinningId === o.id;
          const fill = ASPECT_FILL[o.stat];
          return (
            <HexButton
              key={o.id}
              className="equip-card"
              accent={spinningHere ? "var(--gold)" : fill}
              onClick={onChoose ? () => onChoose(o.id) : undefined}
              disabled={!onChoose}
            >
              <span
                className="et"
                style={{
                  color: spinningHere ? "var(--gold)" : fill,
                  fontSize: `${theme.cards.labelFontSize}rem`,
                  transform: `translateY(${theme.cards.labelOffsetY}em)`,
                }}
              >
                {ASPECT_TAG[o.stat]}
              </span>
              <span
                className="ev"
                style={{
                  color: spinningHere ? "var(--gold)" : fill,
                  fontSize: `${theme.cards.valueFontSize}rem`,
                  transform: `translateY(${theme.cards.valueOffsetY}em)`,
                }}
              >
                +{o.amount}
              </span>
            </HexButton>
          );
        })}
      </div>
    </ActionBox>
  );
}
