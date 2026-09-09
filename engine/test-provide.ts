// Vitest setup: feed the engine its data from disk (node-only) before any test runs.
import { provideGameData } from "./game.js";
import { loadConfig, loadBoardJson, loadContent } from "./data.js";

provideGameData({
  config: loadConfig(),
  boardJson: loadBoardJson(),
  content: loadContent(),
});
