import { useEffect, useMemo, useState } from "react";
import { createGame, applyAction, score } from "../engine/game.js";
import { legalActions, greedyBot } from "../engine/index.js";
import { hexKey } from "../engine/hex.js";
import { driftTarget } from "../engine/movement.js";
import { makeRng } from "../engine/rng.js";
import type { Action, Colour, GameState, Hex } from "../engine/index.js";
import { Board } from "./components/Board.js";
import { BoosterCardFace, Die, FuelTrack, TileChip } from "./components/kit.js";
import { Settings } from "./components/Settings.js";
import { loadPrefs, motionReduced, savePrefs, type Prefs } from "./prefs.js";

const ALL_COLOURS: Colour[] = ["black", "red", "blue", "white", "green", "yellow"];
const STAT_ORDER = ["shields", "lasers", "fuelTanks", "cargo", "engines", "booster"] as const;

const LABEL: Partial<Record<Action["type"], string>> = {
  drawBooster: "Draw booster",
  drift: "Drift",
  endMove: "End move",
  endTurn: "End turn",
  scrapShip: "Scrap ship",
  combatDefend: "Defend",
  combatResolve: "Roll combat",
  declineCounter: "Decline counter-attack",
};

function newGame(nPlayers: number): GameState {
  return createGame({ colours: ALL_COLOURS.slice(0, nPlayers), seed: (Math.random() * 1e9) | 0 });
}

function keyToHex(k: string): Hex {
  const [q, r] = k.split(",").map(Number) as [number, number];
  return { q, r };
}

