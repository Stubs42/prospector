/**
 * A short, pronounceable 4-letter name (consonant-vowel-consonant-vowel) for bots, so
 * several of them are easy to tell apart in the status panel ("Kemu is drifting" beats
 * "Player is drifting" when there are three bots). Human seats just say "Player" for now —
 * real per-account names come later with actual multiplayer.
 */
const CONS = ["b", "c", "d", "f", "g", "k", "l", "m", "n", "p", "r", "s", "t", "v", "z"];
const VOW = ["a", "e", "i", "o", "u"];

function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!;
}

export function randomBotName(): string {
  const s = pick(CONS) + pick(VOW) + pick(CONS) + pick(VOW);
  return s[0]!.toUpperCase() + s.slice(1);
}
