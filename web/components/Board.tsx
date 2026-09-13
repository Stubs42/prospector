import { useCallback, useEffect, useReducer, useRef, useState, type PointerEvent as RPointerEvent } from "react";
import { boardFor } from "../../engine/game.js";
import { hexKey } from "../../engine/hex.js";
import type { GameState, Hex, Colour, OreColour } from "../../engine/index.js";
import { SHIP_VAR, ORE_VAR } from "./kit.js";
import { BaseInfo, type TipFn } from "./BaseInfo.js";
import { HexPopup, type HexPopupAction } from "./HexPopup.js";
import { ShipMarker } from "./ShipMarker.js";
import { ShipPickerPopup, type ShipPickerProps } from "./ShipPickerPopup.js";
import { CombatBox, type CombatBoxProps } from "./CombatBox.js";
import { moveFrame, animDone, type MoveAnim } from "../anim.js";
import type { Seat } from "../../client/index.js";
import { clusterOutline, pointsAttr } from "./hexOutline.js";
import { rotatePoint } from "./hexpx.js";

export { S } from "./geo.js";
import { S } from "./geo.js";

function hexPoints(cx: number, cy: number, size: number): string {
  const pts: string[] = [];
  for (let i = 0; i < 6; i++) {
    const a = ((60 * i - 90) * Math.PI) / 180; // pointy-top
    pts.push(`${(cx + size * Math.cos(a)).toFixed(2)},${(cy + size * Math.sin(a)).toFixed(2)}`);
  }
  return pts.join(" ");
}

export interface BoardProps {
  state: GameState;
  seats: readonly Seat[];
  scores: readonly number[];
  highlight: { cells: Hex[]; kind: "place" | "base" | null };
  /** during a "pick a random base" spin: the one base region to trace solid (not pulsing) */
  spinHighlight?: Colour | null;
  /** a single-cell marker for the coordinate-dice spin (initial resource seeding, hyperspace) —
     a ring "landing" on a cell, narrowing in step by step */
  spinPoint?: Hex | null;
  /** the "3 nested wheels" coordinate-dice spin: a dot per settled round-center, the line
     path connecting them so far, and (while a round is still spinning) a rotating mark
     cycling live around the last dot before it settles into the next dot */
  spinPath?: { dots: Hex[]; live: Hex | null } | null;
  /** resource cells the active player can load from right now — the ore chip itself pulses */
  loadCells: readonly Hex[];
  burnTargets: { cell: Hex; cost: number }[];
  driftGhost: { at: Hex; from: Hex } | null;
  burnPreview: { path: Hex[]; cost: number } | null;
  onCoast: (() => void) | null;
  /** the active player's own base cells — clicking one (off a burn target) asks to scrap */
  scrapCells: readonly Hex[];
  /** enemy players the active player can attack right now — their ship ring pulses */
  attackTargets: readonly number[];
  onAttackTarget: (id: number) => void;
  /** the active player's own ship can be clicked to end the turn (post-move, nothing else pending) */
  endTurnReady: boolean;
  onEndTurn: (() => void) | null;
  /** a confirm dialog (e.g. "scrap your ship?") drawn centred, dimming the rest of the board */
  confirm: { center: Hex; lines: string[]; onYes: () => void; onCancel: () => void } | null;
  /** guidance popup drawn in board space; null when no action is pending */
  popup: { center: Hex; lines: string[]; actions?: HexPopupAction[] | undefined; radius?: number | undefined } | null;
  /** the pickShip stage's whole UI (a ship card + browse/select/random) — mutually
     exclusive with `popup` in practice, since it replaces the guidance popup for that stage */
  shipPicker?: ShipPickerProps | null;
  /** combat's whole board-native UI — mutually exclusive with `popup` in practice */
  combatBox?: Omit<CombatBoxProps, "rotation"> | null;
  /** false during base selection: draw only the empty field + highlights + popup */
  world: boolean;
  reducedMotion: boolean;
  /** an in-flight move to play out; null when the board is settled */
  moveAnim: MoveAnim | null;
  onMoveAnimEnd: () => void;
  onCell: (h: Hex) => void;
  onCellHover: (h: Hex | null) => void;
}

