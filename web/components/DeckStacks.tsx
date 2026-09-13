/**
 * The 4 shared "deck" piles as physical card stacks sitting just outside the board's own
 * left/right vertex, instead of the old plain grey text block ("booster deck 45", ...):
 * booster draw + discard/played on the right (a matched pair — one deck), ore supply not
 * yet in play + the equipment draw pile ("available upgrades") on the left. Each frame's
 * long side is parallel to the board edge it sits next to (the board's own outline is a
 * hexagon too, so every edge is already at a fixed 60°-derived angle) — a couple of offset
 * backing rects suggest a stack of cards behind the front one, matching kit.tsx's "look
 * like a real thing from the game box" rule. Screen-fixed: unlike BaseInfo's per-player
 * tokens, this is shared state tied to no particular base, so it never rotates with the
 * board's own logical rotate control.
 */
import type { ReactNode } from "react";
import type { GameState } from "../../engine/index.js";
import type { BoardModel } from "../../engine/board.js";
import { S } from "./geo.js";
import { theme } from "../theme.js";
import { ORE_VAR } from "./kit.js";

const SQRT3 = Math.sqrt(3);

/** pixel position of the board's own 6 outer corners (same lattice as every cell's x*S/y*S
   — see hexpx.ts's axialToPixel — just at the outer ring's vertices, axial ring `R`). */
function boardVertices(R: number): { x: number; y: number }[] {
  const axial: [number, number][] = [
    [R, 0], [0, R], [-R, R], [-R, 0], [0, -R], [R, -R],
  ];
  return axial.map(([q, r]) => ({ x: S * SQRT3 * (q + r / 2), y: S * 1.5 * r }));
}

interface Placement {
  x: number;
  y: number;
  angleDeg: number;
}

/** centre + rotation for a frame sitting on the `a`→`b` edge: long side parallel to it,
   pushed outward (away from the board centre, which a regular polygon's edge midpoint
   already points straight away from) by `padding` px. */
function edgePlacement(a: { x: number; y: number }, b: { x: number; y: number }, padding: number): Placement {
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  const mag = Math.hypot(mx, my) || 1;
  const edgeAngle = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
  // a frame's un-rotated long axis runs along local Y (angle 90°) — rotate by however much
  // more than 90° the edge itself sits at, so that axis ends up parallel to the edge
  return { x: mx + (mx / mag) * padding, y: my + (my / mag) * padding, angleDeg: edgeAngle - 90 };
}

function DeckFrame({ x, y, angleDeg, label, value }: Placement & { label: string; value: ReactNode }) {
  const w = S * theme.board.deckStack.width;
  const h = S * theme.board.deckStack.height;
  return (
    <g transform={`translate(${x} ${y}) rotate(${angleDeg})`} pointerEvents="none">
      {/* two backing rects, peeking out top-left of the front one — "a stack", not one card */}
      <rect x={-w / 2 + 3} y={-h / 2 + 4} width={w} height={h} rx={5} fill="#0a120e" stroke="#28352e" strokeWidth={1} />
      <rect x={-w / 2 + 1.5} y={-h / 2 + 2} width={w} height={h} rx={5} fill="#0a120e" stroke="#28352e" strokeWidth={1} />
      <rect x={-w / 2} y={-h / 2} width={w} height={h} rx={5} fill="#0a120e" stroke="#3a4a41" strokeWidth={1.6} />
      {/* counter-rotate the text back upright, whatever the frame's own tilt is */}
      <g transform={`rotate(${-angleDeg})`}>
        <text
          textAnchor="middle"
          y={-h * 0.22}
          fontSize={S * theme.board.deckStack.labelFontSize}
          fontWeight={700}
          fill="#8b9a91"
          style={{ letterSpacing: "0.06em" }}
        >
          {label}
        </text>
        <text textAnchor="middle" y={h * 0.14} fontSize={S * theme.board.deckStack.valueFontSize} fontWeight={800} fill="#e8efe9">
          {value}
        </text>
      </g>
    </g>
  );
}

export function DeckStacks({ board, state }: { board: BoardModel; state: GameState }) {
  const pad = S * theme.board.deckStack.padding;
  const [v0, v1, v2, v3, v4, v5] = boardVertices(board.radius);

  const boosterTotal = state.decks.booster.draw.length + state.decks.booster.discard.length;
  const equipmentTotal = state.decks.equipment.draw.length + state.decks.equipment.discard.length;
  const supply = state.supply;

  return (
    <g className="deckstacks">
      {/* right side: one deck, draw above / discard below the horizontal mid-line */}
      <DeckFrame {...edgePlacement(v5!, v0!, pad)} label="BOOSTERS" value={`${state.decks.booster.draw.length}/${boosterTotal}`} />
      <DeckFrame {...edgePlacement(v0!, v1!, pad)} label="PLAYED" value={`${state.decks.booster.discard.length}/${boosterTotal}`} />

      {/* left side: ore not yet in play, and the equipment ("upgrade") draw pile */}
      <DeckFrame
        {...edgePlacement(v2!, v3!, pad)}
        label="ORE SUPPLY"
        value={
          <>
            <tspan fill={ORE_VAR.green}>{supply.green}</tspan> <tspan fill={ORE_VAR.yellow}>{supply.yellow}</tspan>{" "}
            <tspan fill={ORE_VAR.red}>{supply.red}</tspan>
          </>
        }
      />
      <DeckFrame
        {...edgePlacement(v3!, v4!, pad)}
        label="UPGRADES"
        value={`${state.decks.equipment.draw.length}/${equipmentTotal}`}
      />
    </g>
  );
}
