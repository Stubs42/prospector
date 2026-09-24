/**
 * Physical-component kit. Every widget looks like a real thing from a game box, and any
 * motion it makes is a rigid-body move / flip / tumble — nothing a cardboard piece couldn't do.
 */
import type { BoosterCard as BoosterCardT, BoosterType, Colour, OreColour, StatKey } from "../../engine/index.js";
import { BoosterCardArt, HyperspaceCardArt, EventCardFace } from "./CardArt.js";
import { ASPECT_FILL } from "./aspects.js";

/** which booster types have real card art, mapped to the ship stat whose tiered icon they
   reuse — hyperspace isn't tied to a stat, it's routed to HyperspaceCardArt separately
   (see BoosterCardFace below) */
const BOOSTER_ART_STAT: Partial<Record<BoosterType, StatKey>> = {
  shield: "shields",
  laser: "lasers",
  engine: "engines",
  reserveFuel: "fuelTanks",
};

export const SHIP_VAR: Record<Colour, string> = {
  black: "var(--ship-black)",
  red: "var(--ship-red)",
  blue: "var(--ship-blue)",
  white: "var(--ship-white)",
  green: "var(--ship-green)",
  yellow: "var(--ship-yellow)",
};

/** the ship marker on the field: normal + the colour it blinks to (see theme.colors.shipBoard) */
function shipColourMap(suffix: string): Record<Colour, string> {
  return {
    black: `var(--ship-black-${suffix})`,
    red: `var(--ship-red-${suffix})`,
    blue: `var(--ship-blue-${suffix})`,
    white: `var(--ship-white-${suffix})`,
    green: `var(--ship-green-${suffix})`,
    yellow: `var(--ship-yellow-${suffix})`,
  };
}
export const SHIP_BOARD_VAR = shipColourMap("board");
export const SHIP_BOARD_HI_VAR = shipColourMap("board-hi");
/** a home base region's own fill: normal + the colour it blinks to (theme.colors.shipBase) */
export const SHIP_BASE_VAR = shipColourMap("base");
export const SHIP_BASE_HI_VAR = shipColourMap("base-hi");
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
    case "event":
      return (
        <svg viewBox="0 0 40 40" className="cicon" aria-hidden="true">
          <circle cx={20} cy={20} r={4} fill="currentColor" opacity={0.9} />
          {[0, 45, 90, 135].map((deg) => (
            <rect key={deg} x={18.6} y={5} width={2.8} height={12} rx={1.4} fill="currentColor" opacity={0.65} transform={`rotate(${deg} 20 20)`} />
          ))}
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
  dimmed,
}: {
  card: BoosterCardT;
  onClick?: (() => void) | undefined;
  clickable?: boolean | undefined;
  selected?: boolean | undefined;
  /** "new" = briefly highlight a just-drawn card; "urgent" = keep pulsing (over the hand limit).
     A playable card no longer pulses ("ready" used to) — see `dimmed` instead. */
  pulse?: "urgent" | "new" | null | undefined;
  /** this card can't be played right now, but something else in the hand can — the card
     itself dims rather than the playable ones pulsing for attention */
  dimmed?: boolean | undefined;
}) {
  const artStat = BOOSTER_ART_STAT[card.type];
  const cls = (base: string) =>
    `${base}${clickable ? " clickable" : ""}${selected ? " picked" : ""}${pulse ? ` pulse-${pulse}` : ""}${dimmed ? " dimmed" : ""}`;
  if (card.type === "hyperspace") {
    return (
      <div className={cls("card-art-wrap")} style={{ cursor: clickable ? "pointer" : "default" }} onClick={onClick}>
        <HyperspaceCardArt />
      </div>
    );
  }
  if (card.type === "event" && card.eventId) {
    return (
      <div className={cls("card-art-wrap")} style={{ cursor: clickable ? "pointer" : "default" }} onClick={onClick}>
        <EventCardFace eventId={card.eventId} title={card.title ?? card.eventId} text={card.effect} />
      </div>
    );
  }
  if (artStat && card.value != null) {
    return (
      <div
        className={cls("card-art-wrap")}
        style={{ cursor: clickable ? "pointer" : "default", color: ASPECT_FILL[artStat] }}
        onClick={onClick}
      >
        <BoosterCardArt stat={artStat} value={card.value} />
      </div>
    );
  }
  return (
    <div className={cls(`card booster-${card.type}`)} style={{ cursor: clickable ? "pointer" : "default" }} onClick={onClick}>
      <CardIcon type={card.type} />
      <div className="cbadge">{card.value ?? "◇"}</div>
      <div className="ctype">{card.type}</div>
      <div className="ceff">{card.effect}</div>
    </div>
  );
}
