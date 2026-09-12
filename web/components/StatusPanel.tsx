/**
 * Top-left "who's doing what" panel — replaces the old topbar identity pill and the
 * "🤖 X is playing…" board toasts with one persistent, always-in-the-same-place readout.
 * Line 1 is identity (a dot in ship colour + a short random name, unrelated to ship type,
 * so it reads naturally in a log: "Kemu is drifting" beats "black is drifting"). Line 2 is
 * whatever that player/bot is doing right now — it updates step by step through a move
 * (draw, drift, burn, load, attack, end turn, ...) like a live one-line log of their turn.
 * During combat this can be the *defender's* decision, not just the active player's — see
 * how callers pick which player's identity/action to pass in.
 */
import type { Colour } from "../../engine/index.js";

export function StatusPanel({
  colour,
  name,
  bot,
  action,
}: {
  /** null before a ship is chosen (setup's pickBase stage) — bases carry no colour yet */
  colour: Colour | null;
  name: string;
  bot: boolean;
  action: string;
}) {
  return (
    <div className="status-panel">
      <div className="status-id">
        <i className="status-dot" style={colour ? { background: `var(--ship-${colour})` } : undefined} />
        {name}
        {bot ? " 🤖" : ""}
      </div>
      <div className="status-action">{action}</div>
    </div>
  );
}
