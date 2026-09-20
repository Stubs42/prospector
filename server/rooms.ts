/** The in-memory room registry — one process, one Map. Every room's authoritative GameState
   lives here (and is mirrored to Postgres by game-server.ts after every change); this file
   only owns the registry shape and lookup, not the game-logic orchestration. */
import type { WebSocket } from "ws";
import type { GameState } from "../engine/index.js";
import type { Seat } from "../client/index.js";
import type { Rng } from "../engine/rng.js";

export interface RoomPlayer {
  playerIndex: number;
  displayName: string;
  seatKind: Seat;
  reconnectToken: string;
}

export interface Room {
  /** Postgres games.id */
  id: string;
  roomCode: string;
  state: GameState;
  seats: Seat[];
  players: RoomPlayer[];
  /** human seats only — a bot seat never has a socket */
  sockets: Map<number, WebSocket>;
  rng: Rng;
  botTimer: ReturnType<typeof setTimeout> | null;
}

const rooms = new Map<string, Room>();

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I — easier to read aloud

export function generateRoomCode(): string {
  let code = "";
  for (let i = 0; i < 5; i++) code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  return rooms.has(code) ? generateRoomCode() : code;
}

export function addRoom(room: Room): void {
  rooms.set(room.roomCode, room);
}

export function getRoom(roomCode: string): Room | undefined {
  return rooms.get(roomCode);
}

export function removeRoom(roomCode: string): void {
  const room = rooms.get(roomCode);
  if (room?.botTimer) clearTimeout(room.botTimer);
  rooms.delete(roomCode);
}

export function allRooms(): IterableIterator<Room> {
  return rooms.values();
}
