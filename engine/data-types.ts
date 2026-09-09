/** Shapes of the generated data files. Pure types — safe to import anywhere (no fs). */
import type { BoosterCard, EquipmentCard } from "./types.js";

export interface BoardJson {
  orientation: "pointy-top" | "flat-top";
  radius: number;
  innerRadius: number;
  layout: { type: string; hexSize: number };
  directionsByColour: Record<string, [number, number]>;
  bases: Record<string, [number, number][]>;
  cellCount: number;
  cells: {
    q: number;
    r: number;
    dist: number;
    region: "inner" | "outer";
    origin: boolean;
    base: string | null;
    x: number;
    y: number;
  }[];
}

export interface ContentJson {
  mode: string;
  ships: { id: string; colour: string; name: string; stats: Record<string, number> }[];
  upgradeCaps: Record<string, number>;
  decks: {
    booster: { count: number; cards: BoosterCard[] };
    equipment: { count: number; cards: EquipmentCard[] };
    fuel: { cards: { id: string; value: number }[]; sharedField: { count: number; value: number } };
  };
  resourceSupplyByPlayers: Record<
    string,
    { perColour: number; short: number; long: number; totalStandard: number }
  >;
}
