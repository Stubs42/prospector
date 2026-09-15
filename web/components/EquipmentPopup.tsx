/**
 * The 3-card equipment offer, as a hex popup — same primitives as CombatBox/HexPopup, and
 * the one component behind BOTH cases pendingEquipment ever represents: a homecoming
 * delivery reward, and the one-time "upgrade at game start" draw (see engine's
 * PendingEquipment). The two only ever differ in `title`/`spinningId`, never in shape.
 *
 * Each candidate is real card art (UpgradeCardArt, see CardArt.tsx) — square, matching how
 * upgrade cards actually look, not a hex button. "select" mode (and homecoming, which is
 * always a choice): every card is clickable, clicking one dispatches chooseEquipment.
 * "random" mode: the caller drives a lucky-wheel cycle through the 3 cards via `spinningId`
 * (the currently-lit candidate) and no `onChoose` at all — same "already-decided, just
 * cosmetic suspense" pattern as every other spin in the app (see spin.ts's SkipGate),
 * landing on the card it's about to dispatch itself.
 */
import type { StatKey } from "../../engine/index.js";
import { ActionBox, HexButton } from "./ActionBox.js";
import { UpgradeCardArt } from "./CardArt.js";

export interface EquipmentOption {
  id: string;
  stat: StatKey;
  amount: number;
}

export interface EquipmentPopupProps {
  title: string;
  options: EquipmentOption[];
  /** the candidate currently lit up mid-spin (random mode) — gold ring, not clickable */
  spinningId?: string | null;
  /** absent while spinning: the popup is a pure reveal, nothing to click yet */
  onChoose?: ((id: string) => void) | undefined;
  /** true when all 3 cards offered are identical — a real choice among duplicates isn't a
     choice, so a one-time reroll is offered instead of (or alongside) picking one anyway */
  canReroll?: boolean | undefined;
  onReroll?: (() => void) | undefined;
}

export function EquipmentPopup({ title, options, spinningId = null, onChoose, canReroll, onReroll }: EquipmentPopupProps) {
  return (
    <ActionBox className="equipbox-box">
      <div className="actionbox-title">{title}</div>
      <div className="equip-choice">
        {options.map((o) => {
          const spinningHere = spinningId === o.id;
          return (
            <div
              key={o.id}
              className={`equip-card-wrap${spinningHere ? " spinning" : ""}`}
              style={{ cursor: onChoose ? "pointer" : "default" }}
              onClick={onChoose ? () => onChoose(o.id) : undefined}
            >
              <UpgradeCardArt stat={o.stat} amount={o.amount} />
            </div>
          );
        })}
      </div>
      {canReroll && onReroll && (
        <div className="actionbox-buttons">
          <HexButton onClick={onReroll}>🎲 Reroll</HexButton>
        </div>
      )}
    </ActionBox>
  );
}
