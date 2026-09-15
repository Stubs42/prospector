/**
 * Real card artwork (res/cards-artwork.svg, via cardAssets.ts) composed into booster/upgrade
 * card faces and backs. The raw art supplies the frame shape, the black "screen" inset, and
 * every icon; this file only supplies DYNAMIC content (which tier icon, the label/value
 * text) at positions read off the artwork's own examples (see cardAssets.ts's history for
 * how those fractions were measured) — never hand-redrawn. Every position/size below is
 * still just a starting point though — theme.cards.booster/upgrade/ship carries a nudge
 * (title/value offset, icon scale) for each, since the measured fractions don't always read
 * quite right once real text/icons sit in them.
 *
 * Colour theming: every path in the art carries an inline `style="fill:...;stroke:..."`,
 * which always beats a CSS class alone — the `.icon-*` class rules only take effect with
 * `!important` (see styles.css's "card artwork theming" block), which is why every card
 * face here is wrapped in `.card-art`.
 */
import { useRef, useState, type CSSProperties, type MouseEvent as RMouseEvent, type ReactNode } from "react";
import type { Colour, ShipStats, StatKey } from "../../engine/index.js";
import { CARD_ART, PORTRAIT_ASPECT, SHIP_NOSE_BY_COLOUR, tierIconFor } from "../cardAssets.js";
import { theme } from "../theme.js";
import { ASPECT_TAG } from "./aspects.js";

/** a rectangle positioned as a fraction of the card's own box (0..1) */
interface FracBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** shrink/grow a box around its own centre — theme.cards.*.iconScale */
function scaleBox(box: FracBox, scale: number): FracBox {
  if (scale === 1) return box;
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const w = box.w * scale;
  const h = box.h * scale;
  return { x: cx - w / 2, y: cy - h / 2, w, h };
}

/** `tip`: hover text for this layer, shown via the app's own floating tooltip (same idea as
   Board.tsx's onTip/.board-tip — not the native `title` attribute, which turned out
   unreliable here: a filled SVG <path> is its own hit-test target by default, so the raw
   artwork nested inside the div kept winning native title's hit-test ahead of the div that
   actually carried it, and no tooltip ever showed. A real mouse event on that same nested
   path still bubbles up through the DOM to this div's own onMouseMove/onMouseLeave handler
   regardless, which is what a `tip` here relies on instead. */
function Layer({
  box, svg, tip, onTip,
}: {
  box: FracBox;
  svg: string;
  tip?: string;
  onTip?: (text: string | null, e: RMouseEvent) => void;
}) {
  const style: CSSProperties = {
    position: "absolute",
    left: `${box.x * 100}%`,
    top: `${box.y * 100}%`,
    width: `${box.w * 100}%`,
    height: `${box.h * 100}%`,
    // .card-art-layer is pointer-events:none by default (every other layer is purely
    // decorative and must stay click-through) — a tip needs the opposite, or the hover
    // never reaches this element at all
    ...(tip ? { pointerEvents: "auto" } : undefined),
  };
  return (
    <div
      className="card-art-layer"
      style={style}
      dangerouslySetInnerHTML={{ __html: svg }}
      onMouseMove={tip ? (e) => onTip?.(tip, e) : undefined}
      onMouseLeave={tip ? (e) => onTip?.(null, e) : undefined}
    />
  );
}

/** a label/value string drawn on top of the art, centred on one point — position comes from
   the card's own baked-in layout (BOOSTER_LABEL etc. below) plus a theme nudge, size from
   theme.cards as a fraction of the card's actual pixel height (`cardHeight`) so it scales
   correctly — a CSS `%` font-size resolves against the *inherited* font-size, not the
   container's own size, so this needs a real px value, not a percentage. Exported so other
   "text on top of real card art" spots (DeckPanels' deck-back stacks) can match a real
   face's placement. */
export function CardText({
  x, y, frac, cardHeight, color, children,
}: {
  x: number; y: number; frac: number; cardHeight: number; color: string; children: ReactNode;
}) {
  const style: CSSProperties = {
    position: "absolute",
    left: `${x * 100}%`,
    top: `${y * 100}%`,
    transform: "translate(-50%, -50%)",
    fontSize: frac * cardHeight,
    fontWeight: 800,
    color,
    whiteSpace: "nowrap",
    textAlign: "center",
  };
  return <div style={style}>{children}</div>;
}

