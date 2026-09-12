/**
 * Top-left "who's doing what" panel — replaces the old topbar identity pill and the
 * "🤖 X is playing…" board toasts with one persistent, always-in-the-same-place readout.
 * Line 1 is identity (a dot in ship colour + name). Below it, a running log of every action
 * taken so far in the current move — appended to as it goes (draw, drift, burn, load,
 * attack, end turn, ...), not just the latest one, so the whole move reads back like a
 * short log. The oldest lines dim as the log grows so the most recent line still reads as
 * "what's happening right now".
 */
import type { Colour } from "../../engine/index.js";

export function StatusPanel({
  colour,
  name,
  bot,
  log,
}: {
  /** null before a ship is chosen (setup's pickBase stage) — bases carry no colour yet */
  colour: Colour | null;
  name: string;
  bot: boolean;
  /** oldest first; the last entry is "right now" */
  log: string[];
}) {
  return (
    <div className="status-panel">
      <div className="status-id">
        <i className="status-dot" style={colour ? { background: `var(--ship-${colour})` } : undefined} />
        {name}
        {bot ? " 🤖" : ""}
      </div>
      {log.map((line, i) => (
        <div key={i} className={`status-action${i === log.length - 1 ? " current" : ""}`}>
          {line}
        </div>
      ))}
    </div>
  );
}