/** cost 0 = free (green), 1 = yellow, 2 = orange, 3 = red */
const BURN_COST_COLOUR = ["var(--ok)", "#d7b13d", "#e08a3d", "#c1573c"];

export function Board({
  state,
  seats,
  scores,
  highlight,
  spinHighlight = null,
  spinPoint = null,
  spinPath = null,
  loadCells,
  burnTargets,
  driftGhost,
  burnPreview,
  onCoast,
  scrapCells,
  attackTargets,
  onAttackTarget,
  endTurnReady,
  onEndTurn,
  confirm,
  popup,
  shipPicker = null,
  combatBox = null,
  world,
  reducedMotion,
  moveAnim,
  onMoveAnimEnd,
  onCell,
  onCellHover,
}: BoardProps) {
  const board = boardFor(state);
  const cells = board.allCells();
  // a base region is only coloured once its ship is known — base and ship are picked
  // independently, so the six board positions carry no inherent colour of their own.
  const baseColourOf = new Map<Colour, Colour>();
  if (state.setup) {
    state.setup.bases.forEach((b, seat) => {
      const c = state.setup!.colours[seat];
      if (b && c) baseColourOf.set(b, c);
    });
  } else {
    for (const pl of state.players) baseColourOf.set(pl.homeBase, pl.colour);
  }
  const xs = cells.map((c) => c.x * S);
  const ys = cells.map((c) => c.y * S);
  // "fit" viewBox: the whole field + a margin so nothing hugs the frame. Pan/zoom rides on top.
  const m = 58;
  const minx = Math.min(...xs) - m;
  const miny = Math.min(...ys) - m;
  const w = Math.max(...xs) - Math.min(...xs) + m * 2;
  const h = Math.max(...ys) - Math.min(...ys) + m * 2;
  const fitCx = minx + w / 2;
  const fitCy = miny + h / 2;

  // --- board rotation -----------------------------------------------------
  // logical, not graphical: a hex tile is unchanged by a 60° turn, so this just relabels
  // which screen position each cell's centre lands on — every tile still draws upright, so
  // text/tooltips/popups never need to know rotation happened (see hexpx.ts's rotatePoint).
  const [rotation, setRotation] = useState(0); // 0..5, each step = 60°
  const rotate = (p: { x: number; y: number }) => rotatePoint(p.x, p.y, rotation);

  // --- board pan / zoom -------------------------------------------------
  const MIN_Z = 0.6;
  const MAX_Z = 6;
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [view, setView] = useState<{ cx: number; cy: number; z: number } | null>(null);
  const v = view ?? { cx: fitCx, cy: fitCy, z: 1 };
  const vb = { x: v.cx - w / v.z / 2, y: v.cy - h / v.z / 2, w: w / v.z, h: h / v.z };
  const dragRef = useRef<{ x: number; y: number; cx: number; cy: number; moved: boolean } | null>(null);
  const pannedRef = useRef(false);

  const toBoard = useCallback((clientX: number, clientY: number) => {
    const el = svgRef.current;
    if (!el) return { bx: v.cx, by: v.cy };
    const r = el.getBoundingClientRect();
    const s = Math.min(r.width / vb.w, r.height / vb.h);
    const bx = vb.x + (clientX - r.left - (r.width - vb.w * s) / 2) / s;
    const by = vb.y + (clientY - r.top - (r.height - vb.h * s) / 2) / s;
    return { bx, by };
  }, [v.cx, v.cy, vb.x, vb.y, vb.w, vb.h]);

  const fit = () => setView(null);

  const zoomBy = useCallback((factor: number, atClientX?: number, atClientY?: number) => {
    setView((prev) => {
      const cur = prev ?? { cx: fitCx, cy: fitCy, z: 1 };
      const z = Math.min(MAX_Z, Math.max(MIN_Z, cur.z * factor));
      if (z === cur.z) return prev;
      let { cx, cy } = cur;
      if (atClientX !== undefined && atClientY !== undefined) {
        const { bx, by } = toBoard(atClientX, atClientY);
        cx = bx - (bx - cur.cx) * (cur.z / z);
        cy = by - (by - cur.cy) * (cur.z / z);
      }
      return { cx, cy, z };
    });
  }, [fitCx, fitCy, toBoard]);

  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      zoomBy(Math.exp(-e.deltaY * 0.0015), e.clientX, e.clientY);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoomBy]);

  const onPointerDown = (e: RPointerEvent<SVGSVGElement>) => {
    if (e.button !== 1) return; // middle-drag pans; left stays free for board clicks
    e.preventDefault();
    pannedRef.current = false;
    dragRef.current = { x: e.clientX, y: e.clientY, cx: v.cx, cy: v.cy, moved: false };
  };
  const onPointerMove = (e: RPointerEvent<SVGSVGElement>) => {
    const d = dragRef.current;
    if (!d) return;
    const el = svgRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const s = Math.min(r.width / vb.w, r.height / vb.h);
    const dx = (e.clientX - d.x) / s;
    const dy = (e.clientY - d.y) / s;
    if (!d.moved && Math.hypot(e.clientX - d.x, e.clientY - d.y) < 4) return;
    d.moved = true;
    pannedRef.current = true;
    el.setPointerCapture(e.pointerId);
    setView({ cx: d.cx - dx, cy: d.cy - dy, z: v.z });
  };
  const endPan = (e: RPointerEvent<SVGSVGElement>) => {
    dragRef.current = null;
    pannedRef.current = false;
    if (svgRef.current?.hasPointerCapture(e.pointerId)) svgRef.current.releasePointerCapture(e.pointerId);
  };

  const [tip, setTip] = useState<{ text: string; x: number; y: number } | null>(null);
  const onTip: TipFn = (text, e) => {
    if (!text || dragRef.current?.moved) { setTip(null); return; }
    const r = svgRef.current?.getBoundingClientRect();
    setTip({ text, x: e.clientX - (r?.left ?? 0), y: e.clientY - (r?.top ?? 0) });
  };
  /** clicking a tipped target can remove it from the DOM before onMouseLeave ever
     fires (chip consumed, ship un-attackable, cell no longer pickable) — clear
     the tooltip explicitly at the click site instead of relying on mouseleave */
  const clicked = (fn: () => void) => () => { setTip(null); fn(); };

  const hi = new Set(highlight.cells.map(hexKey));
  const scrapSet = new Set(scrapCells.map(hexKey));
  const loadSet = new Set(loadCells.map(hexKey));
  const px = (hx: Hex) => {
    const c = board.cell(hx);
    if (c) return rotate({ x: c.x * S, y: c.y * S });
    return rotate({ x: S * Math.sqrt(3) * (hx.q + hx.r / 2), y: S * 1.5 * hx.r });
  };

  // a message/action hexagon (guidance popup, ship picker, combat box, confirm dialog) is
  // anchored to a board cell so it still follows its ship/base while panning, but its own
  // size is specified in board units — without this, zooming the board in or out would
  // inflate or shrink it right along with the cells, which reads as the box "colliding"
  // with the zoom/pan controls. Scaling the group by 1/z around its own anchor point
  // exactly cancels the zoom factor the surrounding viewBox applies, so the box keeps a
  // constant screen size at any zoom level while panning still moves it correctly (it's
  // still just translated board content, like anything else on the board).
  const zoomLock = (center: Hex): string => {
    const o = px(center);
    return `translate(${o.x} ${o.y}) scale(${1 / v.z}) translate(${-o.x} ${-o.y})`;
  };

  // players are empty during interactive setup's pickBase/pickShip stages — everything that
  // dereferences `active` below is itself gated on state only ever being non-empty there
  // (onCoast, highlight.kind === "place")
  const active = state.players[state.activePlayerIndex] ?? null;
  const activeAt = active ? px(active.pose.current) : { x: 0, y: 0 };

  // space cancels a confirm dialog (e.g. the scrap prompt) — Cancel is the safe default
  useEffect(() => {
    if (!confirm) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.code === "Space" || e.key === " ") {
        e.preventDefault();
        confirm.onCancel();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [confirm]);

  // drive the slide animation with rAF; end it (and let the timers resume) when done.
  // a held "drift" has no motion — it just sits there, so it needs no loop.
  const [, forceFrame] = useReducer((n: number) => n + 1, 0);
  const endRef = useRef(onMoveAnimEnd);
  endRef.current = onMoveAnimEnd;
  useEffect(() => {
    if (!moveAnim || moveAnim.kind === "drift") return;
    let raf = 0;
    const loop = () => {
      if (animDone(moveAnim, performance.now())) {
        endRef.current();
        return;
      }
      forceFrame();
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [moveAnim]);

  return (
    <div className="boardwrap">
    <svg
      ref={svgRef}
      viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`}
      width="100%"
      height="100%"
      preserveAspectRatio="xMidYMid meet"
      style={{ touchAction: "none", cursor: dragRef.current?.moved ? "grabbing" : "default" }}
      onMouseDown={(e) => { if (e.button === 1) e.preventDefault(); }}
      onAuxClick={(e) => { if (e.button === 1) e.preventDefault(); }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endPan}
      onPointerCancel={endPan}
      onDoubleClick={fit}
      onClickCapture={(e) => {
        if (pannedRef.current) {
          e.stopPropagation();
          pannedRef.current = false;
        }
      }}
    >
      {cells.map((c) => {
        const { x: cx, y: cy } = rotate({ x: c.x * S, y: c.y * S });
        const key = hexKey(c);
        const isHi = hi.has(key);
        // a "base" pick highlights the whole region as one outline (below), not each cell —
        // so a cell here only gets the per-cell gold border for "place" (launch-cell) picks
        const isCellHi = isHi && highlight.kind !== "base";
        const assigned = c.base ? baseColourOf.get(c.base) : undefined;
        const fill = assigned
          ? SHIP_VAR[assigned]
          : c.region === "outer"
            ? "#1c2b25"
            : "#0e1b15";
        const stroke = isCellHi ? "var(--gold)" : assigned ? SHIP_VAR[assigned] : "#2b4034";
        const clickable = isHi || scrapSet.has(key);
        // a base-pick cell shows a tooltip, not its own hover highlight — the region
        // outline (below) is the only visual indicator for "you can pick this"
        const isBaseCell = isHi && highlight.kind === "base";
        return (
          <polygon
            key={key}
            points={hexPoints(cx, cy, S * 0.94)}
            fill={fill}
            fillOpacity={assigned ? 0.85 : 1}
            stroke={stroke}
            strokeWidth={isCellHi ? 2.5 : assigned ? 1.6 : 1}
            strokeOpacity={assigned ? 0.9 : 1}
            className={clickable ? (isBaseCell ? "cell-hit-quiet" : "cell-hit") : undefined}
            onClick={clickable ? clicked(() => onCell({ q: c.q, r: c.r })) : undefined}
            onMouseEnter={clickable && !isBaseCell ? () => onCellHover({ q: c.q, r: c.r }) : undefined}
            onMouseMove={isBaseCell ? (e) => onTip("Select this base", e) : undefined}
            onMouseLeave={
              isBaseCell ? (e) => onTip(null, e) : clickable ? () => onCellHover(null) : undefined
            }
          />
        );
      })}

      {/* base regions being picked: one pulsing outline per free base (the whole region is
         the click target, not each of its 4 cells), plus a solid outline for the one region
         a "random base" spin is currently landing the pointer on */}
      {highlight.kind === "base" &&
        [...new Set(highlight.cells.map((h) => board.baseOwnerAt(h)))].map((baseId) => {
          if (!baseId) return null;
          const region = board.baseCells(baseId);
          const loop = clusterOutline(region.map((h) => px(h)), S);
          if (loop.length === 0) return null;
          return (
            <polygon
              key={`base-outline-${baseId}`}
              points={pointsAttr(loop)}
              fill="none"
              stroke="var(--gold)"
              strokeWidth={3}
              strokeLinejoin="round"
              className="base-pick"
              pointerEvents="none"
            />
          );
        })}
      {spinHighlight &&
        (() => {
          const region = board.baseCells(spinHighlight);
          const loop = clusterOutline(region.map((h) => px(h)), S);
          if (loop.length === 0) return null;
          return (
            <polygon
              points={pointsAttr(loop)}
              fill={SHIP_VAR[spinHighlight]}
              fillOpacity={0.18}
              stroke="var(--gold)"
              strokeWidth={3.5}
              strokeLinejoin="round"
              pointerEvents="none"
            />
          );
        })()}

      {spinPoint &&
        (() => {
          const { x, y } = px(spinPoint);
          return (
            <circle
              cx={x}
              cy={y}
              r={S * 0.5}
              fill="var(--gold)"
              fillOpacity={0.22}
              stroke="var(--gold)"
              strokeWidth={2.5}
              pointerEvents="none"
            />
          );
        })()}

      {/* the "3 nested wheels" coordinate-dice spin: one rotating mark cycling around the
         current center (never all 6 candidates at once), a dot pinning each round's center,
         and a line tracing the path so far — the whole path disappears once the final cell
         is reached and the resource is actually placed */}
      {spinPath &&
        (() => {
          const dotPts = spinPath.dots.map((h) => px(h));
          const livePt = spinPath.live ? px(spinPath.live) : null;
          const lastDot = dotPts[dotPts.length - 1];
          return (
            <>
              {dotPts.slice(1).map((p, i) => (
                <line
                  key={`spin-seg-${i}`}
                  x1={dotPts[i]!.x}
                  y1={dotPts[i]!.y}
                  x2={p.x}
                  y2={p.y}
                  stroke="var(--gold)"
                  strokeWidth={2}
                  strokeOpacity={0.8}
                  pointerEvents="none"
                />
              ))}
              {livePt && lastDot && (
                <line
                  x1={lastDot.x}
                  y1={lastDot.y}
                  x2={livePt.x}
                  y2={livePt.y}
                  stroke="var(--gold)"
                  strokeWidth={2}
                  strokeOpacity={0.55}
                  pointerEvents="none"
                />
              )}
              {dotPts.map((p, i) => (
                <circle key={`spin-dot-${i}`} cx={p.x} cy={p.y} r={S * 0.12} fill="var(--gold)" pointerEvents="none" />
              ))}
              {livePt && (
                <circle
                  cx={livePt.x}
                  cy={livePt.y}
                  r={S * 0.35}
                  fill="var(--gold)"
                  fillOpacity={0.25}
                  stroke="var(--gold)"
                  strokeWidth={2.5}
                  pointerEvents="none"
                />
              )}
            </>
          );
        })()}

      {/* resources — a loadable one pulses and is the click target itself (no separate ring) */}
      {world && Object.entries(state.board.resources).map(([k, colour]) => {
        const [q, r] = k.split(",").map(Number) as [number, number];
        const { x, y } = px({ q, r });
        const loadable = loadSet.has(k);
        return (
          <g key={`res-${k}`} className={`ore-chip${loadable ? " cell-hit pulse-avail" : ""}`}
             onClick={loadable ? clicked(() => onCell({ q, r })) : undefined}
             onMouseMove={loadable ? (e) => onTip("Load cargo", e) : undefined}
             onMouseLeave={loadable ? (e) => onTip(null, e) : undefined}>
            <circle cx={x} cy={y} r={S * 0.42} fill={ORE_VAR[colour as OreColour]} stroke="rgba(0,0,0,0.4)" />
            <text x={x} y={y + 4} textAnchor="middle" fontSize={11} fontWeight={700} fill="rgba(0,0,0,0.55)">
              {state.config.modes.prospector.resources.values[colour as OreColour]}
            </text>
          </g>
        );
      })}

      {/* burn hover: the path and its fuel cost */}
      {burnPreview && burnPreview.path.length > 0 && (
        <g pointerEvents="none">
          <polyline
            points={[state.players[state.activePlayerIndex]!.pose.current, ...burnPreview.path]
              .map((hx) => {
                const p = px(hx);
                return `${p.x},${p.y}`;
              })
              .join(" ")}
            fill="none"
            stroke="var(--gold)"
            strokeWidth={2.5}
            strokeLinejoin="round"
          />
          {(() => {
            const end = px(burnPreview.path[burnPreview.path.length - 1]!);
            return (
              <g transform={`translate(${end.x} ${end.y - S * 0.9})`}>
                <rect x={-16} y={-11} width={32} height={20} rx={4} fill="#111" stroke="var(--gold)" />
                <text x={0} y={4} textAnchor="middle" fontSize={11} fill="var(--gold)" fontWeight={700}>
                  ⛽{burnPreview.cost}
                </text>
              </g>
            );
          })()}
        </g>
      )}

      {/* ships — abstract marker: ring at current, dot at previous, line while in flight.
         attackable enemies and (post-move) your own ship pulse and are click targets. */}
      {world && state.players
        .filter((p) => !p.eliminated && p.placed)
        .map((p) => {
          const isActive = p.id === state.activePlayerIndex;
          const isAttackable = attackTargets.includes(p.id);
          const isEndTurnShip = isActive && endTurnReady;
          const interact = isAttackable
            ? { tip: "Attack", onClick: clicked(() => onAttackTarget(p.id)) }
            : isEndTurnShip
              ? { tip: "End turn (own ship)", onClick: clicked(onEndTurn!) }
              : null;
          const pulse = isAttackable || isEndTurnShip;
          if (moveAnim && moveAnim.playerId === p.id) {
            const f = moveFrame(moveAnim, performance.now(), px);
            return (
              <ShipMarker key={`ship-${p.id}`} colour={p.colour} ring={f.ring} dot={f.dot}
                tether={f.tether} active={isActive} pulse={pulse} interact={interact} onTip={onTip} />
            );
          }
          const ring = px(p.pose.current);
          const dot = px(p.pose.previous);
          const moving = !p.pose.atRest && !(dot.x === ring.x && dot.y === ring.y);
          return (
            <ShipMarker key={`ship-${p.id}`} colour={p.colour} ring={ring} dot={dot}
              tether={moving ? [dot, ring] : null} active={isActive} pulse={pulse} interact={interact} onTip={onTip} />
          );
        })}

      {/* coast: the drift target — a green "0-burn" ring, same size as the burn targets */}
      {onCoast && (
        <g className="cell-hit coast-here" onClick={onCoast}>
          <title>Coast — drift here, no burn</title>
          <circle cx={activeAt.x} cy={activeAt.y} r={S * 0.6}
            fill="var(--ok)" fillOpacity={0.14} stroke="var(--ok)" strokeWidth={2.6} />
          <text x={activeAt.x} y={activeAt.y + 4} textAnchor="middle"
            fontSize={11} fontWeight={700} fill="var(--ok)">
            0
          </text>
        </g>
      )}

      {/* burn targets — colour = fuel cost (green free, yellow 1, orange 2, red 3) */}
      {burnTargets.map(({ cell, cost }) => {
        const { x, y } = px(cell);
        const col = BURN_COST_COLOUR[Math.min(cost, 3)]!;
        return (
          <g key={`burn-${hexKey(cell)}`} className="cell-hit burn-target"
             onClick={() => onCell(cell)}
             onMouseEnter={() => onCellHover(cell)}
             onMouseLeave={() => onCellHover(null)}>
            <circle cx={x} cy={y} r={S * 0.6} fill={col} fillOpacity={0.14} stroke={col} strokeWidth={2.6} />
            <text x={x} y={y + 4} textAnchor="middle" fontSize={11} fontWeight={700} fill={col}>
              {cost === 0 ? "◇" : cost}
            </text>
          </g>
        );
      })}

      {/* launch-cell markers: a pulsing ship-coloured ring on each of the 4 base cells —
         the ship itself isn't drawn anywhere until one is picked */}
      {highlight.kind === "place" && highlight.cells.map((hx) => {
        const { x, y } = px(hx);
        const col = SHIP_VAR[active!.colour]; // "place" only ever shows once real players exist
        return (
          <g key={`hi-${hexKey(hx)}`} className="cell-hit pulse-avail"
             onClick={clicked(() => onCell(hx))}
             onMouseMove={(e) => onTip("Launch here", e)}
             onMouseLeave={(e) => onTip(null, e)}>
            <circle cx={x} cy={y} r={S * 0.42} fill={col} fillOpacity={0.12} stroke={col} strokeWidth={2.4} />
          </g>
        );
      })}

      {/* table furniture (ship panels, deck counts) — drawn on top so text stays legible */}
      {world && <BaseInfo board={board} state={state} seats={seats} scores={scores} onTip={onTip} rotation={rotation} />}

      {/* guidance popup — what to do next, anchored in board space, zoom-locked to size */}
      {popup && (
        <g transform={zoomLock(popup.center)}>
          <HexPopup
            center={popup.center}
            lines={popup.lines}
            actions={popup.actions}
            radius={popup.radius}
            rotation={rotation}
          />
        </g>
      )}

      {/* pickShip stage: one big hex, browse/select/random instead of a plain grid */}
      {shipPicker && (
        <g transform={zoomLock(shipPicker.center)}>
          <ShipPickerPopup {...shipPicker} rotation={rotation} />
        </g>
      )}

      {/* combat: staging lasers/shields, declaring, and the dice reveal — anchored on
         whoever is currently deciding, mutually exclusive with the plain guidance popup */}
      {combatBox && (
        <g transform={zoomLock(combatBox.center)}>
          <CombatBox {...combatBox} rotation={rotation} />
        </g>
      )}

      {/* confirm dialog (e.g. scrap?) — dims + blocks the rest of the board until answered */}
      {confirm && (
        <>
          <rect x={vb.x} y={vb.y} width={vb.w} height={vb.h} fill="rgba(4,10,7,0.55)" onClick={confirm.onCancel} />
          <g transform={zoomLock(confirm.center)}>
            <HexPopup
              center={confirm.center}
              lines={confirm.lines}
              radius={3}
              rotation={rotation}
              actions={[
                { label: "Cancel", kind: "primary", onClick: confirm.onCancel },
                { label: "Yes", kind: "danger", onClick: confirm.onYes },
              ]}
            />
          </g>
        </>
      )}
    </svg>
      {tip && (
        <div className="board-tip" style={{ left: tip.x, top: tip.y }}>
          {tip.text}
        </div>
      )}
      <div className="zoomctl">
        <button type="button" aria-label="rotate left" onClick={() => setRotation((r) => (r + 5) % 6)}>⟲</button>
        <button type="button" aria-label="rotate right" onClick={() => setRotation((r) => (r + 1) % 6)}>⟳</button>
        <button type="button" aria-label="zoom out" onClick={() => zoomBy(1 / 1.3)}>–</button>
        <button type="button" aria-label="fit board" onClick={fit}>⤢</button>
        <button type="button" aria-label="zoom in" onClick={() => zoomBy(1.3)}>+</button>
      </div>
    </div>
  );
}
