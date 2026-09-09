/**
 * Node-only loaders for the generated data files. Used by tests and CLI tooling.
 * The browser build never imports this — it calls `provideGameData()` with JSON it
 * bundles directly. See engine/data-types.ts for the shapes.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { Config } from "./types.js";
import type { BoardJson, ContentJson } from "./data-types.js";

export type { BoardJson, ContentJson } from "./data-types.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function readJson<T>(rel: string): T {
  return JSON.parse(readFileSync(join(ROOT, rel), "utf8")) as T;
}

export const loadConfig = (): Config => readJson<Config>("config/default.config.json");
export const loadBoardJson = (): BoardJson => readJson<BoardJson>("board/board.json");
export const loadContent = (): ContentJson => readJson<ContentJson>("content/prospector.json");
