/**
 * The entry point into networked play: a "Play Online" dropdown (Host / Join tabs), reusing
 * the same panel look as Settings.tsx (.settings-panel/.settings-row) since this is the same
 * kind of small, click-outside-to-close control living in the topbar. Once online, this
 * collapses down to just the room code + a Leave button — the humans/bots/"New game" controls
 * next to it don't apply to a live networked room (see Topbar.tsx).
 */
import { useEffect, useRef, useState } from "react";
import type { Session } from "../useSession.js";

export function OnlineLobby({ s }: { s: Session }) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"host" | "join">("host");
  const [displayName, setDisplayName] = useState("");
  const [hostHumans, setHostHumans] = useState(1);
  const [hostBots, setHostBots] = useState(1);
  const [upgrade, setUpgrade] = useState<"none" | "random" | "select">("select");
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

  const name = () => displayName.trim() || "Player";

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
              placeholder="Player"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
            />
          </div>
          {tab === "host" ? (
            <>
              <div className="settings-row">
                <span>Humans</span>
                <select value={hostHumans} onChange={(e) => setHostHumans(Number(e.target.value))}>
                  {[1, 2, 3, 4, 5, 6].map((n) => (
                    <option key={n} value={n} disabled={n + hostBots > 6 || n + hostBots < 2}>
                      {n}
                    </option>
                  ))}
                </select>
              </div>
              <div className="settings-row">
                <span>Bots</span>
                <select value={hostBots} onChange={(e) => setHostBots(Number(e.target.value))}>
                  {[0, 1, 2, 3, 4, 5].map((n) => (
                    <option key={n} value={n} disabled={hostHumans + n < 2 || hostHumans + n > 6}>
                      {n}
                    </option>
                  ))}
                </select>
              </div>
              <div className="settings-row">
                <span>Upgrade at start</span>
                <select value={upgrade} onChange={(e) => setUpgrade(e.target.value as typeof upgrade)}>
                  <option value="none">NONE</option>
                  <option value="random">RANDOM</option>
                  <option value="select">SELECT</option>
                </select>
              </div>
              <button onClick={() => s.hostOnline(name(), hostHumans, hostBots, upgrade, "standard")}>
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
