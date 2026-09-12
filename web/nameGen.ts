/**
 * A short, pronounceable 4-letter name (consonant-vowel-consonant-vowel) for telling
 * players/bots apart at a glance in the status panel and pass-gate screens — independent of
 * (and a supplement to) their ship colour, which already exists for that but isn't as easy
 * to read out loud in a log-like line ("Kemu is drifting" beats "black is drifting").
 */
const CONS = ["b", "c", "d", "f", "g", "k", "l", "m", "n", "p", "r", "s", "t", "v", "z"];
const VOW = ["a", "e", "i", "o", "u"];

function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!;
}

export function randomName(): string {
  const s = pick(CONS) + pick(VOW) + pick(CONS) + pick(VOW);
  return s[0]!.toUpperCase() + s.slice(1);
}

export function randomNames(n: number): string[] {
  return Array.from({ length: n }, randomName);
}
