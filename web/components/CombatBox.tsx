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
import type { PanelButton } from "./HandPanel.js";
import { Die } from "./kit.js";

export interface CombatCardChip {
  id: string;
  type: Extract<BoosterType, "laser" | "shield">;
  value: number;
  onClick: () => void;
}

/** one die's reveal: cycles through `value` (a fresh face each animation tick) until
   `settled`, at which point `value` is the real roll and `base`/`total` print alongside it
   as "base+die=total" (lasers+roll=attack total, shields+roll=defence total) */
export interface CombatDieView {
  value: number;
  settled: boolean;
  base: number;
  total: number;
}

export interface CombatRollView {
  attack: CombatDieView | null;
  defence: CombatDieView | null;
  /** true when the defender auto-repelled (shield +99 or hyperspace) — the totals are still
     real, but the win was never actually in question */
  autoRepel?: boolean;
  /** shown once both dice are settled — one or more lines (a title line plus detail, e.g.
     "Attack Succeeded" / "Loot green Orb [2/3]") */
  outcome?: string[] | null;
}

export interface CombatBoxProps {
  title: string;
  /** a single caption line, or several (e.g. the attacker/defender/handicap breakdown) */
  sub?: string | string[] | null;
  cards: CombatCardChip[];
  buttons: PanelButton[];
  roll?: CombatRollView | null;
}

export function CombatBox({ title, sub, cards, buttons, roll = null }: CombatBoxProps) {
  const subLines = sub == null ? [] : Array.isArray(sub) ? sub : [sub];
  return (
    <ActionBox className="combatbox-box">
      <div className="actionbox-title">{title}</div>
      {subLines.length > 0 && (
        <div className="actionbox-sub-block">
          {subLines.map((line, i) => (
            <div key={i} className="actionbox-sub">
              {line}
            </div>
          ))}
        </div>
      )}

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
          <div className="combat-calc attack">
            {roll.attack?.settled ? `${roll.attack.base}+${roll.attack.value}=${roll.attack.total}` : "attack"}
          </div>
          <div className="combat-dice">
            {roll.attack && <Die value={roll.attack.value} tone="attack" />}
            {roll.defence && <Die value={roll.defence.value} tone="defence" />}
          </div>
          <div className="combat-calc defence">
            {roll.defence?.settled
              ? `${roll.defence.base}+${roll.defence.value}=${roll.defence.total}${roll.autoRepel ? " (auto-repel)" : ""}`
              : "defence"}
          </div>
        </div>
      )}
      {roll?.outcome && (
        <div className="actionbox-outcome">
          {roll.outcome.map((line, i) => (
            <div key={i}>{line}</div>
          ))}
        </div>
      )}

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
