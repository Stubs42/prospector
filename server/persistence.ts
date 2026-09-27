/** Load/save game records — the only place server/ talks SQL directly. Kept as plain
   data-in-data-out functions (no Room/WebSocket references) so they're easy to unit-test
   against a fake pool and easy to later swap for a different store without touching
   rooms.ts/game-server.ts. */
import type pg from "pg";
import { STATE_SCHEMA_VERSION, type GameState } from "../engine/index.js";
import type { Seat } from "../client/index.js";

export interface StoredPlayer {
  playerIndex: number;
  displayName: string;
  seatKind: Seat;
  reconnectToken: string;
}

export interface StoredGame {
  id: string;
  roomCode: string;
  state: GameState;
  seats: Seat[];
  names: string[];
  players: StoredPlayer[];
  schemaVersion: number;
}

export async function createGameRecord(
  pool: pg.Pool,
  roomCode: string,
  state: GameState,
  seats: Seat[],
  names: string[],
): Promise<string> {
  const res = await pool.query<{ id: string }>(
    "INSERT INTO games (room_code, state, seats, names, schema_version) VALUES ($1, $2, $3, $4, $5) RETURNING id",
    [roomCode, state, JSON.stringify(seats), JSON.stringify(names), STATE_SCHEMA_VERSION],
  );
  return res.rows[0]!.id;
}

export async function updateGameState(pool: pg.Pool, gameId: string, state: GameState): Promise<void> {
  // re-stamps schema_version on every write too, not just at creation — the state a running
  // server writes is always shaped by whatever code that server is currently running
  await pool.query("UPDATE games SET state = $2, schema_version = $3, updated_at = now() WHERE id = $1", [
    gameId,
    state,
    STATE_SCHEMA_VERSION,
  ]);
}

/** Permanently removes a stored game (and its players, via ON DELETE CASCADE) — used on boot
   to clean up rows a version mismatch left un-restorable, so they don't pile up forever. */
export async function deleteGameRecord(pool: pg.Pool, gameId: string): Promise<void> {
  await pool.query("DELETE FROM games WHERE id = $1", [gameId]);
}

/** Names change only on a join (or at creation), unlike state — a separate write keeps that
   independent of the far more frequent per-action state updates. */
export async function updateRoomNames(pool: pg.Pool, gameId: string, names: string[]): Promise<void> {
  await pool.query("UPDATE games SET names = $2, updated_at = now() WHERE id = $1", [gameId, JSON.stringify(names)]);
}

export async function addPlayer(pool: pg.Pool, gameId: string, player: StoredPlayer): Promise<void> {
  await pool.query(
    "INSERT INTO game_players (game_id, player_index, display_name, seat_kind, reconnect_token) VALUES ($1, $2, $3, $4, $5)",
    [gameId, player.playerIndex, player.displayName, player.seatKind, player.reconnectToken],
  );
}

/** Every persisted game, for repopulating the in-memory room registry on server boot. */
export async function loadAllGames(pool: pg.Pool): Promise<StoredGame[]> {
  const games = await pool.query<{
    id: string;
    room_code: string;
    state: GameState;
    seats: Seat[];
    names: string[];
    schema_version: number;
  }>("SELECT id, room_code, state, seats, names, schema_version FROM games");
  const players = await pool.query<{
    game_id: string;
    player_index: number;
    display_name: string;
    seat_kind: Seat;
    reconnect_token: string;
  }>("SELECT game_id, player_index, display_name, seat_kind, reconnect_token FROM game_players");
  const byGame = new Map<string, StoredPlayer[]>();
  for (const p of players.rows) {
    const list = byGame.get(p.game_id) ?? [];
    list.push({
      playerIndex: p.player_index,
      displayName: p.display_name,
      seatKind: p.seat_kind,
      reconnectToken: p.reconnect_token,
    });
    byGame.set(p.game_id, list);
  }
  return games.rows.map((g) => ({
    id: g.id,
    roomCode: g.room_code,
    state: g.state,
    seats: g.seats,
    names: g.names,
    players: (byGame.get(g.id) ?? []).sort((a, b) => a.playerIndex - b.playerIndex),
    schemaVersion: g.schema_version,
  }));
}

export interface TokenLookup {
  gameId: string;
  roomCode: string;
  playerIndex: number;
}

export async function findByReconnectToken(pool: pg.Pool, token: string): Promise<TokenLookup | null> {
  const res = await pool.query<{ game_id: string; room_code: string; player_index: number }>(
    `SELECT gp.game_id, g.room_code, gp.player_index
       FROM game_players gp JOIN games g ON g.id = gp.game_id
      WHERE gp.reconnect_token = $1`,
    [token],
  );
  const row = res.rows[0];
  return row ? { gameId: row.game_id, roomCode: row.room_code, playerIndex: row.player_index } : null;
}
