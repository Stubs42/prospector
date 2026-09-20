/** Server-side orchestration: create/join a room, validate + apply actions, persist, broadcast,
   and drive bot turns — the networked equivalent of web/useSession.ts's dispatch + bot timer,
   just centralized here instead of running once per browser tab. */
import { randomUUID } from "node:crypto";
import type { WebSocket } from "ws";
import type pg from "pg";
import { applyAction, createGame } from "../engine/index.js";
import { makeRng } from "../engine/rng.js";
import { mkSeats, randomBotName, stepBot, waitingOn, waitingOnBot } from "../client/index.js";
import type { ClientMessage, ServerMessage } from "../client/index.js";
import { addRoom, generateRoomCode, getRoom, type Room, type RoomPlayer } from "./rooms.js";
import { addPlayer, createGameRecord, updateGameState, updateRoomNames, type StoredGame } from "./persistence.js";

const BOT_TURN_MS = 400;

function send(ws: WebSocket, msg: ServerMessage): void {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}

function broadcastState(room: Room): void {
  const msg: ServerMessage = { type: "state", state: room.state, names: room.names };
  const payload = JSON.stringify(msg);
  for (const ws of room.sockets.values()) if (ws.readyState === ws.OPEN) ws.send(payload);
}

/** Restore a room (state + seats + player metadata) from a persisted record, e.g. on boot —
   no sockets are attached yet; those arrive as clients reconnect via their token. `seats` is
   read back verbatim from its own persisted column rather than re-derived from `state.players`
   — during interactive setup that array is still empty, so deriving seat kinds from its length
   silently dropped bot seats (only ever caught by testing against a real, restarted server). */
export function restoreRoom(stored: StoredGame): Room {
  return {
    id: stored.id,
    roomCode: stored.roomCode,
    state: stored.state,
    seats: stored.seats,
    names: stored.names,
    players: stored.players.map((p) => ({ playerIndex: p.playerIndex, displayName: p.displayName, seatKind: p.seatKind, reconnectToken: p.reconnectToken })),
    sockets: new Map(),
    rng: makeRng(stored.state.rngState),
    botTimer: null,
  };
}

export async function createRoom(
  pool: pg.Pool,
  ws: WebSocket,
  msg: Extract<ClientMessage, { type: "createRoom" }>,
): Promise<Room> {
  const seats = mkSeats(msg.humans, msg.bots);
  const seed = (Math.random() * 1e9) | 0;
  const state = createGame({ seats, seed, upgradeAtStart: msg.upgradeAtStart, variant: msg.variant });
  const roomCode = generateRoomCode();
  // a bot's name is picked once, here, so every viewer sees the same one — never invented
  // locally per-browser (that was the whole bug this exists to fix); an as-yet-unfilled human
  // seat gets a plain placeholder until someone actually joins it
  const names = seats.map((kind, i) => (i === 0 ? msg.displayName : kind === "bot" ? randomBotName() : `Player ${i + 1}`));
  const gameId = await createGameRecord(pool, roomCode, state, seats, names);
  const reconnectToken = randomUUID();
  const hostPlayer: RoomPlayer = { playerIndex: 0, displayName: msg.displayName, seatKind: "human", reconnectToken };
  await addPlayer(pool, gameId, hostPlayer);
  const room: Room = {
    id: gameId,
    roomCode,
    state,
    seats,
    names,
    players: [hostPlayer],
    sockets: new Map([[0, ws]]),
    rng: makeRng((Math.random() * 1e9) | 0),
    botTimer: null,
  };
  addRoom(room);
  send(ws, { type: "roomJoined", roomCode, playerIndex: 0, reconnectToken, seats: room.seats, names: room.names });
  send(ws, { type: "state", state: room.state, names: room.names });
  scheduleBotCheck(pool, room);
  return room;
}

/** The next human seat index nobody has claimed yet, or null if the room is full. */
function nextOpenHumanSeat(room: Room): number | null {
  const claimed = new Set(room.players.map((p) => p.playerIndex));
  for (let i = 0; i < room.seats.length; i++) {
    if (room.seats[i] === "human" && !claimed.has(i)) return i;
  }
  return null;
}

/** Returns the seat index this socket was assigned, or null if the join was rejected
   (room missing/full) — the caller uses this to remember which player future "action"
   messages on this socket come from. */
