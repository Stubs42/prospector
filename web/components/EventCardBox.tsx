/**
 * An event card, drawn from the booster deck (engine/events.ts), shown as one persistent box
 * from the moment it's drawn until the drawer answers it — even when there's nothing to
 * decide beyond "Continue" (see engine/events.ts's accept-gate convention). Every connected
 * browser renders the exact same box off the exact same state.pendingEventChoice; only
 * `buttons` differs — empty for anyone who isn't the drawer, so a spectator (or every other
 * seat) just watches and waits, the same pattern FightBox already established for combat.
 *
 * A fixed screen overlay (see HexPopup's note on why these live outside the board's own
 * pan/zoom transform), not board content.
 */
import { ActionBox, HexButton } from "./ActionBox.js";
import { EventCardIcon } from "./EventCardIcons.js";
import type { PanelButton } from "./HandPanel.js";

export interface EventCardBoxProps {
  eventId: string;
  title: string;
  text: string;
  /** the situational line for this particular pause — may differ from `text` (see
     salvage-cache's "found a site" vs. "already drifted out of range" branches) */
  prompt: string;
  buttons: PanelButton[];
}

export function EventCardBox({ eventId, title, text, prompt, buttons }: EventCardBoxProps) {
  return (
    <ActionBox className="eventcard-box">
      <div className="eventcard-icon">
        <EventCardIcon eventId={eventId} />
      </div>
      <div className="actionbox-title">{title}</div>
      <div className="actionbox-sub-block">
        <div className="actionbox-sub">{text}</div>
        {prompt !== text && <div className="actionbox-sub eventcard-prompt">{prompt}</div>}
      </div>
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
