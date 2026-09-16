/**
 * A tiny, always-on diagnostic trail for the "ship's prev position reverted after a correct
 * burn animation" bug — reported live, very rare, never reliably reproduced on demand. Since
 * it can't be caught by stepping through code, this instead keeps a running record of every
 * real state-changing dispatch (human or bot) so that WHEN it recurs, there's actual data to
 * look at instead of another guess: what action fired, in what order, and exactly what each
 * ship's pose was immediately before and after.
 *
 * Kept deliberately cheap (a capped ring buffer, one JSON.stringify per dispatch) so it's
 * safe to leave on permanently rather than something that has to be remembered and enabled
 * ahead of time, right before the one moment it'd actually be useful.
 *
 * Retrieving it after a recurrence: open the browser's DevTools console and run
 *   copy(localStorage.getItem("prospector.poseLog"))
 * (copies the JSON to the clipboard — paste it back).  Or just
 *   localStorage.getItem("prospector.poseLog")
 * to read it inline. The console also prints one line per dispatch live, prefixed
 * "[poseLog]", if DevTools happens to already be open when it happens.
 */
import type { Action, GameState, Hex } from "../engine/index.js";

const KEY = "prospector.poseLog";
const CAP = 60;

interface PoseSnapshot {
  current: Hex;
  previous: Hex;
  atRest: boolean;
}

export interface PoseLogEntry {
  seq: number;
  ts: number;
  source: "dispatch" | "bot";
  /** the dispatched action's type, or just "bot" for the bot-turn timer (stepBot doesn't
     expose which action it actually picked, only the resulting state) */
  actionType: Action["type"] | "bot";
  playerId: number;
  before: PoseSnapshot;
  after: PoseSnapshot;
}

let seq = 0;
let buffer: PoseLogEntry[] = [];

function persist(): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(buffer));
  } catch {
    /* private mode / blocked storage — the in-memory buffer and console line still work */
  }
}

/** Records the acting player's pose before/after one real dispatch. Call with the SAME
   before/after states dispatch() itself reduced, right after a successful applyAction. */
export function logPose(source: "dispatch" | "bot", actionType: Action["type"] | "bot", before: GameState, after: GameState): void {
  const playerId = before.activePlayerIndex;
  const b = before.players[playerId]?.pose;
  const a = after.players[playerId]?.pose;
  if (!b || !a) return; // setup/game-over transitions have no ship pose to compare yet
  const entry: PoseLogEntry = {
    seq: seq++,
    ts: Date.now(),
    source,
    actionType,
    playerId,
    before: { current: b.current, previous: b.previous, atRest: b.atRest },
    after: { current: a.current, previous: a.previous, atRest: a.atRest },
  };
  buffer.push(entry);
  if (buffer.length > CAP) buffer = buffer.slice(-CAP);
  persist();
  // eslint-disable-next-line no-console
  console.log(
    `[poseLog] #${entry.seq} p${playerId} ${actionType}: ` +
      `cur ${hexStr(b.current)}->${hexStr(a.current)}, prev ${hexStr(b.previous)}->${hexStr(a.previous)}, rest ${b.atRest}->${a.atRest}`,
  );
}

function hexStr(h: Hex): string {
  return `(${h.q},${h.r})`;
}

/** Reads back whatever survived a reload — used only by the console instructions above;
   nothing in the app itself calls this. */
export function readPoseLog(): PoseLogEntry[] {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as PoseLogEntry[]) : [];
  } catch {
    return [];
  }
}
