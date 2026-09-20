/** Postgres pool + schema bootstrap. A real migration tool is a later upgrade — for v1 this
   file's `CREATE TABLE IF NOT EXISTS` set is the entire schema story. */
import pg from "pg";

const { Pool } = pg;

export function makePool(connectionString: string): pg.Pool {
  return new Pool({ connectionString });
}

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS games (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_code text UNIQUE NOT NULL,
  state jsonb NOT NULL,
  -- seat kinds ("human"/"bot" per index) can't always be derived from state alone — during
  -- interactive setup, GameState.players is still empty, so this is stored independently
  seats jsonb NOT NULL DEFAULT '[]',
  -- display name per seat — GameState has no concept of a player's display name at all, so
  -- this (like seats) is plain server-owned metadata, never derived from engine state
  names jsonb NOT NULL DEFAULT '[]',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS game_players (
  game_id uuid NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  player_index int NOT NULL,
  display_name text NOT NULL,
  seat_kind text NOT NULL,
  reconnect_token text UNIQUE NOT NULL,
  PRIMARY KEY (game_id, player_index)
);
`;

export async function ensureSchema(pool: pg.Pool): Promise<void> {
  // gen_random_uuid() lives in pgcrypto on older Postgres; 13+ ships it in core as
  // pg_catalog, but CREATE EXTENSION IF NOT EXISTS is a harmless no-op either way
  await pool.query("CREATE EXTENSION IF NOT EXISTS pgcrypto");
  await pool.query(SCHEMA_SQL);
}
