/**
 * The whole fight, as ONE persistent box — from the attacker's target click through defend,
 * the dice reveal, a possible counter-round (roles swapped, same box), to the final outcome.
 * Every connected browser renders the exact same box off the exact same data (GameScreen's
 * `fightBox` derivation); only `buttons` differs — empty for anyone who isn't the current
 * decider, so a spectator (or the side not currently choosing) just watches the table fill in.
 *
 * A staged booster card is pulled out of the hand row entirely and shown here instead —
 * tapping it here un-stages it back to hand, tapping an eligible card in hand stages it here.
 *
 * A fixed screen overlay (see HexPopup's note on why this and its siblings moved out of
 * board space) — no longer anchored to a board cell at all, just always in the same spot.
 */
import { Fragment } from "react";
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

/** one row of the fight table — `value` renders blank (not "0") when that stat isn't known
   yet; `die` (Attack/Defend rows only) draws the animated die glyph alongside the text */
export interface FightTableRow {
  label: string;
  value: string | null;
  die?: { value: number; tone: "attack" | "defence" } | null;
}

export interface FightBoxProps {
  title: string;
  rows: FightTableRow[];
  /** one line, or several (e.g. an outcome title plus its loot detail) */
  message?: string | string[] | null;
  cards: CombatCardChip[];
  buttons: PanelButton[];
}

export function FightBox({ title, rows, message, cards, buttons }: FightBoxProps) {
  const messageLines = message == null ? [] : Array.isArray(message) ? message : [message];
  return (
    <ActionBox className="combatbox-box">
      <div className="actionbox-title">{title}</div>

      <div className="fight-table">
        {rows.map((r, i) => (
          <Fragment key={i}>
            <span className="fight-label">{r.label}</span>
            <span className="fight-value">
              {r.die && <Die value={r.die.value} tone={r.die.tone} />}
              {r.value ?? ""}
            </span>
          </Fragment>
        ))}
      </div>

      {messageLines.length > 0 && (
        <div className="actionbox-sub-block">
          {messageLines.map((line, i) => (
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
