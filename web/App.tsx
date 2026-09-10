import { useMemo, useState } from "react";
import { score } from "../engine/index.js";
import { hexKey } from "../engine/hex.js";
import type { Action, Colour, Hex } from "../engine/index.js";
import { Board, type RadialAction } from "./components/Board.js";
import { BottomPanel, type PanelButton } from "./components/BottomPanel.js";
import { LogOverlay } from "./components/LogOverlay.js";
import { Settings } from "./components/Settings.js";
import { loadPrefs, motionReduced, savePrefs, type Prefs } from "./prefs.js";
import { useSession } from "./useSession.js";

const ALL_COLOURS: Colour[] = ["black", "red", "blue", "white", "green", "yellow"];

const CHIP_LABEL: Partial<Record<Action["type"], string>> = {
  drawBooster: "Draw",
  drift: "Drift",
  endMove: "Coast",
  endTurn: "End turn",
  scrapShip: "Scrap",
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
  const [logOpen, setLogOpen] = useState(false);

  const s = useSession(prefs, reducedMotion);
  const { state, seats, afford, activeIsBot, isWaitingOnBot, needPassGate, driftGhost } = s;
  const { armed, combatSel, attackTarget } = s.staging;
  const dispatch = s.dispatch;

  const pc = state.pendingCombat;
  const p = state.players[state.activePlayerIndex]!;
  const mode = state.config.modes.prospector;
  const baseStats = mode.ships[p.colour];
  const sc = score(state);
  const interactive = !activeIsBot && !needPassGate;
  const overLimit = afford.overLimit;

  // --- hand / combat card helpers -----------------------------------
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

  const cardState = (id: string) => {
    const c = handOwner.hand.find((x) => x.id === id)!;
    let onClick: (() => void) | undefined;
    if (overLimit) onClick = () => dispatch({ type: "discardBooster", cardId: id });
    else if (inBurnPhase && (c.type === "engine" || c.type === "reserveFuel")) onClick = () => s.toggleArmed(id);
    else if (combatCardType && c.type === combatCardType) onClick = () => s.toggleCombatSel(id);
    return { clickable: !!onClick, selected: armed.has(id) || combatSel.has(id), onClick };
  };
  const pickedIds = (type: "laser" | "shield") =>
    handOwner.hand.filter((c) => c.type === type && combatSel.has(c.id)).map((c) => c.id);
  const selSum = (type: "laser" | "shield") =>
    handOwner.hand
      .filter((c) => c.type === type && combatSel.has(c.id))
      .reduce((a, c) => a + (c.value ?? 0), 0);
  const hyperspaceId = state.players[pc?.defenderId ?? -1]?.hand.find((c) => c.type === "hyperspace")?.id;

  const showCards =
    !handHidden &&
    handOwner.hand.length > 0 &&
    (overLimit || inBurnPhase || combatCardType !== null);
  const cardHint = overLimit
    ? "Over the hand limit — tap a card to discard."
    : inBurnPhase && p.hand.some((c) => c.type === "engine" || c.type === "reserveFuel")
      ? "Tap an engine / reserve-fuel card to arm it for this burn."
      : combatCardType === "shield"
        ? "Tap shield cards to add to your defence."
        : combatCardType === "laser"
          ? "Tap laser cards to add to your attack."
          : null;

  // --- combat / bottom-panel buttons -------------------------------
  const combatTitle = pc
    ? `${pc.round > 1 ? "Counter-attack — " : ""}${mode.ships[state.players[pc.attackerId]!.colour].name} attacks ${
        mode.ships[state.players[pc.defenderId]!.colour].name
      }`
    : attackTarget !== null
      ? `Attacking ${mode.ships[state.players[attackTarget]!.colour].name}`
      : null;
  const combatSub = pc
    ? `attack ${afford.combat?.attackLasers} laser + d6  vs  defence ${afford.combat?.defenceShields} shield + d6`
    : attackTarget !== null
      ? "Pick laser boosters, then declare."
      : null;

  const buttons: PanelButton[] = [];
  if (pc && pc.awaiting === "defend" && seats[pc.defenderId] === "human") {
    buttons.push({
      label: `Stand${pickedIds("shield").length ? ` (+${selSum("shield")})` : ""}`,
      kind: "primary",
      onClick: () => dispatch({ type: "combatDefend", shieldBoosters: pickedIds("shield") }),
    });
    if (hyperspaceId)
      buttons.push({ label: "Flee (hyperspace)", onClick: () => dispatch({ type: "combatDefend", hyperspaceBoosterId: hyperspaceId }) });
  } else if (pc && pc.awaiting === "resolve" && (seats[pc.attackerId] === "human" || seats[pc.defenderId] === "human")) {
    buttons.push({ label: "Roll the dice", kind: "primary", onClick: () => dispatch({ type: "combatResolve" }) });
  } else if (pc && pc.awaiting === "counter" && seats[pc.defenderId] === "human") {
    if (afford.counterAttack)
      buttons.push({
        label: `Counter-attack${pickedIds("laser").length ? ` (+${selSum("laser")})` : ""}`,
        kind: "danger",
        onClick: () => dispatch({ ...afford.counterAttack!, laserBoosters: pickedIds("laser") }),
      });
    buttons.push({ label: "Decline", onClick: () => dispatch({ type: "declineCounter" }) });
  } else if (!pc && attackTarget !== null) {
    buttons.push({
      label: `Declare attack${pickedIds("laser").length ? ` (+${selSum("laser")})` : ""}`,
      kind: "danger",
      onClick: () =>
        dispatch({ type: "attack", targetPlayerId: attackTarget, laserBoosters: pickedIds("laser") }),
    });
    buttons.push({ label: "Cancel", onClick: () => s.setAttackTarget(null) });
  }

  // --- radial menu around the active ship --------------------------
  const radial: RadialAction[] = useMemo(() => {
    if (!interactive || pc || attackTarget !== null || overLimit) return [];
    const out: RadialAction[] = afford.plainActions.map((a) => ({
      id: a.type,
      label: CHIP_LABEL[a.type] ?? a.type,
      kind: a.type === "endTurn" ? "primary" : a.type === "scrapShip" ? "danger" : undefined,
      onClick: () => dispatch(a),
    }));
    for (const id of afford.attackTargetIds) {
      out.push({
        id: `atk-${id}`,
        label: `Atk ${state.players[id]!.colour[0]!.toUpperCase()}`,
        kind: "danger",
        onClick: () => s.setAttackTarget(id),
      });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, afford, interactive, pc, attackTarget, overLimit]);

  // --- board affordances ------------------------------------------
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
    <div className="app board-only">
      <div className="topbar">
        <h1>Prospector</h1>
        <span className="turn">
          turn {state.turnNumber} ·{" "}
          <span className="pill">
            <i className="swatch" style={{ background: `var(--ship-${p.colour})` }} />
            {activeIsBot ? `${p.colour} (bot)` : p.colour}
          </span>
        </span>
        <span className="spacer" />
        <button className="ghost" onClick={() => setLogOpen(true)} title="History">
          🕘 log
        </button>
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
          scores={sc.byPlayer}
          highlight={interactive ? highlight : { cells: [], kind: null }}
          burnTargets={interactive ? afford.burnTargets : []}
          driftGhost={interactive ? driftGhost : null}
          burnPreview={interactive ? burnPreview : null}
          radial={radial}
          reducedMotion={reducedMotion}
          onCell={onCell}
          onCellHover={setHoverCell}
        />

        {activeIsBot && <div className="board-toast">🤖 {baseStats.name} is playing…</div>}
        {isWaitingOnBot && !activeIsBot && <div className="board-toast">🤖 waiting on the bot…</div>}
        {state.gameOver && (
          <div className="board-toast win">
            Game over — winner: <b>{sc.winnerIds.map((i) => state.players[i]!.colour).join(", ")}</b>
          </div>
        )}

        <BottomPanel
          cards={showCards ? handOwner.hand : []}
          cardHint={cardHint}
          cardState={cardState}
          combatTitle={combatTitle}
          combatSub={combatSub}
          buttons={buttons}
        />
      </div>

      {logOpen && <LogOverlay state={state} onClose={() => setLogOpen(false)} />}

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
                    {ship.name} <span style={{ color: "var(--muted)", fontWeight: 400 }}>({c})</span>
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
