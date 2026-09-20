/**
 * React glue over engine + client-core. Owns the game / seat / staging state and the two
 * timers (bot autoplay, forced-move auto-advance). A non-React front-end would replace just
 * this file; `client/` and `engine/` are untouched.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { applyAction, boardFor, createGame, statsOf } from "../engine/index.js";
import { makeRng, type Rng } from "../engine/rng.js";
import { add, hexKey } from "../engine/hex.js";
import type { Action, Colour, GameState, Hex, OreColour } from "../engine/index.js";
import {
  affordances,
  driftPreview,
  burnCost,
  mkSeats,
  humansIn,
  waitingOn,
  activeIsBot as activeIsBotOf,
  stepBot,
  randomBotName,
  type Seat,
} from "../client/index.js";
import { legalActions } from "../engine/index.js";
import { deriveMoveAnim, coastAnim, type MoveAnim } from "./anim.js";
import { movePhaseMs, type Prefs } from "./prefs.js";
import { logPose, resetPoseLog } from "./poseLog.js";
import type { ClientMessage, ServerMessage } from "../client/index.js";

const RECONNECT_KEY = "prospector.online.session";
interface SavedOnlineSession {
  roomCode: string;
  token: string;
}
function loadSavedOnlineSession(): SavedOnlineSession | null {
  try {
    const raw = localStorage.getItem(RECONNECT_KEY);
    return raw ? (JSON.parse(raw) as SavedOnlineSession) : null;
  } catch {
    return null;
  }
}
function saveOnlineSession(s: SavedOnlineSession | null): void {
  try {
    if (s) localStorage.setItem(RECONNECT_KEY, JSON.stringify(s));
    else localStorage.removeItem(RECONNECT_KEY);
  } catch {
    // localStorage can throw (private mode, quota) — reconnect-on-refresh just won't work
  }
}

export interface OnlineState {
  status: "offline" | "connecting" | "online";
  roomCode: string | null;
  playerIndex: number | null;
  seats: Seat[];
  error: string | null;
}

// human seats are a live sentinel (null), resolved against prefs.playerName on every render
// so changing "your name" in Settings takes effect immediately without touching bot names;
// bots get one random name each, generated once per game, so several stay easy to tell apart
const rawNamesFor = (seatArr: Seat[]): (string | null)[] =>
  seatArr.map((k) => (k === "bot" ? randomBotName() : null));

// exported only so a plain unit test can assert membership without rendering the hook (no
// jsdom/RTL in this project — see web/dispatchRace.test.ts for the established pattern)
export const AUTO_HIDE = new Set<Action["type"]>([
  "declineCounter",
  "discardBooster",
  "combatDefend",
  "combatResolve",
  // scrapping is now a click-your-base-and-confirm gesture, not a turn-start choice —
  // never auto-fire it, and never let its presence block the auto-draw/auto-drift chain
  "scrapShip",
  // playing a reserve-fuel card is always the player's voluntary choice — never auto-fire it
  "useReserveFuel",
  // starting combat is always the player's voluntary choice, staged through the attack-target
  // click + CombatBox (laser-booster picker) — auto-firing the raw action here skipped that
  // whole flow and attacked with no confirmation and no chance to spend boosters
  "attack",
]);

/** how long a freshly-drawn card keeps its "new" pulse */
const NEW_CARD_PULSE_MS = 3000;

