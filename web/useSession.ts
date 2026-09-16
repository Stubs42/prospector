/**
 * React glue over engine + client-core. Owns the game / seat / staging state and the two
 * timers (bot autoplay, forced-move auto-advance). A non-React front-end would replace just
 * this file; `client/` and `engine/` are untouched.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { applyAction, boardFor, createGame } from "../engine/index.js";
import { makeRng, type Rng } from "../engine/rng.js";
import { hexKey } from "../engine/hex.js";
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
  type Seat,
} from "../client/index.js";
import { legalActions } from "../engine/index.js";
import { deriveMoveAnim, coastAnim, type MoveAnim } from "./anim.js";
import { movePhaseMs, type Prefs } from "./prefs.js";
import { randomBotName } from "./nameGen.js";

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
  // per-seat display names (index = eventual player id) — see rawNamesFor above
  const [rawNames, setRawNames] = useState<(string | null)[]>(() => rawNamesFor(mkSeats(1, 2)));
  const names = rawNames.map((n) => n ?? (prefs.playerName.trim() || "Player"));
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

  function playAnim(a: MoveAnim | null) {
    setMoveAnim(a);
    // a "drift" doesn't animate — it just holds the ship in place while burn targets
    // show — so it never blocks the timers; only a running slide does.
    setAnimLive(a != null && a.kind !== "drift");
  }
  function endAnim() {
    setMoveAnim((a) => (a && a.kind === "drift" ? a : null));
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
  // so this pass-gate and the bot-turn check below both already work during pickBase/pickShip
  const needPassGate =
    humansCount >= 2 && !state.gameOver && !activeIsBot && shownPlayer !== state.activePlayerIndex;
  // held while GameScreen is playing the initial-resource-placement reveal — the real game
  // state already has every resource placed (see populateGame), so without this the bot
  // timer / auto-draw could silently advance the game while that animation is still playing
  const [holdAdvance, setHoldAdvance] = useState(false);
  // during setup, SetupScreen resolves bot turns itself (the same lucky-wheel spin a human's
  // "Random" button runs, just auto-triggered) so the pick is actually watchable — this timer
  // stays out of it entirely and only drives bot turns in a real, started game
  const isWaitingOnBot =
    !state.setup && !holdAdvance && !animLive && !state.gameOver && !needPassGate && seats[waitingOn(state)] === "bot";

  // --- state transitions -------------------------------------------------
  const clearStaging = () => {
    setArmed(new Set());
    setCombatSel(new Set());
    setAttackTarget(null);
  };
  function dispatch(a: Action) {
    // always reduce against the latest known state (see stateRef above), never the `state`
    // this render closed over — a same-tick second dispatch must build on the first one's
    // result, not silently discard it
    const cur = stateRef.current;
    const r = applyAction(cur, a);
    if (r.ok) {
      let anim = deriveMoveAnim(cur, r.state, phaseMs, moveAnim);
      // coasting ends the move without a burn — slide the held drift to its target
      if (!anim && a.type === "endMove" && moveAnim?.kind === "drift" && moveAnim.playerId === cur.activePlayerIndex) {
        anim = coastAnim(moveAnim);
      }
      playAnim(anim);
      stateRef.current = r.state; // commit before setState, so a same-tick dispatch sees it too
      setState(r.state);
      clearStaging();
      if (a.type === "drawBooster") {
        const before = new Set(cur.players[cur.activePlayerIndex]?.hand.map((c) => c.id));
        const after = r.state.players[cur.activePlayerIndex]!.hand;
        setNewCardIds(new Set(after.filter((c) => !before.has(c.id)).map((c) => c.id)));
      } else {
        setNewCardIds(new Set());
      }
      // setup just finished (the last pickShip finalized into a real game) — start fresh
      // on the pass-gate so the very first real turn doesn't immediately ask to "pass"
      if (cur.setup && !r.state.setup) setShownPlayer(r.state.activePlayerIndex);
    } else console.warn("rejected", a, r.error);
  }
  function dispatchBurn(burn: Extract<Action, { type: "burn" }>) {
    // reserve-fuel cards are no longer staged here — they're played (and their fuel
    // banked) the instant they're clicked, via useReserveFuel — only engine cards arm.
    const cur = stateRef.current;
    const active = cur.players[cur.activePlayerIndex]!;
    const engineBoosters = active.hand.filter((c) => c.type === "engine" && armed.has(c.id)).map((c) => c.id);
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
    stateRef.current = g;
    setState(g);
    setShownPlayer(g.activePlayerIndex);
    botRng.current = makeRng((Math.random() * 1e9) | 0);
    clearStaging();
    playAnim(null);
  }
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
  const burnPreviewFor = (h: Hex | null): { path: Hex[]; cost: number } | null => {
    if (!h) return null;
    const t = afford.burnTargets.find((b) => hexKey(b.cell) === hexKey(h));
    return t ? { path: t.path, cost: t.cost } : null;
  };

  // --- timers ---------------------------------------------------------
  useEffect(() => {
    if (!isWaitingOnBot) return;
    const id = setTimeout(() => {
      const cur = stateRef.current; // see stateRef's note above dispatch — same race guard
      const next = stepBot(cur, botRng.current);
      let anim = deriveMoveAnim(cur, next, phaseMs, moveAnim);
      if (!anim && moveAnim?.kind === "drift") anim = coastAnim(moveAnim); // bot coasted out of the drift
      playAnim(anim);
      stateRef.current = next;
      setState(next);
    }, reducedMotion ? 60 : 340);
    return () => clearTimeout(id);
  }, [state, isWaitingOnBot, reducedMotion, phaseMs, moveAnim]);

  const autoCandidates = afford.legal.filter(
    (a) => !AUTO_HIDE.has(a.type) && (a.type !== "endTurn" || prefs.autoEndTurn),
  );
  const autoAction =
    prefs.autoSingle &&
    !state.setup &&
    !holdAdvance &&
    !animLive &&
    !state.gameOver &&
    !needPassGate &&
    !activeIsBot &&
    // never auto-fire the "ship is lost" endMove while a reserve-fuel card could still save
    // it — see Affordances.avoidableShipLoss
    !afford.avoidableShipLoss &&
    autoCandidates.length === 1
      ? autoCandidates[0]!
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
    burnPreviewFor,
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
  };
}

export type Session = ReturnType<typeof useSession>;