export default function App() {
  const [game0] = useState(() => newGame(3));
  const [nPlayers, setNPlayers] = useState(3);
  const [state, setState] = useState<GameState>(game0);
  const [shownPlayer, setShownPlayer] = useState(game0.activePlayerIndex);
  const [hoverCell, setHoverCell] = useState<Hex | null>(null);
  const [prefs, setPrefsState] = useState<Prefs>(() => {
    const p = loadPrefs();
    if (typeof location !== "undefined" && new URLSearchParams(location.search).get("noauto") === "1") {
      p.autoSingle = false;
    }
    return p;
  });

  const setPrefs = (p: Prefs) => {
    setPrefsState(p);
    savePrefs(p);
  };
  const reducedMotion = motionReduced(prefs);

  useEffect(() => {
    const n = Number(new URLSearchParams(location.search).get("demo") ?? 0);
    if (!n) return;
    const rng = makeRng(1);
    let s = state;
    for (let i = 0; i < n && !s.gameOver; i++) {
      const r = applyAction(s, greedyBot(s, rng));
      s = r.ok ? r.state : applyAction(s, legalActions(s)[0]!).state;
    }
    // advance into the burn phase so previews / burn rings are visible in screenshots
    for (const step of [{ type: "drawBooster" }, { type: "drift" }] as Action[]) {
      const legal = legalActions(s);
      if (legal.some((a) => a.type === step.type)) {
        const r = applyAction(s, step);
        if (r.ok) s = r.state;
      }
    }
    setState(s);
    setShownPlayer(s.activePlayerIndex);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const acts = useMemo(() => legalActions(state), [state]);
  const p = state.players[state.activePlayerIndex]!;
  const mode = state.config.modes.prospector;
  const baseStats = mode.ships[p.colour];
  const caps = mode.upgradeCaps;
  const sc = score(state);

  function dispatch(a: Action) {
    const r = applyAction(state, a);
    if (r.ok) {
      setState(r.state);
      setHoverCell(null);
    } else console.warn("rejected", a, r.error);
  }
  function reset(n = nPlayers) {
    const g = newGame(n);
    setState(g);
    setShownPlayer(g.activePlayerIndex);
  }

  // --- affordances from legalActions ------------------------------------
  const burnByCell = new Map<string, Extract<Action, { type: "burn" }>>();
  for (const a of acts) {
    if (a.type !== "burn") continue;
    const k = hexKey(a.path[a.path.length - 1]!);
    const prev = burnByCell.get(k);
    if (!prev || a.path.length < prev.path.length) burnByCell.set(k, a);
  }
  const loadCells: Hex[] = acts.flatMap((a) => (a.type === "loadResource" ? [a.from] : []));
  const placeCells: Hex[] = acts.flatMap((a) => (a.type === "placeShip" ? [a.cell] : []));
  const attackActs = acts.filter((a) => a.type === "attack") as Extract<Action, { type: "attack" }>[];
  const plainActs = acts.filter((a) => LABEL[a.type]);
  const overLimit = acts.length > 0 && acts.every((a) => a.type === "discardBooster");

  // free base-departure cells reduce a burn's fuel cost
  const freeCells = p.turn.moveStartedOnOwnBase
    ? Math.max(0, state.config.core.movement.freeBaseDepartureCells - p.turn.freeBurnCellsUsed)
    : 0;
  const burnCost = (steps: number) => Math.max(0, steps - Math.min(steps, freeCells));

  const placeKeys = new Set(placeCells.map(hexKey));
  const burnTargets = [...burnByCell.entries()].map(([k, a]) => ({
    cell: keyToHex(k),
    cost: burnCost(a.path.length),
  }));

  const highlight: { cells: Hex[]; kind: "load" | "place" | null } = placeCells.length
    ? { cells: placeCells, kind: "place" }
    : loadCells.length
      ? { cells: loadCells, kind: "load" }
      : { cells: [], kind: null };

  // drift preview — only meaningful for a ship that is actually coasting
  const canDrift = acts.some((a) => a.type === "drift");
  const driftGhost =
    canDrift && !p.pose.atRest ? { at: driftTarget(p.pose), from: p.pose.current } : null;

  let burnPreview: { path: Hex[]; cost: number } | null = null;
  if (hoverCell) {
    const b = burnByCell.get(hexKey(hoverCell));
    if (b) burnPreview = { path: b.path, cost: burnCost(b.path.length) };
  }

  function onCell(h: Hex) {
    const k = hexKey(h);
    if (placeKeys.has(k)) return dispatch({ type: "placeShip", cell: h });
    if (loadCells.some((c) => hexKey(c) === k)) return dispatch({ type: "loadResource", from: h });
    const burn = burnByCell.get(k);
    if (burn) dispatch(burn);
  }

  const needPassGate = !state.gameOver && shownPlayer !== state.activePlayerIndex;
  const lastCombat = [...state.log].reverse().find((e) => e.event === "attackSucceeded" || e.event === "attackFailed");

  // auto-advance: when the player has no real choice, take the move for them
  const AUTO_SKIP = new Set<Action["type"]>(["scrapShip", "declineCounter", "discardBooster"]);
  const autoCandidates = acts.filter(
    (a) => !AUTO_SKIP.has(a.type) && (a.type !== "endTurn" || prefs.autoEndTurn),
  );
  const autoAction =
    prefs.autoSingle && !state.gameOver && !needPassGate && autoCandidates.length === 1
      ? autoCandidates[0]!
      : null;
  useEffect(() => {
    if (!autoAction) return;
    const id = setTimeout(() => dispatch(autoAction), reducedMotion ? 30 : 220);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, autoAction, reducedMotion]);

  const statTotal = (k: (typeof STAT_ORDER)[number]) => {
    const t = p.equipment.filter((e) => e.stat === k).reduce((acc, e) => acc + e.amount, baseStats[k]);
    return Math.min(t, caps[k] ?? t);
  };
  const boosterLimit = statTotal("booster");

  return (
    <div className="app">
      <div className="topbar">
        <h1>Prospector</h1>
        <span className="turn">
          turn {state.turnNumber} ·{" "}
          <span className="pill">
            <i className="swatch" style={{ background: `var(--ship-${p.colour})` }} />
            {p.colour}
          </span>
        </span>
        <span className="spacer" />
        <label className="turn">
          players{" "}
          <select value={nPlayers} onChange={(e) => setNPlayers(Number(e.target.value))}>
            {[2, 3, 4, 5, 6].map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
        </label>
        <Settings prefs={prefs} onChange={setPrefs} />
        <button onClick={() => reset()}>New game</button>
      </div>

      <div className="stage">
        <div className="boardwrap">
          <Board
            state={state}
            highlight={highlight}
            burnTargets={burnTargets}
            driftGhost={driftGhost}
            burnPreview={burnPreview}
            reducedMotion={reducedMotion}
            onCell={onCell}
            onCellHover={setHoverCell}
          />
        </div>

        <div className="sidebar">
          {state.gameOver && (
            <div className="gameover">
              Game over — {sc.winnerIds.length > 1 ? "draw between" : "winner:"}{" "}
              <b>{sc.winnerIds.map((i) => state.players[i]!.colour).join(", ")}</b>
              <div className="hint">
                scores: {state.players.map((pl) => `${pl.colour} ${sc.byPlayer[pl.id]}`).join(" · ")}
              </div>
            </div>
          )}

          <section>
            <h2>Active ship</h2>
            <div className="pill" style={{ fontWeight: 700 }}>
              <i className="swatch" style={{ background: `var(--ship-${p.colour})` }} />
              {baseStats.name} <span style={{ color: "var(--muted)", fontWeight: 400 }}>({p.colour})</span>
            </div>
            <div className="stats">
              {STAT_ORDER.map((k) => (
                <div className="stat" key={k}>
                  <b>{statTotal(k)}</b>
                  <span>{k}</span>
                </div>
              ))}
            </div>
            <FuelTrack fuel={p.fuel} max={p.fuelMax} />
            <div className="tiles">
              cargo:
              {p.cargo.length === 0 && <span className="hint" style={{ marginLeft: 4 }}>empty</span>}
              {p.cargo.map((c, i) => (
                <TileChip key={i} colour={c} value={mode.resources.values[c]} />
              ))}
            </div>
            <div className="tiles">
              delivered:
              {p.delivered.map((c, i) => (
                <TileChip key={i} colour={c} value={mode.resources.values[c]} />
              ))}
              <span className="hint" style={{ marginLeft: "auto" }}>score {sc.byPlayer[p.id]}</span>
            </div>
          </section>

          <section>
            <h2>Booster hand ({p.hand.length}/{boosterLimit})</h2>
            {overLimit && <p className="hint">Over the limit — click a card to discard.</p>}
            <div className="hand">
              {p.hand.length === 0 && <span className="hint">no cards</span>}
              {p.hand.map((c) => (
                <BoosterCardFace
                  key={c.id}
                  card={c}
                  clickable={overLimit}
                  onClick={overLimit ? () => dispatch({ type: "discardBooster", cardId: c.id }) : undefined}
                />
              ))}
            </div>
          </section>

          <section>
            <h2>Actions</h2>
            <div className="actions">
              {plainActs.map((a) => (
                <button
                  key={a.type}
                  className={a.type === "endTurn" ? "primary" : a.type === "scrapShip" ? "danger" : ""}
                  onClick={() => dispatch(a)}
                >
                  {LABEL[a.type]}
                </button>
              ))}
              {attackActs.map((a) => (
                <button key={`atk-${a.targetPlayerId}`} className="danger" onClick={() => dispatch(a)}>
                  Attack {state.players[a.targetPlayerId]!.colour}
                </button>
              ))}
            </div>
            {placeCells.length > 0 && (
              <p className="hint">Launch: click a highlighted base cell to pick your starting field (or just Draw booster to keep the default).</p>
            )}
            {driftGhost && <p className="hint">Gold outline = where you'll coast to if you drift.</p>}
            {burnTargets.length > 0 && (
              <p className="hint">
                Click a ring to burn there — <span style={{ color: "var(--ok)" }}>●</span> free ·{" "}
                <span style={{ color: "#d7b13d" }}>●</span> 1 ·{" "}
                <span style={{ color: "#e08a3d" }}>●</span> 2 ·{" "}
                <span style={{ color: "#c1573c" }}>●</span> 3 fuel. Hover for the path.
              </p>
            )}
            {highlight.kind === "load" && <p className="hint">Click a highlighted resource to load it.</p>}
            {state.pendingCombat && (
              <p className="hint">
                combat: {state.players[state.pendingCombat.attackerId]!.colour} →{" "}
                {state.players[state.pendingCombat.defenderId]!.colour} ({state.pendingCombat.awaiting})
              </p>
            )}
            {lastCombat && (
              <div className="combat-roll">
                <Die value={Number(lastCombat.detail?.attackDie ?? 1)} tone="attack" />
                <Die value={Number(lastCombat.detail?.defenceDie ?? 1)} tone="defence" />
                <span className="hint">
                  {Number(lastCombat.detail?.attackTotal)} vs {Number(lastCombat.detail?.defenceTotal)} —{" "}
                  {lastCombat.event === "attackSucceeded" ? "hit" : "repelled"}
                </span>
              </div>
            )}
          </section>

          <section>
            <h2>Log</h2>
            <div className="log">
              {state.log.slice(-14).reverse().map((e, i) => (
                <div key={i}>
                  <b>t{e.turn}</b> {state.players[e.player]?.colour} — {e.event}
                </div>
              ))}
            </div>
          </section>
        </div>
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
              {baseStats.name} · {p.colour}
            </span>
          </div>
          <button className="primary" onClick={() => setShownPlayer(state.activePlayerIndex)}>
            Start turn {state.turnNumber}
          </button>
        </div>
      )}
    </div>
  );
}
