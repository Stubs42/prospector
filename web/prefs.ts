export interface Prefs {
  /** when only one action is legal, apply it automatically (no click) */
  autoSingle: boolean;
  /** also auto-apply "End turn" when it is the only option (goes straight to the pass screen) */
  autoEndTurn: boolean;
  /** on = animate, off = no motion, auto = follow the OS setting */
  animations: "on" | "off" | "auto";
}

export const DEFAULT_PREFS: Prefs = {
  autoSingle: true,
  autoEndTurn: false,
  animations: "auto",
};

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
