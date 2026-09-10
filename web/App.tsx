import { useState } from "react";
import { score, statsOf } from "../engine/index.js";
import { hexKey } from "../engine/hex.js";
import type { Action, Colour, Hex } from "../engine/index.js";
import { formatLogEntry } from "../client/index.js";
import { Board } from "./components/Board.js";
import { BoosterCardFace, Die, FuelTrack, TileChip } from "./components/kit.js";
import { Settings } from "./components/Settings.js";
import { loadPrefs, motionReduced, savePrefs, type Prefs } from "./prefs.js";
import { useSession } from "./useSession.js";

const ALL_COLOURS: Colour[] = ["black", "red", "blue", "white", "green", "yellow"];
const STAT_ORDER = ["shields", "lasers", "fuelTanks", "cargo", "engines", "booster"] as const;

const LABEL: Partial<Record<Action["type"], string>> = {
  drawBooster: "Draw booster",
  drift: "Drift",
  endMove: "End move",
  endTurn: "End turn",
  scrapShip: "Scrap ship",
};

export default function App() {
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
  const [hoverCell, setHoverCell] = useState<Hex | null>(null);

  const s = useSession(prefs, reducedMotion);
  const { state, seats, afford, activeIsBot, isWaitingOnBot, needPassGate, driftGhost } = s;
  const { armed, combatSel, attackTarget } = s.staging;
  const dispatch = s.dispatch;

  const pc = state.pendingCombat;
  const p = state.players[state.activePlayerIndex]!;
  const mode = state.config.modes.prospector;
  const baseStats = mode.ships[p.colour];
  const caps = mode.upgradeCaps;
  const sc = score(state);
  const interactive = !activeIsBot;
  const overLimit = afford.overLimit;

  // --- hand / combat view helpers -------------------------------------
  const handOwner =
    pc && (pc.awaiting === "defend" || pc.awaiting === "counter") ? state.players[pc.defenderId]! : p;
  const handHidden = seats[handOwner.id] === "bot";
  const inBurnPhase =
    !activeIsBot && !pc && state.phase === "start" && p.turn.driftDone && !p.turn.moved && !overLimit;
  const combatCardType: "laser" | "shield" | null =
    pc?.awaiting === "defend" && seats[pc.defenderId] === "human"
      ? "shield"
      : (pc?.awaiting === "counter" && seats[pc.defenderId] === "human") || (!pc && attackTarget !== null)
        ? "laser"
        : null;
  const cardClick = (c: { id: string; type: string }): (() => void) | undefined => {
    if (overLimit) return () => dispatch({ type: "discardBooster", cardId: c.id });
    if (inBurnPhase && (c.type === "engine" || c.type === "reserveFuel")) return () => s.toggleArmed(c.id);
    if (combatCardType && c.type === combatCardType) return () => s.toggleCombatSel(c.id);
    return undefined;
  };
  const pickedIds = (type: "laser" | "shield") =>
    handOwner.hand.filter((c) => c.type === type && combatSel.has(c.id)).map((c) => c.id);
  const sel = (type: "laser" | "shield") =>
    handOwner.hand
      .filter((c) => c.type === type && combatSel.has(c.id))
      .reduce((a, c) => a + (c.value ?? 0), 0);
  const hyperspaceInHand = (pid: number) =>
    state.players[pid]!.hand.find((c) => c.type === "hyperspace")?.id;
  const cardHint =
    inBurnPhase && p.hand.some((c) => c.type === "engine" || c.type === "reserveFuel")
      ? "Click an engine / reserve-fuel card to arm it for this burn (played when you burn)."
      : combatCardType === "shield"
        ? "Click shield cards to add them to your defence."
        : combatCardType === "laser"
          ? "Click laser cards to add them to your attack."
          : null;
  const lastCombat = [...state.log]
    .reverse()
    .find((e) => e.event === "attackSucceeded" || e.event === "attackFailed");

  const statTotal = (k: (typeof STAT_ORDER)[number]) => {
    const t = p.equipment.filter((e) => e.stat === k).reduce((acc, e) => acc + e.amount, baseStats[k]);
    return Math.min(t, caps[k] ?? t);
  };
  const boosterLimit = statTotal("booster");

  // --- board affordances --------------------------------------------
  const highlight: { cells: Hex[]; kind: "load" | "place" | null } = afford.placeCells.length
    ? { cells: afford.placeCells, kind: "place" }
    : afford.loadCells.length
      ? { cells: afford.loadCells, kind: "load" }
      : { cells: [], kind: null };
  const burnPreview = s.burnPreviewFor(hoverCell);

  function onCell(h: Hex) {
    const k = hexKey(h);
    if (afford.placeCells.some((c) => hexKey(c) === k)) return dispatch({ type: "placeShip", cell: h });
    if (afford.loadCells.some((c) => hexKey(c) === k)) return dispatch({ type: "loadResource", from: h });
    const bt = afford.burnTargets.find((b) => hexKey(b.cell) === k);
    if (bt) s.dispatchBurn({ type: "burn", path: bt.path });
  }

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
        <div className="boardwrap">
          <Board
            state={state}
            highlight={interactive ? highlight : { cells: [], kind: null }}
            burnTargets={interactive ? afford.burnTargets : []}
            driftGhost={interactive ? driftGhost : null}
            burnPreview={interactive ? burnPreview : null}
            reducedMotion={reducedMotion}
            onCell={onCell}
            onCellHover={setHoverCell}
          />
        </div>

        <div className="sidebar">
          <div className="sidebar-top">
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
              <h2>Players</h2>
              <div className="roster">
                <div className="rosterrow rosterhead">
                  <span />
                  <span className="rname">ship</span>
                  <span className="rmini" title="ship stats after equipment">S/L/E/C</span>
                  <span title="fuel remaining">fuel</span>
                  <span className="rcargo" title="values of ore currently carried (not yet delivered)">
                    ◆ hold
                  </span>
                  <span className="rscore" title="value of ore delivered home (green 1, yellow 2, red 3)">
                    pts
                  </span>
                </div>
                {state.players.map((pl) => {
                  const st = statsOf(state, pl);
                  return (
                    <div
                      key={pl.id}
                      className={`rosterrow${pl.id === state.activePlayerIndex ? " active" : ""}${
                        pl.eliminated ? " out" : ""
                      }`}
                    >
                      <i className="swatch" style={{ background: `var(--ship-${pl.colour})` }} />
                      <span className="rname">
                        {mode.ships[pl.colour].name}
                        <em>{seats[pl.id] === "bot" ? "bot" : "you"}</em>
                      </span>
                      <span className="rmini" title="shield / laser / engine / cargo">
                        {st.shields}/{st.lasers}/{st.engines}/{st.cargo}
                      </span>
                      <span className="rfuel" title={`fuel ${pl.fuel}/${pl.fuelMax}`}>
                        <i style={{ width: `${(pl.fuel / pl.fuelMax) * 100}%` }} />
                      </span>
                      <span className="rcargo">
                        {pl.cargo.map((c) => mode.resources.values[c]).join("") || "–"}
                      </span>
                      <span className="rscore" title="delivered value">
                        {sc.byPlayer[pl.id]}
                      </span>
                    </div>
                  );
                })}
              </div>
              <p className="hint">
                S/L/E/C = shields / lasers / engines / cargo holds. ◆ hold = ore aboard (at risk in a
                fight); pts = ore delivered home.
              </p>
            </section>

            <section>
              <h2>{activeIsBot ? "Bot ship" : "Active ship"}</h2>
              <div className="pill" style={{ fontWeight: 700 }}>
                <i className="swatch" style={{ background: `var(--ship-${p.colour})` }} />
                {baseStats.name}{" "}
                <span style={{ color: "var(--muted)", fontWeight: 400 }}>({p.colour})</span>
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
                {p.cargo.length === 0 && (
                  <span className="hint" style={{ marginLeft: 4 }}>
                    empty
                  </span>
                )}
                {p.cargo.map((c, i) => (
                  <TileChip key={i} colour={c} value={mode.resources.values[c]} />
                ))}
              </div>
              <div className="tiles">
                delivered:
                {p.delivered.map((c, i) => (
                  <TileChip key={i} colour={c} value={mode.resources.values[c]} />
                ))}
                <span className="hint" style={{ marginLeft: "auto" }}>
                  score {sc.byPlayer[p.id]}
                </span>
              </div>
            </section>

            <section>
              <h2>
                {handOwner.id === state.activePlayerIndex
                  ? "Booster hand"
                  : `${mode.ships[handOwner.colour].name}'s hand`}{" "}
                ({handOwner.hand.length}/{statsOf(state, handOwner).booster})
                {handHidden && <span className="hint"> — hidden</span>}
              </h2>
              {overLimit && !activeIsBot && (
                <p className="hint">Over the limit — click a card to discard.</p>
              )}
              {cardHint && <p className="hint">{cardHint}</p>}
              <div className="hand">
                {handHidden ? (
                  <span className="hint">
                    {handOwner.hand.length} card{handOwner.hand.length === 1 ? "" : "s"}, face down
                  </span>
                ) : handOwner.hand.length === 0 ? (
                  <span className="hint">no cards</span>
                ) : (
                  handOwner.hand.map((c) => {
                    const click = cardClick(c);
                    return (
                      <BoosterCardFace
                        key={c.id}
                        card={c}
                        clickable={!!click}
                        selected={armed.has(c.id) || combatSel.has(c.id)}
                        onClick={click}
                      />
                    );
                  })
                )}
              </div>
            </section>

            <section>
              <h2>Actions</h2>
              {activeIsBot && (
                <p className="hint">
                  🤖 <b>{baseStats.name}</b> ({p.colour}) is playing…
                </p>
              )}
              {isWaitingOnBot && !activeIsBot && <p className="hint">🤖 waiting on the bot…</p>}

              {pc && (
                <div className="combatbox">
                  <p style={{ margin: "0 0 0.3rem", fontWeight: 700 }}>
                    {pc.round > 1 ? "Counter-attack — " : ""}
                    {mode.ships[state.players[pc.attackerId]!.colour].name} attacks{" "}
                    {mode.ships[state.players[pc.defenderId]!.colour].name}
                    {seats[pc.defenderId] === "human" && pc.awaiting === "defend"
                      ? " — your cargo is at stake"
                      : ""}
                  </p>
                  <p className="hint" style={{ marginTop: 0 }}>
                    attack {afford.combat?.attackLasers} laser
                    {pc.attackerLaserBoost ? ` (+${pc.attackerLaserBoost} card)` : ""} + d6 {" vs "}
                    defence {afford.combat?.defenceShields} shield + d6
                  </p>
                  {pc.awaiting === "defend" && seats[pc.defenderId] === "human" && (
                    <div className="actions">
                      <button
                        className="primary"
                        onClick={() =>
                          dispatch({ type: "combatDefend", shieldBoosters: pickedIds("shield") })
                        }
                      >
                        Stand{pickedIds("shield").length ? ` (+${sel("shield")} shield)` : ""}
                      </button>
                      {(() => {
                        const hid = hyperspaceInHand(pc.defenderId);
                        return hid ? (
                          <button onClick={() => dispatch({ type: "combatDefend", hyperspaceBoosterId: hid })}>
                            Flee (hyperspace)
                          </button>
                        ) : null;
                      })()}
                    </div>
                  )}
                  {pc.awaiting === "resolve" &&
                    (seats[pc.attackerId] === "human" || seats[pc.defenderId] === "human") && (
                      <button className="primary" onClick={() => dispatch({ type: "combatResolve" })}>
                        Roll the dice
                      </button>
                    )}
                  {pc.awaiting === "counter" && seats[pc.defenderId] === "human" && (
                    <div className="actions">
                      {afford.counterAttack && (
                        <button
                          className="danger"
                          onClick={() =>
                            dispatch({ ...afford.counterAttack!, laserBoosters: pickedIds("laser") })
                          }
                        >
                          Counter-attack{pickedIds("laser").length ? ` (+${sel("laser")} laser)` : ""}
                        </button>
                      )}
                      <button onClick={() => dispatch({ type: "declineCounter" })}>Decline</button>
                    </div>
                  )}
                </div>
              )}

              {!pc && attackTarget !== null && (
                <div className="combatbox">
                  <p className="hint">
                    Attacking {mode.ships[state.players[attackTarget]!.colour].name}. Pick laser boosters,
                    then declare.
                  </p>
                  <div className="actions">
                    <button
                      className="danger"
                      onClick={() =>
                        dispatch({
                          type: "attack",
                          targetPlayerId: attackTarget,
                          laserBoosters: pickedIds("laser"),
                        })
                      }
                    >
                      Declare attack{pickedIds("laser").length ? ` (+${sel("laser")} laser)` : ""}
                    </button>
                    <button onClick={() => s.setAttackTarget(null)}>Cancel</button>
                  </div>
                </div>
              )}

              <div className="actions" hidden={activeIsBot || !!pc}>
                {afford.plainActions.map((a) => (
                  <button
                    key={a.type}
                    className={a.type === "endTurn" ? "primary" : a.type === "scrapShip" ? "danger" : ""}
                    onClick={() => dispatch(a)}
                  >
                    {LABEL[a.type] ?? a.type}
                  </button>
                ))}
                {attackTarget === null &&
                  afford.attackTargetIds.map((id) => (
                    <button key={`atk-${id}`} className="danger" onClick={() => s.setAttackTarget(id)}>
                      Attack {state.players[id]!.colour}
                    </button>
                  ))}
              </div>

              {!activeIsBot && afford.placeCells.length > 0 && (
                <p className="hint">
                  Launch: click a highlighted base cell to pick your starting field (or just Draw booster
                  to keep the default).
                </p>
              )}
              {!activeIsBot && driftGhost && (
                <p className="hint">Gold outline = where you'll coast to if you drift.</p>
              )}
              {!activeIsBot && afford.burnTargets.length > 0 && (
                <p className="hint">
                  Click a ring to burn there — <span style={{ color: "var(--ok)" }}>●</span> free ·{" "}
                  <span style={{ color: "#d7b13d" }}>●</span> 1 · <span style={{ color: "#e08a3d" }}>●</span>{" "}
                  2 · <span style={{ color: "#c1573c" }}>●</span> 3 fuel. Hover for the path.
                </p>
              )}
              {!activeIsBot && highlight.kind === "load" && (
                <p className="hint">Click a highlighted resource to load it.</p>
              )}
              {lastCombat && !state.pendingCombat && (
                <div className="combat-roll">
                  <Die value={Number(lastCombat.detail?.attackDie ?? 1)} tone="attack" />
                  <Die value={Number(lastCombat.detail?.defenceDie ?? 1)} tone="defence" />
                  <span className="hint">{formatLogEntry(state, lastCombat)}</span>
                </div>
              )}
            </section>
          </div>

          <section className="logsection">
            <h2>Log</h2>
            <div className="log">
              {state.log
                .slice(-60)
                .reverse()
                .map((e, i) => (
                  <div key={i}>
                    <b>t{e.turn}</b> {formatLogEntry(state, e)}
                  </div>
                ))}
            </div>
          </section>
        </div>
      </div>

      {s.setup.open && (
        <div className="pass setup">
          <div className="sub">
            {s.humans === 1
              ? "Choose your ship"
              : `Player ${s.setup.picks.length + 1} of ${s.humans} — choose a ship`}
          </div>
          <div className="shipgrid">
            {ALL_COLOURS.map((c) => {
              const ship = mode.ships[c];
              const taken = s.setup.picks.includes(c);
              return (
                <button key={c} className="shipcard" disabled={taken} onClick={() => s.pickShip(c)}>
                  <span className="pill" style={{ fontWeight: 700 }}>
                    <i className="swatch" style={{ background: `var(--ship-${c})` }} />
                    {ship.name}{" "}
                    <span style={{ color: "var(--muted)", fontWeight: 400 }}>({c})</span>
                  </span>
                  <span className="shipstats">
                    <span>{ship.shields} shield</span>
                    <span>{ship.lasers} laser</span>
                    <span>{ship.engines} engine</span>
                    <span>{ship.cargo} cargo</span>
                    <span>{ship.fuelTanks} fuel</span>
                    <span>{ship.booster} booster</span>
                  </span>
                  {taken && <span className="sub">taken</span>}
                </button>
              );
            })}
          </div>
          <div className="sub">
            {s.bots > 0 && `${s.bots} bot${s.bots === 1 ? "" : "s"} will take random remaining ships.`}
          </div>
        </div>
      )}

      {needPassGate && !s.setup.open && (
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
          <button className="primary" onClick={s.revealTurn}>
            Start turn {state.turnNumber}
          </button>
        </div>
      )}
    </div>
  );
}
