/**
 * Interactive game start, both real engine actions (see engine/game.ts stepSetup) — this
 * component just renders whichever stage state.setup is at and dispatches the click.
 *
 * Per seat, in turn: pickBase (reuses the board — click a highlighted base region, same
 * pattern as every other board-native pick), then immediately pickShip (a one-card-at-a-time
 * carousel inside a big hex — ‹ › to browse, Select to confirm, 🎲 Random to spin the same
 * browsing motion onto a random one) for that same seat, before the next seat's turn. Once
 * every seat has both, the engine parks in "rollOff" with the start player already decided;
 * this plays that as a reveal (spinning the same base-outline highlight over the now fully
 * owned regions) and then dispatches finishSetup to open the real game.
 */
import { useEffect, useRef, useState } from "react";
import { boardFor } from "../../engine/game.js";
import { hexKey } from "../../engine/hex.js";
import type { Colour, Hex } from "../../engine/index.js";
import { Board } from "./Board.js";
import { HexPopup } from "./HexPopup.js";
import { ShipPickerPopup } from "./ShipPickerPopup.js";
import { Topbar } from "./Topbar.js";
import { StatusPanel } from "./StatusPanel.js";
import type { Prefs } from "../prefs.js";
import { SkipGate } from "../spin.js";
import type { Session } from "../useSession.js";

