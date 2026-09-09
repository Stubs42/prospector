# Prospector

Reviving a 2006 print-only board game as a web application — and keeping it playable as a
physical game. A *movement-engine game system*: the flagship **Prospector** mode is
resource collection; other modes (race, rally, courier…) will reuse the same core.

## Layout

| Path | What |
|---|---|
| `rules.en.html` | English rulebook + design/architecture notes (open in a browser) |
| `docs/` | `STATUS.md` (progress), `decisions.md`, split `rules-core.md` / `rules-prospector.md` |
| `config/` | `config.schema.json` + `default.config.json` — every tunable quantity, defaults = the 2006 values |
| `board/` | `build_board.py` → `board.json` (hex model); `render_board.py` → SVG preview |
| `content/` | `build_content.py` → card/ship/tile data; `validate_content.py` |
| `engine/` | headless rules engine (TypeScript) — pure, deterministic, framework-agnostic |
| `web/` | hot-seat UI (Vite + React) over the engine |

## Develop

```bash
npm install
npm test            # engine test suite (vitest)
npm run check       # tsc --noEmit
npm run dev         # hot-seat UI at http://localhost:5180
npm run build:web   # production bundle -> dist-web/

python board/build_board.py       # regenerate board.json from config
python content/build_content.py   # regenerate content packs
python content/validate_content.py
```

## Status

Phases 0–4 complete: frozen ruleset, board & content as data, headless engine (61 tests),
first hot-seat UI. Next: movement-feel animation pass and the physical-component visual kit.
See `docs/STATUS.md`.
