/** A tiny in-memory stand-in for `pg.Pool`, understanding only the exact queries
   persistence.ts issues. Good enough to unit-test room/game-server logic without a real
   Postgres — real Postgres integration is exercised separately (see persistence.test.ts,
   skipped automatically when DATABASE_URL isn't reachable). */
import { randomUUID } from "node:crypto";
import type pg from "pg";

interface GameRow {
  id: string;
  room_code: string;
  state: unknown;
  seats: unknown;
  names: unknown;
}
interface PlayerRow {
  game_id: string;
  player_index: number;
  display_name: string;
  seat_kind: string;
  reconnect_token: string;
}

export class FakePool {
  games: GameRow[] = [];
  players: PlayerRow[] = [];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async query(sql: string, params: any[] = []): Promise<{ rows: any[] }> {
    if (sql.includes("INSERT INTO games")) {
      const id = randomUUID();
      this.games.push({
        id,
        room_code: params[0],
        state: params[1],
        seats: JSON.parse(params[2]),
        names: JSON.parse(params[3]),
      });
      return { rows: [{ id }] };
    }
    if (sql.includes("UPDATE games SET state")) {
      const row = this.games.find((g) => g.id === params[0]);
      if (row) row.state = params[1];
      return { rows: [] };
    }
    if (sql.includes("UPDATE games SET names")) {
      const row = this.games.find((g) => g.id === params[0]);
      if (row) row.names = JSON.parse(params[1]);
      return { rows: [] };
    }
    if (sql.includes("INSERT INTO game_players")) {
      this.players.push({
        game_id: params[0],
        player_index: params[1],
        display_name: params[2],
        seat_kind: params[3],
        reconnect_token: params[4],
      });
      return { rows: [] };
    }
    if (sql.includes("SELECT id, room_code, state, seats, names FROM games")) {
      return {
        rows: this.games.map((g) => ({ id: g.id, room_code: g.room_code, state: g.state, seats: g.seats, names: g.names })),
      };
    }
    if (sql.includes("SELECT game_id, player_index")) {
      return { rows: this.players.slice() };
    }
    if (sql.includes("reconnect_token = $1")) {
      const p = this.players.find((pl) => pl.reconnect_token === params[0]);
      if (!p) return { rows: [] };
      const g = this.games.find((gm) => gm.id === p.game_id);
      return { rows: g ? [{ game_id: p.game_id, room_code: g.room_code, player_index: p.player_index }] : [] };
    }
    throw new Error(`FakePool: unhandled query: ${sql}`);
  }
}

export function fakePool(): pg.Pool {
  return new FakePool() as unknown as pg.Pool;
}
