// Browser side of engine data injection: bundle the generated JSON and hand it to the engine.
import config from "../config/default.config.json";
import boardJson from "../board/board.json";
import content from "../content/prospector.json";
import { provideGameData } from "../engine/game.js";
import type { Config } from "../engine/types.js";
import type { BoardJson, ContentJson } from "../engine/data-types.js";

provideGameData({
  config: config as unknown as Config,
  boardJson: boardJson as unknown as BoardJson,
  content: content as unknown as ContentJson,
});
