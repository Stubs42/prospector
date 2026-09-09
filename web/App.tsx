import { useEffect, useMemo, useState } from "react";
import { createGame, applyAction, score } from "../engine/game.js";
import { legalActions, greedyBot } from "../engine/index.js";
import { makeRng } from "../engine/rng.js";
import { hexKey } from "../engine/hex.js";
import type { Action, Colour, GameState, Hex } from "../engine/index.js";
import { Board } from "./components/Board.js";

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

export default function App() {
  const [nPlayers, setNPlayers] = useState(3);
  const [state, setState] = useState<GameState>(() => newGame(3));
  const [shownPlayer, setShownPlayer] = useState(0);

  // ?demo=N — let greedy bots play N actions on load, for screenshots / kicking the tyres
  useEffect(() => {
    const n = Number(new URLSearchParams(location.search).get("demo") ?? 0);
    if (!n) return;
    const rng = makeRng(1);
    let s = state;
    for (let i = 0; i < n && !s.gameOver; i++) {
      const r = applyAction(s, greedyBot(s, rng));
      s = r.ok ? r.state : applyAction(s, legalActions(s)[0]!).state;
    }
    setState(s);
    setShownPlayer(s.activePlayerIndex);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const acts = useMemo(() => legalActions(state), [state]);
  const p = state.players[state.activePlayerIndex]!;
  const stats = state.config.modes.prospector.ships[p.colour];
  const caps = state.config.modes.prospector.upgradeCaps;

  function dispatch(a: Action) {
    const r = applyAction(state, a);
    if (r.ok) setState(r.state);
    else console.warn("rejected", a, r.error);
  }

  function reset(n = nPlayers) {
    const g = newGame(n);
    setState(g);
    setShownPlayer(g.activePlayerIndex);
  }

  // --- derive UI affordances from legalActions -----------------------------
  const burnByCell = new Map<string, Extract<Action, { type: "burn" }>>();
  for (const a of acts) {
    if (a.type !== "burn") continue;
    const dest = a.path[a.path.length - 1]!;
    const k = hexKey(dest);
    const prev = burnByCell.get(k);
    if (!prev || a.path.length < prev.path.length) burnByCell.set(k, a);
  }
  const loadCells: Hex[] = acts.flatMap((a) => (a.type === "loadResource" ? [a.from] : []));
  const attackActs = acts.filter((a) => a.type === "attack") as Extract<Action, { type: "attack" }>[];
  const plainActs = acts.filter((a) => LABEL[a.type]) as Action[];

  const highlight: { cells: Hex[]; kind: "burn" | "load" | null } = loadCells.length
    ? { cells: loadCells, kind: "load" }
    : burnByCell.size
      ? { cells: [...burnByCell.keys()].map((k) => keyToHex(k)), kind: "burn" }
      : { cells: [], kind: null };

  function onCell(h: Hex) {
    const k = hexKey(h);
    if (loadCells.some((c) => hexKey(c) === k)) {
      dispatch({ type: "loadResource", from: h });
      return;
    }
    const burn = burnByCell.get(k);
    if (burn) dispatch(burn);
  }

  const needPassGate = !state.gameOver && shownPlayer !== state.activePlayerIndex;
  const overLimit = acts.length > 0 && acts.every((a) => a.type === "discardBooster");
  const sc = score(state);

  return (
    <div className="app">
      <div className="topbar">
        <h1>Prospector</h1>
        <span className="turn">
          turn {state.turnNumber} · <span className="pill"><i className="swatch" style={{ background: `var(--ship-${p.colour})` }} />{p.colour}</span>
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
        <button onClick={() => reset()}>New game</button>
      </div>

      <div className="stage">
        <div className="boardwrap">
          <Board state={state} highlight={highlight} onCell={onCell} />
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
              {stats.name} <span style={{ color: "var(--muted)", fontWeight: 400 }}>({p.colour})</span>
            </div>
            <div className="stats">
              {STAT_ORDER.map((k) => {
                const total = p.equipment
                  .filter((e) => e.stat === k)
                  .reduce((acc, e) => acc + e.amount, stats[k]);
                const capped = Math.min(total, caps[k] ?? total);
                return (
                  <div className="stat" key={k}>
                    <b>{capped}</b>
                    <span>{k}</span>
                  </div>
                );
              })}
            </div>
            <div className="fueltrack" title={`fuel ${p.fuel} / ${p.fuelMax}`}>
              {Array.from({ length: p.fuelMax }, (_, i) => (
                <i key={i} className={`fuelcell ${i < p.fuel ? "full" : "empty"}`} />
              ))}
            </div>
            <div className="tiles">
              cargo:
              {p.cargo.length === 0 && <span className="hint" style={{ marginLeft: 4 }}>empty</span>}
              {p.cargo.map((c, i) => (
                <i key={i} className="oretile" style={{ background: `var(--ore-${c})` }}>
                  {state.config.modes.prospector.resources.values[c]}
                </i>
              ))}
            </div>
            <div className="tiles">
              delivered:
              {p.delivered.map((c, i) => (
                <i key={i} className="oretile" style={{ background: `var(--ore-${c})` }}>
                  {state.config.modes.prospector.resources.values[c]}
                </i>
              ))}
              <span className="hint" style={{ marginLeft: "auto" }}>score {sc.byPlayer[p.id]}</span>
            </div>
          </section>

          <section>
            <h2>Booster hand ({p.hand.length}/{Math.min(stats.booster, caps.booster ?? stats.booster)})</h2>
            {overLimit && <p className="hint">Over the limit — click a card to discard.</p>}
            <div className="hand">
              {p.hand.length === 0 && <span className="hint">no cards</span>}
              {p.hand.map((c) => (
                <div
                  key={c.id}
                  className={`card booster-${c.type}`}
                  style={{ cursor: overLimit ? "pointer" : "default" }}
                  onClick={overLimit ? () => dispatch({ type: "discardBooster", cardId: c.id }) : undefined}
                >
                  <div className="ctype">{c.type}</div>
                  <div className="cval">{c.value ?? "◇"}</div>
                  <div className="ceff">{c.effect}</div>
                </div>
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
            {highlight.kind === "burn" && <p className="hint">Click a highlighted cell to burn there.</p>}
            {highlight.kind === "load" && <p className="hint">Click a highlighted resource to load it.</p>}
            {state.pendingCombat && (
              <p className="hint">
                combat: {state.players[state.pendingCombat.attackerId]!.colour} → {state.players[state.pendingCombat.defenderId]!.colour} ({state.pendingCombat.awaiting})
              </p>
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
              <i className="swatch" style={{ background: `var(--ship-${p.colour})`, width: "1.4rem", height: "1.4rem" }} />
              {stats.name} · {p.colour}
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

function keyToHex(k: string): Hex {
  const [q, r] = k.split(",").map(Number) as [number, number];
  return { q, r };
}
