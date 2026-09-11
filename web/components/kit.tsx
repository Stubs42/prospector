/**
 * Physical-component kit. Every widget looks like a real thing from a game box, and any
 * motion it makes is a rigid-body move / flip / tumble — nothing a cardboard piece couldn't do.
 */
import type { BoosterCard as BoosterCardT, BoosterType, Colour, OreColour } from "../../engine/index.js";

export const SHIP_VAR: Record<Colour, string> = {
  black: "var(--ship-black)",
  red: "var(--ship-red)",
  blue: "var(--ship-blue)",
  white: "var(--ship-white)",
  green: "var(--ship-green)",
  yellow: "var(--ship-yellow)",
};
export const ORE_VAR: Record<OreColour, string> = {
  green: "var(--ore-green)",
  yellow: "var(--ore-yellow)",
  red: "var(--ore-red)",
};

/** A single ship cone, drawn about its own tip at local (0,0). Place inside a <g transform>. */
export function Cone({
  fill,
  lift = 0,
  ghost = false,
}: {
  fill: string;
  /** vertical stack offset in px (each cone in a stack sits a little higher) */
  lift?: number;
  ghost?: boolean;
}) {
  return (
    <path
      d={`M 0 ${-9 - lift} L -6 ${4 - lift} L 6 ${4 - lift} Z`}
      fill={fill}
      stroke="rgba(0,0,0,0.55)"
      strokeWidth={1}
      opacity={ghost ? 0.32 : 1}
      strokeDasharray={ghost ? "2 2" : undefined}
    />
  );
}

/** Green (full) / red (empty) fuel cards, laid out as a strip. */
export function FuelTrack({ fuel, max }: { fuel: number; max: number }) {
  return (
    <div className="fueltrack" title={`fuel ${fuel} / ${max}`}>
      {Array.from({ length: max }, (_, i) => (
        <i key={i} className={`fuelcell ${i < fuel ? "full" : "empty"}`} />
      ))}
    </div>
  );
}

/** A resource chip. */
export function TileChip({ colour, value }: { colour: OreColour; value: number }) {
  return (
    <i className="oretile" style={{ background: ORE_VAR[colour] }} title={`${colour} · ${value}`}>
      {value}
    </i>
  );
}

const PIPS: Record<number, [number, number][]> = {
  1: [[1, 1]],
  2: [[0, 0], [2, 2]],
  3: [[0, 0], [1, 1], [2, 2]],
  4: [[0, 0], [2, 0], [0, 2], [2, 2]],
  5: [[0, 0], [2, 0], [1, 1], [0, 2], [2, 2]],
  6: [[0, 0], [2, 0], [0, 1], [2, 1], [0, 2], [2, 2]],
};

/** A six-sided die showing a face. `tone` tints the body (attacker red / defender blue). */
export function Die({ value, tone }: { value: number; tone?: "attack" | "defence" }) {
  const bg = tone === "attack" ? "var(--ship-red)" : tone === "defence" ? "var(--ship-blue)" : "#e9e6df";
  const dot = tone ? "#fff" : "#20242a";
  return (
    <span className="die" style={{ background: bg }} aria-label={`die ${value}`}>
      {(PIPS[value] ?? []).map(([c, r], i) => (
        <i key={i} className="pip" style={{ gridColumn: c + 1, gridRow: r + 1, background: dot }} />
      ))}
    </span>
  );
}

/**
 * Small abstract prop glyph per booster type — echoes the physical card art
 * (fuel cells, shield disc, laser rounds, engine thrust, a starburst for the
 * one-shot hyperspace card) without going photoreal. `currentColor` picks up
 * the aspect colour set by `.card.booster-*` in styles.css.
 */
function CardIcon({ type }: { type: BoosterType }) {
  switch (type) {
    case "reserveFuel":
      return (
        <svg viewBox="0 0 40 40" className="cicon" aria-hidden="true">
          {[-8, 0, 8].map((x) => (
            <g key={x} transform={`translate(${20 + x} 20) rotate(-28)`}>
              <rect x={-3.5} y={-13} width={7} height={26} rx={2.5} fill="currentColor" opacity={0.85} />
              <rect x={-3.5} y={-13} width={7} height={5} rx={2} fill="#dfe6ee" opacity={0.9} />
              <rect x={-3.5} y={8} width={7} height={5} rx={2} fill="#dfe6ee" opacity={0.9} />
            </g>
          ))}
        </svg>
      );
    case "shield":
      return (
        <svg viewBox="0 0 40 40" className="cicon" aria-hidden="true">
          <circle cx={20} cy={20} r={13} fill="none" stroke="currentColor" strokeWidth={3} opacity={0.85} />
          <circle cx={20} cy={20} r={7} fill="currentColor" opacity={0.4} />
        </svg>
      );
    case "laser":
      return (
        <svg viewBox="0 0 40 40" className="cicon" aria-hidden="true">
          {[-9, 0, 9].map((x, i) => (
            <rect key={x} x={20 + x - 1.6} y={10} width={3.2} height={20} rx={1.6} fill="currentColor" opacity={0.55 + i * 0.15} />
          ))}
        </svg>
      );
    case "engine":
      return (
        <svg viewBox="0 0 40 40" className="cicon" aria-hidden="true">
          {[[-7, -6], [7, -6], [-7, 7], [7, 7]].map(([x, y]) => (
            <ellipse key={`${x},${y}`} cx={20 + x!} cy={20 + y!} rx={7} ry={5.5} fill="none" stroke="currentColor" strokeWidth={2.4} opacity={0.85} />
          ))}
        </svg>
      );
    case "hyperspace":
      return (
        <svg viewBox="0 0 40 40" className="cicon" aria-hidden="true">
          <path
            d="M20 6 L23.5 17 L34 20 L23.5 23 L20 34 L16.5 23 L6 20 L16.5 17 Z"
            fill="currentColor"
            opacity={0.85}
          />
        </svg>
      );
  }
}

/** A booster card face. */
export function BoosterCardFace({
  card,
  onClick,
  clickable,
  selected,
  pulse,
}: {
  card: BoosterCardT;
  onClick?: (() => void) | undefined;
  clickable?: boolean | undefined;
  selected?: boolean | undefined;
  /** "new" = briefly highlight a just-drawn card; "urgent" = keep pulsing (over the hand limit);
     "ready" = playable right now (armable this burn / usable in combat) */
  pulse?: "urgent" | "new" | "ready" | null | undefined;
}) {
  return (
    <div
      className={`card booster-${card.type}${selected ? " picked" : ""}${pulse ? ` pulse-${pulse}` : ""}`}
      style={{ cursor: clickable ? "pointer" : "default" }}
      onClick={onClick}
    >
      <CardIcon type={card.type} />
      <div className="cbadge">{card.value ?? "◇"}</div>
      <div className="ctype">{card.type}</div>
      <div className="ceff">{card.effect}</div>
    </div>
  );
}