export async function joinRoom(
  pool: pg.Pool,
  ws: WebSocket,
  msg: Extract<ClientMessage, { type: "joinRoom" }>,
): Promise<{ roomCode: string; playerIndex: number } | null> {
  const room = getRoom(msg.roomCode);
  if (!room) {
    send(ws, { type: "error", message: `No room "${msg.roomCode}"` });
    return null;
  }

  const seatIndex = nextOpenHumanSeat(room);
  if (seatIndex === null) {
    send(ws, { type: "error", message: "Room is full" });
    return null;
  }

  const reconnectToken = randomUUID();
  const player: RoomPlayer = { playerIndex: seatIndex, displayName: msg.displayName, seatKind: "human", reconnectToken };
  await addPlayer(pool, room.id, player);
  room.players.push(player);
  room.names[seatIndex] = msg.displayName;
  await updateRoomNames(pool, room.id, room.names);
  room.sockets.set(seatIndex, ws);
  send(ws, { type: "roomJoined", roomCode: room.roomCode, playerIndex: seatIndex, reconnectToken, seats: room.seats, names: room.names });
  // the joiner already has the fresh names in that roomJoined message above — broadcast to
  // everyone ELSE already in the room too, so an already-connected player learns the new
  // real name immediately instead of waiting for the next unrelated action's own broadcast
  broadcastState(room);
  return { roomCode: room.roomCode, playerIndex: seatIndex };
}

/** Reattach a returning browser to its seat using the token it stored on first join. */
export function reconnect(ws: WebSocket, room: Room, playerIndex: number): void {
  room.sockets.set(playerIndex, ws);
  const player = room.players.find((p) => p.playerIndex === playerIndex);
  send(ws, {
    type: "roomJoined",
    roomCode: room.roomCode,
    playerIndex,
    reconnectToken: player?.reconnectToken ?? "",
    seats: room.seats,
    names: room.names,
  });
  send(ws, { type: "state", state: room.state, names: room.names });
}

export function handleDisconnect(room: Room, playerIndex: number): void {
  // v1 policy: a disconnected human seat just waits — no timeout, no bot takeover. The room
  // (and its persisted state) is untouched; only the live socket mapping is cleared.
  room.sockets.delete(playerIndex);
}

/** Validate and apply one action from `playerIndex`, persist on success, broadcast to the
   room, and re-check whether a bot should move next. */
export async function handleAction(
  pool: pg.Pool,
  room: Room,
  playerIndex: number,
  ws: WebSocket,
  action: Extract<ClientMessage, { type: "action" }>["action"],
): Promise<void> {
  // the engine itself has no notion of "who is submitting this" — applyAction just checks
  // whether the action is legal for whoever it internally considers active right now, which
  // is exactly right for a single trusted local caller (hot-seat) but means nothing stops one
  // networked player's socket from acting for another seat entirely unless this is checked
  // here. waitingOn covers setup (pickBase/pickShip), plain turns, AND mid-combat (whichever
  // side — attacker or defender — the pendingCombat.awaiting step is actually asking).
  //
  // finishSetup is the one deliberate exception: it fires once, after every seat has already
  // picked base+ship, to reveal an already-decided roll-off winner — state.activePlayerIndex
  // at that point is still whichever seat picked LAST (finishSetup itself is what finally sets
  // it to the real winner), not a seat with any decision left to make. Gating it the same way
  // as everything else meant only that exact last-picker's own browser could ever complete
  // setup — a permanent stall whenever that seat happened to be a bot (no browser to submit
  // it at all). See engine/game.ts's stepSetup: any seat submitting finishSetup during
  // "rollOff" produces the identical, already-determined result — never a partisan decision.
  if (action.type !== "finishSetup" && playerIndex !== waitingOn(room.state)) {
    return send(ws, { type: "error", message: "not your turn" });
  }
  const result = applyAction(room.state, action);
  if (!result.ok) return send(ws, { type: "error", message: result.error ?? "illegal action" });
  room.state = result.state;
  await updateGameState(pool, room.id, room.state);
  broadcastState(room);
  scheduleBotCheck(pool, room);
}

/** Recursively drive bot turns, exactly mirroring web/useSession.ts's isWaitingOnBot timer,
   just centralized here instead of once per browser tab. */
function scheduleBotCheck(pool: pg.Pool, room: Room): void {
  if (room.botTimer) clearTimeout(room.botTimer);
  room.botTimer = null;
  if (room.state.gameOver) return;
  // bots resolve their own setup picks too (stepBot already special-cases state.setup via
  // randomBot — see client/bot.ts), so no separate "still in setup" bail-out is needed here
  if (!waitingOnBot(room.state, room.seats)) return;
  room.botTimer = setTimeout(() => {
    room.state = stepBot(room.state, room.rng);
    void updateGameState(pool, room.id, room.state).then(() => {
      broadcastState(room);
      scheduleBotCheck(pool, room);
    });
  }, BOT_TURN_MS);
}
