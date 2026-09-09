import { useEffect, useMemo, useRef, useState } from "react";
import { createGame, applyAction, score, statsOf } from "../engine/game.js";
import { legalActions, greedyBot } from "../engine/index.js";
import { hexKey } from "../engine/hex.js";
import { driftTarget } from "../engine/movement.js";
import { makeRng, type Rng } from "../engine/rng.js";
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

type Seat = "human" | "bot";

function newGame(seats: Seat[]): GameState {
  return createGame({ colours: ALL_COLOURS.slice(0, seats.length), seed: (Math.random() * 1e9) | 0 });
}

function keyToHex(k: string): Hex {
  const [q, r] = k.split(",").map(Number) as [number, number];
  return { q, r };
}

function fmtLog(state: GameState, e: GameState["log"][number]): string {
  const col = (id: unknown) => state.players[Number(id)]?.colour ?? "?";
  const d = (e.detail ?? {}) as Record<string, unknown>;
  switch (e.event) {
    case "boosterPlayed": {
      const cards = (d.cards as { type: string; value: number | null }[])
        .map((c) => `${c.type} ${c.value === null ? "◇" : "+" + c.value}`)
        .join(", ");
      return `${col(d.player)} played ${cards} (${d.context})`;
    }
    case "burned":
      return `${col(d.player)} burned ${d.cells} cell${d.cells === 1 ? "" : "s"}` +
        `${d.fuelSpent ? `, ${d.fuelSpent} fuel` : ", free"}${d.engineBoost ? ` (+${d.engineBoost} eng)` : ""}`;
    case "attackDeclared":
      return `${col(d.attacker)} attacks ${col(d.defender)}${d.laserBoost ? ` (+${d.laserBoost} laser)` : ""}`;
    case "defence":
      return d.autoRepel ? `${col(d.defender)} auto-repels` : `${col(d.defender)} raises shields +${d.shieldBoost}`;
    case "attackSucceeded":
      return `${col(d.attacker)} hits ${col(d.defender)} (${d.attackTotal}–${d.defenceTotal}) — ${col(d.attacker)} takes a ${d.spoil} from ${col(d.defender)}`;
    case "attackFailed":
      return `${col(d.attacker)}'s attack repelled by ${col(d.defender)} (${d.attackTotal}–${d.defenceTotal})${
        d.defenceTotal === d.attackTotal ? " — tie, defender wins; they may counter-attack" : "; defender may counter-attack"
      }`;
    case "defenderFled":
      return `${col(d.defender)} flees through hyperspace`;
    case "loaded":
      return `${col(d.player)} loads a ${d.colour}`;
    case "delivered":
      return `${col(d.player)} delivers ${(d.tiles as string[]).join(", ")}`;
    case "equipped":
      return `${col(d.player)} installs equipment`;
    case "shipLost":
      return `${col(d.player)} loses the ship (${d.reason})`;
    case "shipEliminated":
      return `${col(d.player)} is eliminated`;
    case "shipPlaced":
      return `${col(d.player)} launches`;
    default:
      return `${state.players[e.player]?.colour ?? ""} — ${e.event}`;
  }
}

const mkSeats = (humans: number, bots: number): Seat[] => [
  ...Array<Seat>(humans).fill("human"),
  ...Array<Seat>(bots).fill("bot"),
];