const FULL: FracBox = { x: 0, y: 0, w: 1, h: 1 };
// measured off Booster-card-fuel-example / Booster-card-laser-example (see cardAssets.ts)
const BOOSTER_SCREEN: FracBox = { x: 0.048, y: 0.183, w: 0.905, h: 0.633 };
const BOOSTER_ICON: FracBox = { x: 0.1, y: 0.21, w: 0.8, h: 0.56 };
export const BOOSTER_LABEL = { x: 0.5, y: 0.1 };
export const BOOSTER_VALUE = { x: 0.5, y: 0.86 };
// measured off Upgarde-card-laser-example
const UPGRADE_SCREEN: FracBox = { x: 0.048, y: 0.19, w: 0.905, h: 0.762 };
const UPGRADE_ICON: FracBox = { x: 0.14, y: 0.24, w: 0.72, h: 0.72 };
export const UPGRADE_LABEL = { x: 0.5, y: 0.1 };
export const UPGRADE_VALUE = { x: 0.79, y: 0.85 };

export interface BoosterCardArtProps {
  stat: StatKey;
  /** the printed value — every booster shows one (e.g. a fuel/laser/shield/engine amount) */
  value: number;
  /** anything drawn on top after the standard label/value (e.g. a "+1" corner chip) */
  children?: ReactNode;
}

/** a booster card's face — real art, portrait. Used for hand cards and the booster
   deck-panel stack's "example" face isn't needed (the deck panel shows the back, not a
   face); mainly consumed by kit.tsx's BoosterCardFace. */
export function BoosterCardArt({ stat, value, children }: BoosterCardArtProps) {
  const t = theme.cards.booster;
  const w = theme.cards.boosterWidth;
  const h = w / PORTRAIT_ASPECT;
  const icon = tierIconFor(stat, value);
  return (
    <div className="card-art" style={{ position: "relative", width: w, height: h }}>
      <Layer box={FULL} svg={CARD_ART.framePortraitOuter} />
      <Layer box={BOOSTER_SCREEN} svg={CARD_ART.framePortraitInner} />
      {icon && <Layer box={scaleBox(BOOSTER_ICON, t.iconScale)} svg={icon} />}
      <CardText x={BOOSTER_LABEL.x} y={BOOSTER_LABEL.y + t.titleOffsetY} frac={t.titleFontSize} cardHeight={h} color="#000">
        {ASPECT_TAG[stat]}
      </CardText>
      <CardText x={BOOSTER_VALUE.x} y={BOOSTER_VALUE.y + t.valueOffsetY} frac={t.valueFontSize} cardHeight={h} color="#000">
        {value}
      </CardText>
      {children}
    </div>
  );
}

// a one-shot hyperspace card isn't tied to a ship stat like the other 4 booster types (no
// tierIconFor analog to pull from), so it draws its own small starburst directly instead —
// same shape CardIcon used to draw for the old plain-card fallback, just now as a Layer so
// it goes through the exact same positioning/scaling path as every other booster icon
const HYPERSPACE_ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40">' +
  '<path d="M20 6 L23.5 17 L34 20 L23.5 23 L20 34 L16.5 23 L6 20 L16.5 17 Z" fill="var(--card-hyperspace)" opacity="0.85"/>' +
  "</svg>";

/** the one-shot hyperspace card — same real frame/screen art as any other booster card
   (BoosterCardArt), just with its own icon and no printed value (a hyperspace card is used
   up, not stacked/amount-based, so there's nothing to print). */
export function HyperspaceCardArt() {
  const t = theme.cards.booster;
  const w = theme.cards.boosterWidth;
  const h = w / PORTRAIT_ASPECT;
  return (
    <div className="card-art" style={{ position: "relative", width: w, height: h }}>
      <Layer box={FULL} svg={CARD_ART.framePortraitOuter} />
      <Layer box={BOOSTER_SCREEN} svg={CARD_ART.framePortraitInner} />
      <Layer box={scaleBox(BOOSTER_ICON, t.iconScale)} svg={HYPERSPACE_ICON} />
      <CardText x={BOOSTER_LABEL.x} y={BOOSTER_LABEL.y + t.titleOffsetY} frac={t.titleFontSize} cardHeight={h} color="#000">
        HYPERSPACE
      </CardText>
    </div>
  );
}

export interface UpgradeCardArtProps {
  stat: StatKey;
  amount: number;
}

