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
import { Settings } from "./Settings.js";
import { StatusPanel } from "./StatusPanel.js";
import type { Prefs } from "../prefs.js";
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

  // A lucky-wheel spin over the free bases, landing on a genuinely random one before
  // dispatching pickBase. Used for both the human's "🎲 Random" button *and* bot turns
  // (below) — a bot has no strategy to speak of here, so "spin and land on one" is exactly
  // as good a bot policy as any, and it's the one that's actually watchable.
  const [spinning, setSpinning] = useState<Colour | null>(null);
  // only pulse the still-free bases while it's actually a human's turn to pick one — during
  // a bot's turn (or while spinning) nothing is clickable, so nothing should look clickable
  const highlightCells =
    canPickNow && !spinning ? freeBases.flatMap((c) => [...board.baseCells(c)]) : [];

  function runBaseSpin() {
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
    const tick = (k: number) => {
      setSpinning(seq[k]!);
      if (k < seq.length - 1) {
        const t = k / (seq.length - 1);
        window.setTimeout(() => tick(k + 1), 70 + t * t * 260); // ease-out: fast, then slow to a stop
      } else {
        window.setTimeout(() => {
          setSpinning(null);
          s.pickBase(target);
        }, 450);
      }
    };
    tick(0);
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
  function runShipSpin() {
    if (freeShips.length === 0) return;
    if (freeShips.length === 1) {
      s.pickShip(freeShips[0]!);
      return;
    }
    const targetIdx = Math.floor(Math.random() * freeShips.length);
    const target = shipAt(targetIdx)!;
    const ticks = freeShips.length * 2 + 6;
    setShipSpinning(true);
    const tick = (k: number) => {
      const stepsFromEnd = ticks - 1 - k;
      setShipIndex(targetIdx - stepsFromEnd);
      if (k < ticks - 1) {
        const t = k / (ticks - 1);
        window.setTimeout(() => tick(k + 1), 70 + t * t * 260);
      } else {
        window.setTimeout(() => {
          setShipSpinning(false);
          s.pickShip(target);
        }, 450);
      }
    };
    tick(0);
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
    const tick = (k: number) => {
      const stepsFromEnd = ticks - 1 - k;
      const idx = ((startIdx - stepsFromEnd) % bases.length + bases.length) % bases.length;
      setRollOffBase(bases[idx]!);
      if (k < ticks - 1) {
        const t = k / (ticks - 1);
        window.setTimeout(() => tick(k + 1), 70 + t * t * 260);
      } else {
        setRollOffLanded(true);
        window.setTimeout(() => s.finishSetup(), 1100); // linger on the winner, then open the game
      }
    };
    tick(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setup.stage]);
  const rollOffActive = setup.stage === "rollOff";

  const lines =
    setup.stage === "pickBase"
      ? seats.length > 1
        ? ["Please select a base", `player ${current + 1} of ${seats.length}`]
        : ["Please select", "a base"]
      : rollOffActive
        ? rollOffLanded
          ? [`Player ${setup.startSeat! + 1}`, "goes first!"]
          : ["Rolling for", "start player..."]
        : [];

  return (
    <div className="app board-only">
      <div className="topbar">
        <h1>Prospector</h1>
        <span className="turn">new game</span>
        <span className="spacer" />
        <label className="turn">
          humans{" "}
          <select
            value={s.humans}
            onChange={(e) => {
              const h = Number(e.target.value);
              s.openSetup(h, Math.min(s.bots, 6 - h));
            }}
          >
            {[1, 2, 3, 4, 5, 6].map((n) => (
              <option key={n} value={n} disabled={n + s.bots > 6 || n + s.bots < 2}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <label className="turn">
          bots{" "}
          <select value={s.bots} onChange={(e) => s.openSetup(s.humans, Number(e.target.value))}>
            {[0, 1, 2, 3, 4, 5].map((n) => (
              <option key={n} value={n} disabled={s.humans + n < 2 || s.humans + n > 6}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <Settings prefs={prefs} onChange={setPrefs} />
        <button onClick={() => s.openSetup()}>New game</button>
      </div>

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
          confirm={null}
          popup={
            canPickNow && setup.stage === "pickBase"
              ? {
                  center: { q: 0, r: 0 },
                  lines,
                  radius: 3,
                  actions: [{ label: "🎲 Random", kind: "primary", onClick: spinRandomBase }],
                }
              : rollOffActive
                ? { center: { q: 0, r: 0 }, lines, radius: 3 }
                : null
          }
          shipPicker={
            !s.needPassGate && setup.stage === "pickShip" && shownShip
              ? {
                  center: { q: 0, r: 0 },
                  title:
                    seats.length > 1 ? `Select your ship — player ${current + 1} of ${seats.length}` : "Select your ship",
                  colour: shownShip,
                  name: mode.ships[shownShip].name,
                  stats: mode.ships[shownShip],
                  canBrowse: freeShips.length > 1,
                  spinning: shipSpinning,
                  // a bot's own turn is watch-only — the card still spins, but there's
                  // nothing for the human to click on the bot's behalf
                  interactive: !currentIsBot,
                  onPrev: () => browseShip(-1),
                  onNext: () => browseShip(1),
                  onSelect: selectShip,
                  onRandom: spinRandomShip,
                }
              : null
          }
          world={false}
          reducedMotion={reducedMotion}
          moveAnim={null}
          onMoveAnimEnd={() => {}}
          onCell={onCell}
          onCellHover={() => {}}
        />

        {!s.needPassGate && !rollOffActive && (
          <StatusPanel
            colour={null} // no ship yet — bases carry no colour of their own during setup
            name={s.names[current] ?? "?"}
            bot={currentIsBot}
            action={setup.stage === "pickBase" ? "Picking a base" : "Picking a ship"}
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
