/**
 * Interactive game start: pickBase, then pickShip, both real engine actions
 * (see engine/game.ts stepSetup) — this component just renders whichever stage
 * state.setup is at and dispatches the click.
 *
 * The base pick reuses the board (click a highlighted base region, same pattern as
 * every other board-native pick in this app). The ship pick is a plain card grid for
 * now — a placeholder for the carousel-with-art widget described in the backlog; it's
 * wired to the same `pickShip` action, so swapping the widget later doesn't touch
 * useSession or the engine at all.
 */
import { useState } from "react";
import { boardFor } from "../../engine/game.js";
import { hexKey } from "../../engine/hex.js";
import type { Colour, Hex } from "../../engine/index.js";
import { ASPECT_ORDER, ASPECT_TAG } from "./aspects.js";
import { Board } from "./Board.js";
import { Settings } from "./Settings.js";
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

  const current =
    setup.stage === "pickBase" ? setup.turnIndex : (setup.shipOrder?.[setup.turnIndex] ?? 0);
  const currentIsBot = seats[current] === "bot";
  const canPickNow = setup.stage === "pickBase" && !currentIsBot && !s.needPassGate;

  // "random base" — a lucky-wheel spin over the free bases, landing on a genuinely random
  // one before dispatching pickBase; purely a client-side convenience (equivalent to the
  // player clicking that base themselves), so there's nothing for the engine to know about.
  const [spinning, setSpinning] = useState<Colour | null>(null);
  const highlightCells =
    setup.stage === "pickBase" && !spinning ? freeBases.flatMap((c) => [...board.baseCells(c)]) : [];

  function spinRandomBase() {
    if (!canPickNow || spinning || freeBases.length === 0) return;
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

  function onCell(h: Hex) {
    if (!canPickNow || spinning) return;
    const k = hexKey(h);
    const base = freeBases.find((c) => board.baseCells(c).some((b) => hexKey(b) === k));
    if (base) s.pickBase(base);
  }

  const lines =
    setup.stage === "pickBase"
      ? seats.length > 1
        ? ["Please select a base", `player ${current + 1} of ${seats.length}`]
        : ["Please select", "a base"]
      : seats.length > 1
        ? ["Please select a ship", `player ${current + 1} of ${seats.length}`]
        : ["Please select", "a ship"];

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
          spinHighlight={spinning}
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
          popup={s.needPassGate ? null : { center: { q: 0, r: 0 }, lines }}
          world={false}
          reducedMotion={reducedMotion}
          moveAnim={null}
          onMoveAnimEnd={() => {}}
          onCell={onCell}
          onCellHover={() => {}}
        />

        {canPickNow && (
          <button className="random-base-btn" disabled={!!spinning} onClick={spinRandomBase}>
            🎲 Random base
          </button>
        )}

        {setup.stage === "pickShip" && !s.needPassGate && !currentIsBot && (
          <div className="shippick-overlay">
            <div className="shipgrid">
              {freeShips.map((c) => {
                const ship = mode.ships[c];
                return (
                  <button key={c} className="shipcard" onClick={() => s.pickShip(c)}>
                    <span className="pill">
                      <i className="swatch" style={{ background: `var(--ship-${c})` }} />
                      {ship.name}
                    </span>
                    <div className="shipstats">
                      {ASPECT_ORDER.map((stat) => (
                        <span key={stat}>
                          {ASPECT_TAG[stat]} {ship[stat]}
                        </span>
                      ))}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {currentIsBot && !s.needPassGate && <div className="board-toast">🤖 picking…</div>}
      </div>

      {s.needPassGate && (
        <div className="pass setup">
          <div className="sub">pass the device to</div>
          <div className="who">player {current + 1}</div>
          <button className="primary" onClick={s.revealTurn}>
            {setup.stage === "pickBase" ? "Select your base" : "Select your ship"}
          </button>
        </div>
      )}
    </div>
  );
}
