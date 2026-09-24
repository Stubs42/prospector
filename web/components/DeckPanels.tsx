/**
 * The 4 shared "deck" piles, as fixed screen overlays — same family as StatusPanel (a
 * persistent, always-in-the-same-place readout, not board content, so panning/zooming/
 * rotating the board never touches them): the booster deck (draw + discard/played) top
 * right, mirroring StatusPanel's top-left identity panel; the equipment ("upgrade") draw
 * pile and the ore not yet in play lower right.
 *
 * Each stack is real card-back art (CardBackArt, see CardArt.tsx) EXCEPT the "played" pile,
 * which is an open discard — it shows the actual top (most recently discarded) card's real
 * face, not a generic backside, since that's genuinely known information. The draw counts
 * live as a caption below the art, inside a shared frame, rather than overlaid on the card
 * itself (which read as if it were printed on the card). The ore-not-yet-in-play readout
 * isn't a card at all any more — just three coloured dots (one per ore colour) with their
 * counts below, in a plain frame instead of a square card-back.
 */
import type { GameState } from "../../engine/index.js";
import { ORE_VAR, BoosterCardFace } from "./kit.js";
import { CardBackArt } from "./CardArt.js";
import { PORTRAIT_ASPECT } from "../cardAssets.js";
import { theme } from "../theme.js";

const ORE_ORDER = ["green", "yellow", "red"] as const;

/** the discard pile before anything's been played — an empty slot, not a card-back (there's
   no "card" there yet to show the back of); same box as a real card so nothing shifts once
   one appears */
function EmptyCardSlot() {
  const w = theme.cards.boosterWidth;
  const h = w / PORTRAIT_ASPECT;
  return <div className="card-art-wrap empty-slot" style={{ width: w, height: h }} />;
}

function DeckStack({
  children,
  label,
  value,
}: {
  children: React.ReactNode;
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="deckstack">
      {children}
      <div className="deckstack-caption">
        <span className="deckstack-label">{label}</span>
        <span className="deckstack-value">{value}</span>
      </div>
    </div>
  );
}

// the upgrade deck's own art is square at theme.cards.upgradeSize, wider than a booster
// card (theme.cards.boosterWidth) — zoom it down to match, and give both supply-panel
// frames that same content width so the ore frame (which has no card of its own to size
// off) lines up with it exactly rather than hugging its own, narrower dot row
const UPGRADE_CARD_SCALE = theme.cards.boosterWidth / theme.cards.upgradeSize;
const SUPPLY_FRAME_WIDTH = theme.cards.boosterWidth;

export function DeckPanels({ state }: { state: GameState }) {
  const boosterTotal = state.decks.booster.draw.length + state.decks.booster.discard.length;
  const eventTotal = state.decks.event.draw.length + state.decks.event.discard.length;
  const equipmentTotal = state.decks.equipment.draw.length + state.decks.equipment.discard.length;
  const topDiscard = state.decks.booster.discard[state.decks.booster.discard.length - 1] ?? null;
  const topEventDiscard = state.decks.event.discard[state.decks.event.discard.length - 1] ?? null;
  return (
    <>
      {/* a shared positioning column — the event deck's own frame sits directly below the
         booster one (not crammed into one wider row, so the event discard, the one everybody
         actually looks at when something happens, stays visually distinct from "just another
         booster pile"); stacking them via a flex wrapper instead of two independent
         position:absolute frames avoids hand-tuning a second fixed pixel offset */}
      <div className="deck-panel-column">
        <div className="deck-panel">
          <DeckStack label="BOOSTERS" value={`${state.decks.booster.draw.length}/${boosterTotal}`}>
            <div className="card-art-wrap">
              <CardBackArt />
            </div>
          </DeckStack>
          <DeckStack label="PLAYED" value={`${state.decks.booster.discard.length}/${boosterTotal}`}>
            {topDiscard ? <BoosterCardFace card={topDiscard} /> : <EmptyCardSlot />}
          </DeckStack>
        </div>
        <div className="deck-panel">
          <DeckStack label="EVENTS" value={`${state.decks.event.draw.length}/${eventTotal}`}>
            <div className="card-art-wrap">
              <CardBackArt />
            </div>
          </DeckStack>
          <DeckStack label="EVENT PLAYED" value={`${state.decks.event.discard.length}/${eventTotal}`}>
            {topEventDiscard ? <BoosterCardFace card={topEventDiscard} /> : <EmptyCardSlot />}
          </DeckStack>
        </div>
      </div>
      <div className="supply-panel">
        <div className="supply-frame" style={{ width: SUPPLY_FRAME_WIDTH }}>
          <div className="ore-dots">
            {ORE_ORDER.map((o) => (
              <div key={o} className="ore-col">
                <span className="ore-dot" style={{ background: ORE_VAR[o] }} />
                <span className="ore-count" style={{ color: ORE_VAR[o] }}>
                  {state.supply[o]}
                </span>
              </div>
            ))}
          </div>
        </div>
        <div className="supply-frame" style={{ width: SUPPLY_FRAME_WIDTH }}>
          <DeckStack label="UPGRADES" value={`${state.decks.equipment.draw.length}/${equipmentTotal}`}>
            <div className="card-art-wrap" style={{ zoom: UPGRADE_CARD_SCALE }}>
              <CardBackArt square />
            </div>
          </DeckStack>
        </div>
      </div>
    </>
  );
}
