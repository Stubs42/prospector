import { formatLogEntry } from "../../client/index.js";
import type { GameState } from "../../engine/index.js";

export function LogOverlay({ state, onClose }: { state: GameState; onClose: () => void }) {
  return (
    <div className="overlay-scrim" onClick={onClose}>
      <div className="log-overlay" onClick={(e) => e.stopPropagation()}>
        <div className="log-overlay-head">
          <span>History</span>
          <button onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div className="log-overlay-body">
          {state.log.length === 0 && <p className="hint">Nothing has happened yet.</p>}
          {[...state.log].reverse().map((e, i) => (
            <div key={i}>
              <b>t{e.turn}</b> {formatLogEntry(state, e)}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
