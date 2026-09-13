/**
 * The 4 shared "deck" piles, as fixed screen overlays — same family as StatusPanel (a
 * persistent, always-in-the-same-place readout, not board content, so panning/zooming/
 * rotating the board never touches them): the booster deck (draw + discard/played) top
 * right, mirroring StatusPanel's top-left identity panel; the equipment ("upgrade") draw
 * pile and the ore not yet in play lower right. Each stack is sized like a real card — the
 * booster pair matches a hand card's own portrait shape (`.card`, see kit.tsx's
 * BoosterCardFace); the upgrade/ore pair is square, matching the shape upgrade cards will
 * eventually render as once they get their own art (ships/boosters are getting the same
 * treatment) — for now just a plain card-back placeholder, no per-card face to show yet.
 */
import type { GameState, OreColour } from "../../engine/index.js";
import { ORE_VAR } from "./kit.js";

function DeckCard({ square, label, value }: { square?: boolean; label: string; value: React.ReactNode }) {
  return (
    <div className={`deckcard${square ? " square" : ""}`}>
      <div className="deckcard-label">{label}</div>
      <div className="deckcard-value">{value}</div>
    </div>
  );
}

const ORE_ORDER: OreColour[] = ["green", "yellow", "red"];

export function DeckPanels({ state }: { state: GameState }) {
  const boosterTotal = state.decks.booster.draw.length + state.decks.booster.discard.length;
  const equipmentTotal = state.decks.equipment.draw.length + state.decks.equipment.discard.length;
  return (
    <>
      <div className="deck-panel">
        <DeckCard label="BOOSTERS" value={`${state.decks.booster.draw.length}/${boosterTotal}`} />
        <DeckCard label="PLAYED" value={`${state.decks.booster.discard.length}/${boosterTotal}`} />
      </div>
      <div className="supply-panel">
        <DeckCard square label="UPGRADES" value={`${state.decks.equipment.draw.length}/${equipmentTotal}`} />
        <DeckCard
          square
          label="ORE SUPPLY"
          value={
            <span className="deckcard-orerow">
              {ORE_ORDER.map((o) => (
                <span key={o} style={{ color: ORE_VAR[o] }}>
                  {state.supply[o]}
                </span>
              ))}
            </span>
          }
        />
      </div>
    </>
  );
}
