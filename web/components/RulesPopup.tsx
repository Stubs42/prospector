/**
 * The in-game rulebook — adapted from the original physical-game rules (rules.en.html,
 * docs/rules-core.md, docs/rules-prospector.md) to how this implementation actually plays:
 * the real numbers from config/default.config.json, and the real on-screen interactions
 * (burn-target rings, the coast ring, the combat dialog's actual button names, ...) rather
 * than the physical game's cone-moving/dice-rolling procedure. Same overlay shell as
 * LogOverlay.tsx (.overlay-scrim + a centred panel), just wider and organized as sections of
 * prose instead of a log.
 */
export function RulesPopup({ onClose }: { onClose: () => void }) {
  return (
    <div className="overlay-scrim" onClick={onClose}>
      <div className="rules-overlay" onClick={(e) => e.stopPropagation()}>
        <div className="rules-overlay-head">
          <span>Rules</span>
          <button onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div className="rules-overlay-body">
          <h3>Objective</h3>
          <p>
            Mine ore from deep space and haul it home. Whoever has delivered the most total
            value once every tile in the supply has been mined and delivered wins.
          </p>

          <h3>Setup</h3>
          <p>
            Each player picks a home base (four equivalent cells per base region — pure
            preference) and a ship, either by browsing with the arrows or spinning
            <b> 🎲 Random</b>. Every ship trades off the same six stats differently: shields
            (defence), lasers (attack), fuel tanks, cargo, engines (burn range), and hand size.
            Depending on the table's "upgrade at start" setting you may also draw 3 equipment
            cards and keep 1 before the game begins.
          </p>
          <table className="rules-table">
            <thead>
              <tr>
                <th>Ship</th>
                <th>Shields</th>
                <th>Lasers</th>
                <th>Fuel</th>
                <th>Cargo</th>
                <th>Engines</th>
                <th>Hand</th>
              </tr>
            </thead>
            <tbody>
              <tr><td>Pirate</td><td>0</td><td>2</td><td>10</td><td>2</td><td>1</td><td>3</td></tr>
              <tr><td>Dove</td><td>2</td><td>0</td><td>10</td><td>2</td><td>1</td><td>3</td></tr>
              <tr><td>Polo</td><td>1</td><td>0</td><td>13</td><td>2</td><td>1</td><td>3</td></tr>
              <tr><td>Hermes</td><td>0</td><td>1</td><td>10</td><td>2</td><td>2</td><td>3</td></tr>
              <tr><td>Atlas</td><td>1</td><td>0</td><td>10</td><td>3</td><td>1</td><td>3</td></tr>
              <tr><td>Joe</td><td>1</td><td>1</td><td>10</td><td>2</td><td>1</td><td>3</td></tr>
            </tbody>
          </table>
          <p>
            Once every seat has a base and ship, the board seeds resources near the middle and
            the start player is rolled off — all shown as a short animation before turn 1
            begins.
          </p>

          <h3>Your turn</h3>
          <p>Each turn runs through the same steps, most of them automatic when there's nothing to decide:</p>
          <ol>
            <li>
              <b>Scrap</b> (optional) — click your own base cell any time before drawing to
              retire the ship back to base instead of playing this turn.
            </li>
            <li><b>Draw</b> a booster card. Over your hand limit? Discard down to it first.</li>
            <li>
              <b>Drift</b> — your ship carries last turn's velocity forward automatically (a
              stationary ship just holds still). The board shows this as a held ring/dot pair
              connected by a line; a green "0" ring on your own cell means you can also just
              stay there instead of burning at all.
            </li>
            <li>
              <b>Burn</b> (optional, unless the drift lands somewhere illegal) — every cell
              you could reach is highlighted with a coloured ring showing its fuel cost: green
              is free, yellow/orange/red cost more. Click one to fly there. Your engine rating
              caps how far you can burn in one turn; an armed engine booster card extends it.
            </li>
            <li>
              <b>One post-move action</b> (optional) — load a resource <i>or</i> attack, never
              both.
            </li>
          </ol>
          <p>
            Steps with only one possible outcome (a forced draw, a drift with no real choice,
            an unavoidable end-of-move) resolve themselves after a short pause — you're only
            ever asked to click when there's an actual decision.
          </p>

          <h3>Fuel &amp; hyperspace</h3>
          <p>
            Fuel is a simple pool, capped at your ship's tank rating — burning costs 1 fuel per
            cell, and arriving home always refills to full. The first cell of a burn leaving
            your own base is free (no fuel, no engine capacity spent).
          </p>
          <p>
            With 4+ engines and 4 fuel to spend, you can jump to <b>hyperspace</b> instead of a
            normal burn: your ship vanishes and reappears at a random spot on the board,
            immediately ending your turn (no post-move action afterward). A hyperspace booster
            card grants the same jump without needing the engine/fuel threshold, and can also
            be played as a surprise escape while defending in combat.
          </p>

          <h3>Loading resources</h3>
          <p>
            End your move next to a resource tile and you may load it (one per turn). A full
            cargo hold can still swap in a more valuable tile, dropping the old one on your
            cell. Loading counts as your post-move action, so you can't also attack that turn.
          </p>

          <h3>Combat</h3>
          <p>
            End your move next to another player's ship and you may attack instead of loading —
            they need to be carrying at least one resource, and you need a free cargo slot.
            Clicking their ship opens the fight:
          </p>
          <ol>
            <li>You arm any laser booster cards you want to add, then <b>Declare attack</b>.</li>
            <li>
              The defender arms shield boosters and clicks <b>Stand</b> — or plays a
              hyperspace card to <b>Flee</b>, or a shield +99 card, either of which auto-wins
              the defence with no roll at all.
            </li>
            <li>
              Both dice roll: attacker's lasers + boosters + roll vs. defender's shields +
              boosters + roll. Strictly higher wins. A win takes the loser's single most
              valuable carried resource.
            </li>
          </ol>
          <p>
            Win and you'll see <b>Attack Succeeded</b> plus what you looted (or "nothing to
            loot" if your hold was already full). Lose, and the defender gets{" "}
            <b>Defence Successful</b> with a real choice: <b>Counter-attack</b> (the fight
            continues with roles swapped) or <b>End Fight</b>/<b>End Turn</b> to stop there —
            if they stop, the original attacker sees an explicit <b>Attack Failed</b> screen
            before ending their own turn. Only one fight per turn, and fighting rules out
            loading this same turn (and vice versa).
          </p>

          <h3>Booster cards</h3>
          <p>Drawn one per turn, played for a one-time effect, hand limit set by your ship's rating:</p>
          <table className="rules-table">
            <thead>
              <tr><th>Type</th><th>Effect</th><th>Values in the deck</th></tr>
            </thead>
            <tbody>
              <tr><td>Shield</td><td>+ combat defence (99 auto-wins defence)</td><td>1×4, 2×3, 3×2, 99×3</td></tr>
              <tr><td>Laser</td><td>+ combat attack (50 must be played alone)</td><td>1×4, 2×3, 3×2, 50×3</td></tr>
              <tr><td>Reserve fuel</td><td>refuels immediately, capped at your tank</td><td>1×4, 2×3, 3×2</td></tr>
              <tr><td>Engine</td><td>+ burn range, this turn only</td><td>1×4, 2×3, 3×2</td></tr>
              <tr><td>Hyperspace</td><td>a jump — on your burn, or as a surprise defence</td><td>×3</td></tr>
            </tbody>
          </table>
          <p>
            Reserve-fuel cards play the instant you tap them; engine and laser/shield cards
            arm when tapped and apply the moment you actually burn or declare/defend.
          </p>

          <h3>Equipment</h3>
          <p>
            Permanent upgrades, capped per stat (lasers/shields 4, engines 3, cargo 4, hand 7,
            fuel tanks 19). Deliver at least one resource home and you'll draw 3, keep 1 — if
            all three are identical and unusable you get one free reroll. A fuel-tank upgrade
            also tops up your current fuel to match.
          </p>

          <h3>Home base</h3>
          <p>
            Arriving at any cell of your own base (on a move that didn't start there) stops
            you instantly — no fuel spent shedding speed — and refuels you to full. A move that
            starts on your base doesn't brake just because it's still touching the base
            cluster. Once there, deliver any carried resources (permanently scored, safe from
            raiding), draw an equipment card, and the supply reseeds to keep the board active.
          </p>

          <h3>Losing your ship</h3>
          <p>
            Drift off the edge of the board, fail a hyperspace jump onto an occupied cell, or
            run out of burn range before reaching anywhere legal, and the ship is lost: it
            returns to base at rest, empty-handed (anything it carried is reseeded back into
            the supply). If the supply is already empty when this happens, that player is out
            for good — but keeps whatever they'd already delivered.
          </p>

          <h3>Winning</h3>
          <p>
            The game ends once every tile in the supply has been delivered to some base.
            Highest total delivered value (green 1 · yellow 2 · red 3) wins.
          </p>

          <h3>Playing online</h3>
          <p>
            Only the player whose decision it currently is sees clickable prompts — everyone
            else just watches the board update and the animations play out live, the same way
            they would leaning over someone's shoulder at a physical table.
          </p>
        </div>
      </div>
    </div>
  );
}
