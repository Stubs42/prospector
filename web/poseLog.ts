/**
 * Diagnostics for the "ship's prev position reverted after a correct burn animation" bug —
 * reported live, very rare, never reliably reproduced on demand.
 *
 * Started as a plain trail (record every dispatch's before/after pose) but that turned out
 * not to help: manually replaying the drift/burn math across a raw dump is slow and every
 * entry so far has actually been internally consistent, which just proves the bug — if it's
 * real — lives in the gap BETWEEN two dispatches, not within one. So this now also runs a
 * direct assertion on exactly that gap: one dispatch's `after` and the next dispatch's
 * `before` are meant to be the SAME evolving GameState handed from one call to the next —
 * every player's pose should therefore be byte-for-byte identical across that boundary, with
 * no exceptions needed for hyperspace/scrap/combat-loss, since those relocate a ship WITHIN
 * one before/after pair, never across the gap between two calls. Any mismatch here is the
 * exact shape of a stale-closure/double-dispatch race actually happening, caught in the act,
 * not just suspected after the fact.
 *
 * Kept deliberately cheap (capped ring buffers, one JSON.stringify per dispatch) so it's safe
 * to leave on permanently.
 *
 * Retrieving after a recurrence — open DevTools console and run:
 *   localStorage.getItem("prospector.poseAnomalies")   // should be the FIRST thing to check
 *   localStorage.getItem("prospector.poseLog")         // full recent trail, for context
 * A continuity break also prints immediately as a console.error, prefixed "[poseLog]", if
 * DevTools happens to already be open when it happens.
 */
import type { Action, GameState, Hex } from "../engine/index.js";

const LOG_KEY = "prospector.poseLog";
const ANOMALY_KEY = "prospector.poseAnomalies";
const LOG_CAP = 60;
const ANOMALY_CAP = 20;

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

export interface PoseAnomaly {
  seq: number;
  ts: number;
  /** whose pose broke continuity — not necessarily the player whose turn it is (a combat
     loss, say, can reposition someone other than whoever's acting) */
  playerId: number;
  /** the action that was dispatched when the break was noticed (its OWN before/after was
     internally fine — the break is that its `before` didn't match the end of the PREVIOUS
     dispatch) */
  actionType: Action["type"] | "bot";
  expected: PoseSnapshot;
  actual: PoseSnapshot;
}

let seq = 0;
let buffer: PoseLogEntry[] = [];
let anomalies: PoseAnomaly[] = [];
let lastAfter: GameState | null = null;

function snap(pose: { current: Hex; previous: Hex; atRest: boolean }): PoseSnapshot {
  return { current: pose.current, previous: pose.previous, atRest: pose.atRest };
}

function poseEqual(a: PoseSnapshot, b: PoseSnapshot): boolean {
  return (
    a.current.q === b.current.q &&
    a.current.r === b.current.r &&
    a.previous.q === b.previous.q &&
    a.previous.r === b.previous.r &&
    a.atRest === b.atRest
  );
}

function persist(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* private mode / blocked storage — the in-memory buffers and console lines still work */
  }
}

/** Call once per real dispatch (human or bot), with the SAME before/after states that
   dispatch actually reduced. Runs the continuity assertion against whatever the PREVIOUS
   call's `after` was, then records this dispatch's own before/after for context. */
export function logPose(source: "dispatch" | "bot", actionType: Action["type"] | "bot", before: GameState, after: GameState): void {
  if (lastAfter) {
    for (const p of lastAfter.players) {
      const expected = snap(p.pose);
      const actualPose = before.players.find((x) => x.id === p.id)?.pose;
      if (!actualPose) continue;
      const actual = snap(actualPose);
      if (!poseEqual(expected, actual)) {
        const anomaly: PoseAnomaly = { seq, ts: Date.now(), playerId: p.id, actionType, expected, actual };
        anomalies.push(anomaly);
        if (anomalies.length > ANOMALY_CAP) anomalies = anomalies.slice(-ANOMALY_CAP);
        persist(ANOMALY_KEY, anomalies);
        // eslint-disable-next-line no-console
        console.error(
          `[poseLog] CONTINUITY BREAK — player ${p.id}'s pose at the end of the previous dispatch ` +
            `(${JSON.stringify(expected)}) doesn't match where this "${actionType}" dispatch started from ` +
            `(${JSON.stringify(actual)}).`,
        );
      }
    }
  }
  lastAfter = after;

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
    before: snap(b),
    after: snap(a),
  };
  buffer.push(entry);
  if (buffer.length > LOG_CAP) buffer = buffer.slice(-LOG_CAP);
  persist(LOG_KEY, buffer);
  // eslint-disable-next-line no-console
  console.log(
    `[poseLog] #${entry.seq} p${playerId} ${actionType}: ` +
      `cur ${hexStr(b.current)}->${hexStr(a.current)}, prev ${hexStr(b.previous)}->${hexStr(a.previous)}, rest ${b.atRest}->${a.atRest}`,
  );
}

/** Call whenever a brand new game state starts existing independently of the previous one
   (a real "New game", or a debug fast-forward) — otherwise the first dispatch of the new
   game gets compared against the old game's last pose and flags a false continuity break. */
export function resetPoseLog(): void {
  lastAfter = null;
}

function hexStr(h: Hex): string {
  return `(${h.q},${h.r})`;
}

/** Reads back whatever survived a reload — used only by the console instructions above;
   nothing in the app itself calls this. */
export function readPoseLog(): PoseLogEntry[] {
  try {
    const raw = localStorage.getItem(LOG_KEY);
    return raw ? (JSON.parse(raw) as PoseLogEntry[]) : [];
  } catch {
    return [];
  }
}

/** Same, for anomalies — check this FIRST after a recurrence. */
export function readPoseAnomalies(): PoseAnomaly[] {
  try {
    const raw = localStorage.getItem(ANOMALY_KEY);
    return raw ? (JSON.parse(raw) as PoseAnomaly[]) : [];
  } catch {
    return [];
  }
}
