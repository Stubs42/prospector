# Architecture — layers

Three layers, each depending only on the one below. A different GUI replaces only the top.

```
engine/      pure rules. state + applyAction() + legalActions(). No fs, no framework,
             deterministic (seeded RNG). Config-driven; a mode is data + hooks.

client/      GUI-agnostic presentation logic. No rendering, no framework.
               seats.ts        who plays each slot; whose input the game waits on
               affordances.ts  legalActions -> structured {burnTargets, loadCells,
                               attackTargets, plainActions, combat, ...}
               preview.ts      drift preview, burn fuel-cost
               bot.ts          stepBot(state, rng) -> next state
               log-format.ts   log entry -> sentence

web/         the physical-board GUI (Vite + React).
               useSession.ts   the only React-specific glue: owns game/seat/staging
                               state and the two timers (bot autoplay, auto-advance);
                               everything it decides comes from client/.
               App.tsx         rendering + input wiring on top of useSession()
               components/     Board (SVG), kit (Cone/Die/Card/FuelTrack/TileChip), Settings
               styles.css, prefs.ts
```

## What goes where

- A **rule** or a new **mode** → `engine/` (+ config).
- Logic **every GUI would need** (turning `legalActions` into clickable things, running
  bots, seat/turn management, previews, log text) → `client/`. If you'd reimplement it for
  a second GUI, it belongs here.
- **Visual style, layout, animation, input handling** → `web/`.

## Adding a second GUI later (e.g. a mobile layout)

- `engine/` and `client/` are untouched.
- If it's also React: reuse `useSession` directly; write new components / layout.
- If it's not React: reuse `client/`; write ~100 lines of your own state glue in place of
  `useSession`.

## Physical-parity

The **rules** must stay playable with cardboard — this is enforced at the `engine/` layer
(see `decisions.md` §F). The **GUI** is free to be whatever; the physical-board look is the
first treatment, not a constraint.