export function useSession(prefs: Prefs, reducedMotion: boolean) {
  const [humans, setHumans] = useState(1);
  const [bots, setBots] = useState(2);
  // "select" is the default (see engine's CreateGameOptions.upgradeAtStart) — carried across
  // "New game" until the player changes it in the setup topbar
  const [upgradeAtStart, setUpgradeAtStart] = useState<"none" | "random" | "select">("select");
  const [seats, setSeats] = useState<Seat[]>(() => mkSeats(1, 2));
  // per-seat display names (index = eventual player id) — see rawNamesFor above. Purely local
  // and offline-only: hot-seat has no per-seat identity to know, so every human seat just
  // shows this device's own prefs.playerName. Online, real names come from the server instead
  // (onlineNames, below) — every browser would otherwise invent its own guess per seat.
  const [rawNames, setRawNames] = useState<(string | null)[]>(() => rawNamesFor(mkSeats(1, 2)));
  const [onlineNames, setOnlineNames] = useState<string[]>([]);
  // a fresh game always starts as an interactive setup (state.setup non-null) — pickBase and
  // pickShip are real, logged engine actions, not client-side randomness. See stepSetup in
  // engine/game.ts.
  const [state, setState] = useState<GameState>(() =>
    createGame({ seats: mkSeats(1, 2), seed: (Math.random() * 1e9) | 0, upgradeAtStart: "select" }),
  );
  const [shownPlayer, setShownPlayer] = useState(state.activePlayerIndex);
  const [armed, setArmed] = useState<Set<string>>(new Set());
  const [combatSel, setCombatSel] = useState<Set<string>>(new Set());
  const [attackTarget, setAttackTarget] = useState<number | null>(null);
  // moveAnim: an in-flight (or a held, frozen-at-reach drift) move. animLive: an rAF is actually running.
  const [moveAnim, setMoveAnim] = useState<MoveAnim | null>(null);
  const [animLive, setAnimLive] = useState(false);
  const [newCardIds, setNewCardIds] = useState<Set<string>>(new Set());
  const botRng = useRef<Rng>(makeRng(0x5eed));
  const phaseMs = movePhaseMs(prefs);

  // The single source of truth `dispatch` (and the bot timer) actually reduce against —
  // kept in sync with `state` every render, but ALSO written synchronously the instant a
  // dispatch resolves, so a second dispatch fired in the same tick (before React has
  // re-rendered and hooked everyone back up to a fresh `state` closure) still reduces from
  // the first one's result instead of a stale, already-superseded GameState. Without this,
  // two dispatches racing in the same tick (a legitimate possibility: an auto-advance timer
  // firing at the same moment as a manual click, react-strict-mode's double effect-invoke,
  // or any other same-tick double dispatch) silently drops whichever applied first — e.g. a
  // burn that visibly lands correctly, then a second, stale-state dispatch overwrites it,
  // pose.previous reverting to what it was before that burn ever happened. That exactly
  // matches a reported bug: frequent, never reliably reproducible (a timing race, not a
  // deterministic engine bug — those repro 100% off the same action sequence).
  const stateRef = useRef(state);
  stateRef.current = state;
  // same reasoning as stateRef, for the same reason: commitState's incoming-"state"-message
  // path is invoked from ws.onmessage, a closure assigned ONCE per socket connection (inside
  // openSocket, itself only called when hosting/joining/reconnecting) — not re-created every
  // render. A plain `moveAnim` read inside that closure would forever see whatever it was at
  // connect time (typically null), never the real held-drift animation a later burn needs to
  // continue smoothly from — exactly the shape of a reported bug: a burn's slide visually
  // started from the raw (already-drift-advanced) state position instead of the true held
  // ring/dot, jumping through the drift target before snapping to the real one.
  const moveAnimRef = useRef(moveAnim);
  moveAnimRef.current = moveAnim;

  // --- online (networked) mode -------------------------------------------
  // offline (the default) behaves exactly as this file always has: dispatch applies locally.
  // Once online, dispatch instead sends the action to the server and waits for its broadcast
  // "state" message to arrive — see dispatch() and the socket message handler below.
  const wsRef = useRef<WebSocket | null>(null);
  const [online, setOnlineState] = useState<OnlineState>({
    status: "offline",
    roomCode: null,
    playerIndex: null,
    seats: [],
    error: null,
  });
  // real synced names once online (see onlineNames' own declaration above for why);
  // hot-seat's per-device rawNames/prefs.playerName scheme is untouched
  const names =
    online.status === "offline" ? rawNames.map((n) => n ?? (prefs.playerName.trim() || "Player")) : onlineNames;
  // set by dispatch() right before sending an action over the wire, so the socket handler can
  // attribute the next incoming state to it (for the anim-deriving special cases below that
  // need to know the action type, not just the before/after pose) — cleared once consumed.
  // Best-effort: if another player's/bot's broadcast races in first, this occasionally
  // mis-attributes a cosmetic animation choice, never the underlying game state.
  const pendingActionTypeRef = useRef<Action["type"] | null>(null);
  // "is this browser's own seat the one a given decision belongs to" — offline (hot-seat) this
  // is always true (one shared browser IS whoever's deciding); online it's the difference
  // between an interactive prompt and a passive one. GameScreen/SetupScreen use this to gate
  // every "what do you want to do" surface (pickers, burn targets, combat buttons, hand cards)
  // so only the deciding seat's own browser ever renders them as clickable — every other
  // connected browser just watches the result.
  const isMe = (playerIndex: number): boolean => online.status === "offline" || online.playerIndex === playerIndex;

  function playAnim(a: MoveAnim | null) {
    moveAnimRef.current = a; // synchronous, like stateRef — see its declaration above
    setMoveAnim(a);
    // a "drift" doesn't animate — it just holds the ship in place while burn targets
    // show — so it never blocks the timers; only a running slide does.
    setAnimLive(a != null && a.kind !== "drift");
  }
  function endAnim() {
    const next = moveAnimRef.current && moveAnimRef.current.kind === "drift" ? moveAnimRef.current : null;
    moveAnimRef.current = next;
    setMoveAnim(next);
    setAnimLive(false);
  }

  // null during interactive setup (state.players is empty until the last ship is picked)
  const p = state.players[state.activePlayerIndex] ?? null;

  const armedEngine = (p?.hand ?? [])
    .filter((c) => c.type === "engine" && armed.has(c.id))
    .reduce((a, c) => a + (c.value ?? 0), 0);

  const afford = useMemo(() => affordances(state, { extraEngines: armedEngine }), [state, armedEngine]);

  const humansCount = humansIn(seats);
  const activeIsBot = activeIsBotOf(state, seats);

  // state.activePlayerIndex tracks whoever is up next throughout setup too (see stepSetup),
  // so this pass-gate and the bot-turn check below both already work during pickBase/pickShip.
  // "pass the device" only makes sense in local hot-seat play — online, every seat has its own
  // device/browser, so there's nothing to pass.
  const needPassGate =
    online.status === "offline" &&
    humansCount >= 2 &&
    !state.gameOver &&
    !activeIsBot &&
    shownPlayer !== state.activePlayerIndex;
  // held while GameScreen is playing the initial-resource-placement reveal — the real game
  // state already has every resource placed (see populateGame), so without this the bot
  // timer / auto-draw could silently advance the game while that animation is still playing
  const [holdAdvance, setHoldAdvance] = useState(false);
  // during setup, SetupScreen resolves bot turns itself (the same lucky-wheel spin a human's
  // "Random" button runs, just auto-triggered) so the pick is actually watchable — this timer
  // stays out of it entirely and only drives bot turns in a real, started game. Online, the
  // server drives every bot turn centrally (server/game-server.ts) — this client must never
  // also step a bot locally, or two independent RNGs would race to advance the same game.
  const isWaitingOnBot =
    online.status === "offline" &&
    !state.setup &&
    !holdAdvance &&
    !animLive &&
    !state.gameOver &&
    !needPassGate &&
    seats[waitingOn(state)] === "bot";

  // --- state transitions -------------------------------------------------
  const clearStaging = () => {
    setArmed(new Set());
    setCombatSel(new Set());
    setAttackTarget(null);
  };
  // Applies a (cur -> next) transition to all the client-local bookkeeping that isn't part of
  // GameState itself: pose log, move animation, staging, the "just drew this" pulse, and the
  // setup-just-finished pass-gate reset. Transport-agnostic on purpose — `next` may have come
  // from a local applyAction call (hot-seat) or a server broadcast (online); either way this
  // is the one place that turns "here's a new GameState" into the right UI reaction.
  // `actionType` drives two animation special-cases that a plain pose diff can't tell apart on
  // its own (coasting a held drift with no burn, and clearing a hold on scrapShip) — see the
  // dispatch()/online-mode callers for how each supplies it.
  function commitState(cur: GameState, next: GameState, actionType: Action["type"] | null) {
    if (!cur.setup) logPose("dispatch", actionType ?? "network", cur, next);
    // read the ref, not the closed-over `moveAnim` — see moveAnimRef's declaration: this
    // function is called from a stale ws.onmessage closure once online, which would otherwise
    // never see anything past whatever moveAnim was at connect time
    const heldAnim = moveAnimRef.current;
    let anim = deriveMoveAnim(cur, next, phaseMs, heldAnim);
    // coasting ends the move without a burn — slide the held drift to its target
    if (!anim && actionType === "endMove" && heldAnim?.kind === "drift" && heldAnim.playerId === cur.activePlayerIndex) {
      anim = coastAnim(heldAnim);
    }
    if (anim) {
      playAnim(anim);
    } else if (actionType === "scrapShip" || next.activePlayerIndex !== cur.activePlayerIndex) {
      // the held drift (if any) no longer applies once the ship is scrapped, or the turn
      // moves on to someone else, without ever resolving it into a slide
      playAnim(null);
    }
    // otherwise: this transition never touched anyone's pose (drawBooster, discardBooster,
    // useReserveFuel, attack, combat sub-decisions, chooseEquipment, ...) — leave whatever
    // drift is currently held exactly as it is. Calling playAnim(null) here used to wipe
    // the hold's own p0/c0 the instant e.g. a reserve-fuel card was played mid-drift, so
    // the burn dispatched right after it derived its slide from scratch (the ship's plain
    // current pose) instead of continuing the drift's already-shown path — a phantom extra
    // "drift" animation, whose end then snapped to the real position: exactly the shape of
    // the long-suspected "prev position reverts" bug, even though the underlying state was
    // correct throughout (see poseLog's own findings — it never caught a real data break).
    stateRef.current = next; // commit before setState, so a same-tick dispatch sees it too
    setState(next);
    clearStaging();
    if (actionType === "drawBooster") {
      const before = new Set(cur.players[cur.activePlayerIndex]?.hand.map((c) => c.id));
      const after = next.players[cur.activePlayerIndex]?.hand ?? [];
      setNewCardIds(new Set(after.filter((c) => !before.has(c.id)).map((c) => c.id)));
    } else {
      setNewCardIds(new Set());
    }
    // setup just finished (the last pickShip finalized into a real game) — start fresh
    // on the pass-gate so the very first real turn doesn't immediately ask to "pass"
    if (cur.setup && !next.setup) setShownPlayer(next.activePlayerIndex);
  }
  function dispatch(a: Action) {
    // always reduce against the latest known state (see stateRef above), never the `state`
    // this render closed over — a same-tick second dispatch must build on the first one's
    // result, not silently discard it
    const cur = stateRef.current;
    if (online.status !== "offline") {
      // the server is the sole authority once online — send the action and wait for its
      // broadcast "state" message (handled below) to actually commit anything; a locally-run
      // applyAction here would just be discarded speculation, so don't even attempt one
      pendingActionTypeRef.current = a.type;
      const msg: ClientMessage = { type: "action", action: a };
      wsRef.current?.send(JSON.stringify(msg));
      return;
    }
    const r = applyAction(cur, a);
    if (r.ok) commitState(cur, r.state, a.type);
    else console.warn("rejected", a, r.error);
  }
  function dispatchBurn(burn: Extract<Action, { type: "burn" }>) {
    // reserve-fuel cards are no longer staged here — they're played (and their fuel
    // banked) the instant they're clicked, via useReserveFuel — only engine cards arm.
    const cur = stateRef.current;
    const active = cur.players[cur.activePlayerIndex]!;
    // arming an engine card widens the burn-target PREVIEW (see armedEngine/afford above),
    // but that doesn't mean every armed card is actually needed for whichever target the
    // player ends up clicking — a nearby burn that was already reachable unboosted must not
    // silently spend a card that was only armed to reach a farther one. Try the burn with
    // progressively more of the armed cards attached (smallest first, so a small card covers
    // a small shortfall before a big one gets touched), stopping at the first count that's
    // actually legal — applyAction clones state internally, so a losing trial here is free.
    const armedEngineCards = active.hand
      .filter((c) => c.type === "engine" && armed.has(c.id))
      .sort((a, b) => (a.value ?? 0) - (b.value ?? 0));
    for (let n = 0; n <= armedEngineCards.length; n++) {
      const engineBoosters = armedEngineCards.slice(0, n).map((c) => c.id);
      const attempt = engineBoosters.length ? { ...burn, engineBoosters } : burn;
      if (applyAction(cur, attempt).ok) {
        dispatch(attempt);
        return;
      }
    }
    // every prefix failed (shouldn't happen for a target the UI actually offered) — fall
    // back to spending everything armed, so a genuinely-needed burn is never just dropped
    const engineBoosters = armedEngineCards.map((c) => c.id);
    dispatch(engineBoosters.length ? { ...burn, engineBoosters } : burn);
  }
  /** (re)start setup fresh — a new interactive game, base/ship all unpicked */
  function openSetup(h = humans, b = bots, upgrade = upgradeAtStart) {
    setHumans(h);
    setBots(b);
    setUpgradeAtStart(upgrade);
    const seatArr = mkSeats(h, b);
    setSeats(seatArr);
    setRawNames(rawNamesFor(seatArr));
    const g = createGame({ seats: seatArr, seed: (Math.random() * 1e9) | 0, upgradeAtStart: upgrade });
    resetPoseLog(); // a brand new game — the old one's last pose is not this one's baseline
    stateRef.current = g;
    setState(g);
    setShownPlayer(g.activePlayerIndex);
    botRng.current = makeRng((Math.random() * 1e9) | 0);
    clearStaging();
    playAnim(null);
  }

  // --- online (networked) mode: connection management --------------------
  function wsUrl(): string {
    const scheme = location.protocol === "https:" ? "wss:" : "ws:";
    return `${scheme}//${location.host}/ws`;
  }
  function openSocket(onOpen: (ws: WebSocket) => void): void {
    wsRef.current?.close();
    setOnlineState((o) => ({ ...o, status: "connecting", error: null }));
    const ws = new WebSocket(wsUrl());
    wsRef.current = ws;
    ws.onopen = () => onOpen(ws);
    ws.onerror = () => setOnlineState((o) => ({ ...o, status: "offline", error: "Could not reach the server" }));
    ws.onclose = () => setOnlineState((o) => (o.status === "offline" ? o : { ...o, status: "offline" }));
    ws.onmessage = (ev) => {
      const msg: ServerMessage = JSON.parse(ev.data as string);
      switch (msg.type) {
        case "roomJoined":
          saveOnlineSession({ roomCode: msg.roomCode, token: msg.reconnectToken });
          setOnlineState({
            status: "online",
            roomCode: msg.roomCode,
            playerIndex: msg.playerIndex,
            seats: msg.seats,
            error: null,
          });
          setSeats(msg.seats);
          setOnlineNames(msg.names);
          break;
        case "state": {
          const actionType = pendingActionTypeRef.current;
          pendingActionTypeRef.current = null;
          commitState(stateRef.current, msg.state, actionType);
          setOnlineNames(msg.names);
          break;
        }
        case "error":
          // a rejection while still trying to get INTO a room (bad room code, room full, a
          // createRoom with an out-of-range player count, ...) must fall back to "offline" so
          // the lobby button un-sticks from "Connecting…" and the player can retry; a
          // rejection of an in-game action once already online is exactly like a local
          // dispatch's illegal action — surfaced, but never kicks the player out of the room
          setOnlineState((o) => (o.status === "connecting" ? { ...o, status: "offline", error: msg.message } : { ...o, error: msg.message }));
          break;
        case "roomClosed":
          saveOnlineSession(null);
          setOnlineState({ status: "offline", roomCode: null, playerIndex: null, seats: [], error: "Room closed" });
          break;
      }
    };
  }
  function hostOnline(
    displayName: string,
    h: number,
    b: number,
    upgrade: "none" | "random" | "select",
    variant: "standard" | "short" | "long",
  ): void {
    openSocket((ws) => {
      const msg: ClientMessage = { type: "createRoom", displayName, humans: h, bots: b, upgradeAtStart: upgrade, variant };
      ws.send(JSON.stringify(msg));
    });
  }
  function joinOnline(displayName: string, roomCode: string): void {
    openSocket((ws) => {
      const msg: ClientMessage = { type: "joinRoom", roomCode, displayName };
      ws.send(JSON.stringify(msg));
    });
  }
  function leaveOnline(): void {
    saveOnlineSession(null);
    wsRef.current?.close();
    wsRef.current = null;
    setOnlineState({ status: "offline", roomCode: null, playerIndex: null, seats: [], error: null });
    setOnlineNames([]);
    openSetup(); // fall back to a fresh local hot-seat game rather than a dead screen
  }
  // auto-reconnect once, on first mount, if a browser refresh left a room behind
  useEffect(() => {
    const saved = loadSavedOnlineSession();
    if (!saved) return;
    openSocket((ws) => {
      const msg: ClientMessage = { type: "joinRoom", roomCode: saved.roomCode, displayName: "", reconnectToken: saved.token };
      ws.send(JSON.stringify(msg));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pickBase = (base: Colour) => dispatch({ type: "pickBase", base });
  const pickShip = (colour: Colour) => dispatch({ type: "pickShip", colour });
  const finishSetup = () => dispatch({ type: "finishSetup" });
  const revealTurn = () => setShownPlayer(state.activePlayerIndex);
  const toggle = (setter: typeof setArmed) => (id: string) =>
    setter((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });

  // the "just drew this" pulse wears off on its own after a few seconds
  useEffect(() => {
    if (newCardIds.size === 0) return;
    const id = setTimeout(() => setNewCardIds(new Set()), NEW_CARD_PULSE_MS);
    return () => clearTimeout(id);
  }, [newCardIds]);

  // --- previews --------------------------------------------------------
  const driftGhost = afford.legal.some((a) => a.type === "drift") ? driftPreview(state) : null;

  // --- timers ---------------------------------------------------------
  useEffect(() => {
    if (!isWaitingOnBot) return;
    const id = setTimeout(() => {
      const cur = stateRef.current; // see stateRef's note above dispatch — same race guard
      const next = stepBot(cur, botRng.current);
      logPose("bot", "bot", cur, next);
      let anim = deriveMoveAnim(cur, next, phaseMs, moveAnim);
      if (!anim && moveAnim?.kind === "drift") anim = coastAnim(moveAnim); // bot coasted out of the drift
      playAnim(anim);
      stateRef.current = next;
      setState(next);
    }, reducedMotion ? 60 : 340);
    return () => clearTimeout(id);
  }, [state, isWaitingOnBot, reducedMotion, phaseMs, moveAnim]);

  // a deliberate-choice action (attack, useReserveFuel, scrapShip, ...) is hidden from
  // auto-fire so it never fires ON ITS OWN — but that must never make a "close out this
  // phase" action (endMove as much as endTurn) look like "the only thing left" either: e.g.
  // out of fuel with nothing else to do but a reserve-fuel card in hand — endMove was the
  // only thing surviving the AUTO_HIDE filter, so it auto-fired and finalized the move
  // before the player ever got to play the card, leaving scrapping the ship as the only way
  // out. Both endMove and endTurn now only auto-fire when they're truly the SOLE legal
  // action worth pausing for — checked against the full list minus scrapShip specifically,
  // not the raw unfiltered list: scrapShip is a PERMANENT fallback (legal any time the ship
  // is placed, config.core.turn.allowScrapBeforeDraw), not a situational opportunity like
  // attack/useReserveFuel that only appears when actually relevant — counting it here would
  // make endMove/endTurn nearly never auto-fire in perfectly ordinary play (it's always
  // sitting there in the background), which is exactly what happened the first time this
  // was tightened: normal end-of-move/turn advance started requiring a manual click even
  // with nothing real to decide.
  const CLOSING_ACTIONS = new Set<Action["type"]>(["endMove", "endTurn"]);
  const autoCandidates = afford.legal.filter((a) => !AUTO_HIDE.has(a.type));
  const soleAutoCandidate =
    autoCandidates.length === 1 && !CLOSING_ACTIONS.has(autoCandidates[0]!.type) ? autoCandidates[0]! : null;
  const legalMinusScrap = afford.legal.filter((a) => a.type !== "scrapShip");
  const soleClosingAction =
    legalMinusScrap.length === 1 && CLOSING_ACTIONS.has(legalMinusScrap[0]!.type)
      ? legalMinusScrap[0]!.type === "endTurn"
        ? prefs.autoEndTurn
          ? legalMinusScrap[0]!
          : null
        : legalMinusScrap[0]!
      : null;
  const autoAction =
    prefs.autoSingle &&
    !state.setup &&
    !holdAdvance &&
    !animLive &&
    !state.gameOver &&
    !needPassGate &&
    !activeIsBot &&
    // online, every connected browser computes this identically (it's derived purely from
    // shared state) — without this check, every spectator's browser would ALSO fire its own
    // dispatch attempt on the same timer, get rejected by the server's turn-ownership check,
    // but still stamp its own pendingActionTypeRef with a guess that the next (unrelated) real
    // broadcast would then be wrongly attributed to — exactly the shape of a reported "move
    // animation glitches" bug, since the anim-deriving special cases key off actionType.
    isMe(state.activePlayerIndex) &&
    // never auto-fire the "ship is lost" endMove while a reserve-fuel card could still save
    // it — see Affordances.avoidableShipLoss
    !afford.avoidableShipLoss &&
    // never auto-fire an empty-tank drift while a reserve-fuel card could top it up and
    // open real burn targets first — see Affordances.avoidableZeroFuelDrift
    !afford.avoidableZeroFuelDrift
      ? (soleAutoCandidate ?? soleClosingAction)
      : null;
  useEffect(() => {
    if (!autoAction) return;
    const id = setTimeout(() => dispatch(autoAction), reducedMotion ? 30 : 220);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, autoAction, reducedMotion]);

  // --- ?demo=N : fast-forward with bots, for screenshots -------------
  useEffect(() => {
    const qs = new URLSearchParams(location.search);
    const n = Number(qs.get("demo") ?? 0);
    const rng = makeRng(1);
    if (qs.get("skipsetup") === "1" && !n) {
      let s = state;
      while (s.setup) s = stepBot(s, rng); // randomly resolve pickBase/pickShip for every seat
      resetPoseLog();
      stateRef.current = s;
      setState(s);
      setSeats(Array<Seat>(s.players.length).fill("human"));
      setShownPlayer(s.activePlayerIndex);
      return;
    }
    if (!n) return;
    let s = state;
    while (s.setup) s = stepBot(s, rng); // setup always resolves first, however small n is
    for (let i = 0; i < n && !s.gameOver; i++) s = stepBot(s, rng);
    for (const step of [{ type: "drawBooster" }, { type: "drift" }] as Action[]) {
      if (legalActions(s).some((a) => a.type === step.type)) {
        const r = applyAction(s, step);
        if (r.ok) s = r.state;
      }
    }
    if (
      qs.get("combattest") === "onturn" ||
      qs.get("combattest") === "offturn" ||
      qs.get("combattest") === "resolve"
    ) {
      // DEBUG ONLY — preview the counter-attack decision box directly (skips the whole
      // declare/defend/resolve dance): "offturn" is the original defender being asked to
      // counter or step back after successfully defending round 1 (attacker still on turn);
      // "onturn" is the original attacker being asked the same after successfully defending
      // a round-2 counter (so THEY'D end their own turn by declining, not just the fight);
      // "resolve" lands one step earlier still — right at "Roll the dice" — so the reveal
      // animation and win/loss outcome message can be checked without fighting through the
      // declare/stand click-through
      // the N stepBot calls above may not have caught up with every seat's start-of-game
      // upgrade pick yet (each call is one action, not a full turn) — every other action,
      // including our own forced pendingCombat below, is globally gated behind resolving it
      while (s.pendingEquipment) {
        const card = s.pendingEquipment.cards[0];
        if (!card) break;
        const r = applyAction(s, { type: "chooseEquipment", cardId: card.id });
        if (!r.ok) break;
        s = r.state;
      }
      const active = s.players[s.activePlayerIndex]!;
      const enemy = s.players.find((pl) => pl.id !== active.id && !pl.eliminated);
      if (enemy) {
        // a fixed direction, not board.neighbours(...).filter(...) — this only needs real
        // adjacency for areNeighbours' sake, not a legal/free cell, so it can't land on an
        // empty filtered list depending on where this seed happened to start the ship
        const spot = add(active.pose.current, { q: 1, r: 0 });
        const onTurn = qs.get("combattest") === "onturn";
        const resolving = qs.get("combattest") === "resolve";
        s = {
          ...s,
          phase: "moved",
          players: s.players.map((pl) =>
            pl.id === enemy.id ? { ...pl, pose: { current: spot, previous: spot, atRest: true } } : pl,
          ),
          pendingCombat: resolving
            ? {
                attackerId: active.id,
                defenderId: enemy.id,
                round: 1,
                // wildly lopsided on purpose: guarantees a win regardless of dice roll, so
                // this debug path can preview the "Attack Succeeded"/loot outcome message
                attackerLaserBoost: qs.get("forcewin") === "1" ? 99 : 0,
                awaiting: "resolve",
                lastAttackFailed: false,
                defShields: statsOf(s, enemy).shields,
              }
            : {
                attackerId: onTurn ? enemy.id : active.id,
                defenderId: onTurn ? active.id : enemy.id,
                round: onTurn ? 2 : 1,
                attackerLaserBoost: 0,
                awaiting: "counter",
                lastAttackFailed: true,
              },
        };
      }
    }
    if (qs.get("equip") === "1" && s.decks.equipment.draw.length >= 3) {
      // preview the homecoming upgrade picker without playing a full delivery
      s = { ...s, pendingEquipment: { playerId: s.activePlayerIndex, cards: s.decks.equipment.draw.slice(0, 3), reason: "homecoming", rerollsUsed: 0, seedCount: 0, endTurnAfter: false } };
    }
    if (qs.get("postmove") === "1") {
      // preview the post-move board targets: a loadable resource, an attackable enemy,
      // and your own ship, all ready at once
      const board = boardFor(s);
      const active = s.players[s.activePlayerIndex]!;
      const nb = board.neighbours(active.pose.current).filter((h) => board.isInner(h) && !board.baseOwnerAt(h));
      const resourceCell = nb.find((h) => !s.board.resources[hexKey(h)]) ?? nb[0];
      const enemy = s.players.find((pl) => pl.id !== active.id && !pl.eliminated);
      s = {
        ...s,
        phase: "moved",
        board: resourceCell
          ? { resources: { ...s.board.resources, [hexKey(resourceCell)]: "green" } }
          : s.board,
        players: s.players.map((pl) => {
          if (pl.id === active.id) return { ...pl, turn: { ...pl.turn, postMoveActionTaken: null } };
          if (enemy && pl.id === enemy.id) {
            const spot = nb.find((h) => !resourceCell || hexKey(h) !== hexKey(resourceCell)) ?? nb[0]!;
            return { ...pl, pose: { current: spot, previous: spot, atRest: true }, cargo: pl.cargo.length ? pl.cargo : ["yellow"] };
          }
          return pl;
        }),
      };
    }
    if (qs.get("discard") === "1") {
      // preview the over-the-limit discard prompt by force-feeding extra cards; snap the
      // turn phase back to "start" so the hand-limit gate (only checked there) re-fires
      s = {
        ...s,
        phase: "start",
        players: s.players.map((pl, i) =>
          i === s.activePlayerIndex ? { ...pl, hand: [...pl.hand, ...s.decks.booster.draw.slice(0, 3)] } : pl,
        ),
      };
    }
    if (qs.get("playedcard") === "1") {
      // DEBUG ONLY — preview the open discard pile showing a real top card
      const card = s.decks.booster.draw[0];
      if (card) {
        s = {
          ...s,
          decks: {
            ...s.decks,
            booster: { draw: s.decks.booster.draw.slice(1), discard: [...s.decks.booster.discard, card] },
          },
        };
      }
    }
    if (qs.get("gameover") === "1") {
      // DEBUG ONLY — preview the game-over ranking popup: a tied pair (identical score AND
      // identical per-colour counts, to check the "share the rank" path), a same-score
      // player that loses the tiebreak on red count (checks the skip-to-3 path), and a
      // clear last place.
      const cases = [
        ["red", "red", "yellow"],
        ["yellow", "yellow", "yellow", "yellow"],
        ["red", "red", "yellow"],
        ["green"],
      ] as OreColour[][];
      s = {
        ...s,
        gameOver: true,
        players: s.players.map((pl, i) => ({ ...pl, delivered: cases[i % cases.length]! })),
      };
    }
    resetPoseLog(); // this whole block only ever runs once, on a debug/demo fast-forward
    stateRef.current = s;
    setState(s);
    setShownPlayer(s.activePlayerIndex);
    setSeats(Array<Seat>(s.players.length).fill("human"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    state,
    seats,
    names,
    humans,
    bots,
    upgradeAtStart,
    /** `data` is the engine's own SetupState — GUIs read stage/bases/colours/turnIndex/
       startSeat straight off it instead of re-deriving them client-side */
    setup: { open: state.setup !== null, data: state.setup },
    staging: { armed, combatSel, attackTarget },
    afford,
    activeIsBot,
    isWaitingOnBot,
    needPassGate,
    driftGhost,
    moveAnim,
    animLive,
    newCardIds,
    /** the action about to auto-fire on its own, if any — GUIs should hide it as a click target */
    autoAction,
    endMoveAnim: endAnim,
    dispatch,
    dispatchBurn,
    openSetup,
    pickBase,
    pickShip,
    finishSetup,
    holdAdvance,
    setHoldAdvance,
    revealTurn,
    toggleArmed: toggle(setArmed),
    toggleCombatSel: toggle(setCombatSel),
    setAttackTarget,
    online,
    isMe,
    hostOnline,
    joinOnline,
    leaveOnline,
  };
}

export type Session = ReturnType<typeof useSession>;
