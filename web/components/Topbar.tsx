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
import { OnlineLobby } from "./OnlineLobby.js";
import type { Prefs } from "../prefs.js";
import type { Session } from "../useSession.js";
import type { Colour } from "../../engine/index.js";

export interface TopbarIdentity {
  colour: Colour;
  playerName: string;
  shipName: string;
}

export function Topbar({
  s,
  prefs,
  setPrefs,
  turnLabel,
  identity,
  onOpenLog,
  onOpenRules,
}: {
  s: Session;
  prefs: Prefs;
  setPrefs: (p: Prefs) => void;
  /** "turn N" once a real game is running, "new game" during setup */
  turnLabel: ReactNode;
  /** the viewer's own seat (colour + ship + display name) — a constant reminder of which
     colour this browser is playing, centred in the header. Only well-defined online (the
     seat the server assigned this connection) or for a solo human offline; absent during
     setup and for a shared hot-seat device with no single fixed "you" — GameScreen is the
     only caller that ever passes it. Shown even while the header is collapsed. */
  identity?: TopbarIdentity | null;
  /** absent during setup — there's no move log yet */
  onOpenLog?: (() => void) | undefined;
  /** the popup itself is rendered by the caller (inside its own .stage), not here — this
     button just asks for it, same as onOpenLog, so it centres on the board area rather than
     the whole viewport (Topbar itself sits outside .stage, above it) */
  onOpenRules: () => void;
}) {
  return (
    <div className={`topbar${prefs.topbarCollapsed ? " collapsed" : ""}`}>
      <h1>Prospector</h1>
      <span className="turn">{turnLabel}</span>
      {/* centred between the left (title/turn) and right (buttons/toggle) groups via a
         matched pair of flex:1 spacers, not absolute positioning — the topbar can wrap to
         two lines on a narrow width (the offline humans/bots/upgrade selectors are wide),
         and an absolutely-positioned element centred on the whole (now taller) bar would
         land in the gap between wrapped rows instead of visually reading as part of either
         one; staying in normal flow lets it wrap along with everything else instead */}
      <span className="spacer" />
      {identity && (
        <span className="topbar-identity">
          <i className="topbar-identity-dot" style={{ background: `var(--ship-${identity.colour})` }} />
          {identity.playerName} commanding {identity.shipName}
        </span>
      )}
      <span className="spacer" />
      {!prefs.topbarCollapsed && (
        <>
          {onOpenLog && (
            <button className="ghost" onClick={onOpenLog} title="History">
              🕘 log
            </button>
          )}
          <button className="ghost" onClick={onOpenRules} title="Rules">
            📖 rules
          </button>
          {s.online.status === "offline" && (
            <>
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
            </>
          )}
          <Settings prefs={prefs} onChange={setPrefs} />
          <OnlineLobby s={s} prefs={prefs} setPrefs={setPrefs} />
          {s.online.status === "offline" && <button onClick={() => s.openSetup()}>New game</button>}
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
