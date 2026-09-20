import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { WebSocket } from "ws";
import { legalActions } from "../engine/index.js";
import { fakePool, FakePool } from "./testFakePool.js";
import { getRoom, removeRoom } from "./rooms.js";
import { createRoom, joinRoom, handleAction, handleDisconnect, reconnect } from "./game-server.js";
import { findByReconnectToken } from "./persistence.js";

function fakeSocket(): WebSocket & { sent: unknown[] } {
  const sent: unknown[] = [];
  return {
    readyState: 1,
    OPEN: 1,
    send: (payload: string) => sent.push(JSON.parse(payload)),
    sent,
  } as unknown as WebSocket & { sent: unknown[] };
}

describe("game-server", () => {
  let pool: ReturnType<typeof fakePool>;

  beforeEach(() => {
    vi.useFakeTimers();
    pool = fakePool();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("createRoom assigns the host seat 0 and sends roomJoined + state", async () => {
    const ws = fakeSocket();
    const room = await createRoom(pool, ws, {
      type: "createRoom",
      displayName: "Alice",
      humans: 1,
      bots: 1,
      upgradeAtStart: "none",
      variant: "standard",
    });
    try {
      expect(room.seats).toEqual(["human", "bot"]);
      expect(ws.sent[0]).toMatchObject({ type: "roomJoined", playerIndex: 0, seats: ["human", "bot"] });
      expect(ws.sent[1]).toMatchObject({ type: "state" });
      expect(getRoom(room.roomCode)).toBe(room);
    } finally {
      removeRoom(room.roomCode);
    }
  });

  it("joinRoom fills the next open human seat, and rejects once full", async () => {
    const hostWs = fakeSocket();
    const room = await createRoom(pool, hostWs, {
      type: "createRoom",
      displayName: "Alice",
      humans: 2,
      bots: 0,
      upgradeAtStart: "none",
      variant: "standard",
    });
    try {
      const guestWs = fakeSocket();
      const joined = await joinRoom(pool, guestWs, { type: "joinRoom", roomCode: room.roomCode, displayName: "Bob" });
      expect(joined).toEqual({ roomCode: room.roomCode, playerIndex: 1 });
      expect(guestWs.sent[0]).toMatchObject({ type: "roomJoined", playerIndex: 1 });

      const thirdWs = fakeSocket();
      const rejected = await joinRoom(pool, thirdWs, {
        type: "joinRoom",
        roomCode: room.roomCode,
        displayName: "Carl",
      });
      expect(rejected).toBeNull();
      expect(thirdWs.sent[0]).toMatchObject({ type: "error" });
    } finally {
      removeRoom(room.roomCode);
    }
  });

  it("handleAction validates via applyAction, persists, and broadcasts to every socket", async () => {
    const hostWs = fakeSocket();
    const room = await createRoom(pool, hostWs, {
      type: "createRoom",
      displayName: "Alice",
      humans: 2,
      bots: 0,
      upgradeAtStart: "none",
      variant: "standard",
    });
    try {
      const guestWs = fakeSocket();
      await joinRoom(pool, guestWs, { type: "joinRoom", roomCode: room.roomCode, displayName: "Bob" });

      const legal = legalActions(room.state)[0]!;
      await handleAction(pool, room, 0, hostWs, legal);

      // both sockets in the room hear about the resulting state, not just the actor
      const hostStates = hostWs.sent.filter((m: any) => m.type === "state");
      const guestStates = guestWs.sent.filter((m: any) => m.type === "state");
      expect(hostStates.length).toBeGreaterThanOrEqual(1);
      expect(guestStates.length).toBeGreaterThanOrEqual(1);
      expect((pool as unknown as FakePool).games.find((g) => g.id === room.id)?.state).toEqual(room.state);

      // an illegal action is rejected and only reaches the sender as an error
      const before = room.state;
      await handleAction(pool, room, 0, hostWs, { type: "endTurn" });
      expect(room.state).toBe(before); // untouched
    } finally {
      removeRoom(room.roomCode);
    }
  });

  it("reconnect re-attaches a socket to its seat using its stored token", async () => {
    const hostWs = fakeSocket();
    const room = await createRoom(pool, hostWs, {
      type: "createRoom",
      displayName: "Alice",
      humans: 1,
      bots: 1,
      upgradeAtStart: "none",
      variant: "standard",
    });
    try {
      const token = (hostWs.sent[0] as any).reconnectToken as string;
      handleDisconnect(room, 0);
      expect(room.sockets.has(0)).toBe(false);

      const lookup = await findByReconnectToken(pool, token);
      expect(lookup).toMatchObject({ roomCode: room.roomCode, playerIndex: 0 });

      const newWs = fakeSocket();
      reconnect(newWs, room, lookup!.playerIndex);
      expect(room.sockets.get(0)).toBe(newWs);
      expect(newWs.sent[0]).toMatchObject({ type: "roomJoined", playerIndex: 0, reconnectToken: token });
    } finally {
      removeRoom(room.roomCode);
    }
  });

  it("drives a bot's turn on a timer once the game is waiting on one", async () => {
    const hostWs = fakeSocket();
    // 0 humans would leave nothing waiting on the host socket, so use 1 human + 1 bot and
    // fast-forward through the host's own turn to hand control to the bot
    const room = await createRoom(pool, hostWs, {
      type: "createRoom",
      displayName: "Alice",
      humans: 1,
      bots: 1,
      upgradeAtStart: "none",
      variant: "standard",
    });
    try {
      // drive the human seat's setup picks until it's the bot's turn (or the game leaves setup)
      let guard = 0;
      while (room.seats[room.state.activePlayerIndex] === "human" && room.state.setup && guard++ < 20) {
        const legal = legalActions(room.state)[0]!;
        await handleAction(pool, room, 0, hostWs, legal);
      }
      const stateBeforeBotTurn = room.state;
      await vi.advanceTimersByTimeAsync(2000);
      expect(room.state).not.toBe(stateBeforeBotTurn);
    } finally {
      removeRoom(room.roomCode);
    }
  });
});
