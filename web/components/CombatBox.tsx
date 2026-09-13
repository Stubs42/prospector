/**
 * Combat's whole UI: one box that follows whoever is deciding right now (the attacker while
 * staging lasers and declaring, the defender while staging shields or fleeing, the loser
 * while deciding a counter-attack). A staged booster card is pulled out of the hand row
 * entirely and shown here instead — tapping it here un-stages it back to hand, tapping an
 * eligible card in hand stages it here. Once both sides are committed, the same box hosts
 * the animated dice reveal before the outcome is folded back into the log.
 *
 * A fixed screen overlay (see HexPopup's note on why this and its siblings moved out of
 * board space) — no longer anchored to a board cell at all, just always in the same spot.
 */
import type { BoosterType } from "../../engine/index.js";
import { ActionBox, HexButton } from "./ActionBox.js";
import { ASPECT_FILL, ASPECT_TAG } from "./aspects.js";
import type { PanelButton } from "./BottomPanel.js";
import { Die } from "./kit.js";

export interface CombatCardChip {
  id: string;
  type: Extract<BoosterType, "laser" | "shield">;
  value: number;
  onClick: () => void;
}

/** one die's reveal: cycles through `value` (a fresh face each animation tick) until
   `settled`, at which point `value` is the real roll and `total` prints alongside it */
export interface CombatDieView {
  value: number;
  settled: boolean;
  total: number;
}

export interface CombatRollView {
  attack: CombatDieView | null;
  defence: CombatDieView | null;
  /** shown once both dice are settled — the win/loss line (and any spoil taken) */
  outcome?: string | null;
}

export interface CombatBoxProps {
  title: string;
  sub?: string | null;
  cards: CombatCardChip[];
  buttons: PanelButton[];
  roll?: CombatRollView | null;
}

export function CombatBox({ title, sub, cards, buttons, roll = null }: CombatBoxProps) {
  return (
    <ActionBox className="combatbox-box">
      <div className="actionbox-title">{title}</div>
      {sub && <div className="actionbox-sub">{sub}</div>}

      {cards.length > 0 && (
        <div className="combat-chips">
          {cards.map((c) => {
            const fill = ASPECT_FILL[c.type === "laser" ? "lasers" : "shields"];
            return (
              <HexButton key={c.id} className="combat-chip" accent={fill} onClick={c.onClick}>
                <span className="cc-tag" style={{ color: fill }}>
                  {ASPECT_TAG[c.type === "laser" ? "lasers" : "shields"]}
                </span>
                <span className="cc-val">+{c.value}</span>
              </HexButton>
            );
          })}
        </div>
      )}

      {roll && (roll.attack || roll.defence) && (
        <div className="combat-roll">
          {roll.attack && (
            <div className="combat-die">
              <Die value={roll.attack.value} tone="attack" />
              <span>{roll.attack.settled ? `= ${roll.attack.total}` : "attack"}</span>
            </div>
          )}
          {roll.defence && (
            <div className="combat-die">
              <Die value={roll.defence.value} tone="defence" />
              <span>{roll.defence.settled ? `= ${roll.defence.total}` : "defence"}</span>
            </div>
          )}
        </div>
      )}
      {roll?.outcome && <div className="actionbox-outcome">{roll.outcome}</div>}

      {buttons.length > 0 && (
        <div className="actionbox-buttons">
          {buttons.map((b, i) => (
            <HexButton key={i} kind={b.kind} onClick={b.onClick}>
              {b.label}
            </HexButton>
          ))}
        </div>
      )}
    </ActionBox>
  );
}
