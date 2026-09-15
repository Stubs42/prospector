/** Turn an engine log entry into a human sentence. GUI-agnostic (returns plain text). */
import type { GameState } from "../engine/index.js";

type Entry = GameState["log"][number];

export function formatLogEntry(state: GameState, e: Entry): string {
  const col = (id: unknown) => state.players[Number(id)]?.colour ?? "?";
  const d = (e.detail ?? {}) as Record<string, unknown>;
  switch (e.event) {
    case "boosterPlayed": {
      const cards = (d.cards as { type: string; value: number | null }[])
        .map((c) => `${c.type} ${c.value === null ? "◇" : "+" + c.value}`)
        .join(", ");
      return `${col(d.player)} played ${cards} (${d.context})`;
    }
    case "burned":
      return (
        `${col(d.player)} burned ${d.cells} cell${d.cells === 1 ? "" : "s"}` +
        `${d.fuelSpent ? `, ${d.fuelSpent} fuel` : ", free"}${d.engineBoost ? ` (+${d.engineBoost} eng)` : ""}`
      );
    case "attackDeclared":
      return `${col(d.attacker)} attacks ${col(d.defender)}${d.laserBoost ? ` (+${d.laserBoost} laser)` : ""}`;
    case "defence":
      return d.autoRepel
        ? `${col(d.defender)} auto-repels`
        : `${col(d.defender)} raises shields +${d.shieldBoost}`;
    case "attackSucceeded":
      return `${col(d.attacker)} hits ${col(d.defender)} (${d.attackTotal}–${d.defenceTotal}) — ${col(
        d.attacker,
      )} takes a ${d.spoil} from ${col(d.defender)}`;
    case "attackFailed":
      return `${col(d.attacker)}'s attack repelled by ${col(d.defender)} (${d.attackTotal}–${d.defenceTotal})${
        d.defenceTotal === d.attackTotal
          ? " — tie, defender wins; they may counter-attack"
          : "; defender may counter-attack"
      }`;
    case "defenderFled":
      return `${col(d.defender)} flees through hyperspace`;
    case "loaded":
      return `${col(d.player)} loads a ${d.colour}`;
    case "delivered":
      return `${col(d.player)} delivers ${(d.tiles as string[]).join(", ")}`;
    case "equipped":
      return d.stat
        ? `${col(d.player)} installs +${d.amount} ${d.stat}`
        : `${col(d.player)} installs equipment`;
    case "shipLost":
      return `${col(d.player)} loses the ship (${d.reason})`;
    case "shipEliminated":
      return `${col(d.player)} is eliminated`;
    case "shipPlaced":
      return `${col(d.player)} launches`;
    default:
      return `${state.players[e.player]?.colour ?? ""} — ${e.event}`;
  }
}
