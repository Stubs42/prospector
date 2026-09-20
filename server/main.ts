/** Entry point: loads env, wires the engine's data, opens Postgres, serves the built web
   client + the /ws WebSocket endpoint on one port (see docs/decisions.md-style rationale in
   the multiplayer plan: same-origin, no CORS, and it maps onto "one internal port behind
   nginx" for a later reverse-proxied deployment without any code changes). */
import "dotenv/config";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer, type WebSocket } from "ws";
import { provideGameData } from "../engine/index.js";
import { loadConfig, loadBoardJson, loadContent } from "../engine/data.js";
import type { ClientMessage } from "../client/index.js";
import { makePool, ensureSchema } from "./db.js";
import { loadAllGames, findByReconnectToken } from "./persistence.js";
import { addRoom, getRoom } from "./rooms.js";
import { createRoom, joinRoom, reconnect, handleAction, handleDisconnect, restoreRoom } from "./game-server.js";

provideGameData({ config: loadConfig(), boardJson: loadBoardJson(), content: loadContent() });

const HERE = fileURLToPath(new URL(".", import.meta.url));
const PORT = Number(process.env.PORT ?? 8787);
const DATABASE_URL = process.env.DATABASE_URL ?? "postgres://prospector:prospector@localhost:5432/prospector";
const STATIC_ROOT = process.env.STATIC_ROOT ?? join(HERE, "..", "dist-web");

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
};

async function serveStatic(urlPath: string): Promise<{ body: Buffer; type: string } | null> {
  const rel = urlPath === "/" ? "/index.html" : urlPath;
  const safe = normalize(rel).replace(/^(\.\.[/\\])+/, "");
  const full = join(STATIC_ROOT, safe);
  if (!existsSync(full)) return null;
  const body = await readFile(full);
  return { body, type: MIME[extname(full)] ?? "application/octet-stream" };
}

async function main(): Promise<void> {
  const pool = makePool(DATABASE_URL);
  await ensureSchema(pool);

  // repopulate the in-memory room registry from Postgres so a restart doesn't lose games in
  // progress — sockets reattach as clients reconnect with their stored token
  for (const stored of await loadAllGames(pool)) addRoom(restoreRoom(stored));

  const server = createServer((req, res) => {
    const url = req.url ?? "/";
    serveStatic(url).then((file) => {
      if (!file) {
        // SPA fallback: unknown paths (client-side routes, if any are added later) get
        // index.html instead of a 404
        serveStatic("/index.html").then((index) => {
          if (!index) {
            res.writeHead(404).end("not found");
            return;
          }
          res.writeHead(200, { "Content-Type": index.type }).end(index.body);
        });
        return;
      }
      res.writeHead(200, { "Content-Type": file.type }).end(file.body);
    });
  });

  const wss = new WebSocketServer({ server, path: "/ws" });

  wss.on("connection", (ws: WebSocket) => {
    let attachedRoomCode: string | null = null;
    let attachedPlayerIndex: number | null = null;

    ws.on("message", (raw) => {
      void (async () => {
        let msg: ClientMessage;
        try {
          msg = JSON.parse(String(raw));
        } catch {
          return;
        }
        try {
          switch (msg.type) {
            case "createRoom": {
              const room = await createRoom(pool, ws, msg);
              attachedRoomCode = room.roomCode;
              attachedPlayerIndex = 0;
              break;
            }
            case "joinRoom": {
              if (msg.reconnectToken) {
                const lookup = await findByReconnectToken(pool, msg.reconnectToken);
                const room = lookup && getRoom(lookup.roomCode);
                if (lookup && room) {
                  reconnect(ws, room, lookup.playerIndex);
                  attachedRoomCode = room.roomCode;
                  attachedPlayerIndex = lookup.playerIndex;
                  break;
                }
                // fall through to a fresh join if the token didn't resolve to a live room
              }
              const joined = await joinRoom(pool, ws, msg);
              if (joined) {
                attachedRoomCode = joined.roomCode;
                attachedPlayerIndex = joined.playerIndex;
              }
              break;
            }
            case "action": {
              const room = attachedRoomCode ? getRoom(attachedRoomCode) : undefined;
              if (!room || attachedPlayerIndex === null) {
                ws.send(JSON.stringify({ type: "error", message: "not in a room" }));
                break;
              }
              await handleAction(pool, room, attachedPlayerIndex, ws, msg.action);
              break;
            }
            case "leaveRoom": {
              const room = attachedRoomCode ? getRoom(attachedRoomCode) : undefined;
              if (room && attachedPlayerIndex !== null) handleDisconnect(room, attachedPlayerIndex);
              attachedRoomCode = null;
              attachedPlayerIndex = null;
              break;
            }
          }
        } catch (err) {
          // never let a bad/malicious message (e.g. createGame's own range checks throwing on
          // an out-of-bounds player count) crash the whole process for every other room —
          // this socket just gets told, everyone else keeps playing
          console.error("message handler error:", err);
          ws.send(JSON.stringify({ type: "error", message: err instanceof Error ? err.message : "internal error" }));
        }
      })();
    });

    ws.on("close", () => {
      const room = attachedRoomCode ? getRoom(attachedRoomCode) : undefined;
      if (room && attachedPlayerIndex !== null) handleDisconnect(room, attachedPlayerIndex);
    });
  });

  server.listen(PORT, () => {
    console.log(`prospector server listening on :${PORT} (static: ${STATIC_ROOT})`);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
