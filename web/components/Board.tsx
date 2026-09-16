import {
  useCallback,
  useEffect,
  useReducer,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as RPointerEvent,
  type ReactNode,
} from "react";
import { boardFor } from "../../engine/game.js";
import { hexKey } from "../../engine/hex.js";
import type { GameState, Hex, Colour, OreColour } from "../../engine/index.js";
import { SHIP_BOARD_VAR, SHIP_BOARD_HI_VAR, SHIP_BASE_VAR, SHIP_BASE_HI_VAR, ORE_VAR } from "./kit.js";
import { BaseInfo, type TipFn } from "./BaseInfo.js";
import { ShipMarker } from "./ShipMarker.js";
import { moveFrame, animDone, type MoveAnim } from "../anim.js";
import type { Seat } from "../../client/index.js";
import { clusterOutline, pointsAttr } from "./hexOutline.js";
import { rotatePoint } from "./hexpx.js";
import { theme } from "../theme.js";

export { S } from "./geo.js";
import { S } from "./geo.js";

/** the zoom/pan/rotate control icons — a plain shape in a fixed viewBox, so flex centring
   in the button lands exactly on it (unlike a text glyph, whose position within its own
   line box depends on the current font's baseline/descender metrics) */
function CtlIcon({ children }: { children: ReactNode }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
      {children}
    </svg>
  );
}

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
  /** false during base selection: draw only the empty field + highlights */
  world: boolean;
  reducedMotion: boolean;
  /** an in-flight move to play out; null when the board is settled */
  moveAnim: MoveAnim | null;
  onMoveAnimEnd: () => void;
  onCell: (h: Hex) => void;
  onCellHover: (h: Hex | null) => void;
  /** non-null while a "purely cosmetic, already-decided" animation is playing (a spin, a
     dice reveal) — a click anywhere on the board fast-forwards it to the result instead of
     hitting whatever's normally under the cursor */
  onSkipAnimation?: (() => void) | null;
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
  world,
  reducedMotion,
  moveAnim,
  onMoveAnimEnd,
  onCell,
  onCellHover,
  onSkipAnimation = null,
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
  // touch: one finger reuses dragRef's own tap-vs-drag logic below (just a second pointer
  // source); two fingers hand off to pinchRef instead — tracked by id since either finger
  // may lift first, and a third finger (e.g. a resting palm) is simply ignored
  const touchPointsRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const pinchRef = useRef<{ dist: number; mx: number; my: number } | null>(null);

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
    if (e.pointerType === "touch") {
      e.preventDefault();
      touchPointsRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (touchPointsRef.current.size === 2) {
        dragRef.current = null; // a second finger landed mid-drag: hand off to pinch instead
        const [a, b] = [...touchPointsRef.current.values()] as [{ x: number; y: number }, { x: number; y: number }];
        pinchRef.current = { dist: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
        return;
      }
      if (touchPointsRef.current.size > 2) return; // a third finger (e.g. a resting palm): ignore
      pannedRef.current = false;
      dragRef.current = { x: e.clientX, y: e.clientY, cx: v.cx, cy: v.cy, moved: false };
      return;
    }
    if (e.button !== 1) return; // middle-drag pans; left stays free for board clicks
    e.preventDefault();
    pannedRef.current = false;
    dragRef.current = { x: e.clientX, y: e.clientY, cx: v.cx, cy: v.cy, moved: false };
  };
  const onPointerMove = (e: RPointerEvent<SVGSVGElement>) => {
    if (e.pointerType === "touch" && touchPointsRef.current.has(e.pointerId)) {
      touchPointsRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    }
    if (touchPointsRef.current.size >= 2) {
      const [a, b] = [...touchPointsRef.current.values()] as [{ x: number; y: number }, { x: number; y: number }];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2;
      const prev = pinchRef.current;
      const el = svgRef.current;
      if (prev && el && prev.dist > 0 && dist > 0) {
        pannedRef.current = true;
        el.setPointerCapture(e.pointerId);
        const z = Math.min(MAX_Z, Math.max(MIN_Z, v.z * (dist / prev.dist)));
        // anchor the zoom on the board point that was under the fingers' previous midpoint,
        // then also carry the midpoint's own on-screen movement (two fingers panning
        // together while pinching) — same "keep this board point under the cursor" math
        // zoomBy uses, plus a translation term zoomBy doesn't need
        const { bx, by } = toBoard(prev.mx, prev.my);
        const r = el.getBoundingClientRect();
        const s = Math.min(r.width / vb.w, r.height / vb.h);
        const cx = bx - (bx - v.cx) * (v.z / z) - (mx - prev.mx) / s;
        const cy = by - (by - v.cy) * (v.z / z) - (my - prev.my) / s;
        setView({ cx, cy, z });
      }
      pinchRef.current = { dist, mx, my };
      return;
    }
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
    if (e.pointerType === "touch") {
      touchPointsRef.current.delete(e.pointerId);
      if (touchPointsRef.current.size < 2) pinchRef.current = null;
      if (touchPointsRef.current.size === 1) {
        // one finger lifted out of a pinch, one still down: resume as a plain single-finger
        // pan from here rather than treating the remaining finger as a fresh tap
        const [remaining] = [...touchPointsRef.current.values()] as [{ x: number; y: number }];
        dragRef.current = { x: remaining.x, y: remaining.y, cx: v.cx, cy: v.cy, moved: true };
      } else if (touchPointsRef.current.size === 0) {
        dragRef.current = null;
      }
    } else {
      dragRef.current = null;
    }
    // NOT reset here: a real drag/pinch leaves pannedRef true so the synthetic "click" a
    // touch release fires right after is still suppressed by onClickCapture below; the next
    // gesture's onPointerDown clears it before anything new starts
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

  // per-cell values shared by the fill layer and the grid layer below — computed once so
  // the two rendering passes agree on exactly which cells are highlighted/clickable/etc.
  const cellViews = cells.map((c) => {
    const { x: cx, y: cy } = rotate({ x: c.x * S, y: c.y * S });
    const key = hexKey(c);
    const isHi = hi.has(key);
    const assigned = c.base ? baseColourOf.get(c.base) : undefined;
    // an unassigned field cell is mostly transparent — the starfield behind the board
    // shows through its interior, with only a faint tint left to tell inner from outer
    const fill = assigned ? SHIP_BASE_VAR[assigned] : c.region === "outer" ? theme.board.outerFill : theme.board.innerFill;
    const fillOpacity = assigned
      ? 0.85
      : c.region === "outer"
        ? theme.board.outerCellFillOpacity
        : theme.board.innerCellFillOpacity;
    const clickable = isHi || scrapSet.has(key);
    // a base-pick cell shows a tooltip, not its own hover highlight — the region
    // outline (below) is the only visual indicator for "you can pick this"
    const isBaseCell = isHi && highlight.kind === "base";
    return { c, cx, cy, key, fill, fillOpacity, clickable, isBaseCell };
  });

  // players are empty during interactive setup's pickBase/pickShip stages — everything that
  // dereferences `active` below is itself gated on state only ever being non-empty there
  // (onCoast, highlight.kind === "place")
  const active = state.players[state.activePlayerIndex] ?? null;
  const activeAt = active ? px(active.pose.current) : { x: 0, y: 0 };

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
        // an "everything here is already decided" animation is running (a lucky-wheel
        // spin, a dice reveal) — a click anywhere fast-forwards straight to its result,
        // taking priority over (and pre-empting) whatever that click would otherwise hit
        if (onSkipAnimation) {
          e.stopPropagation();
          onSkipAnimation();
          return;
        }
        if (pannedRef.current) {
          e.stopPropagation();
          pannedRef.current = false;
        }
      }}
    >
      <defs>
        {/* the grid's own edges read as a metal rod, not a flat painted line — a light-to-
           dark sweep across the stroke plus a soft drop-shadow on the whole grid gives it
           a slightly raised, cast-metal feel without per-edge lighting math. Colours and
           the shadow's own numbers live in theme.ts (theme.board), not here. */}
        <linearGradient id="rodGrad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor={theme.board.gridBright} />
          <stop offset="100%" stopColor={theme.board.gridDark} />
        </linearGradient>
        <filter id="rodDepth" x="-5%" y="-5%" width="110%" height="110%">
          <feDropShadow
            dx="0"
            dy={theme.board.gridShadowOffset}
            stdDeviation={theme.board.gridShadowBlur}
            floodColor="#000"
            floodOpacity={theme.board.gridShadowOpacity}
          />
        </filter>
      </defs>
      {/* two layers, deliberately not one polygon with both fill and stroke: the grid
         (metal rods) must read as one uniform mesh sitting *on top of* every cell alike,
         including a coloured base region — drawing fill+stroke together per cell let a
         base's own colour override (and visually blend into) its share of the grid. */}
      {cellViews.map(({ c, cx, cy, key, fill, fillOpacity, clickable, isBaseCell }) => (
        <polygon
          key={key}
          // full size (no gap) — every edge is shared with its neighbour, one continuous
          // hex grid rather than separated tiles floating with a gap between them
          points={hexPoints(cx, cy, S)}
          fill={fill}
          fillOpacity={fillOpacity}
          stroke="none"
          // a click target must stay clickable even though its fill is almost fully
          // transparent now (the starfield shows through) — visiblePainted (the SVG
          // default) can miss a very low fillOpacity in some browsers
          pointerEvents={clickable ? "all" : undefined}
          className={clickable ? (isBaseCell ? "cell-hit-quiet" : "cell-hit") : undefined}
          onClick={clickable ? clicked(() => onCell({ q: c.q, r: c.r })) : undefined}
          onMouseEnter={clickable && !isBaseCell ? () => onCellHover({ q: c.q, r: c.r }) : undefined}
          onMouseMove={isBaseCell ? (e) => onTip("Select this base", e) : undefined}
          onMouseLeave={
            isBaseCell ? (e) => onTip(null, e) : clickable ? () => onCellHover(null) : undefined
          }
        />
      ))}

      <g filter="url(#rodDepth)" pointerEvents="none">
        {cellViews.map(({ cx, cy, key }) => (
          <polygon
            key={key}
            points={hexPoints(cx, cy, S)}
            fill="none"
            // the plain grid edge reads as a metal rod (a gradient stroke, see <defs>) —
            // uniform everywhere now. Launch-cell picks used to also gold-edge each of the
            // 4 base cells here, redundant with (and visually competing against) the
            // pulsing ship-coloured ring already drawn on each one; a base cell doesn't
            // get its own coloured edge either — its fill alone already says whose it is.
            stroke="url(#rodGrad)"
            strokeWidth={1.4}
          />
        ))}
      </g>

      {/* base regions being picked: one blinking outline per free base (the whole region is
         the click target, not each of its 4 cells), plus a solid outline for the one region
         a "random base" spin is currently landing the pointer on. A hard on/off opacity
         toggle (steps, no interpolation — see .region-blink), not a smooth pulse — but still
         the same plain gold every free base used before, not each base's own SHIP_BASE_HI_VAR
         (which is white for 5 of 6 colours and gold only for white's own base — different
         colours per base read as a bug, not a blink). Not the ship marker's colour-swap
         convention either: the region is already solid-filled with its own base colour once
         assigned, so swapping the outline between that same colour and any per-base highlight
         would vanish for half the cycle — one fixed gold, toggled fully off/on, stays visible
         and matches every other base uniformly. */}
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
              className="region-blink"
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
              // during the roll-off reveal a base is already solid-filled with this exact
              // colour (fillOpacity 0.85), so tinting it with more of the SAME colour used
              // to be nearly invisible — theme.colors.shipBase's highlight is a genuinely
              // different colour instead
              fill={SHIP_BASE_HI_VAR[spinHighlight]}
              fillOpacity={0.35}
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
                  stroke={theme.board.spinPathColor}
                  strokeWidth={theme.board.spinPathStrokeWidth}
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
                  stroke={theme.board.spinPathColor}
                  strokeWidth={theme.board.spinPathStrokeWidth}
                  strokeOpacity={0.55}
                  pointerEvents="none"
                />
              )}
              {dotPts.map((p, i) => (
                <circle
                  key={`spin-dot-${i}`}
                  cx={p.x}
                  cy={p.y}
                  r={S * theme.board.spinPathDotRadius}
                  fill={theme.board.spinPathColor}
                  pointerEvents="none"
                />
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

      {/* launch-cell markers: a blinking ship-coloured ring on each of the 4 base cells —
         the ship itself isn't drawn anywhere until one is picked */}
      {highlight.kind === "place" && highlight.cells.map((hx) => {
        const { x, y } = px(hx);
        // "place" only ever shows once real players exist
        const col = SHIP_BOARD_VAR[active!.colour];
        const hi = SHIP_BOARD_HI_VAR[active!.colour];
        return (
          <g key={`hi-${hexKey(hx)}`} className="cell-hit"
             onClick={clicked(() => onCell(hx))}
             onMouseMove={(e) => onTip("Launch here", e)}
             onMouseLeave={(e) => onTip(null, e)}>
            <circle cx={x} cy={y} r={S * 0.42} fillOpacity={0.12} strokeWidth={2.4}
              className="ship-blink" style={{ "--blink-normal": col, "--blink-hi": hi } as CSSProperties} />
          </g>
        );
      })}

      {/* table furniture (ship panels) — drawn on top so text stays legible */}
      {world && <BaseInfo board={board} state={state} seats={seats} scores={scores} onTip={onTip} rotation={rotation} />}

    </svg>
      {tip && (
        <div className="board-tip" style={{ left: tip.x, top: tip.y }}>
          {tip.text}
        </div>
      )}
      <div className="zoomctl">
        {/* real SVG icons, not text glyphs — a font's glyph sits wherever that font's own
           baseline/descender metrics put it (never quite centred, and inconsistently so
           across fonts/browsers); a plain shape in a fixed viewBox centres exactly */}
        <button type="button" aria-label="rotate left" onClick={() => setRotation((r) => (r + 5) % 6)}>
          <CtlIcon><path d="M3 12a9 9 0 1 0 3-6.7" /><polyline points="3 3 3 8 8 8" /></CtlIcon>
        </button>
        <button type="button" aria-label="rotate right" onClick={() => setRotation((r) => (r + 1) % 6)}>
          <CtlIcon><path d="M21 12a9 9 0 1 1-3-6.7" /><polyline points="21 3 21 8 16 8" /></CtlIcon>
        </button>
        <button type="button" aria-label="zoom out" onClick={() => zoomBy(1 / 1.3)}>
          <CtlIcon><line x1="5" y1="12" x2="19" y2="12" /></CtlIcon>
        </button>
        <button type="button" aria-label="fit board" onClick={fit}>
          <CtlIcon>
            <path d="M8 3H5a2 2 0 0 0-2 2v3" />
            <path d="M16 3h3a2 2 0 0 1 2 2v3" />
            <path d="M21 16v3a2 2 0 0 1-2 2h-3" />
            <path d="M3 16v3a2 2 0 0 0 2 2h3" />
          </CtlIcon>
        </button>
        <button type="button" aria-label="zoom in" onClick={() => zoomBy(1.3)}>
          <CtlIcon><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></CtlIcon>
        </button>
      </div>
    </div>
  );
}