/** an upgrade card's face — real art, square. Used by EquipmentPopup. */
export function UpgradeCardArt({ stat, amount }: UpgradeCardArtProps) {
  const t = theme.cards.upgrade;
  const w = theme.cards.upgradeSize;
  const icon = tierIconFor(stat, amount);
  const iconBox = scaleBox(UPGRADE_ICON, t.iconScale);
  iconBox.x += t.iconOffsetX;
  iconBox.y += t.iconOffsetY;
  return (
    <div className="card-art" style={{ position: "relative", width: w, height: w }}>
      <Layer box={FULL} svg={CARD_ART.frameSquareOuter} />
      <Layer box={UPGRADE_SCREEN} svg={CARD_ART.frameSquareInner} />
      {icon && <Layer box={iconBox} svg={icon} />}
      <CardText x={UPGRADE_LABEL.x} y={UPGRADE_LABEL.y + t.titleOffsetY} frac={t.titleFontSize} cardHeight={w} color="#000">
        {ASPECT_TAG[stat]}
      </CardText>
      <CardText
        x={UPGRADE_VALUE.x + t.valueOffsetX}
        y={UPGRADE_VALUE.y + t.valueOffsetY}
        frac={t.valueFontSize}
        cardHeight={w}
        color="#b3b3b3"
      >
        +{amount}
      </CardText>
    </div>
  );
}

/** a face-down card, real art — the deck-panel stacks (DeckPanels.tsx) use these instead of
   a plain CSS placeholder */
export function CardBackArt({ square }: { square?: boolean | undefined }) {
  const w = square ? theme.cards.upgradeSize : theme.cards.boosterWidth;
  const h = square ? w : w / PORTRAIT_ASPECT;
  return (
    <div className="card-art" style={{ position: "relative", width: w, height: h }}>
      <Layer box={FULL} svg={square ? CARD_ART.upgradeBack : CARD_ART.boosterBack} />
    </div>
  );
}

// measured off Ship-card-Atlas-example (see cardAssets.ts's history)
const SHIP_SCREEN: FracBox = { x: 0.048, y: 0.034, w: 0.905, h: 0.417 };
const SHIP_NOSE: FracBox = { x: 0.22, y: 0.1, w: 0.56, h: 0.26 };
const SHIP_NAME = { x: 0.5, y: 0.46 };
// a 2x3 grid, each cell the same size — column/row index -> fraction box
const SHIP_CELL_W = 0.2857;
const SHIP_CELL_H = 0.1999;
const SHIP_CELL_X = [0.0476, 0.3571, 0.6667] as const;
const SHIP_CELL_Y = [0.5501, 0.7667] as const;
function shipCellBox(col: 0 | 1 | 2, row: 0 | 1): FracBox {
  return { x: SHIP_CELL_X[col], y: SHIP_CELL_Y[row], w: SHIP_CELL_W, h: SHIP_CELL_H };
}
/** a cell's icon sits centred with a little breathing room inside its own frame */
function shipIconBox(col: 0 | 1 | 2, row: 0 | 1): FracBox {
  const pad = 0.05;
  return { x: SHIP_CELL_X[col] + pad, y: SHIP_CELL_Y[row] + pad, w: SHIP_CELL_W - pad * 2, h: SHIP_CELL_H - pad * 2 };
}
/** the fuel cell is laid out differently from the other 5 (icon on the left, its real
   number on the right — see theme.cards.ship's own doc comment) */
function fuelIconBox(col: 0 | 1 | 2, row: 0 | 1, scale: number): FracBox {
  const pad = 0.06;
  const cellX = SHIP_CELL_X[col];
  const cellY = SHIP_CELL_Y[row];
  const box: FracBox = {
    x: cellX + pad + theme.cards.ship.fuelIconOffsetX,
    y: cellY + pad,
    w: SHIP_CELL_W * 0.46,
    h: SHIP_CELL_H - pad * 2,
  };
  return scaleBox(box, scale);
}
/** hover text for a stat cell — "Shields: 1" / "No Shields" at 0, not the board token's
   terser ASPECT_LABEL/ASPECT_TAG (this is prose for a tooltip, not a printed chip) */
const STAT_TOOLTIP_NAME: Record<StatKey, string> = {
  shields: "Shields",
  lasers: "Lasers",
  engines: "Engines",
  cargo: "Cargo Capacity",
  fuelTanks: "Fuel Tanks",
  booster: "Hand Limit",
};
function statTooltip(stat: StatKey, value: number): string {
  const name = STAT_TOOLTIP_NAME[stat];
  return value > 0 ? `${name}: ${value}` : `No ${name}`;
}

/** top row: shields, lasers, fuel (icon + printed number); bottom row: cargo, engines, hand
   limit (a star rating, not its own icon shape — see cardAssets.ts's tierIconFor) */
