import { describe, it, expect } from "vitest";
import { makeRng } from "./rng.js";
import { makeDeck, drawCard, discardCards, bottomCards, drawN } from "./cards.js";

const rng = () => makeRng(1);

describe("deck", () => {
  it("makeDeck shuffles all cards into draw, none in discard", () => {
    const d = makeDeck([1, 2, 3, 4, 5], rng());
    expect(d.draw.slice().sort()).toEqual([1, 2, 3, 4, 5]);
    expect(d.discard).toEqual([]);
  });

  it("drawCard peels the top and does not mutate input", () => {
    const d0 = { draw: [10, 20, 30], discard: [] as number[] };
    const { card, deck } = drawCard(d0, rng(), true);
    expect(card).toBe(10);
    expect(deck.draw).toEqual([20, 30]);
    expect(d0.draw).toEqual([10, 20, 30]);
  });

  it("reshuffles discard when draw is empty", () => {
    let deck = { draw: [] as number[], discard: [1, 2, 3] };
    const res = drawCard(deck, rng(), true);
    expect(res.card).not.toBeNull();
    expect(res.deck.draw.length + 1).toBe(3);
    expect(res.deck.discard).toEqual([]);
  });

  it("returns null when empty and no reshuffle", () => {
    const res = drawCard({ draw: [], discard: [1] }, rng(), false);
    expect(res.card).toBeNull();
  });

  it("discardCards appends; bottomCards puts under the draw pile", () => {
    const d = { draw: [1, 2], discard: [9] };
    expect(discardCards(d, [3, 4]).discard).toEqual([9, 3, 4]);
    expect(bottomCards(d, [3, 4]).draw).toEqual([1, 2, 3, 4]);
  });

  it("drawN pulls up to n and threads the deck", () => {
    const d = makeDeck([1, 2, 3, 4, 5, 6], rng());
    const { cards, deck } = drawN(d, 3, rng(), true);
    expect(cards).toHaveLength(3);
    expect(deck.draw).toHaveLength(3);
  });
});