export default function App() {
  const [humans, setHumans] = useState(1);
  const [bots, setBots] = useState(2);
  const [seats, setSeats] = useState<Seat[]>(() => mkSeats(1, 2));
  const [game0] = useState(() => newGame(mkSeats(1, 2)));
  const [state, setState] = useState<GameState>(game0);
  const [shownPlayer, setShownPlayer] = useState(game0.activePlayerIndex);
  const [hoverCell, setHoverCell] = useState<Hex | null>(null);
  const botRng = useRef<Rng>(makeRng(0x5eed));
  // booster cards the human has staged: armed for the coming burn, or picked for a fight
  const [armed, setArmed] = useState<Set<string>>(new Set());
  const [combatSel, setCombatSel] = useState<Set<string>>(new Set());
  const [attackTarget, setAttackTarget] = useState<number | null>(null);
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
    setSeats(Array<Seat>(s.players.length).fill("human")); // freeze bot autoplay for screenshots
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const p = state.players[state.activePlayerIndex]!;
  const mode = state.config.modes.prospector;
  const baseStats = mode.ships[p.colour];
  const caps = mode.upgradeCaps;
  const sc = score(state);

  const armedEngine = p.hand
    .filter((c) => c.type === "engine" && armed.has(c.id))
    .reduce((a, c) => a + (c.value ?? 0), 0);
  const armedFuel = p.hand
    .filter((c) => c.type === "reserveFuel" && armed.has(c.id))
    .reduce((a, c) => a + (c.value ?? 0), 0);
  const acts = useMemo(
    () => legalActions(state, { extraEngines: armedEngine, extraFuel: armedFuel }),
    [state, armedEngine, armedFuel],
  );

  const clearStaging = () => {
    setArmed(new Set());
    setCombatSel(new Set());
    setAttackTarget(null);
  };
  function dispatch(a: Action) {
    const r = applyAction(state, a);
    if (r.ok) {
      setState(r.state);
      setHoverCell(null);
      clearStaging();
    } else console.warn("rejected", a, r.error);
  }
  function reset(nextSeats: Seat[] = seats) {
    const g = newGame(nextSeats);
    setSeats(nextSeats);
    setState(g);
    setShownPlayer(g.activePlayerIndex);
    botRng.current = makeRng((Math.random() * 1e9) | 0);
  }

  const humansCount = seats.filter((s) => s === "human").length;
  const activeIsBot = seats[state.activePlayerIndex] === "bot";
  const interactive = !activeIsBot; // affordances shown only on a human's turn

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

  const armedEngineIds = p.hand.filter((c) => c.type === "engine" && armed.has(c.id)).map((c) => c.id);
  const armedFuelIds = p.hand.filter((c) => c.type === "reserveFuel" && armed.has(c.id)).map((c) => c.id);

  function dispatchBurn(burn: Extract<Action, { type: "burn" }>) {
    dispatch(
      armedEngineIds.length || armedFuelIds.length
        ? { ...burn, engineBoosters: armedEngineIds, reserveFuelBoosters: armedFuelIds }
        : burn,
    );
  }

  function onCell(h: Hex) {
    const k = hexKey(h);
    if (placeKeys.has(k)) return dispatch({ type: "placeShip", cell: h });
    if (loadCells.some((c) => hexKey(c) === k)) return dispatch({ type: "loadResource", from: h });
    const burn = burnByCell.get(k);
    if (burn) dispatchBurn(burn);
  }

  // the pass-the-device gate only matters with 2+ humans sharing one screen
  const needPassGate =
    humansCount >= 2 &&
    !state.gameOver &&
    !activeIsBot &&
    shownPlayer !== state.activePlayerIndex;

  // whose input the game is waiting on right now (attacker for the dice roll, else defender / active)
  const pc = state.pendingCombat;
  const waitingOn = pc
    ? pc.awaiting === "resolve"
      ? pc.attackerId
      : pc.defenderId
    : state.activePlayerIndex;
  const waitingOnBot = !state.gameOver && !needPassGate && seats[waitingOn] === "bot";

  // bots (and bot-vs-bot combat) resolve themselves, with a visible beat between moves
  useEffect(() => {
    if (!waitingOnBot) return;
    const id = setTimeout(() => {
      const a = greedyBot(state, botRng.current);
      const r = applyAction(state, a);
      setState(r.ok ? r.state : applyAction(state, legalActions(state)[0]!).state);
    }, reducedMotion ? 60 : 340);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, waitingOnBot, reducedMotion]);

  // --- booster / combat staging helpers -------------------------------------
  const handOwner =
    pc && (pc.awaiting === "defend" || pc.awaiting === "counter") ? state.players[pc.defenderId]! : p;
  const handHidden = seats[handOwner.id] === "bot";
  const counterAttack = pc?.awaiting === "counter" ? acts.find((a) => a.type === "attack") : undefined;

  const inBurnPhase =
    !activeIsBot && !pc && state.phase === "start" && p.turn.driftDone && !p.turn.moved && !overLimit;
  const combatCardType: "laser" | "shield" | null =
    pc?.awaiting === "defend" && seats[pc.defenderId] === "human"
      ? "shield"
      : (pc?.awaiting === "counter" && seats[pc.defenderId] === "human") || (!pc && attackTarget !== null)
        ? "laser"
        : null;

  const toggle = (setter: typeof setArmed, id: string) =>
    setter((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  const cardClick = (c: { id: string; type: string }): (() => void) | undefined => {
    if (overLimit) return () => dispatch({ type: "discardBooster", cardId: c.id });
    if (inBurnPhase && (c.type === "engine" || c.type === "reserveFuel")) return () => toggle(setArmed, c.id);
    if (combatCardType && c.type === combatCardType) return () => toggle(setCombatSel, c.id);
    return undefined;
  };
  const pickedIds = (type: "laser" | "shield") =>
    handOwner.hand.filter((c) => c.type === type && combatSel.has(c.id)).map((c) => c.id);
  const sel = (type: "laser" | "shield") =>
    handOwner.hand.filter((c) => c.type === type && combatSel.has(c.id)).reduce((a, c) => a + (c.value ?? 0), 0);
  const hyperspaceInHand = (pid: number) =>
    state.players[pid]!.hand.find((c) => c.type === "hyperspace")?.id;

  const cardHint = inBurnPhase && p.hand.some((c) => c.type === "engine" || c.type === "reserveFuel")
    ? "Click an engine / reserve-fuel card to arm it for this burn (played when you burn)."
    : combatCardType === "shield"
      ? "Click shield cards to add them to your defence."
      : combatCardType === "laser"
        ? "Click laser cards to add them to your attack."
        : null;
  const lastCombat = [...state.log].reverse().find((e) => e.event === "attackSucceeded" || e.event === "attackFailed");

  // auto-advance: when the player has no real choice, take the move for them
  // Never auto-resolve a genuine decision: declining a counter-attack, which booster to
  // discard, or the turn-start scrap-vs-draw choice. scrapShip stays in the count so that
  // "scrap or draw" reads as two options and auto-advance holds off.
  const AUTO_HIDE = new Set<Action["type"]>([
    "declineCounter",
    "discardBooster",
    "combatDefend",
    "combatResolve",
  ]);
  const autoCandidates = acts.filter(
    (a) => !AUTO_HIDE.has(a.type) && (a.type !== "endTurn" || prefs.autoEndTurn),
  );
  const autoAction =
    prefs.autoSingle &&
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
          humans{" "}
          <select
            value={humans}
            onChange={(e) => {
              const h = Number(e.target.value);
              const b = Math.min(bots, 6 - h);
              setHumans(h);
              setBots(b);
              reset(mkSeats(h, b));
            }}
          >
            {[1, 2, 3, 4, 5, 6].map((n) => (
              <option key={n} value={n} disabled={n + bots > 6 || n + bots < 2}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <label className="turn">
          bots{" "}
          <select
            value={bots}
            onChange={(e) => {
              const b = Number(e.target.value);
              setBots(b);
              reset(mkSeats(humans, b));
            }}
          >
            {[0, 1, 2, 3, 4, 5].map((n) => (
              <option key={n} value={n} disabled={humans + n < 2 || humans + n > 6}>
                {n}
              </option>
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
            highlight={interactive ? highlight : { cells: [], kind: null }}
            burnTargets={interactive ? burnTargets : []}
            driftGhost={interactive ? driftGhost : null}
            burnPreview={interactive ? burnPreview : null}
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
            <h2>Players</h2>
            <div className="roster">
              {state.players.map((pl) => {
                const s = statsOf(state, pl);
                return (
                  <div
                    key={pl.id}
                    className={`rosterrow${pl.id === state.activePlayerIndex ? " active" : ""}${pl.eliminated ? " out" : ""}`}
                  >
                    <i className="swatch" style={{ background: `var(--ship-${pl.colour})` }} />
                    <span className="rname">
                      {mode.ships[pl.colour].name}
                      <em>{seats[pl.id] === "bot" ? "bot" : "you"}</em>
                    </span>
                    <span className="rmini" title="shield / laser / engine / cargo">
                      {s.shields}/{s.lasers}/{s.engines}/{s.cargo}
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
          </section>

          <section>
            <h2>{activeIsBot ? "Bot ship" : "Active ship"}</h2>
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
            <h2>
              {handOwner.id === state.activePlayerIndex ? "Booster hand" : `${mode.ships[handOwner.colour].name}'s hand`}{" "}
              ({handOwner.hand.length}/{statsOf(state, handOwner).booster})
              {handHidden && <span className="hint"> — hidden</span>}
            </h2>
            {overLimit && !activeIsBot && <p className="hint">Over the limit — click a card to discard.</p>}
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
            {waitingOnBot && !activeIsBot && <p className="hint">🤖 waiting on the bot…</p>}

            {/* combat */}
            {pc && (
              <div className="combatbox">
                <p style={{ margin: "0 0 0.3rem", fontWeight: 700 }}>
                  {pc.round > 1 ? "Counter-attack — " : ""}
                  {mode.ships[state.players[pc.attackerId]!.colour].name} attacks {mode.ships[state.players[pc.defenderId]!.colour].name}
                  {seats[pc.defenderId] === "human" && pc.awaiting === "defend" ? " — your cargo is at stake" : ""}
                </p>
                <p className="hint" style={{ marginTop: 0 }}>
                  attack {statsOf(state, state.players[pc.attackerId]!).lasers + pc.attackerLaserBoost} laser
                  {pc.attackerLaserBoost ? ` (+${pc.attackerLaserBoost} card)` : ""} + d6
                  {" vs "}
                  defence {pc.defShields ?? statsOf(state, state.players[pc.defenderId]!).shields} shield + d6
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
                {pc.awaiting === "resolve" && (seats[pc.attackerId] === "human" || seats[pc.defenderId] === "human") && (
                  <button className="primary" onClick={() => dispatch({ type: "combatResolve" })}>
                    Roll the dice
                  </button>
                )}
                {pc.awaiting === "counter" && seats[pc.defenderId] === "human" && (
                  <div className="actions">
                    {counterAttack && (
                      <button
                        className="danger"
                        onClick={() => dispatch({ ...counterAttack, laserBoosters: pickedIds("laser") })}
                      >
                        Counter-attack{pickedIds("laser").length ? ` (+${sel("laser")} laser)` : ""}
                      </button>
                    )}
                    <button onClick={() => dispatch({ type: "declineCounter" })}>Decline</button>
                  </div>
                )}
              </div>
            )}

            {/* attack declaration */}
            {!pc && attackTarget !== null && (
              <div className="combatbox">
                <p className="hint">
                  Attacking {mode.ships[state.players[attackTarget]!.colour].name}. Pick laser boosters, then declare.
                </p>
                <div className="actions">
                  <button
                    className="danger"
                    onClick={() =>
                      dispatch({ type: "attack", targetPlayerId: attackTarget, laserBoosters: pickedIds("laser") })
                    }
                  >
                    Declare attack{pickedIds("laser").length ? ` (+${sel("laser")} laser)` : ""}
                  </button>
                  <button onClick={() => setAttackTarget(null)}>Cancel</button>
                </div>
              </div>
            )}

            <div className="actions" hidden={activeIsBot || !!pc}>
              {plainActs.map((a) => (
                <button
                  key={a.type}
                  className={a.type === "endTurn" ? "primary" : a.type === "scrapShip" ? "danger" : ""}
                  onClick={() => dispatch(a)}
                >
                  {LABEL[a.type]}
                </button>
              ))}
              {attackTarget === null &&
                attackActs.map((a) => (
                  <button key={`atk-${a.targetPlayerId}`} className="danger" onClick={() => setAttackTarget(a.targetPlayerId)}>
                    Attack {state.players[a.targetPlayerId]!.colour}
                  </button>
                ))}
            </div>
            {!activeIsBot && placeCells.length > 0 && (
              <p className="hint">Launch: click a highlighted base cell to pick your starting field (or just Draw booster to keep the default).</p>
            )}
            {!activeIsBot && driftGhost && <p className="hint">Gold outline = where you'll coast to if you drift.</p>}
            {!activeIsBot && burnTargets.length > 0 && (
              <p className="hint">
                Click a ring to burn there — <span style={{ color: "var(--ok)" }}>●</span> free ·{" "}
                <span style={{ color: "#d7b13d" }}>●</span> 1 ·{" "}
                <span style={{ color: "#e08a3d" }}>●</span> 2 ·{" "}
                <span style={{ color: "#c1573c" }}>●</span> 3 fuel. Hover for the path.
              </p>
            )}
            {!activeIsBot && highlight.kind === "load" && <p className="hint">Click a highlighted resource to load it.</p>}
            {lastCombat && !state.pendingCombat && (
              <div className="combat-roll">
                <Die value={Number(lastCombat.detail?.attackDie ?? 1)} tone="attack" />
                <Die value={Number(lastCombat.detail?.defenceDie ?? 1)} tone="defence" />
                <span className="hint">{fmtLog(state, lastCombat)}</span>
              </div>
            )}
          </section>

          <section>
            <h2>Log</h2>
            <div className="log">
              {state.log.slice(-18).reverse().map((e, i) => (
                <div key={i}>
                  <b>t{e.turn}</b> {fmtLog(state, e)}
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
