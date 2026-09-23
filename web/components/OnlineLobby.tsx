/**
 * The entry point into networked play: a "Play Online" dropdown (Host / Join tabs), reusing
 * the same panel look as Settings.tsx (.settings-panel/.settings-row) since this is the same
 * kind of small, click-outside-to-close control living in the topbar. Once online, this
 * collapses down to just the room code + a Leave button — the humans/bots/"New game" controls
 * next to it don't apply to a live networked room (see Topbar.tsx).
 *
 * The display name and the "host a game" setup (humans/bots/upgrade) are controlled straight
 * off `prefs` (persisted to localStorage on every change, same as Settings.tsx) instead of
 * local state, so the last-used values are still there next time this opens. Room code is
 * deliberately NOT remembered — it's a one-off token for whichever room you're joining right
 * now, not a setting.
 */
import { useEffect, useRef, useState } from "react";
import type { Session } from "../useSession.js";
import type { Prefs } from "../prefs.js";

export function OnlineLobby({ s, prefs, setPrefs }: { s: Session; prefs: Prefs; setPrefs: (p: Prefs) => void }) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"host" | "join">("host");
  const [roomCode, setRoomCode] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [open]);

  const set = <K extends keyof Prefs>(k: K, v: Prefs[K]) => setPrefs({ ...prefs, [k]: v });

  if (s.online.status === "online") {
    return (
      <div className="online-lobby">
        <span className="online-room-code" title="Share this code with other players">
          Room {s.online.roomCode}
        </span>
        <button className="ghost" onClick={s.leaveOnline}>
          Leave
        </button>
      </div>
    );
  }

  // no online-specific name set yet — fall back to the general "Your name" setting, then a
  // plain default; the placeholder below shows the same chain so it's clear what'll be used
  const settingsName = prefs.playerName.trim();
  const name = () => prefs.onlineDisplayName.trim() || settingsName || "Player";

  return (
    <div className="online-lobby" ref={ref}>
      <button onClick={() => setOpen((o) => !o)} disabled={s.online.status === "connecting"}>
        {s.online.status === "connecting" ? "Connecting…" : "Play Online"}
      </button>
      {open && (
        <div className="settings-panel online-lobby-panel" role="menu">
          <div className="online-lobby-tabs">
            <button className={tab === "host" ? "active" : undefined} onClick={() => setTab("host")}>
              Host
            </button>
            <button className={tab === "join" ? "active" : undefined} onClick={() => setTab("join")}>
              Join
            </button>
          </div>
          <div className="settings-row">
            <span>Your name</span>
            <input
              type="text"
              maxLength={16}
              placeholder={settingsName || "Player"}
              value={prefs.onlineDisplayName}
              onChange={(e) => set("onlineDisplayName", e.target.value)}
            />
          </div>
          {tab === "host" ? (
            <>
              <div className="settings-row">
                <span>Humans</span>
                <select
                  value={prefs.onlineHostHumans}
                  onChange={(e) => set("onlineHostHumans", Number(e.target.value))}
                >
                  {[1, 2, 3, 4, 5, 6].map((n) => (
                    <option key={n} value={n} disabled={n + prefs.onlineHostBots > 6 || n + prefs.onlineHostBots < 2}>
                      {n}
                    </option>
                  ))}
                </select>
              </div>
              <div className="settings-row">
                <span>Bots</span>
                <select value={prefs.onlineHostBots} onChange={(e) => set("onlineHostBots", Number(e.target.value))}>
                  {[0, 1, 2, 3, 4, 5].map((n) => (
                    <option key={n} value={n} disabled={prefs.onlineHostHumans + n < 2 || prefs.onlineHostHumans + n > 6}>
                      {n}
                    </option>
                  ))}
                </select>
              </div>
              <div className="settings-row">
                <span>Upgrade at start</span>
                <select
                  value={prefs.onlineHostUpgrade}
                  onChange={(e) => set("onlineHostUpgrade", e.target.value as Prefs["onlineHostUpgrade"])}
                >
                  <option value="none">NONE</option>
                  <option value="random">RANDOM</option>
                  <option value="select">SELECT</option>
                </select>
              </div>
              <button
                onClick={() =>
                  s.hostOnline(name(), prefs.onlineHostHumans, prefs.onlineHostBots, prefs.onlineHostUpgrade, "standard")
                }
              >
                Host game
              </button>
            </>
          ) : (
            <>
              <div className="settings-row">
                <span>Room code</span>
                <input
                  type="text"
                  maxLength={5}
                  placeholder="ABCDE"
                  value={roomCode}
                  onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
                />
              </div>
              <button disabled={!roomCode.trim()} onClick={() => s.joinOnline(name(), roomCode.trim())}>
                Join game
              </button>
            </>
          )}
          {s.online.error && <div className="online-lobby-error">{s.online.error}</div>}
        </div>
      )}
    </div>
  );
}
