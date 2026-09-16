/**
 * A guidance popup: usually just a message (non-interactive) — pass `actions` to turn it
 * into a small confirm dialog instead. A fixed screen overlay (see `.actionbox` in
 * styles.css), not board content — it used to be drawn in board space, anchored to a cell
 * near the ship/base it was about, but that put it inside the same pan/zoom transform as
 * the board itself: zooming in or out inflated or shrank it right along with the cells, and
 * panning could carry it out of view entirely. Living outside that transform, like the
 * zoom controls or the status panel, is what actually fixes it.
 */
import type { ReactNode } from "react";
import { ActionBox, HexButton } from "./ActionBox.js";

export interface HexPopupAction {
  label: string;
  kind?: "primary" | "danger";
  onClick: () => void;
}

export function HexPopup({ lines, actions }: { lines: ReactNode[]; actions?: HexPopupAction[] | undefined }) {
  return (
    <ActionBox>
      {lines.map((ln, i) => (
        <div key={i} className="actionbox-line">
          {ln}
        </div>
      ))}
      {!!actions?.length && (
        <div className="actionbox-buttons">
          {actions.map((a, i) => (
            <HexButton key={i} kind={a.kind} onClick={a.onClick}>
              {a.label}
            </HexButton>
          ))}
        </div>
      )}
    </ActionBox>
  );
}
