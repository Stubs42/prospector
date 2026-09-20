/**
 * Wire protocol between a network client (web/) and the multiplayer server (server/). Lives
 * here, not in web/ or server/, because both already import shared logic from client/ (see
 * this folder's own header comment: "hot-seat, mobile, network" were always the intended
 * consumers) — one canonical definition avoids the two sides drifting apart.
 *
 * Deliberately reuses the engine's own `Action`/`GameState` types rather than inventing a
 * parallel vocabulary: the server validates every action with the same `applyAction` the
 * hot-seat client already trusts, so the wire format is just "here's an Action" / "here's the
 * resulting GameState".
 */
import type { Action, GameState } from "../engine/index.js";
import type { Seat } from "./seats.js";

export type ClientMessage =
  | {
      type: "createRoom";
      displayName: string;
      humans: number;
      bots: number;
      upgradeAtStart: "none" | "random" | "select";
      variant: "standard" | "short" | "long";
    }
  | { type: "joinRoom"; roomCode: string; displayName: string; reconnectToken?: string }
  | { type: "action"; action: Action }
  | { type: "leaveRoom" };

export type ServerMessage =
  | { type: "roomJoined"; roomCode: string; playerIndex: number; reconnectToken: string; seats: Seat[] }
  | { type: "state"; state: GameState }
  | { type: "error"; message: string }
  | { type: "roomClosed" };
