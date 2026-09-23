/**
 * The real, in-progress game — everything App.tsx used to render once state.setup is null.
 * Split out (same reason as SetupScreen) so its hooks (notably the move-log below) can run
 * unconditionally: a component only mounts once state.players is actually populated, so
 * there's no nullable-`p` juggling to do here at all.
 */
import { useEffect, useRef, useState } from "react";
import { score, statsOf } from "../../engine/index.js";
import { waitingOn, decisiveCombat, winProbability } from "../../client/index.js";
import { boardFor } from "../../engine/game.js";
import { hexKey } from "../../engine/hex.js";
import type { BoosterCard, Colour, Hex } from "../../engine/index.js";
import { Board } from "./Board.js";
import { HandPanel, type PanelButton } from "./HandPanel.js";
import { FightBox, type FightBoxProps, type FightTableRow, type CombatCardChip } from "./FightBox.js";
import { EquipmentPopup } from "./EquipmentPopup.js";
import { HexPopup } from "./HexPopup.js";
import { LogOverlay } from "./LogOverlay.js";
import { RulesPopup } from "./RulesPopup.js";
import { Topbar } from "./Topbar.js";
import { StatusPanel } from "./StatusPanel.js";
import { DeckPanels } from "./DeckPanels.js";
import type { Prefs } from "../prefs.js";
import { spinCoordinateDice, SkipGate, type CoordinateSpinPath } from "../spin.js";
import { theme } from "../theme.js";
import type { Session } from "../useSession.js";
import type { GameState, PlayerState } from "../../engine/types.js";

// final ranking for the game-over popup: same total-value score the engine already uses to
// pick winnerIds, but broken into a full ordering — ties broken by counting the most
// valuable ore delivered first, then the next tier down, etc.; a tie that survives every
// tier truly shares the rank, and the rank after a tie is skipped (1, 2, 2, 4 — standard
// competition ranking), not squeezed down to 3.
function rankPlayers(state: GameState, names: string[]) {
  const { values, colours } = state.config.modes.prospector.resources;
  const byValueDesc = [...colours].sort((a, b) => values[b]! - values[a]!); // red, yellow, green
  const rows = state.players.map((p) => {
    const countOf = (c: (typeof colours)[number]) => p.delivered.filter((d) => d === c).length;
    return {
      id: p.id,
      colour: p.colour,
      name: names[p.id] ?? p.colour,
      shipName: state.config.modes.prospector.ships[p.colour].name,
      score: p.delivered.reduce((a, c) => a + values[c]!, 0),
      counts: byValueDesc.map(countOf), // used for the tiebreak, in the same red/yellow/green order
      red: countOf("red"),
      yellow: countOf("yellow"),
      green: countOf("green"),
    };
  });
  rows.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    for (let i = 0; i < a.counts.length; i++) {
      if (b.counts[i] !== a.counts[i]) return b.counts[i]! - a.counts[i]!;
    }
    return 0;
  });
  let rank = 1;
  return rows.map((row, i) => {
    if (i > 0) {
      const prev = rows[i - 1]!;
      const tied = prev.score === row.score && prev.counts.every((v, j) => v === row.counts[j]);
      if (!tied) rank = i + 1;
    }
    return { ...row, rank };
  });
}

/** how many lines of "what happened this move" the status panel keeps before trimming */
const MOVE_LOG_CAP = 10;

/** the 6 coordinate-die colours, in the fixed order the wheel-spin candidates are laid out */
const ALL_COLOURS: Colour[] = ["black", "red", "blue", "white", "green", "yellow"];

