/** Load/save game records — the only place server/ talks SQL directly. Kept as plain
   data-in-data-out functions (no Room/WebSocket references) so they're easy to unit-test
   against a fake pool and easy to later swap for a different store without touching
   rooms.ts/game-server.ts. */
import type pg from "pg";
import type { GameState } from "../engine/index.js";
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
  players: StoredPlayer[];
}

export async function createGameRecord(pool: pg.Pool, roomCode: string, state: GameState, seats: Seat[]): Promise<string> {
  const res = await pool.query<{ id: string }>(
    "INSERT INTO games (room_code, state, seats) VALUES ($1, $2, $3) RETURNING id",
    [roomCode, state, JSON.stringify(seats)],
  );
  return res.rows[0]!.id;
}

export async function updateGameState(pool: pg.Pool, gameId: string, state: GameState): Promise<void> {
  await pool.query("UPDATE games SET state = $2, updated_at = now() WHERE id = $1", [gameId, state]);
}

export async function addPlayer(pool: pg.Pool, gameId: string, player: StoredPlayer): Promise<void> {
  await pool.query(
    "INSERT INTO game_players (game_id, player_index, display_name, seat_kind, reconnect_token) VALUES ($1, $2, $3, $4, $5)",
    [gameId, player.playerIndex, player.displayName, player.seatKind, player.reconnectToken],
  );
}

/** Every persisted game, for repopulating the in-memory room registry on server boot. */
export async function loadAllGames(pool: pg.Pool): Promise<StoredGame[]> {
  const games = await pool.query<{ id: string; room_code: string; state: GameState; seats: Seat[] }>(
    "SELECT id, room_code, state, seats FROM games",
  );
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
    players: (byGame.get(g.id) ?? []).sort((a, b) => a.playerIndex - b.playerIndex),
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
