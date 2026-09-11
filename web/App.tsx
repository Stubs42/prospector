import { useState } from "react";
import { score } from "../engine/index.js";
import { boardFor } from "../engine/game.js";
import { hexKey } from "../engine/hex.js";
import type { BoardModel } from "../engine/board.js";
import type { Colour, Hex } from "../engine/index.js";
import { Board } from "./components/Board.js";
import { BottomPanel, type PanelButton } from "./components/BottomPanel.js";
import { LogOverlay } from "./components/LogOverlay.js";
import { Settings } from "./components/Settings.js";
import { axialToPixel, pixelToAxial, towardOrigin } from "./components/hexpx.js";
import { loadPrefs, motionReduced, savePrefs, type Prefs } from "./prefs.js";
import { useSession } from "./useSession.js";

const ALL_COLOURS: Colour[] = ["black", "red", "blue", "white", "green", "yellow"];

/** a cell a few steps inward from a base, where that base's guidance popup sits */
function launchAnchor(board: BoardModel, colour: Colour): Hex {
  const cs = board.baseCells(colour);
  const q = cs.reduce((a, c) => a + c.q, 0) / cs.length;
  const r = cs.reduce((a, c) => a + c.r, 0) / cs.length;
  const { x, y } = axialToPixel({ q, r });
  const pulled = towardOrigin(x, y, 150);
  return pixelToAxial(pulled.x, pulled.y);
}

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
  const [scrapConfirmOpen, setScrapConfirmOpen] = useState(
    () => typeof location !== "undefined" && new URLSearchParams(location.search).get("scrap") === "1",
  );

  const s = useSession(prefs, reducedMotion);
  const { state, seats, afford, activeIsBot, isWaitingOnBot, needPassGate, driftGhost } = s;
  const { armed, combatSel, attackTarget } = s.staging;
  const dispatch = s.dispatch;

  const pc = state.pendingCombat;
  const p = state.players[state.activePlayerIndex]!;
  const board = boardFor(state);
  const mode = state.config.modes.prospector;
  const baseStats = mode.ships[p.colour];
  const sc = score(state);
  const inSetup = s.setup.open;
  const anim = s.animLive; // a move is actively playing — hold back prompts/targets
  const suppress = anim || scrapConfirmOpen; // also true while the scrap confirm dialog is up
  const interactive = !inSetup && !activeIsBot && !needPassGate;
  const overLimit = afford.overLimit;
  // turn 1: the ship must be placed on a base cell before anything else
  const launchPhase = interactive && !pc && afford.placeCells.length > 0;

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

  const canRefuel = (id: string) => afford.legal.some((a) => a.type === "useReserveFuel" && a.cardId === id);
  const cardState = (id: string) => {
    const c = handOwner.hand.find((x) => x.id === id)!;
    let onClick: (() => void) | undefined;
    if (overLimit) onClick = () => dispatch({ type: "discardBooster", cardId: id });
    // reserve fuel isn't armed for a later burn — it's used up the instant it's clicked
    else if (inBurnPhase && c.type === "reserveFuel" && canRefuel(id))
      onClick = () => dispatch({ type: "useReserveFuel", cardId: id });
    else if (inBurnPhase && c.type === "engine") onClick = () => s.toggleArmed(id);
    else if (combatCardType && c.type === combatCardType) onClick = () => s.toggleCombatSel(id);
    const pulse: "urgent" | "new" | "ready" | null = overLimit
      ? "urgent"
      : s.newCardIds.has(id)
        ? "new"
        : onClick
          ? "ready"
          : null;
    return { clickable: !!onClick, selected: armed.has(id) || combatSel.has(id), onClick, pulse };
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
    (overLimit || inBurnPhase || combatCardType !== null || s.newCardIds.size > 0);
  const cardHint = overLimit
    ? null // the centred hex popup carries this message instead
    : inBurnPhase && p.hand.some((c) => c.type === "engine" || c.type === "reserveFuel")
      ? "Tap an engine card to arm it for this burn, or a reserve-fuel card to refuel now."
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
  const freeBaseColours = ALL_COLOURS.filter((c) => !s.setup.picks.includes(c));
  const colourAtCell = (h: Hex): Colour | null => {
    const k = hexKey(h);
    return ALL_COLOURS.find((c) => board.baseCells(c).some((b) => hexKey(b) === k)) ?? null;
  };

  const highlight: { cells: Hex[]; kind: "place" | "base" | null } = inSetup
    ? { cells: freeBaseColours.flatMap((c) => [...board.baseCells(c)]), kind: "base" }
    : afford.placeCells.length
      ? { cells: afford.placeCells, kind: "place" }
      : { cells: [], kind: null };
  // loadable resources pulse the ore chip itself instead of a separate ring
  const loadCellsForBoard = boardActive ? afford.loadCells : [];
  const attackTargets = boardActive ? afford.attackTargetIds : [];
  const onAttackTarget = (id: number) => s.setAttackTarget(id);

  // guidance popup: where the next action is, and what it is
  const popup: { center: Hex; lines: string[] } | null = inSetup
    ? {
        center: { q: 0, r: 0 },
        lines:
          s.humans > 1
            ? ["Please select your base", `player ${s.setup.picks.length + 1} of ${s.humans}`]
            : ["Please select", "your base"],
      }
    : launchPhase
      ? { center: launchAnchor(board, p.colour), lines: ["Select your", "launch cell"] }
      : interactive && overLimit
        ? { center: { q: 0, r: 0 }, lines: ["Too many cards!", "Discard one to continue"] }
        : null;

  // clicking your own base (off a burn target) asks to scrap — available any time during the move
  const scrapCells = interactive && !pc && attackTarget === null && !launchPhase ? board.baseCells(p.colour) : [];
  const scrapConfirm =
    scrapConfirmOpen && scrapCells.length
      ? {
          center: { q: 0, r: 0 } as Hex,
          lines: ["So you really want to", "scrap your ship?"],
          onYes: () => {
            dispatch({ type: "scrapShip" });
            setScrapConfirmOpen(false);
          },
          onCancel: () => setScrapConfirmOpen(false),
        }
      : null;

  const burnPreview = s.burnPreviewFor(hoverCell);
  function onCell(h: Hex) {
    if (inSetup) {
      const col = colourAtCell(h);
      if (col && freeBaseColours.includes(col)) s.pickBase(col);
      return;
    }
    const k = hexKey(h);
    if (afford.placeCells.some((c) => hexKey(c) === k)) return dispatch({ type: "placeShip", cell: h });
    if (afford.loadCells.some((c) => hexKey(c) === k)) return dispatch({ type: "loadResource", from: h });
    const bt = afford.burnTargets.find((b) => hexKey(b.cell) === k);
    if (bt) return s.dispatchBurn({ type: "burn", path: bt.path });
    // your own base, and not a burn target right now (arriving home is not scrapping)
    if (scrapCells.some((c) => hexKey(c) === k)) setScrapConfirmOpen(true);
  }

  return (
    <div className="app board-only">
      <div className="topbar">
        <h1>Prospector</h1>
        <span className="turn">
          {inSetup ? (
            "new game"
          ) : (
            <>
              turn {state.turnNumber} ·{" "}
              <span className="pill">
                <i className="swatch" style={{ background: `var(--ship-${p.colour})` }} />
                {activeIsBot ? `${p.colour} (bot)` : p.colour}
              </span>
            </>
          )}
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
          highlight={suppress ? { cells: [], kind: null } : interactive || inSetup ? highlight : { cells: [], kind: null }}
          loadCells={loadCellsForBoard}
          burnTargets={interactive && !suppress ? afford.burnTargets : []}
          driftGhost={interactive && !suppress ? driftGhost : null}
          burnPreview={interactive && !suppress ? burnPreview : null}
          onCoast={suppress ? null : onCoast}
          scrapCells={anim ? [] : scrapCells}
          attackTargets={attackTargets}
          onAttackTarget={onAttackTarget}
          endTurnReady={endTurnReady}
          onEndTurn={onEndTurn}
          confirm={scrapConfirm}
          popup={suppress ? null : popup}
          world={!inSetup}
          reducedMotion={reducedMotion}
          moveAnim={s.moveAnim}
          onMoveAnimEnd={s.endMoveAnim}
          onCell={onCell}
          onCellHover={setHoverCell}
        />

        {!inSetup && activeIsBot && <div className="board-toast">🤖 {baseStats.name} is playing…</div>}
        {!inSetup && isWaitingOnBot && !activeIsBot && (
          <div className="board-toast">🤖 waiting on the bot…</div>
        )}
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
          equipment={
            interactive && afford.equipmentChoice
              ? afford.equipmentChoice.map((c) => ({ id: c.id, stat: c.stat, amount: c.amount, effect: c.effect }))
              : []
          }
          onEquip={(id) => dispatch({ type: "chooseEquipment", cardId: id })}
          urgent={overLimit}
        />
      </div>

      {logOpen && <LogOverlay state={state} onClose={() => setLogOpen(false)} />}

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