const SHIP_GRID: { stat: StatKey; col: 0 | 1 | 2; row: 0 | 1 }[] = [
  { stat: "shields", col: 0, row: 0 },
  { stat: "lasers", col: 1, row: 0 },
  { stat: "fuelTanks", col: 2, row: 0 },
  { stat: "cargo", col: 0, row: 1 },
  { stat: "engines", col: 1, row: 1 },
  { stat: "booster", col: 2, row: 1 },
];

export interface ShipCardArtProps {
  colour: Colour;
  name: string;
  stats: ShipStats;
}

/** a ship's stat card — real art, portrait, the same shape/size family as a booster card
   but its own configurable width (theme.cards.shipWidth). Every non-fuel stat (0-3) shows
   as a tiered pip icon — 0 means an empty slot, no icon at all; fuel alone shows a
   representative tank icon plus its real printed number (its capacity is well past what 3
   pips could show). Used by the setup screen's ship picker (ShipPickerPopup). */
export function ShipCardArt({ colour, name, stats }: ShipCardArtProps) {
  const t = theme.cards.ship;
  const w = theme.cards.shipWidth;
  const h = w / PORTRAIT_ASPECT;
  // the 6 stat cells' hover tooltip, positioned the same way Board.tsx's own onTip/.board-tip
  // is: `position: absolute` relative to this card's own (position:relative, untransformed)
  // container, converting the raw clientX/Y into card-local coordinates via its rect. NOT
  // `position: fixed` with raw clientX/Y — that seemed simpler (no ref/rect needed) but a
  // ship card always renders inside ActionBox's `.actionbox`, which has its own
  // `transform: translate(-50%, -50%)` to center itself; any transformed ancestor becomes
  // the containing block for a `position: fixed` descendant instead of the true viewport
  // (a CSS-spec gotcha, not a bug in this component), so the tooltip rendered at a fixed
  // — but wrong — offset from the cursor instead of following it.
  const cardRef = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<{ text: string; x: number; y: number } | null>(null);
  const onTip = (text: string | null, e: RMouseEvent) => {
    if (!text) { setTip(null); return; }
    const r = cardRef.current?.getBoundingClientRect();
    setTip({ text, x: e.clientX - (r?.left ?? 0), y: e.clientY - (r?.top ?? 0) });
  };
  return (
    <div ref={cardRef} className="card-art" style={{ position: "relative", width: w, height: h }}>
      <Layer box={FULL} svg={CARD_ART.framePortraitOuter} />
      <Layer box={SHIP_SCREEN} svg={CARD_ART.shipScreenBg} />
      <div
        className="card-art-layer"
        style={{
          position: "absolute",
          left: `${SHIP_NOSE.x * 100}%`, top: `${SHIP_NOSE.y * 100}%`,
          width: `${SHIP_NOSE.w * 100}%`, height: `${SHIP_NOSE.h * 100}%`,
        }}
        // a per-colour gradient (light-to-dark, cone-like) baked in at module load, not
        // CSS currentColor — see cardAssets.ts's SHIP_NOSE_BY_COLOUR for why
        dangerouslySetInnerHTML={{ __html: SHIP_NOSE_BY_COLOUR[colour] }}
      />
      <CardText x={SHIP_NAME.x} y={SHIP_NAME.y + t.nameOffsetY} frac={t.nameFontSize} cardHeight={h} color="#000">
        {name}
      </CardText>
      {SHIP_GRID.map(({ stat, col, row }) => {
        const value = stats[stat];
        const isFuel = stat === "fuelTanks";
        const icon = isFuel ? tierIconFor(stat, 1) : tierIconFor(stat, value);
        return (
          <div key={stat}>
            <Layer box={shipCellBox(col, row)} svg={CARD_ART.shipCellBg} tip={statTooltip(stat, value)} onTip={onTip} />
            {icon && (
              <Layer
                box={isFuel ? fuelIconBox(col, row, t.iconScale[stat]) : scaleBox(shipIconBox(col, row), t.iconScale[stat])}
                svg={icon}
              />
            )}
            {isFuel && (
              <CardText
                x={SHIP_CELL_X[col] + SHIP_CELL_W * 0.72 + t.fuelOffsetX}
                y={SHIP_CELL_Y[row] + SHIP_CELL_H / 2 + t.fuelOffsetY}
                frac={t.fuelFontSize}
                cardHeight={h}
                color="#b3b3b3"
              >
                {value}
              </CardText>
            )}
          </div>
        );
      })}
      {tip && (
        <div className="board-tip" style={{ left: tip.x, top: tip.y }}>
          {tip.text}
        </div>
      )}
    </div>
  );
}
