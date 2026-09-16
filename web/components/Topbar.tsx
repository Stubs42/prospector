/**
 * The app's top bar — shared by SetupScreen and GameScreen (used to be copy-pasted between
 * the two, which is exactly how the collapse toggle below ended up on only one of them: it
 * was added to GameScreen's copy and nobody thought to update SetupScreen's independent
 * copy too. One component now, so the two can never drift apart like that again.
 *
 * Wraps (instead of just clipping) on a narrow phone width, and can be collapsed down to
 * just the title/turn label/toggle to reclaim vertical board space — persisted via
 * prefs.topbarCollapsed so it doesn't need re-toggling every reload.
 */
import type { ReactNode } from "react";
import { Settings } from "./Settings.js";
import type { Prefs } from "../prefs.js";
import type { Session } from "../useSession.js";

export function Topbar({
  s,
  prefs,
  setPrefs,
  turnLabel,
  onOpenLog,
}: {
  s: Session;
  prefs: Prefs;
  setPrefs: (p: Prefs) => void;
  /** "turn N" once a real game is running, "new game" during setup */
  turnLabel: ReactNode;
  /** absent during setup — there's no move log yet */
  onOpenLog?: (() => void) | undefined;
}) {
  return (
    <div className={`topbar${prefs.topbarCollapsed ? " collapsed" : ""}`}>
      <h1>Prospector</h1>
      <span className="turn">{turnLabel}</span>
      <span className="spacer" />
      {!prefs.topbarCollapsed && (
        <>
          {onOpenLog && (
            <button className="ghost" onClick={onOpenLog} title="History">
              🕘 log
            </button>
          )}
          <label className="turn">
            humans{" "}
            <select
              value={s.humans}
              onChange={(e) => {
                const h = Number(e.target.value);
                s.openSetup(h, Math.min(s.bots, 6 - h));
              }}
            >
              {[1, 2, 3, 4, 5, 6].map((n) => (
                <option key={n} value={n} disabled={n + s.bots > 6 || n + s.bots < 2}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <label className="turn">
            bots{" "}
            <select value={s.bots} onChange={(e) => s.openSetup(s.humans, Number(e.target.value))}>
              {[0, 1, 2, 3, 4, 5].map((n) => (
                <option key={n} value={n} disabled={s.humans + n < 2 || s.humans + n > 6}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <label className="turn">
            upgrade at start{" "}
            <select
              value={s.upgradeAtStart}
              onChange={(e) => s.openSetup(s.humans, s.bots, e.target.value as "none" | "random" | "select")}
            >
              <option value="none">NONE</option>
              <option value="random">RANDOM</option>
              <option value="select">SELECT</option>
            </select>
          </label>
          <Settings prefs={prefs} onChange={setPrefs} />
          <button onClick={() => s.openSetup()}>New game</button>
        </>
      )}
      <button
        type="button"
        className="ghost topbar-toggle"
        aria-label={prefs.topbarCollapsed ? "Show controls" : "Hide controls"}
        title={prefs.topbarCollapsed ? "Show controls" : "Hide controls"}
        onClick={() => setPrefs({ ...prefs, topbarCollapsed: !prefs.topbarCollapsed })}
      >
        {prefs.topbarCollapsed ? "▾" : "▴"}
      </button>
    </div>
  );
}
