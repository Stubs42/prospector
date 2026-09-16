export interface Prefs {
  /** shown instead of "Player" for every human seat, in the status panel and pass screens.
     Blank falls back to "Player" — there's just one name for now, ahead of real per-account
     names with actual multiplayer. */
  playerName: string;
  /** when only one action is legal, apply it automatically (no click) */
  autoSingle: boolean;
  /** also auto-apply "End turn" when it is the only option (goes straight to the pass screen) */
  autoEndTurn: boolean;
  /** on = animate, off = no motion, auto = follow the OS setting */
  animations: "on" | "off" | "auto";
  /** how long a move-animation phase takes */
  moveSpeed: "slow" | "normal" | "fast";
  /** hide everything in the topbar except the title/turn/toggle itself — reclaims vertical
     space on a small phone screen; persisted so it doesn't need re-toggling every reload */
  topbarCollapsed: boolean;
}

export const DEFAULT_PREFS: Prefs = {
  playerName: "",
  autoSingle: true,
  autoEndTurn: false,
  animations: "auto",
  moveSpeed: "normal",
  topbarCollapsed: false,
};

const MOVE_PHASE_MS: Record<Prefs["moveSpeed"], number> = { slow: 780, normal: 440, fast: 220 };

/** ms per move-animation phase; 0 when motion is reduced (snap straight to the result) */
export function movePhaseMs(p: Prefs): number {
  return motionReduced(p) ? 0 : MOVE_PHASE_MS[p.moveSpeed];
}

const KEY = "prospector.prefs";

export function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULT_PREFS, ...(JSON.parse(raw) as Partial<Prefs>) };
  } catch {
    /* private mode / blocked storage — fall through to defaults */
  }
  return { ...DEFAULT_PREFS };
}

export function savePrefs(p: Prefs): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* ignore */
  }
}

export function motionReduced(p: Prefs): boolean {
  if (p.animations === "on") return false;
  if (p.animations === "off") return true;
  return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}
