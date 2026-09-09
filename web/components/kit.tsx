/**
 * Physical-component kit. Every widget looks like a real thing from a game box, and any
 * motion it makes is a rigid-body move / flip / tumble — nothing a cardboard piece couldn't do.
 */
import type { BoosterCard as BoosterCardT, Colour, OreColour } from "../../engine/index.js";

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

/** A booster card face. */
export function BoosterCardFace({
  card,
  onClick,
  clickable,
  selected,
}: {
  card: BoosterCardT;
  onClick?: (() => void) | undefined;
  clickable?: boolean | undefined;
  selected?: boolean | undefined;
}) {
  return (
    <div
      className={`card booster-${card.type}${selected ? " picked" : ""}`}
      style={{ cursor: clickable ? "pointer" : "default" }}
      onClick={onClick}
    >
      <div className="ctype">{card.type}</div>
      <div className="cval">{card.value ?? "◇"}</div>
      <div className="ceff">{card.effect}</div>
    </div>
  );
}
