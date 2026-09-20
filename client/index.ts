/**
 * client-core — GUI-agnostic presentation logic that sits between the pure rules engine
 * and any front-end (hot-seat, mobile, network). Contains no rendering and no framework.
 */
export * from "./seats.js";
export * from "./affordances.js";
export * from "./preview.js";
export * from "./bot.js";
export { formatLogEntry } from "./log-format.js";
export type { ClientMessage, ServerMessage } from "./protocol.js";
export { randomBotName } from "./nameGen.js";
