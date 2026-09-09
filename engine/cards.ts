import type { Rng } from "./rng.js";

export interface Deck<T> {
  draw: T[];
  discard: T[];
}

export function makeDeck<T>(cards: readonly T[], rng: Rng): Deck<T> {
  return { draw: rng.shuffle(cards), discard: [] };
}

/**
 * Draw the top card. When the draw pile is empty and `reshuffle` is set, the discard pile is
 * shuffled into a new draw pile first. Returns a new deck (does not mutate the input).
 */
export function drawCard<T>(
  deck: Deck<T>,
  rng: Rng,
  reshuffle: boolean,
): { card: T | null; deck: Deck<T> } {
  let draw = deck.draw;
  let discard = deck.discard;

  if (draw.length === 0) {
    if (!reshuffle || discard.length === 0) {
      return { card: null, deck: { draw: [...draw], discard: [...discard] } };
    }
    draw = rng.shuffle(discard);
    discard = [];
  }

  const card = draw[0]!;
  return { card, deck: { draw: draw.slice(1), discard: [...discard] } };
}

export function discardCards<T>(deck: Deck<T>, cards: readonly T[]): Deck<T> {
  return { draw: [...deck.draw], discard: [...deck.discard, ...cards] };
}

/** Put cards back on the bottom of the draw pile (equipment "rejected cards go under the deck"). */
export function bottomCards<T>(deck: Deck<T>, cards: readonly T[]): Deck<T> {
  return { draw: [...deck.draw, ...cards], discard: [...deck.discard] };
}

export function drawN<T>(
  deck: Deck<T>,
  n: number,
  rng: Rng,
  reshuffle: boolean,
): { cards: T[]; deck: Deck<T> } {
  const cards: T[] = [];
  let d = deck;
  for (let i = 0; i < n; i++) {
    const res = drawCard(d, rng, reshuffle);
    if (res.card === null) break;
    cards.push(res.card);
    d = res.deck;
  }
  return { cards, deck: d };
}
