/**
 * The 4 shared "deck" piles, as fixed screen overlays — same family as StatusPanel (a
 * persistent, always-in-the-same-place readout, not board content, so panning/zooming/
 * rotating the board never touches them): the booster deck (draw + discard/played) top
 * right, mirroring StatusPanel's top-left identity panel; the equipment ("upgrade") draw
 * pile and the ore not yet in play lower right. Each stack is real card-back art
 * (CardBackArt, see CardArt.tsx) — the booster pair portrait, the upgrade/ore pair square —
 * with a label/value overlay at the same position a real card face uses. The back art's own
 * "screen" runs bigger than a face's, covering most of the card, so the overlay text is
 * light (not the dark ink a face uses on its lighter frame margin).
 */
import type { GameState, OreColour } from "../../engine/index.js";
import { ORE_VAR } from "./kit.js";
import { CardBackArt, CardText, BOOSTER_LABEL, BOOSTER_VALUE, UPGRADE_LABEL, UPGRADE_VALUE } from "./CardArt.js";
import { PORTRAIT_ASPECT } from "../cardAssets.js";
import { theme } from "../theme.js";

const OVERLAY_INK = "#e8efe9";

function DeckStack({ square, label, value }: { square?: boolean; label: string; value: React.ReactNode }) {
  const labelPt = square ? UPGRADE_LABEL : BOOSTER_LABEL;
  const valuePt = square ? UPGRADE_VALUE : BOOSTER_VALUE;
  const t = square ? theme.cards.upgrade : theme.cards.booster;
  const h = square ? theme.cards.upgradeSize : theme.cards.boosterWidth / PORTRAIT_ASPECT;
  return (
    <div style={{ position: "relative" }}>
      <CardBackArt square={square} />
      <CardText x={labelPt.x} y={labelPt.y + t.titleOffsetY} frac={t.titleFontSize} cardHeight={h} color={OVERLAY_INK}>
        {label}
      </CardText>
      <CardText x={valuePt.x} y={valuePt.y + t.valueOffsetY} frac={t.valueFontSize} cardHeight={h} color={OVERLAY_INK}>
        {value}
      </CardText>
    </div>
  );
}

const ORE_ORDER: OreColour[] = ["green", "yellow", "red"];

export function DeckPanels({ state }: { state: GameState }) {
  const boosterTotal = state.decks.booster.draw.length + state.decks.booster.discard.length;
  const equipmentTotal = state.decks.equipment.draw.length + state.decks.equipment.discard.length;
  const upgradeH = theme.cards.upgradeSize;
  return (
    <>
      <div className="deck-panel">
        <DeckStack label="BOOSTERS" value={`${state.decks.booster.draw.length}/${boosterTotal}`} />
        <DeckStack label="PLAYED" value={`${state.decks.booster.discard.length}/${boosterTotal}`} />
      </div>
      <div className="supply-panel">
        <DeckStack square label="UPGRADES" value={`${state.decks.equipment.draw.length}/${equipmentTotal}`} />
        <div style={{ position: "relative" }}>
          <CardBackArt square />
          <CardText
            x={UPGRADE_LABEL.x}
            y={UPGRADE_LABEL.y + theme.cards.upgrade.titleOffsetY}
            frac={theme.cards.upgrade.titleFontSize}
            cardHeight={upgradeH}
            color={OVERLAY_INK}
          >
            ORE
          </CardText>
          <div
            className="deckcard-orerow"
            style={{
              position: "absolute",
              left: `${(UPGRADE_VALUE.x + theme.cards.upgrade.valueOffsetX) * 100}%`,
              top: `${(UPGRADE_VALUE.y + theme.cards.upgrade.valueOffsetY) * 100}%`,
              transform: "translate(-50%, -50%)",
              fontSize: theme.cards.upgrade.valueFontSize * upgradeH,
            }}
          >
            {ORE_ORDER.map((o) => (
              <span key={o} style={{ color: ORE_VAR[o] }}>
                {state.supply[o]}
              </span>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
