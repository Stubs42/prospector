/**
 * React glue over engine + client-core. Owns the game / seat / staging state and the two
 * timers (bot autoplay, forced-move auto-advance). A non-React front-end would replace just
 * this file; `client/` and `engine/` are untouched.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { applyAction, createGame } from "../engine/index.js";
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

const ALL_COLOURS: Colour[] = ["black", "red", "blue", "white", "green", "yellow"];

const AUTO_HIDE = new Set<Action["type"]>([
  "declineCounter",
  "discardBooster",
  "combatDefend",
  "combatResolve",
]);

export function useSession(prefs: Prefs, reducedMotion: boolean) {
  const [humans, setHumans] = useState(1);
  const [bots, setBots] = useState(2);
  const [seats, setSeats] = useState<Seat[]>(() => mkSeats(1, 2));
  const [state, setState] = useState<GameState>(() =>
    createGame({ colours: ALL_COLOURS.slice(0, 3), seed: (Math.random() * 1e9) | 0 }),
  );
  const [shownPlayer, setShownPlayer] = useState(state.activePlayerIndex);
  const [setupOpen, setSetupOpen] = useState(true);
  const [humanPicks, setHumanPicks] = useState<Colour[]>([]);
  const [armed, setArmed] = useState<Set<string>>(new Set());
  const [combatSel, setCombatSel] = useState<Set<string>>(new Set());
  const [attackTarget, setAttackTarget] = useState<number | null>(null);
  // moveAnim: an in-flight (or a held, frozen-at-reach drift) move. animLive: an rAF is actually running.
  const [moveAnim, setMoveAnim] = useState<MoveAnim | null>(null);
  const [animLive, setAnimLive] = useState(false);
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

  const p = state.players[state.activePlayerIndex]!;

  const armedEngine = p.hand
    .filter((c) => c.type === "engine" && armed.has(c.id))
    .reduce((a, c) => a + (c.value ?? 0), 0);
  const armedFuel = p.hand
    .filter((c) => c.type === "reserveFuel" && armed.has(c.id))
    .reduce((a, c) => a + (c.value ?? 0), 0);

  const afford = useMemo(
    () => affordances(state, { extraEngines: armedEngine, extraFuel: armedFuel }),
    [state, armedEngine, armedFuel],
  );

  const humansCount = humansIn(seats);
  const activeIsBot = activeIsBotOf(state, seats);

  const needPassGate =
    humansCount >= 2 && !state.gameOver && !activeIsBot && shownPlayer !== state.activePlayerIndex;
  const isWaitingOnBot =
    !setupOpen && !animLive && !state.gameOver && !needPassGate && seats[waitingOn(state)] === "bot";

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
    } else console.warn("rejected", a, r.error);
  }
  function dispatchBurn(burn: Extract<Action, { type: "burn" }>) {
    const engineBoosters = p.hand.filter((c) => c.type === "engine" && armed.has(c.id)).map((c) => c.id);
    const reserveFuelBoosters = p.hand
      .filter((c) => c.type === "reserveFuel" && armed.has(c.id))
      .map((c) => c.id);
    dispatch(
      engineBoosters.length || reserveFuelBoosters.length
        ? { ...burn, engineBoosters, reserveFuelBoosters }
        : burn,
    );
  }
  function openSetup(h = humans, b = bots) {
    setHumans(h);
    setBots(b);
    setSeats(mkSeats(h, b));
    setHumanPicks([]);
    setSetupOpen(true);
  }
  function startGame(colourOrder: Colour[]) {
    const g = createGame({ colours: colourOrder, seed: (Math.random() * 1e9) | 0 });
    setSeats(mkSeats(humans, bots));
    setState(g);
    setShownPlayer(g.activePlayerIndex);
    botRng.current = makeRng((Math.random() * 1e9) | 0);
    setHumanPicks([]);
    setSetupOpen(false);
  }
  function pickShip(colour: Colour) {
    const picks = [...humanPicks, colour];
    if (picks.length < humans) {
      setHumanPicks(picks);
      return;
    }
    const remaining = ALL_COLOURS.filter((c) => !picks.includes(c));
    for (let i = remaining.length - 1; i > 0; i--) {
      const j = (Math.random() * (i + 1)) | 0;
      [remaining[i], remaining[j]] = [remaining[j]!, remaining[i]!];
    }
    startGame([...picks, ...remaining.slice(0, bots)]);
  }
  const revealTurn = () => setShownPlayer(state.activePlayerIndex);
  const toggle = (setter: typeof setArmed) => (id: string) =>
    setter((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });

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
    !setupOpen &&
    !animLive &&
    !state.gameOver &&
    !needPassGate &&
    !activeIsBot &&
    autoCandidates.length === 1 &&
    autoCandidates[0]!.type !== "scrapShip"
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
    if (qs.get("skipsetup") === "1" && !n) {
      setSeats(Array<Seat>(state.players.length).fill("human"));
      setShownPlayer(state.activePlayerIndex);
      setSetupOpen(false);
      return;
    }
    if (!n) return;
    const rng = makeRng(1);
    let s = state;
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
    setState(s);
    setShownPlayer(s.activePlayerIndex);
    setSeats(Array<Seat>(s.players.length).fill("human"));
    setSetupOpen(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    state,
    seats,
    humans,
    bots,
    setup: { open: setupOpen, picks: humanPicks },
    staging: { armed, combatSel, attackTarget },
    afford,
    activeIsBot,
    isWaitingOnBot,
    needPassGate,
    driftGhost,
    burnPreviewFor,
    moveAnim,
    animLive,
    endMoveAnim: endAnim,
    dispatch,
    dispatchBurn,
    openSetup,
    pickShip,
    pickBase: pickShip,
    revealTurn,
    toggleArmed: toggle(setArmed),
    toggleCombatSel: toggle(setCombatSel),
    setAttackTarget,
  };
}

export type Session = ReturnType<typeof useSession>;
