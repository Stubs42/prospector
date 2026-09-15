import { useEffect, useRef, useState } from "react";
import type { Prefs } from "../prefs.js";

export function Settings({ prefs, onChange }: { prefs: Prefs; onChange: (p: Prefs) => void }) {
  const [open, setOpen] = useState(
    () => typeof location !== "undefined" && new URLSearchParams(location.search).get("prefs") === "1",
  );
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [open]);

  const set = <K extends keyof Prefs>(k: K, v: Prefs[K]) => onChange({ ...prefs, [k]: v });

  return (
    <div className="settings" ref={ref}>
      <button aria-label="Preferences" title="Preferences" onClick={() => setOpen((o) => !o)}>
        ⚙
      </button>
      {open && (
        <div className="settings-panel" role="menu">
          <div className="settings-row">
            <span>Your name</span>
            <input
              type="text"
              maxLength={16}
              placeholder="Player"
              value={prefs.playerName}
              onChange={(e) => set("playerName", e.target.value)}
            />
          </div>
          <label>
            <input
              type="checkbox"
              checked={prefs.autoSingle}
              onChange={(e) => set("autoSingle", e.target.checked)}
            />
            <span>
              Auto-advance forced moves
              <em>When only one action is possible, take it without a click.</em>
            </span>
          </label>
          <label className={prefs.autoSingle ? "" : "disabled"}>
            <input
              type="checkbox"
              disabled={!prefs.autoSingle}
              checked={prefs.autoEndTurn}
              onChange={(e) => set("autoEndTurn", e.target.checked)}
            />
            <span>
              Also auto-end the turn
              <em>Skip straight to the next player's pass screen.</em>
            </span>
          </label>
          <div className="settings-row">
            <span>Animations</span>
            <select
              value={prefs.animations}
              onChange={(e) => set("animations", e.target.value as Prefs["animations"])}
            >
              <option value="auto">follow system</option>
              <option value="on">on</option>
              <option value="off">off</option>
            </select>
          </div>
          <div className={`settings-row ${prefs.animations === "off" ? "disabled" : ""}`}>
            <span>Move speed</span>
            <select
              value={prefs.moveSpeed}
              disabled={prefs.animations === "off"}
              onChange={(e) => set("moveSpeed", e.target.value as Prefs["moveSpeed"])}
            >
              <option value="slow">slow</option>
              <option value="normal">normal</option>
              <option value="fast">fast</option>
            </select>
          </div>
        </div>
      )}
    </div>
  );
}