export function GameScreen({
  s,
  prefs,
  setPrefs,
  reducedMotion,
}: {
  s: Session;
  prefs: Prefs;
  setPrefs: (p: Prefs) => void;
  reducedMotion: boolean;
}) {
  const [logOpen, setLogOpen] = useState(false);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [scrapConfirmOpen, setScrapConfirmOpen] = useState(
    () => typeof location !== "undefined" && new URLSearchParams(location.search).get("scrap") === "1",
  );

  const { state, seats, afford, activeIsBot, isWaitingOnBot, needPassGate, driftGhost } = s;
  const { armed, combatSel, attackTarget } = s.staging;
  const dispatch = s.dispatch;

  const pc = state.pendingCombat;
  const p = state.players[state.activePlayerIndex]!;
  const board = boardFor(state);
  const mode = state.config.modes.prospector;
  const sc = score(state);

  // whichever "everything's already decided, this is just cosmetic suspense" animation is
  // currently playing (resource placement, the combat dice reveal) — clicking anywhere on
  // the board fast-forwards it straight to its already-known result, see spin.ts's SkipGate
  const skipGateRef = useRef<SkipGate | null>(null);
  const onSkipAnimation = () => skipGateRef.current?.skip();

  // --- resource placement reveal: initial game-open seeding AND every later re-seed -------
  // (a homecoming delivery seeds one new tile per resource delivered — see arriveHomeBaseIfAny
  // in engine/game.ts) share the exact same "system is placing a tile" animation. The engine
  // already placed each tile atomically the instant it happened; this only replays its own
  // coordinate-dice roll (resourceSeeded log entries) as three separate spins: a rotating
  // mark cycles around the origin and settles on a point (a dot), then cycles around THAT dot
  // and settles on a second dot, then cycles around THAT dot and settles on the final cell —
  // never showing all 6 candidates at once, just the live mark, a line back to its round's
  // center, and the growing dot-and-line path behind it. The whole path disappears the
  // instant the tile is actually placed. Detected by watching state.log.length grow (like the
  // combat-dice reveal below), not just once at mount, so it also fires for a mid-game
  // re-seed — nobody's turn while it plays — "the system" is doing this — so the normal
  // auto-draw/bot timers are held off the whole time (see useSession's holdAdvance) and the
  // status panel shows a placeholder identity.
  // how much of the log has already been turned into a finished reveal — React STATE, not a
  // ref: a ref would advance the instant the effect body below runs, even if that particular
  // run gets torn down right away (react-strict-mode's dev-only double-invoke of a fresh
  // effect does exactly this) — leaving the *next* (kept) run seeing nothing left to animate
  // and the whole reveal stuck on whatever single tick the aborted run managed to draw. State
  // only advances once a run actually finishes uncancelled, so a StrictMode remount just
  // replays the same batch from scratch instead of silently dropping it.
  //
  // Lazy-initialized from the CURRENT log length, not a literal 0 — this is only a "replay
  // what happened since I've been watching" cursor, never "replay this game's entire history
  // from turn 1." A literal 0 start (found live) meant every page refresh — the log already
  // has every resourceSeeded entry from the whole game in it by then — replayed the full
  // history of reveals from scratch, several seconds each, with holdAdvance keeping the game
  // frozen for all of it: a refresh looked like it did nothing, because functionally it undid
  // nothing except cost the player minutes of forced animation before they got control back.
  const [seedProcessed, setSeedProcessed] = useState(() => state.log.length);
  // cells that are ALREADY placed in real engine state but not yet revealed on screen —
  // hidden from `displayState` below until their own spin lands (initial seeding hides
  // every starting tile at once; a homecoming re-seed only ever hides the 1-2 new ones,
  // every pre-existing tile on the board stays visible the whole time)
  const [hiddenSeeds, setHiddenSeeds] = useState<Set<string>>(new Set());
  const [spinPath, setSpinPath] = useState<CoordinateSpinPath | null>(null);
  // starts false, not "did this game ever have a resourceSeeded entry" — that was almost
  // always true (any game past its opening seed) and, combined with the seedProcessed==0 bug
  // above, meant a fresh mount could get stuck showing "Placing resources" indefinitely if the
  // reveal effect below ever bailed out early without reaching its own setPlacing(false). The
  // effect reactively flips this true itself the moment it finds real unprocessed entries.
  const [placing, setPlacing] = useState(false);
  useEffect(() => {
    const newEntries = state.log.slice(seedProcessed).filter((l) => l.event === "resourceSeeded");
    if (newEntries.length === 0) return;
    setHiddenSeeds(
      new Set(newEntries.map((e) => hexKey((e.detail as { cell: Hex }).cell))),
    );
    setPlacing(true);
    s.setHoldAdvance(true);
    let cancelled = false;
    (async () => {
      for (const entry of newEntries) {
        // a fresh gate per tile — skipping this one's reveal must not also fast-forward
        // every tile still queued after it in the same delivery (see spinCoordinateDice's
        // own doc comment — this is the shared 3-round coordinate-dice spin, same one a
        // hyperspace jump reveal uses below)
        const gate = new SkipGate();
        skipGateRef.current = gate;
        const d = entry.detail as { cell: Hex; dice: { step: number; colour: Colour }[] };
        const dice = [...d.dice].sort((a, b) => b.step - a.step); // coarse to fine: ring 3, 2, 1
        await spinCoordinateDice(
          dice,
          (c) => board.directionOf(c),
          ALL_COLOURS,
          setSpinPath,
          () => cancelled,
          gate,
          { reducedMotion, totalMs: theme.spin.resourceDurationMs, startIntervalMs: theme.spin.startIntervalMs, endIntervalMs: theme.spin.endIntervalMs },
        );
        if (cancelled) return;
        await gate.wait(reducedMotion ? 20 : 250); // let the finished path linger a beat
        setHiddenSeeds((h) => {
          const n = new Set(h);
          n.delete(hexKey(d.cell));
          return n;
        });
        setSpinPath(null);
        await gate.wait(reducedMotion ? 20 : 200);
      }
      if (!cancelled) {
        setPlacing(false);
        setSeedProcessed(state.log.length);
        s.setHoldAdvance(false);
      }
    })();
    return () => {
      cancelled = true;
      // whichever tile's gate is current when this effect tears down — no single fixed
      // `gate` to compare against any more now that each tile gets its own
      skipGateRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.log.length, seedProcessed]);

  // --- hyperspace reveal: the exact same 3-round coordinate-dice spin as resource seeding,
  // just landing on the ship's own new position instead of a resource tile. A hyperspaceRoll
  // log entry (a normal burn-phase jump AND a combat-flee both emit the identical shape)
  // already carries the real, already-decided dice — the engine has already committed the
  // ship's new pose to state the instant the jump happened, so without this the ship just
  // silently snapped there with no reveal at all (a real, previously-unbuilt gap — resource
  // seeding got this animation, hyperspace never did). `lastPoseRef` remembers each player's
  // pose as of the PREVIOUS render so the already-landed pose can be held back on screen
  // (via displayState below) until the spin actually catches up to it.
  // same "only replay what happened since I've been watching" fix as seedProcessed above —
  // lazy-initialized from the current log length, not a literal 0
  const [hyperspaceProcessed, setHyperspaceProcessed] = useState(() => state.log.length);
  const [hyperspaceReveal, setHyperspaceReveal] = useState<{ playerId: number; pose: PlayerState["pose"] } | null>(null);
  const lastPoseRef = useRef<Record<number, PlayerState["pose"]>>({});
  useEffect(() => {
    const newEntries = state.log.slice(hyperspaceProcessed).filter((l) => l.event === "hyperspaceRoll");
    if (newEntries.length === 0) return;
    let cancelled = false;
    (async () => {
      for (const entry of newEntries) {
        const d = entry.detail as { player: number; dice: { step: number; colour: Colour }[] };
        const frozen = lastPoseRef.current[d.player];
        if (!frozen) continue; // no known "before" pose to hold on screen — skip rather than crash the reveal
        setHyperspaceReveal({ playerId: d.player, pose: frozen });
        s.setHoldAdvance(true);
        const gate = new SkipGate();
        skipGateRef.current = gate;
        const dice = [...d.dice].sort((a, b) => b.step - a.step); // coarse to fine: ring 3, 2, 1
        await spinCoordinateDice(
          dice,
          (c) => board.directionOf(c),
          ALL_COLOURS,
          setSpinPath,
          () => cancelled,
          gate,
          {
            reducedMotion,
            totalMs: theme.spin.resourceDurationMs,
            startIntervalMs: theme.spin.startIntervalMs,
            endIntervalMs: theme.spin.endIntervalMs,
          },
        );
        if (cancelled) return;
        await gate.wait(reducedMotion ? 20 : 250); // let the landed path linger a beat
        setSpinPath(null);
        setHyperspaceReveal(null);
        await gate.wait(reducedMotion ? 20 : 200);
      }
      if (!cancelled) {
        setHyperspaceProcessed(state.log.length);
        s.setHoldAdvance(false);
      }
    })();
    return () => {
      cancelled = true;
      skipGateRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.log.length, hyperspaceProcessed]);
  // runs after the reveal effect above on the same render (declaration order), so it only
  // ever overwrites lastPoseRef AFTER that effect has already read the still-previous value
  useEffect(() => {
    for (const pl of state.players) lastPoseRef.current[pl.id] = pl.pose;
  });

  const displayState = hiddenSeeds.size || hyperspaceReveal
    ? {
        ...state,
        board: {
          resources: Object.fromEntries(Object.entries(state.board.resources).filter(([k]) => !hiddenSeeds.has(k))),
        },
        players: hyperspaceReveal
          ? state.players.map((pl) => (pl.id === hyperspaceReveal.playerId ? { ...pl, pose: hyperspaceReveal.pose } : pl))
          : state.players,
      }
    : state;

  // --- combat: animated dice reveal ---------------------------------------------------
  // combatResolve already rolled both dice atomically (see engine/game.ts's combatResolve)
  // — this only stages their *reveal*, one at a time (attack settles, then defence), off
  // the exact numbers already logged (attackSucceeded/attackFailed). Nothing about the
  // outcome changes here; holdAdvance just stops the bot timer / auto-actions from racing
  // past the animation once pendingCombat has already moved on (cleared, or to "counter").
  interface CombatReveal {
    attackerId: number;
    defenderId: number;
    attackDie: number;
    defenceDie: number;
    attackTotal: number;
    defenceTotal: number;
    attackerLasers: number;
    defenderShields: number;
    autoRepel: boolean;
    /** the fight round this reveal is for (1 = the original attack, 2+ = a counter-attack) —
       drives the "attacks" vs "counter attacks" wording in the title */
    round: number;
    attackerWins: boolean;
    spoil: string | null;
    attackFace: number;
    attackSettled: boolean;
    defenceFace: number;
    defenceSettled: boolean;
    showOutcome: boolean;
  }
  const [combatReveal, setCombatReveal] = useState<CombatReveal | null>(null);
  // set once the loser of a fight declines to (or can't) counter-attack — the fight is over,
  // but the attacker (always still the one on turn) gets one explicit "Attack Failed" / "End
  // Turn" beat rather than just silently falling back to the ambient "click your ship" cue.
  // Holds the attacker's own playerId (not just a boolean) so this can be shown ONLY on that
  // attacker's own browser online — derived below from the pendingCombat transition itself,
  // not from whichever browser happened to click decline (that used to be the same browser in
  // hot-seat by construction, but online the decliner is a different seat/device entirely).
  const [attackFailedSummary, setAttackFailedSummary] = useState<{ attackerId: number; reason: "declined" | "fled" } | null>(null);
  // watches pendingCombat go from "awaiting a declined/failed counter" to null — every
  // browser (attacker's, decliner's, any spectator's) evaluates this identically off shared
  // state, so the resulting summary always attributes to the real attacker regardless of who
  // dispatched declineCounter.
  const prevPendingCombatRef = useRef(state.pendingCombat);
  useEffect(() => {
    const prev = prevPendingCombatRef.current;
    prevPendingCombatRef.current = state.pendingCombat;
    if (!prev) return;
    if (!state.pendingCombat) {
      if (prev.awaiting === "counter" && prev.lastAttackFailed) {
        setAttackFailedSummary({ attackerId: prev.attackerId, reason: "declined" });
        // the attacker's own combatReveal ("Defence Successful" + Confirm) is local state that
        // only clears when THIS browser clicks its own Confirm — but decline happened on the
        // DEFENDER's browser, so if the attacker hasn't confirmed yet, their stale reveal box
        // would otherwise keep rendering right on top of the new Attack Failed box (found live:
        // "the window showing the dice is displayed above it and I cannot end my turn") — and
        // holdAdvance would stay stuck true forever, since nothing else was ever going to flip
        // it back. The fight has unambiguously ended by now regardless of whether this browser
        // ever acknowledged its own reveal, so both get force-cleared here.
        setCombatReveal(null);
        s.setHoldAdvance(false);
      } else if (prev.awaiting === "defend") {
        // the ONLY way "defend" ever clears to null without ever reaching "resolve" is a
        // successful hyperspace flee (engine/game.ts's combatDefend) — no dice roll happened, so
        // there's no combatReveal to clear here. holdAdvance is deliberately left alone: the
        // hyperspace-reveal effect above is already holding it for the spin animation and will
        // release it itself once that finishes, so the attacker's "Attack Failed" box (gated by
        // `suppress`, same as everything else) naturally waits for the reveal to land first.
        setAttackFailedSummary({ attackerId: prev.attackerId, reason: "fled" });
      }
      return;
    }
    // a NEW round already started (the losing side chose to counter-attack) while this
    // browser's own reveal of the PREVIOUS round was still up — the losing attacker gets no
    // button on that reveal (see fightBox's reveal branch), so nothing else was ever going
    // to dismiss it; without this, that stale "Attack Failed" box would keep covering the
    // new round's own live box (now THEIR turn to defend, roles swapped) indefinitely — found
    // live: "the attacker's box still showed End Fight while the defender was declaring a
    // counter-attack" (a round-1 leftover, not the live round-2 state it should show instead)
    if (prev.round !== state.pendingCombat.round) {
      setCombatReveal(null);
      s.setHoldAdvance(false);
    }
  }, [state.pendingCombat]);
  const combatLogLen = useRef(state.log.length);
  useEffect(() => {
    if (state.log.length <= combatLogLen.current) {
      combatLogLen.current = state.log.length;
      return;
    }
    const entry = state.log[state.log.length - 1]!;
    combatLogLen.current = state.log.length;
    if (entry.event !== "attackSucceeded" && entry.event !== "attackFailed") return;
    const d = entry.detail as {
      attacker: number;
      defender: number;
      attackDie: number;
      defenceDie: number;
      attackTotal: number;
      defenceTotal: number;
      attackerLasers: number;
      defenderShields: number;
      autoRepel: boolean;
      round: number;
      spoil?: string | null;
    };
    // a handicap outside the range any roll could change (see decisiveCombat) makes the
    // dice-cycling reveal pure theatre for an outcome that was never really in question —
    // settle both dice on their real faces immediately instead of spinning through it, same
    // as the reducedMotion path already does
    const skipRollAnimation =
      reducedMotion ||
      decisiveCombat(d.attackerLasers, d.defenderShields, state.config.core.dice.combat, mode.combat.winTest) !== null;
    s.setHoldAdvance(true);
    let cancelled = false;
    const gate = new SkipGate();
    skipGateRef.current = gate;
    setCombatReveal({
      attackerId: d.attacker,
      defenderId: d.defender,
      attackDie: d.attackDie,
      defenceDie: d.defenceDie,
      attackTotal: d.attackTotal,
      defenceTotal: d.defenceTotal,
      attackerLasers: d.attackerLasers,
      defenderShields: d.defenderShields,
      autoRepel: d.autoRepel,
      round: d.round,
      attackerWins: entry.event === "attackSucceeded",
      spoil: d.spoil ?? null,
      attackFace: 1,
      attackSettled: false,
      defenceFace: 1,
      defenceSettled: false,
      showOutcome: false,
    });
    // cycles random faces, ease-out deceleration, landing on `real` on the last tick —
    // same shape as every other lucky-wheel spin, just over 1-6 faces instead of cells.
    // Every wait goes through `gate`, so a click anywhere on the board (onSkipAnimation)
    // jumps straight to the real roll — it was already decided the instant combat
    // resolved, this is purely the reveal.
    const spin = async (real: number, apply: (face: number, settled: boolean) => void): Promise<void> => {
      if (skipRollAnimation) {
        apply(real, true);
        await gate.wait(40);
        return;
      }
      const ticks = 14;
      for (let k = 0; k < ticks; k++) {
        if (cancelled) return;
        const last = k === ticks - 1;
        apply(last ? real : 1 + Math.floor(Math.random() * 6), last);
        const t = k / (ticks - 1);
        await gate.wait(last ? 400 : 40 + t * t * 160);
      }
    };
    (async () => {
      await spin(d.attackDie, (face, settled) =>
        setCombatReveal((cr) => (cr ? { ...cr, attackFace: face, attackSettled: settled } : cr)),
      );
      if (cancelled) return;
      await spin(d.defenceDie, (face, settled) =>
        setCombatReveal((cr) => (cr ? { ...cr, defenceFace: face, defenceSettled: settled } : cr)),
      );
      if (cancelled) return;
      // the reveal itself is done the instant both dice settle — holdAdvance stays true
      // (and combatReveal stays set) until the player explicitly confirms the outcome
      // (see fightBox's Confirm button below), not a fixed timeout
      setCombatReveal((cr) => (cr ? { ...cr, showOutcome: true } : cr));
    })();
    return () => {
      cancelled = true;
      if (skipGateRef.current === gate) skipGateRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.log.length]);

  // an event card's flavour text (engine/events.ts's `eventDrawn` log entry) — shown to every
  // browser the same way spectators already see everything else, briefly, in the "⚙ System"
  // status-panel slot (same slot "Placing resources" uses during setup's resource seeding).
  // Auto-resolving events (pirate-ambush, hyperspace-quake) have no other pause point at all,
  // so without this the flavour text would never be seen — a choice event's own popup (see
  // eventChoiceBox above) additionally stays up until the drawer answers.
  const [eventBanner, setEventBanner] = useState<{ title: string; text: string } | null>(null);
  const eventLogLen = useRef(state.log.length);
  useEffect(() => {
    if (state.log.length <= eventLogLen.current) {
      eventLogLen.current = state.log.length;
      return;
    }
    const drawn = state.log.slice(eventLogLen.current).find((e) => e.event === "eventDrawn");
    eventLogLen.current = state.log.length;
    if (!drawn) return;
    const d = drawn.detail as { title: string; text: string };
    setEventBanner({ title: d.title, text: d.text });
    const id = window.setTimeout(() => setEventBanner(null), reducedMotion ? 300 : 3500);
    return () => window.clearTimeout(id);
  }, [state.log.length, reducedMotion]);

  const anim = s.animLive; // a move is actively playing — hold back prompts/targets
  const suppress = anim || scrapConfirmOpen || placing || !!hyperspaceReveal; // also true while placing / the scrap dialog is up
  // online, only the browser whose own seat is actually active gets an interactive board/
  // popup — everyone else just watches state changes and animations play out (see plan doc:
  // "Gate interactive UI to the deciding player online"). s.isMe is always true offline, so
  // hot-seat behavior is unchanged.
  const interactive = !activeIsBot && !needPassGate && s.isMe(state.activePlayerIndex);
  const overLimit = afford.overLimit;
  // turn 1: the ship must be placed on a base cell before anything else. `needsLaunch` is the
  // plain, ungated fact (used below for the passive status label, which must read the same for
  // every viewer); `launchPhase` additionally requires `interactive` since IT drives the actual
  // clickable popup/highlight, which only the deciding seat should ever see.
  const needsLaunch = !pc && afford.placeCells.length > 0;
  const launchPhase = interactive && needsLaunch;

  // --- start-of-game "random" upgrade: auto-spin, then dispatch chooseEquipment ---------
  // Same "already decided, just cosmetic suspense" lucky-wheel as SetupScreen's own "Random"
  // base/ship picks: cycles the highlight through the 3 candidates, decelerating, and lands
  // on whichever one it's about to dispatch itself — a bot's own "random" (or "select") draw
  // never reaches here at all, it resolves invisibly via the existing stepBot policy, same as
  // any homecoming choice a bot makes today.
  const [equipSpinId, setEquipSpinId] = useState<string | null>(null);
  const equipSpinStarted = useRef(false);
  useEffect(() => {
    const pe = state.pendingEquipment;
    if (!pe || pe.reason !== "start" || pe.mode !== "random" || !interactive) {
      equipSpinStarted.current = false;
      return;
    }
    if (equipSpinStarted.current) return;
    equipSpinStarted.current = true;
    s.setHoldAdvance(true);
    let cancelled = false;
    const gate = new SkipGate();
    skipGateRef.current = gate;
    (async () => {
      const cards = pe.cards;
      const targetIdx = Math.floor(Math.random() * cards.length);
      const ticks = cards.length * 2 + 6; // a couple of laps, then a settling lap onto target
      for (let k = 0; k < ticks; k++) {
        if (cancelled) return;
        const stepsFromEnd = ticks - 1 - k;
        const idx = ((targetIdx - stepsFromEnd) % cards.length + cards.length) % cards.length;
        setEquipSpinId(cards[idx]!.id);
        const last = k === ticks - 1;
        const t = k / (ticks - 1);
        await gate.wait(last ? 450 : 70 + t * t * 260); // ease-out: fast, then slow to a stop
      }
      if (cancelled) return;
      if (skipGateRef.current === gate) skipGateRef.current = null;
      setEquipSpinId(null);
      dispatch({ type: "chooseEquipment", cardId: cards[targetIdx]!.id });
      s.setHoldAdvance(false);
    })();
    return () => {
      cancelled = true;
      if (skipGateRef.current === gate) skipGateRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.pendingEquipment, interactive]);

  // --- hand / combat card helpers -----------------------------------
  // whoever is actually making the current decision — the attacker/mover normally, the
  // *defender* while combat is waiting on them (their shields, their counter-attack call),
  // or the attacker again while the dice reveal plays out (pendingCombat may have already
  // moved on by then, so the reveal snapshot takes priority). Drives the status panel's
  // identity/log — that must always reflect whoever is actually acting, bot included.
  const activeMover = combatReveal
    ? state.players[combatReveal.attackerId]!
    : pc && (pc.awaiting === "defend" || pc.awaiting === "counter")
      ? state.players[pc.defenderId]!
      : p;
  // the hand PANEL's owner: activeMover, unless that's a bot and we're playing solo (one
  // human, the rest bots) — solo, your own hand stays visible the whole time (a real board
  // game's hand doesn't vanish while the other players take their turns), so it falls back
  // to the sole human's hand instead of hiding outright while a bot acts. In real hot-seat
  // (2+ humans) this never applies — another human's hand must stay hidden on a bot's turn
  // exactly like before.
  const soloHumanId = s.humans === 1 ? seats.indexOf("human") : -1;
  const handOwner = seats[activeMover.id] === "bot" && soloHumanId >= 0 ? state.players[soloHumanId]! : activeMover;
  // online, another human's hand is exactly as private as a bot's "hand" always was here —
  // extends the existing hiding rule instead of adding a parallel one, closing both the
  // information leak (seeing someone else's exact cards) and the clickability gap in one line
  const handHidden = seats[handOwner.id] === "bot" || (s.online.status !== "offline" && !s.isMe(handOwner.id));

  // --- status panel: who's doing what, and a running log of their move ---------------
  const actionLabel: string =
    state.gameOver ? "Game over"
    : combatReveal ? "Rolling for combat"
    : pc?.awaiting === "defend" ? "Defending"
    : pc?.awaiting === "resolve" ? "Rolling for combat"
    : pc?.awaiting === "counter" ? "Deciding a counter-attack"
    : attackTarget !== null ? "Attacking"
    : afford.equipmentChoice ? "Choosing an upgrade"
    : overLimit ? "Discarding a card"
    : needsLaunch ? "Picking a launch cell"
    : !p.turn.boosterDrawn ? "Drawing a card"
    : !p.turn.driftDone ? "Drifting"
    : !p.turn.moved ? "Deciding a burn"
    : !p.turn.postMoveActionTaken ? "Deciding next move"
    : "Ending turn";

  // a "move" is one player's whole turn, start to end — combat sub-decisions (the defender's
  // shields, their counter-attack call) happen *within* it, so the log key is the turn owner
  // (activePlayerIndex), not `handOwner`, even though the identity line above can briefly
  // switch to the defender while it's their call
  const [moveLog, setMoveLog] = useState<string[]>([actionLabel]);
  const moveKey = useRef(`${state.turnNumber}-${state.activePlayerIndex}`);
  useEffect(() => {
    const key = `${state.turnNumber}-${state.activePlayerIndex}`;
    if (moveKey.current !== key) {
      moveKey.current = key;
      setMoveLog([actionLabel]);
    } else {
      setMoveLog((log) => (log[log.length - 1] === actionLabel ? log : [...log, actionLabel].slice(-MOVE_LOG_CAP)));
    }
  }, [state.turnNumber, state.activePlayerIndex, actionLabel]);

  const canRefuel = (id: string) => afford.legal.some((a) => a.type === "useReserveFuel" && a.cardId === id);
  // `overLimit` (afford.overLimit) is only ever meaningful for state.activePlayerIndex — a
  // bot's own over-limit moment (before its auto-discard resolves) must never make the
  // solo human's OWN cards look discardable/urgent/dimmed, which the raw overLimit flag
  // used to do throughout this hand-state logic (it doesn't know whose hand it's about).
  // Hoisted above clickableAction/cardState so every check below uses the scoped version.
  const handOwnerOverLimit = overLimit && handOwner.id === state.activePlayerIndex;
  // the click handler a card WOULD get right now, if any — factored out of cardState so
  // "is anything in this hand playable at all" (handHasPlayableCard below) can ask the same
  // question without duplicating the rules
  const clickableAction = (c: BoosterCard): (() => void) | undefined => {
    if (handOwnerOverLimit) return () => dispatch({ type: "discardBooster", cardId: c.id });
    // reserve fuel isn't armed for a later burn — it's used up the instant it's clicked
    if (inBurnPhase && c.type === "reserveFuel" && canRefuel(c.id)) return () => dispatch({ type: "useReserveFuel", cardId: c.id });
    if (inBurnPhase && c.type === "engine") return () => s.toggleArmed(c.id);
    // an alternative to burning, not staged/armed — playing it resolves the jump (and the
    // whole move) immediately, same "used up on click" shape as reserve fuel above
    if (inBurnPhase && c.type === "hyperspace" && afford.legal.some((a) => a.type === "hyperspace" && a.via === "booster" && a.boosterId === c.id))
      return () => dispatch({ type: "hyperspace", via: "booster", boosterId: c.id });
    if (combatCardType && c.type === combatCardType) return () => s.toggleCombatSel(c.id);
    return undefined;
  };
  const cardState = (id: string) => {
    const c = handOwner.hand.find((x) => x.id === id)!;
    const onClick = clickableAction(c);
    const clickable = !!onClick;
    const pulse: "urgent" | "new" | null = handOwnerOverLimit ? "urgent" : s.newCardIds.has(id) ? "new" : null;
    // a card that can't be played dims itself ONLY once something else in the hand can —
    // no point graying out the whole hand when nothing is actionable at all (see
    // handHasPlayableCard below); replaces the old "ready" pulse on the playable card(s)
    // themselves — same information, the other way round
    const dimmed = !clickable && handHasPlayableCard;
    return { clickable, selected: armed.has(id) || combatSel.has(id), onClick, pulse, dimmed };
  };
  // covers the whole move decision, not just "after drift": drift and burn are one decision
  // now (see engine/index.ts's legalActions and engine/game.ts's ensureDrifted), so a reserve-
  // fuel/engine/hyperspace card is clickable from the moment a move could start, not gated
  // behind a driftDone that's now just an internal implementation detail. NOT yet true while
  // the start-of-game upgrade choice is pending (!state.pendingEquipment already covers that
  // interrupt window) — without that check the hand panel would force-open for these cards
  // before there was any real move to use them on.
  const inBurnPhase =
    !activeIsBot && !pc && !state.pendingEquipment && state.phase === "start" && !p.turn.moved && !overLimit;
  const combatCardType: "laser" | "shield" | null =
    pc?.awaiting === "defend" && seats[pc.defenderId] === "human"
      ? "shield"
      : (pc?.awaiting === "counter" && seats[pc.defenderId] === "human") || (!pc && attackTarget !== null)
        ? "laser"
        : null;
  // whether ANY card in this hand could actually be played right now — inBurnPhase/
  // combatCardType being "the right phase" isn't enough on its own if the hand simply
  // doesn't hold a matching card (no engine/reserveFuel during a burn, no laser/shield
  // during combat); auto-expanding the hand for nothing to do there is just noise (see
  // showCards below) and nothing needs dimming either (see cardState above)
  const handHasPlayableCard = handOwner.hand.some((c) => !!clickableAction(c));
  const pickedIds = (type: "laser" | "shield") =>
    handOwner.hand.filter((c) => c.type === type && combatSel.has(c.id)).map((c) => c.id);
  const selSum = (type: "laser" | "shield") =>
    handOwner.hand
      .filter((c) => c.type === type && combatSel.has(c.id))
      .reduce((a, c) => a + (c.value ?? 0), 0);
  const hyperspaceId = state.players[pc?.defenderId ?? -1]?.hand.find((c) => c.type === "hyperspace")?.id;

  // whether THIS hand (not just any hand) has a freshly-drawn card — matters now that
  // handOwner can be the solo human while a bot (whose own draw also touches newCardIds) is
  // the one actually acting; a bot's own new card must never force the human's hand open
  // suppressed while a start-of-game upgrade offer is imminent or already up: the auto-draw
  // -> drift -> equipment-choice chain fires within one short auto-advance tick, so without
  // this the hand would pulse open for the freshly-drawn card and immediately collapse again
  // a moment later as drift consumes p.startEquipment and the (unrelated) equipment popup
  // takes over — a flash the player can't act on either way. p.startEquipment is still set
  // in the brief window between draw and drift; state.pendingEquipment covers the choice
  // itself (same reasoning as inBurnPhase's own pendingEquipment check above).
  const startUpgradeImminent = !!handOwner.startEquipment || !!state.pendingEquipment;
  const handHasNewCard = !startUpgradeImminent && handOwner.hand.some((c) => s.newCardIds.has(c.id));
  const showCards =
    !handHidden &&
    handOwner.hand.length > 0 &&
    (handOwnerOverLimit || ((inBurnPhase || combatCardType !== null) && handHasPlayableCard) || handHasNewCard);
  const cardHint = handOwnerOverLimit
    ? null // the centred hex popup carries this message instead
    : inBurnPhase && p.hand.some((c) => c.type === "engine" || c.type === "reserveFuel" || c.type === "hyperspace")
      ? "Tap an engine card to arm it for this burn, a reserve-fuel card to refuel now, or a hyperspace card to jump instead."
      : combatCardType === "shield"
        ? "Tap shield cards to add to your defence."
        : combatCardType === "laser"
          ? "Tap laser cards to add to your attack."
          : null;

  // --- the ONE fight box -------------------------------------------
  // Everything about a fight — declaring, defending, the dice reveal, a possible counter
  // round with roles swapped, and the final outcome — renders through this single derivation
  // into one FightBox, instead of the three separately-shaped popups this used to be
  // (a live declare/defend/counter box, a completely separate dice-reveal object, and a third
  // "Attack Failed" box). Every browser builds the exact same box off the exact same data;
  // only `buttons` differs by role (empty for anyone who isn't the current decider).
  const fmtPct = (p: number) => `${Math.round(p * 100)}%`;
  const fmtSigned = (n: number) => (n > 0 ? `+${n}` : `${n}`);
  // the six-row stats table — a `null` value renders blank (that stat genuinely isn't known
  // yet), not "0"; `dice` is only ever populated once the actual reveal is playing out.
  const fightRows = (
    lasers: number | null,
    shields: number | null,
    dice: { attack: { value: number; settled: boolean } | null; defence: { value: number; settled: boolean } | null } | null,
    autoRepel: boolean,
  ): FightTableRow[] => {
    const win =
      lasers != null && shields != null
        ? fmtPct(winProbability(lasers, shields, state.config.core.dice.combat, mode.combat.winTest))
        : null;
    const attackTotal = dice?.attack?.settled ? (lasers ?? 0) + dice.attack.value : null;
    const defenceTotal = dice?.defence?.settled ? (shields ?? 0) + dice.defence.value : null;
    return [
      { label: "Lasers", value: lasers != null ? String(lasers) : null },
      { label: "Shields", value: shields != null ? String(shields) : null },
      { label: "Win", value: win },
      {
        label: "Attack",
        value: attackTotal != null ? `${lasers}+${dice!.attack!.value}=${attackTotal}` : null,
        die: dice?.attack ? { value: dice.attack.value, tone: "attack" } : null,
      },
      {
        label: "Defend",
        value: defenceTotal != null ? `${shields}+${dice!.defence!.value}=${defenceTotal}${autoRepel ? " (auto-repel)" : ""}` : null,
        die: dice?.defence ? { value: dice.defence.value, tone: "defence" } : null,
      },
      { label: "Result", value: attackTotal != null && defenceTotal != null ? fmtSigned(attackTotal - defenceTotal) : null },
    ];
  };
  const fightTitle = (attackerId: number, defenderId: number, isCounter: boolean): string =>
    `${mode.ships[state.players[attackerId]!.colour].name} ${isCounter ? "counter attacks" : "attacks"} ${
      mode.ships[state.players[defenderId]!.colour].name
    }`;

  // declining a counter-attack reads as two different real moves depending on WHO declines:
  // the on-turn player (the original attacker, having just defended a counter) is genuinely
  // ending their own turn; the off-turn player (the original defender, done retaliating) is
  // just stepping back from the fight and handing control back — the attacker still gets
  // their own explicit "Attack Failed" / "End Turn" beat once that happens, derived from the
  // pendingCombat transition above (attackFailedSummary), not set here directly — the browser
  // that clicks decline is the DEFENDER's, not necessarily the attacker's who needs to see it.
  const declineIsOnTurn = pc ? pc.defenderId === state.activePlayerIndex : false;
  const onDeclineCounter = () => dispatch({ type: "declineCounter" });

  // combat's real decider is whichever seat pendingCombat.awaiting is actually asking —
  // attacker while resolving/rolling, defender otherwise — not always state.activePlayerIndex
  // (a counter-attack round swaps the roles). Online, only that seat's own browser gets real
  // buttons; everyone else sees the box (table, message) with nothing to click.
  const myDecision = s.isMe(waitingOn(state));
  const hasLaserCard = (playerId: number) => state.players[playerId]?.hand.some((c) => c.type === "laser") ?? false;
  const hasShieldOrHyperCard = (playerId: number) =>
    state.players[playerId]?.hand.some((c) => c.type === "shield" || c.type === "hyperspace") ?? false;

  // a staged laser/shield leaves the hand row entirely and shows up here instead — clicking
  // it here (instead of in hand) is the undo: back into combatSel-less, back into the hand row
  const combatCards: CombatCardChip[] = combatCardType
    ? handOwner.hand
        .filter((c) => c.type === combatCardType && combatSel.has(c.id))
        .map((c) => ({ id: c.id, type: combatCardType, value: c.value ?? 0, onClick: () => s.toggleCombatSel(c.id) }))
    : [];

  let fightBox: FightBoxProps | null = combatReveal
    ? // the dice reveal (or its settled outcome) — takes priority over the live `pc` state,
      // since pc may already have moved on (to "counter", or cleared entirely) while this
      // browser's own local animation is still catching up
      (() => {
        const iAmAttacker = s.isMe(combatReveal.attackerId);
        const defenderIsDeciding =
          myDecision && !combatReveal.attackerWins && seats[combatReveal.defenderId] === "human";
        const message: string[] | null = !combatReveal.showOutcome
          ? null
          : combatReveal.attackerWins
            ? iAmAttacker
              ? combatReveal.spoil
                ? [
                    "Attack Succeeded",
                    `Bounty: ${combatReveal.spoil} ore [${state.players[combatReveal.attackerId]!.cargo.length}/${
                      statsOf(state, state.players[combatReveal.attackerId]!).cargo
                    }]`,
                  ]
                : ["Attack Succeeded", "Nothing to loot (empty hold)"]
              : s.isMe(combatReveal.defenderId)
                ? combatReveal.spoil
                  ? [
                      "Defended",
                      `Lost ${combatReveal.spoil} ore [${state.players[combatReveal.defenderId]!.cargo.length}/${
                        statsOf(state, state.players[combatReveal.defenderId]!).cargo
                      }]`,
                    ]
                  : ["Defended", "Nothing lost"]
                : combatReveal.spoil
                  ? ["Attack Succeeded", `Bounty: ${combatReveal.spoil} ore`]
                  : ["Attack Succeeded", "Nothing to loot (empty hold)"]
            : [iAmAttacker ? "Attack Failed" : "Defence Successful"];
        return {
          title: fightTitle(combatReveal.attackerId, combatReveal.defenderId, combatReveal.round > 1),
          rows: fightRows(
            combatReveal.attackerLasers,
            combatReveal.defenderShields,
            { attack: { value: combatReveal.attackFace, settled: combatReveal.attackSettled }, defence: combatReveal.attackSettled ? { value: combatReveal.defenceFace, settled: combatReveal.defenceSettled } : null },
            combatReveal.autoRepel,
          ),
          message,
          cards: [],
          // the outcome sits on screen until explicitly acknowledged. A loss goes straight to
          // the REAL counter-attack/end-fight choice for the defender's own browser (reusing
          // the same buttons the live "counter" phase below would build); the attacker gets
          // NO buttons at all on a loss — just waits, same as the spec asks — since the fight
          // isn't over yet and there's nothing for them to decide. Every OTHER viewer (a win,
          // or a spectator watching someone else's loss) gets their own local Confirm to
          // dismiss their own copy — never a dispatch, so nobody needs to wait on anyone
          // else's click; a stale reveal force-clears on its own once the real state moves on
          // regardless (see the pendingCombat-watching effect above).
          buttons: !combatReveal.showOutcome
            ? []
            : defenderIsDeciding
              ? [
                  ...(afford.counterAttack
                    ? [
                        {
                          label: `Counter-attack${pickedIds("laser").length ? ` (+${selSum("laser")})` : ""}`,
                          kind: "danger" as const,
                          onClick: () => {
                            setCombatReveal(null);
                            s.setHoldAdvance(false);
                            dispatch({ ...afford.counterAttack!, laserBoosters: pickedIds("laser") });
                          },
                        },
                      ]
                    : []),
                  {
                    label: declineIsOnTurn ? "End Turn" : "End Fight",
                    onClick: () => {
                      setCombatReveal(null);
                      s.setHoldAdvance(false);
                      onDeclineCounter();
                    },
                  },
                ]
              : !combatReveal.attackerWins && iAmAttacker
                ? []
                : [
                    {
                      label: "Confirm",
                      kind: "primary" as const,
                      onClick: () => {
                        setCombatReveal(null);
                        s.setHoldAdvance(false);
                      },
                    },
                  ],
        };
      })()
    : pc && pc.awaiting === "counter"
      ? // the new attacker (the original defender) deciding whether to counter at all, and if
        // so with which lasers — same local declare-then-dispatch staging the original attack
        // used, just role-swapped; the table resets to blank (a fresh round hasn't happened
        // yet), and this counter-declare is ALWAYS a real choice — a defender who currently
        // holds no laser cards can still counter-attack bare-handed, so unlike the plain
        // "add lasers" declare step below, this never auto-skips.
        {
          title: fightTitle(pc.defenderId, pc.attackerId, true),
          rows: fightRows(null, null, null, false),
          message: null,
          cards: combatCards,
          buttons:
            myDecision && seats[pc.defenderId] === "human"
              ? [
                  ...(afford.counterAttack
                    ? [
                        {
                          label: `Counter-attack${pickedIds("laser").length ? ` (+${selSum("laser")})` : ""}`,
                          kind: "danger" as const,
                          onClick: () => dispatch({ ...afford.counterAttack!, laserBoosters: pickedIds("laser") }),
                        },
                      ]
                    : []),
                  { label: declineIsOnTurn ? "End Turn" : "End Fight", onClick: onDeclineCounter },
                ]
              : [],
        }
      : pc
        ? // defend or resolve — shared, everyone-sees-it box. The attacker's lasers are
          // technically fixed the instant `pc` exists (the "attack" action bundles them),
          // but withheld from the table until the defender has actually committed — the
          // defender's shield/flee decision must be made blind to the attacker's real
          // total, not with it already spoiled in the same box they're deciding from.
          {
            title: fightTitle(pc.attackerId, pc.defenderId, pc.round > 1),
            rows: fightRows(
              pc.awaiting === "defend" ? null : (afford.combat?.attackLasers ?? null),
              pc.defShields ?? null,
              null,
              false,
            ),
            message:
              pc.awaiting === "defend" && myDecision && seats[pc.defenderId] === "human" && hasShieldOrHyperCard(pc.defenderId)
                ? "Optionally add shield boosters or Hyperspace, then Defend."
                : null,
            cards: combatCards,
            buttons:
              myDecision && pc.awaiting === "defend" && seats[pc.defenderId] === "human" && hasShieldOrHyperCard(pc.defenderId)
                ? [
                    {
                      label: `Defend${pickedIds("shield").length ? ` (+${selSum("shield")})` : ""}`,
                      kind: "primary" as const,
                      onClick: () => dispatch({ type: "combatDefend", shieldBoosters: pickedIds("shield") }),
                    },
                    ...(hyperspaceId
                      ? [{ label: "Flee (hyperspace)", onClick: () => dispatch({ type: "combatDefend", hyperspaceBoosterId: hyperspaceId }) }]
                      : []),
                  ]
                : [],
          }
        : attackTarget !== null && hasLaserCard(state.activePlayerIndex)
          ? // the very first step: local to the attacker's own browser only — nothing is
            // broadcast (pendingCombat doesn't exist yet), same as any other pre-dispatch
            // staging in this app (armed engine cards, staged shields/lasers everywhere
            // else). Skipped entirely (see the auto-fire effect below) when there's no
            // laser card to even consider — straight to the shared box existing already
            // past this step.
            {
              title: `Attacking ${mode.ships[state.players[attackTarget]!.colour].name}`,
              rows: fightRows(null, null, null, false),
              message: "Optionally add laser boosters, then click Attack.",
              cards: combatCards,
              buttons: [
                {
                  label: `Attack${pickedIds("laser").length ? ` (+${selSum("laser")})` : ""}`,
                  kind: "danger" as const,
                  onClick: () => dispatch({ type: "attack", targetPlayerId: attackTarget, laserBoosters: pickedIds("laser") }),
                },
                { label: "Cancel", onClick: () => s.setAttackTarget(null) },
              ],
            }
          : null;

  // auto-fire when there's nothing left to decide — mirrors the decisive-resolve pattern:
  // no laser card at all to consider means the "declare" step is pure ceremony, so it's
  // skipped rather than asking for a pointless Attack click
  useEffect(() => {
    if (attackTarget === null || pc || hasLaserCard(state.activePlayerIndex)) return;
    const id = setTimeout(() => dispatch({ type: "attack", targetPlayerId: attackTarget, laserBoosters: [] }), reducedMotion ? 30 : 220);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, attackTarget, reducedMotion]);
  // same idea for the defender's shield step — no shield/hyperspace card means "Defend" was
  // never a real decision either
  useEffect(() => {
    if (!pc || pc.awaiting !== "defend" || !myDecision || suppress) return;
    if (seats[pc.defenderId] !== "human" || hasShieldOrHyperCard(pc.defenderId)) return;
    const id = setTimeout(() => dispatch({ type: "combatDefend", shieldBoosters: [] }), reducedMotion ? 30 : 220);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, pc, myDecision, suppress, reducedMotion]);
  // the dice roll is never a manual click — once the defender has committed (or auto-
  // skipped, above), roll automatically; the reveal box that follows (with its own real
  // Confirm/next-step buttons) is where the player actually interacts, not this step
  useEffect(() => {
    if (!pc || pc.awaiting !== "resolve" || !myDecision || suppress) return;
    if (!(seats[pc.attackerId] === "human" || seats[pc.defenderId] === "human")) return;
    const id = setTimeout(() => dispatch({ type: "combatResolve" }), reducedMotion ? 30 : 260);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, myDecision, suppress, reducedMotion]);

  // the fight is fully over and it was the OFF-turn player who called it off (End Fight) —
  // the on-turn attacker gets one explicit "Attack Failed" / "End Turn" beat, folded into the
  // SAME fight-box shape (a blank table, just the message + End Turn) instead of a separate
  // popup type. Visible to EVERY browser (so a spectator, or the defender who just declined,
  // can still see why the fight ended — same "box for everyone, real button only for the
  // decider" split the rest of this box already uses), not just the attacker's own —
  // attackFailedSummary holds THEIR playerId regardless (see its declaration), used only to
  // gate the End Turn button, not the box's visibility. Only takes over once nothing else
  // (a live fight, a reveal) is already claiming the box.
  if (!fightBox && attackFailedSummary !== null) {
    fightBox = {
      title: "Fight over",
      rows: fightRows(null, null, null, false),
      message:
        attackFailedSummary.reason === "fled" ? ["Attack Failed", "The defender escaped via hyperspace."] : ["Attack Failed"],
      cards: [],
      buttons: s.isMe(attackFailedSummary.attackerId)
        ? [
            {
              label: "End Turn",
              kind: "primary" as const,
              onClick: () => {
                setAttackFailedSummary(null);
                dispatch({ type: "endTurn" });
              },
            },
          ]
        : [],
    };
  }
  // a spectator's/defender's own browser never clicks the End Turn button above (that's only
  // ever the attacker's), so without this their local attackFailedSummary would sit there
  // forever even once the attacker's real endTurn has already broadcast and moved play on —
  // clear it the instant the turn actually changes away from that attacker, on every browser
  useEffect(() => {
    if (attackFailedSummary !== null && state.activePlayerIndex !== attackFailedSummary.attackerId) {
      setAttackFailedSummary(null);
    }
  }, [state.activePlayerIndex, attackFailedSummary]);

  // an event card (drawn from the booster deck, see engine/events.ts) paused mid-resolve,
  // waiting on the drawer to pick an option — same family as attackFailedBox/equipBox, gated
  // to the drawer's own browser the same way (pendingEventChoice.playerId is always the
  // drawer today; events never ask a non-active player anything)
  const eventChoiceBox =
    state.pendingEventChoice && s.isMe(state.pendingEventChoice.playerId)
      ? {
          lines: [state.pendingEventChoice.prompt],
          actions: state.pendingEventChoice.options.map((o) => ({
            label: o.label,
            ...(o.id === "skip" ? {} : { kind: "primary" as const }),
            onClick: () => dispatch({ type: "resolveEventChoice", optionId: o.id }),
          })),
        }
      : null;

  // the equipment popup replaces the plain guidance popup while a choice (homecoming, or the
  // start-of-game upgrade) is pending for the deciding human — a bot's own pending choice of
  // either kind never reaches here, it resolves invisibly via stepBot's greedy policy
  const equipBox =
    interactive && afford.equipmentChoice
      ? {
          title:
            afford.equipmentChoice.reason === "homecoming"
              ? "Delivered — choose an upgrade"
              : afford.equipmentChoice.mode === "random"
                ? "Rolling for a starting upgrade…"
                : "Choose a starting upgrade",
          options: afford.equipmentChoice.cards.map((c) => ({
            id: c.id,
            stat: c.stat,
            amount: c.amount,
            // a maxed stat's card is filtered out of afford.legal (see legalActions) but
            // still shown here, dimmed — the offer isn't rewritten to hide it
            disabled: !afford.legal.some((a) => a.type === "chooseEquipment" && a.cardId === c.id),
          })),
          spinningId: equipSpinId,
          // no onChoose while the random spin is animating — it's not clickable, just a reveal
          onChoose:
            afford.equipmentChoice.reason === "start" && afford.equipmentChoice.mode === "random"
              ? undefined
              : (id: string) => dispatch({ type: "chooseEquipment", cardId: id }),
          // same "no interaction while spinning" rule applies to the reroll button
          canReroll:
            afford.canRerollEquipment &&
            !(afford.equipmentChoice.reason === "start" && afford.equipmentChoice.mode === "random"),
          onReroll: () => dispatch({ type: "rerollEquipment" }),
        }
      : null;

  // --- board-native action targets ---------------------------------
  // Every clickable option is shown on the thing it acts on, pulsing gently, rather than as
  // a separate button: a resource pulses when loadable, an enemy ship pulses when attackable,
  // and your own ship pulses to end the turn. An action about to auto-fire on its own
  // (drawBooster, drift, a forced endTurn, ...) never gets a pulse first — that would just be
  // a flash before it vanishes again.
  const autoPendingType = s.autoAction?.type ?? null;
  const noStagingPending = !pc && attackTarget === null;

  // "coast" (endMove) is the green circle on the ship's own cell, mid-move
  const coastAction =
    interactive && noStagingPending && !overLimit && autoPendingType !== "endMove"
      ? afford.plainActions.find((a) => a.type === "endMove") ?? null
      : null;
  const onCoast = coastAction ? () => dispatch(coastAction) : null;

  // post-move: load a resource (pulses the ore chip), attack (pulses the enemy ring),
  // end turn (pulses your own ring) — all can be available at once
  const boardActive = interactive && noStagingPending && !suppress;
  const endTurnAction = boardActive ? afford.plainActions.find((a) => a.type === "endTurn") ?? null : null;
  const endTurnReady = !!endTurnAction && autoPendingType !== "endTurn";
  const onEndTurn = endTurnAction ? () => dispatch(endTurnAction) : null;

  // --- board affordances ------------------------------------------
  const highlight: { cells: Hex[]; kind: "place" | "base" | null } = afford.placeCells.length
    ? { cells: afford.placeCells, kind: "place" }
    : { cells: [], kind: null };
  // loadable resources pulse the ore chip itself instead of a separate ring
  const loadCellsForBoard = boardActive ? afford.loadCells : [];
  const attackTargets = boardActive ? afford.attackTargetIds : [];
  const onAttackTarget = (id: number) => s.setAttackTarget(id);

  // guidance popup: where the next action is, and what it is — a fixed overlay (see
  // HexPopup's note), not anchored to any board cell any more
  const popup: { lines: string[] } | null = launchPhase
    ? { lines: ["Select your", "launch cell"] }
    : interactive && overLimit
      ? { lines: ["Too many cards!", "Discard one to continue"] }
      : null;

  // clicking your own base (off a burn target) asks to scrap — available any time during the move
  const scrapCells = interactive && !pc && attackTarget === null && !launchPhase ? board.baseCells(p.homeBase) : [];
  const scrapConfirm =
    scrapConfirmOpen && scrapCells.length
      ? {
          lines: ["So you really want to", "scrap your ship?"],
          onYes: () => {
            dispatch({ type: "scrapShip" });
            setScrapConfirmOpen(false);
          },
          onCancel: () => setScrapConfirmOpen(false),
        }
      : null;

  // space cancels the scrap confirm — Cancel is the safe default
  useEffect(() => {
    if (!scrapConfirm) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.code === "Space" || e.key === " ") {
        e.preventDefault();
        scrapConfirm.onCancel();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [scrapConfirm]);

  function onCell(h: Hex) {
    const k = hexKey(h);
    if (afford.placeCells.some((c) => hexKey(c) === k)) return dispatch({ type: "placeShip", cell: h });
    if (afford.loadCells.some((c) => hexKey(c) === k)) return dispatch({ type: "loadResource", from: h });
    // the free "stay here" cell (drifted or not — see engine/index.ts's legalActions) is its
    // own board element with its own click handler (the coast ring, wired to onCoast below),
    // not routed through here
    const bt = afford.burnTargets.find((b) => hexKey(b.cell) === k);
    if (bt) return s.dispatchBurn({ type: "burn", path: bt.path });
    // your own base, and not a burn target right now (arriving home is not scrapping)
    if (scrapCells.some((c) => hexKey(c) === k)) setScrapConfirmOpen(true);
  }

  // "which seat is actually me" — online, that's the seat the server assigned this
  // connection; offline it's only ever well-defined for a solo human (soloHumanId, computed
  // above) — a shared hot-seat device has no single fixed "you" to remind, so this stays
  // null there and the header shows nothing extra, same as always
  const myPlayerId = s.online.status !== "offline" ? s.online.playerIndex : soloHumanId >= 0 ? soloHumanId : null;
  const myIdentity =
    myPlayerId != null && state.players[myPlayerId]
      ? {
          colour: state.players[myPlayerId]!.colour,
          playerName: s.names[myPlayerId] ?? "Player",
          shipName: mode.ships[state.players[myPlayerId]!.colour].name,
        }
      : null;

  return (
    <div className="app board-only">
      <Topbar
        s={s}
        prefs={prefs}
        setPrefs={setPrefs}
        turnLabel={`turn ${state.turnNumber}`}
        identity={myIdentity}
        onOpenLog={() => setLogOpen(true)}
        onOpenRules={() => setRulesOpen(true)}
      />

      <div className="stage">
        <Board
          state={displayState}
          seats={seats}
          names={s.names}
          scores={sc.byPlayer}
          highlight={suppress ? { cells: [], kind: null } : interactive ? highlight : { cells: [], kind: null }}
          spinPath={spinPath}
          loadCells={loadCellsForBoard}
          // an about-to-auto-fire drift (needsImplicitDriftFirst, useSession.ts) means these
          // targets are pre-upgrade-cost and already stale — showing them for the ~220ms
          // before the auto-drift reveals the real start-of-game upgrade offer is exactly
          // the "flash before it vanishes" this app avoids elsewhere (see coastAction's own
          // autoPendingType check below)
          burnTargets={interactive && !suppress && autoPendingType !== "drift" ? afford.burnTargets : []}
          driftGhost={interactive && !suppress && autoPendingType !== "drift" ? driftGhost : null}
          onCoast={suppress ? null : onCoast}
          scrapCells={anim ? [] : scrapCells}
          attackTargets={attackTargets}
          onAttackTarget={onAttackTarget}
          endTurnReady={endTurnReady}
          onEndTurn={onEndTurn}
          world
          reducedMotion={reducedMotion}
          moveAnim={s.moveAnim}
          onMoveAnimEnd={s.endMoveAnim}
          onCell={onCell}
          onSkipAnimation={placing || (combatReveal && !combatReveal.showOutcome) || equipSpinId ? onSkipAnimation : null}
        />

        {/* guidance popup / fight box: fixed overlays, like the zoom controls or the status
           panel — outside the board's own pan/zoom transform, so they never collide with it */}
        {!suppress && fightBox && <FightBox {...fightBox} />}
        {!suppress && !fightBox && eventChoiceBox && <HexPopup lines={eventChoiceBox.lines} actions={eventChoiceBox.actions} />}
        {!suppress && !fightBox && !eventChoiceBox && popup && <HexPopup lines={popup.lines} />}
        {!suppress && !fightBox && equipBox && <EquipmentPopup {...equipBox} />}
        {scrapConfirm && (
          <div className="board-scrim" onClick={scrapConfirm.onCancel}>
            <div onClick={(e) => e.stopPropagation()}>
              <HexPopup
                lines={scrapConfirm.lines}
                actions={[
                  { label: "Cancel", kind: "primary", onClick: scrapConfirm.onCancel },
                  { label: "Yes", kind: "danger", onClick: scrapConfirm.onYes },
                ]}
              />
            </div>
          </div>
        )}

        {eventBanner ? (
          <StatusPanel colour={null} name="⚙ System" bot={false} log={[eventBanner.title, eventBanner.text]} system />
        ) : placing ? (
          <StatusPanel colour={null} name="⚙ System" bot={false} log={["Placing resources"]} system />
        ) : (
          <StatusPanel
            colour={activeMover.colour}
            name={s.names[activeMover.id] ?? "?"}
            bot={seats[activeMover.id] === "bot"}
            log={moveLog}
          />
        )}
        <DeckPanels state={state} />
        {isWaitingOnBot && !activeIsBot && <div className="board-toast">🤖 waiting on the bot…</div>}
        {s.reconnecting && <div className="board-toast">🔌 reconnecting…</div>}
        {state.gameOver && (
          <div className="board-scrim">
            <HexPopup
              lines={[
                "Game Over!",
                <table className="gameover-table" key="ranking">
                  <thead>
                    <tr>
                      <th></th>
                      <th></th>
                      <th>Player</th>
                      <th>Ship</th>
                      <th className="num">
                        <i className="swatch ore" style={{ background: "var(--ore-red)" }} />
                      </th>
                      <th className="num">
                        <i className="swatch ore" style={{ background: "var(--ore-yellow)" }} />
                      </th>
                      <th className="num">
                        <i className="swatch ore" style={{ background: "var(--ore-green)" }} />
                      </th>
                      <th className="num">pts</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rankPlayers(state, s.names).map((row) => (
                      <tr key={row.id}>
                        <td className="num">{row.rank}.</td>
                        <td>
                          <i className="swatch" style={{ background: `var(--ship-${row.colour})` }} />
                        </td>
                        <td>{row.name}</td>
                        <td>{row.shipName}</td>
                        <td className="num">{row.red}</td>
                        <td className="num">{row.yellow}</td>
                        <td className="num">{row.green}</td>
                        <td className="num">{row.score}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>,
                "Ready for a New Game",
              ]}
            />
          </div>
        )}

        <HandPanel
          // a staged laser/shield moved into the combat box above — it no longer shows here
          cards={
            handHidden
              ? []
              : handOwner.hand.filter((c) => !(combatCardType && c.type === combatCardType && combatSel.has(c.id)))
          }
          cardHint={cardHint}
          cardState={cardState}
          urgent={handOwnerOverLimit}
          forceOpen={showCards}
          ownerId={handOwner.id}
        />

        {logOpen && <LogOverlay state={state} onClose={() => setLogOpen(false)} />}
        {rulesOpen && <RulesPopup config={state.config} onClose={() => setRulesOpen(false)} />}
      </div>

      {needPassGate && (
        <div className="pass">
          <div className="sub">pass the device to</div>
          <div className="who">
            <span className="pill">
              <i
                className="swatch"
                style={{ background: `var(--ship-${p.colour})`, width: "1.4rem", height: "1.4rem" }}
              />
              {s.names[p.id] ?? "?"} · {p.colour}
            </span>
          </div>
          <button className="primary" onClick={s.revealTurn}>
            Start turn {state.turnNumber}
          </button>
        </div>
      )}
    </div>
  );
}
