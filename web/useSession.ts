/**
 * React glue over engine + client-core. Owns the game / seat / staging state and the two
 * timers (bot autoplay, forced-move auto-advance). A non-React front-end would replace just
 * this file; `client/` and `engine/` are untouched.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { applyAction, boardFor, createGame } from "../engine/index.js";
import { makeRng, type Rng } from "../engine/rng.js";
import { hexKey } from "../engine/hex.js";
import type { Action, Colour, GameState, Hex } from "../engine/index.js";
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

const AUTO_HIDE = new Set<Action["type"]>([
  "declineCounter",
  "discardBooster",
  "combatDefend",
  "combatResolve",
  // scrapping is now a click-your-base-and-confirm gesture, not a turn-start choice —
  // never auto-fire it, and never let its presence block the auto-draw/auto-drift chain
  "scrapShip",
  // playing a reserve-fuel card is always the player's voluntary choice — never auto-fire it
  "useReserveFuel",
]);

/** how long a freshly-drawn card keeps its "new" pulse */
const NEW_CARD_PULSE_MS = 3000;

export function useSession(prefs: Prefs, reducedMotion: boolean) {
  const [humans, setHumans] = useState(1);
  const [bots, setBots] = useState(2);
  const [seats, setSeats] = useState<Seat[]>(() => mkSeats(1, 2));
  // per-seat display names (index = eventual player id) — see rawNamesFor above
  const [rawNames, setRawNames] = useState<(string | null)[]>(() => rawNamesFor(mkSeats(1, 2)));
  const names = rawNames.map((n) => n ?? (prefs.playerName.trim() || "Player"));
  // a fresh game always starts as an interactive setup (state.setup non-null) — pickBase and
  // pickShip are real, logged engine actions, not client-side randomness. See stepSetup in
  // engine/game.ts.
  const [state, setState] = useState<GameState>(() =>
    createGame({ seats: mkSeats(1, 2), seed: (Math.random() * 1e9) | 0 }),
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
  // during setup, SetupScreen resolves bot turns itself (the same lucky-wheel spin a human's
  // "Random" button runs, just auto-triggered) so the pick is actually watchable — this timer
  // stays out of it entirely and only drives bot turns in a real, started game
  const isWaitingOnBot =
    !state.setup && !animLive && !state.gameOver && !needPassGate && seats[waitingOn(state)] === "bot";

  // --- state transitions -------------------------------------------------
  const clearStaging = () => {
    setArmed(new Set());
    setCombatSel(new Set());
    setAttackTarget(null);
  };
  function dispatch(a: Action) {
    const r = applyAction(state, a);
    if (r.ok) {
      let anim = deriveMoveAnim(state, r.state, phaseMs, moveAnim);
      // coasting ends the move without a burn — slide the held drift to its target
      if (!anim && a.type === "endMove" && moveAnim?.kind === "drift" && moveAnim.playerId === state.activePlayerIndex) {
        anim = coastAnim(moveAnim);
      }
      playAnim(anim);
      setState(r.state);
      clearStaging();
      if (a.type === "drawBooster" && p) {
        const before = new Set(p.hand.map((c) => c.id));
        const after = r.state.players[state.activePlayerIndex]!.hand;
        setNewCardIds(new Set(after.filter((c) => !before.has(c.id)).map((c) => c.id)));
      } else {
        setNewCardIds(new Set());
      }
      // setup just finished (the last pickShip finalized into a real game) — start fresh
      // on the pass-gate so the very first real turn doesn't immediately ask to "pass"
      if (state.setup && !r.state.setup) setShownPlayer(r.state.activePlayerIndex);
    } else console.warn("rejected", a, r.error);
  }
  function dispatchBurn(burn: Extract<Action, { type: "burn" }>) {
    // reserve-fuel cards are no longer staged here — they're played (and their fuel
    // banked) the instant they're clicked, via useReserveFuel — only engine cards arm.
    const engineBoosters = p!.hand.filter((c) => c.type === "engine" && armed.has(c.id)).map((c) => c.id);
    dispatch(engineBoosters.length ? { ...burn, engineBoosters } : burn);
  }
  /** (re)start setup fresh — a new interactive game, base/ship all unpicked */
  function openSetup(h = humans, b = bots) {
    setHumans(h);
    setBots(b);
    const seatArr = mkSeats(h, b);
    setSeats(seatArr);
    setRawNames(rawNamesFor(seatArr));
    const g = createGame({ seats: seatArr, seed: (Math.random() * 1e9) | 0 });
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
      const next = stepBot(state, botRng.current);
      let anim = deriveMoveAnim(state, next, phaseMs, moveAnim);
      if (!anim && moveAnim?.kind === "drift") anim = coastAnim(moveAnim); // bot coasted out of the drift
      playAnim(anim);
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
    !animLive &&
    !state.gameOver &&
    !needPassGate &&
    !activeIsBot &&
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
      s = { ...s, pendingEquipment: { playerId: s.activePlayerIndex, cards: s.decks.equipment.draw.slice(0, 3) } };
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
    revealTurn,
    toggleArmed: toggle(setArmed),
    toggleCombatSel: toggle(setCombatSel),
    setAttackTarget,
  };
}

export type Session = ReturnType<typeof useSession>;
