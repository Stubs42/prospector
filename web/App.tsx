import { useState } from "react";
import { GameScreen } from "./components/GameScreen.js";
import { SetupScreen } from "./components/SetupScreen.js";
import { Starfield } from "./components/Starfield.js";
import { loadPrefs, motionReduced, savePrefs, type Prefs } from "./prefs.js";
import { useSession } from "./useSession.js";

export default function App() {
  const [prefs, setPrefsState] = useState<Prefs>(() => {
    const p = loadPrefs();
    if (typeof location !== "undefined" && new URLSearchParams(location.search).get("noauto") === "1") {
      p.autoSingle = false;
    }
    return p;
  });
  const setPrefs = (p: Prefs) => {
    setPrefsState(p);
    savePrefs(p);
  };
  const reducedMotion = motionReduced(prefs);
  const s = useSession(prefs, reducedMotion);

  // interactive setup (pickBase -> pickShip) and the real game are two completely separate
  // screens — state.players is empty until setup finishes, so each owns its own hooks
  // (notably GameScreen's move-log) without any nullable-player juggling in either one.
  return (
    <>
      {/* fixed to the viewport, seeded off the game's own seed — regenerates on a new
         game, otherwise untouched by anything that happens on the board (pan/zoom/rotate) */}
      <Starfield seed={s.state.seed} />
      {s.state.setup ? (
        <SetupScreen s={s} prefs={prefs} setPrefs={setPrefs} reducedMotion={reducedMotion} />
      ) : (
        <GameScreen s={s} prefs={prefs} setPrefs={setPrefs} reducedMotion={reducedMotion} />
      )}
    </>
  );
}