export function SetupScreen({
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
  const { state, seats } = s;
  const setup = state.setup!;
  const board = boardFor(state);
  const mode = state.config.modes.prospector;
  const colourOrder = state.config.core.board.colourOrder;

  const freeBases = colourOrder.filter((c) => !setup.bases.includes(c));
  const freeShips = colourOrder.filter((c) => !setup.colours.includes(c));

  // base and ship are the same seat's turn back-to-back now, so `current` is just
  // turnIndex for both stages; during the roll-off reveal there's no "turn", only a winner
  const current = setup.stage === "rollOff" ? (setup.startSeat ?? 0) : setup.turnIndex;
  const currentIsBot = seats[current] === "bot";
  const canPickNow = setup.stage === "pickBase" && !currentIsBot && !s.needPassGate;
  const canPickShipNow = setup.stage === "pickShip" && !currentIsBot && !s.needPassGate;

  // whichever "already decided" spin is currently running (base pick, ship pick, the
  // roll-off) — a click anywhere on the board fast-forwards it to its result, since none
  // of these were ever actually suspenseful at animation time (see spin.ts's SkipGate)
  const skipGateRef = useRef<SkipGate | null>(null);
  const onSkipAnimation = () => skipGateRef.current?.skip();

  // a seat's "move" is its base pick immediately followed by its ship pick — log both lines
  // before resetting for the next seat
  const setupAction = setup.stage === "pickBase" ? "Picking a base" : "Picking a ship";
  const [setupLog, setSetupLog] = useState<string[]>([setupAction]);
  const setupLogSeat = useRef(current);
  useEffect(() => {
    if (setup.stage === "rollOff") return;
    if (setupLogSeat.current !== current) {
      setupLogSeat.current = current;
      setSetupLog([setupAction]);
    } else {
      setSetupLog((log) => (log[log.length - 1] === setupAction ? log : [...log, setupAction]));
    }
  }, [current, setupAction, setup.stage]);

  // A lucky-wheel spin over the free bases, landing on a genuinely random one before
  // dispatching pickBase. Used for both the human's "🎲 Random" button *and* bot turns
  // (below) — a bot has no strategy to speak of here, so "spin and land on one" is exactly
  // as good a bot policy as any, and it's the one that's actually watchable.
  const [spinning, setSpinning] = useState<Colour | null>(null);
  // only pulse the still-free bases while it's actually a human's turn to pick one — during
  // a bot's turn (or while spinning) nothing is clickable, so nothing should look clickable
  const highlightCells =
    canPickNow && !spinning ? freeBases.flatMap((c) => [...board.baseCells(c)]) : [];

  async function runBaseSpin() {
    if (freeBases.length === 0) return;
    if (freeBases.length === 1) {
      s.pickBase(freeBases[0]!);
      return;
    }
    const target = freeBases[Math.floor(Math.random() * freeBases.length)]!;
    const startIdx = freeBases.indexOf(target);
    const ticks = freeBases.length * 2 + 6; // a couple of laps, then a settling lap onto target
    const seq: Colour[] = Array.from({ length: ticks }, (_, k) => {
      const stepsFromEnd = ticks - 1 - k;
      const idx = ((startIdx - stepsFromEnd) % freeBases.length + freeBases.length) % freeBases.length;
      return freeBases[idx]!;
    });
    const gate = new SkipGate();
    skipGateRef.current = gate;
    for (let k = 0; k < seq.length; k++) {
      setSpinning(seq[k]!);
      const last = k === seq.length - 1;
      const t = k / (seq.length - 1);
      await gate.wait(last ? 450 : 70 + t * t * 260); // ease-out: fast, then slow to a stop
    }
    if (skipGateRef.current === gate) skipGateRef.current = null;
    setSpinning(null);
    s.pickBase(target);
  }
  function spinRandomBase() {
    if (!canPickNow || spinning) return;
    runBaseSpin();
  }

  // a bot's own pickBase turn spins the same wheel, automatically, after a short pause —
  // every pick reads the same regardless of who made it, and nothing just instantly appears
  useEffect(() => {
    if (setup.stage !== "pickBase" || !currentIsBot || s.needPassGate || spinning) return;
    const id = window.setTimeout(runBaseSpin, 400);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setup.stage, current, currentIsBot, s.needPassGate]);

  function onCell(h: Hex) {
    if (!canPickNow || spinning) return;
    const k = hexKey(h);
    const base = freeBases.find((c) => board.baseCells(c).some((b) => hexKey(b) === k));
    if (base) s.pickBase(base);
  }

  // pickShip: one ship shown at a time, browsed with ‹ ›. Reset to the first option
  // whenever a new seat's turn starts, so nobody inherits the previous player's spot.
  const [shipIndex, setShipIndex] = useState(0);
  const [shipSpinning, setShipSpinning] = useState(false);
  useEffect(() => setShipIndex(0), [current, setup.stage]);
  const shipAt = (i: number) => freeShips[((i % freeShips.length) + freeShips.length) % freeShips.length];
  const shownShip = freeShips.length ? shipAt(shipIndex) : null;

  function browseShip(delta: 1 | -1) {
    if (!canPickShipNow || shipSpinning || freeShips.length < 2) return;
    setShipIndex((i) => i + delta);
  }

  // the same lucky-wheel motion as "random base": spin through the free ships, decelerating,
  // and confirm whichever one it lands on. Used for both the human's "🎲 Random" button and
  // a bot's own pickShip turn (below).
  async function runShipSpin() {
    if (freeShips.length === 0) return;
    if (freeShips.length === 1) {
      s.pickShip(freeShips[0]!);
      return;
    }
    const targetIdx = Math.floor(Math.random() * freeShips.length);
    const target = shipAt(targetIdx)!;
    const ticks = freeShips.length * 2 + 6;
    setShipSpinning(true);
    const gate = new SkipGate();
    skipGateRef.current = gate;
    for (let k = 0; k < ticks; k++) {
      const stepsFromEnd = ticks - 1 - k;
      setShipIndex(targetIdx - stepsFromEnd);
      const last = k === ticks - 1;
      const t = k / (ticks - 1);
      await gate.wait(last ? 450 : 70 + t * t * 260);
    }
    if (skipGateRef.current === gate) skipGateRef.current = null;
    setShipSpinning(false);
    s.pickShip(target);
  }
  function spinRandomShip() {
    if (!canPickShipNow || shipSpinning || freeShips.length < 2) return;
    runShipSpin();
  }

  // a bot's own pickShip turn spins the same wheel, automatically — see the pickBase effect.
  // rollOff can never overlap a pickShip turn now (it only starts once every seat has both).
  useEffect(() => {
    if (setup.stage !== "pickShip" || !currentIsBot || s.needPassGate || shipSpinning) return;
    const id = window.setTimeout(runShipSpin, 400);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setup.stage, current, currentIsBot, s.needPassGate]);

  function selectShip() {
    if (!canPickShipNow || shipSpinning || !shownShip) return;
    s.pickShip(shownShip);
  }

  // The start-player roll-off: the engine has already decided it (one RNG draw, no per-seat
  // action) and parked in stage "rollOff" waiting for finishSetup. This plays that as a
  // reveal — spinning the same base-outline highlight, now over every seat's own (fully
  // assigned) region — before dispatching finishSetup to actually open the real game. It's
  // public/spectator content, not anyone's private turn, so it's not gated by needPassGate.
  const [rollOffBase, setRollOffBase] = useState<Colour | null>(null);
  const [rollOffLanded, setRollOffLanded] = useState(false);
  const rollOffStarted = useRef(false);
  useEffect(() => {
    if (setup.stage !== "rollOff") {
      rollOffStarted.current = false;
      setRollOffLanded(false);
      return;
    }
    if (rollOffStarted.current) return;
    rollOffStarted.current = true;
    const bases = setup.bases.map((b) => b!); // every seat has one by now
    const startIdx = setup.startSeat!;
    const ticks = bases.length * 2 + 6;
    const gate = new SkipGate();
    skipGateRef.current = gate;
    (async () => {
      for (let k = 0; k < ticks; k++) {
        const stepsFromEnd = ticks - 1 - k;
        const idx = ((startIdx - stepsFromEnd) % bases.length + bases.length) % bases.length;
        setRollOffBase(bases[idx]!);
        const last = k === ticks - 1;
        if (!last) {
          const t = k / (ticks - 1);
          await gate.wait(70 + t * t * 260);
        } else {
          setRollOffLanded(true);
          await gate.wait(1100); // linger on the winner, then open the game
        }
      }
      if (skipGateRef.current === gate) skipGateRef.current = null;
      s.finishSetup();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setup.stage]);
  const rollOffActive = setup.stage === "rollOff";

  const lines =
    setup.stage === "pickBase"
      ? ["Select Your Base"]
      : rollOffActive
        ? rollOffLanded
          ? [`Player ${setup.startSeat! + 1}`, "goes first!"]
          : ["Rolling for", "start player..."]
        : [];

  return (
    <div className="app board-only">
      <Topbar s={s} prefs={prefs} setPrefs={setPrefs} turnLabel="new game" />

      <div className="stage">
        <Board
          state={state}
          seats={seats}
          scores={[]}
          highlight={{ cells: highlightCells, kind: "base" }}
          spinHighlight={
            setup.stage === "pickBase"
              ? spinning
              : rollOffActive
                ? rollOffBase
                : (setup.bases[current] ?? null) // pickShip: your own base, steady, so you can see it
          }
          loadCells={[]}
          burnTargets={[]}
          driftGhost={null}
          burnPreview={null}
          onCoast={null}
          scrapCells={[]}
          attackTargets={[]}
          onAttackTarget={() => {}}
          endTurnReady={false}
          onEndTurn={null}
          world={false}
          reducedMotion={reducedMotion}
          moveAnim={null}
          onMoveAnimEnd={() => {}}
          onCell={onCell}
          onCellHover={() => {}}
          onSkipAnimation={spinning || shipSpinning || rollOffActive ? onSkipAnimation : null}
        />

        {/* guidance popup / ship picker: fixed overlays, like the zoom controls or the
           status panel — not board content, so pan/zoom never touches them */}
        {canPickNow && setup.stage === "pickBase" && !spinning && (
          <HexPopup lines={lines} actions={[{ label: "🎲 Random", kind: "primary", onClick: spinRandomBase }]} />
        )}
        {rollOffActive && <HexPopup lines={lines} />}
        {!s.needPassGate && setup.stage === "pickShip" && shownShip && (
          <ShipPickerPopup
            // this box (unlike the base-pick one) still shows during a bot's own turn —
            // watchable, but not addressed to "you", since it isn't your decision to make
            title={currentIsBot ? "Selecting Ship" : "Select Your Ship"}
            colour={shownShip}
            name={mode.ships[shownShip].name}
            stats={mode.ships[shownShip]}
            canBrowse={freeShips.length > 1}
            spinning={shipSpinning}
            // a bot's own turn is watch-only — the card still spins, but there's
            // nothing for the human to click on the bot's behalf
            interactive={!currentIsBot}
            onPrev={() => browseShip(-1)}
            onNext={() => browseShip(1)}
            onSelect={selectShip}
            onRandom={spinRandomShip}
          />
        )}

        {!s.needPassGate && !rollOffActive && (
          <StatusPanel
            colour={null} // no ship yet — bases carry no colour of their own during setup
            name={s.names[current] ?? "?"}
            bot={currentIsBot}
            log={setupLog}
          />
        )}
      </div>

      {/* the roll-off is public/spectator content, not any one seat's private turn — let it
         play out on whoever's screen is already up before asking to pass the device on to
         the winner for their (private) ship pick */}
      {s.needPassGate && !rollOffActive && (
        <div className="pass setup">
          <div className="sub">pass the device to</div>
          <div className="who">{s.names[current] ?? `player ${current + 1}`}</div>
          <button className="primary" onClick={s.revealTurn}>
            {setup.stage === "pickBase" ? "Select your base" : "Select your ship"}
          </button>
        </div>
      )}
    </div>
  );
}
