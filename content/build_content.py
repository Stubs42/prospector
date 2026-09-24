"""Phase 2 — expand the composition parameters in config/default.config.json into concrete
content packs:

  content/components.json  — shared physical bits: dice, cones, resource tiles
  content/prospector.json  — the Prospector mode pack: booster deck, equipment deck, fuel
                             deck (physical), ship roster, per-player resource supply

Card ids are deterministic so a diff of the generated files is meaningful.

Run:  python content/build_content.py
"""

import json
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CONFIG = os.path.join(ROOT, "config", "default.config.json")
OUT_COMPONENTS = os.path.join(ROOT, "content", "components.json")
OUT_PROSPECTOR = os.path.join(ROOT, "content", "prospector.json")

BOOSTER_EFFECT = {
    "shield": "in combat, defence +{v} (one-shot)",
    "laser": "in combat, attack +{v} (one-shot)",
    "reserveFuel": "fuel = min(fuel + {v}, fuelMax)",
    "engine": "burn cap +{v} this turn",
}

# title/effect text for event cards — kept in sync by hand with the EventDefinition entries in
# engine/events.ts (title/text there); this is the card-face copy, not the resolution logic.
EVENT_META = {
    "pirate-ambush": {
        "title": "Pirate Ambush",
        "effect": "roll shields vs. a raider; lose your most valuable ore on a loss",
    },
    "hyperspace-quake": {
        "title": "Hyperspace Quake",
        "effect": "every ship near a random epicentre is hyperspace-jumped",
    },
    "salvage-cache": {
        "title": "Salvage Cache",
        "effect": "pick a nearby cell to seed and load a resource, or let it drift",
    },
    "asteroid-field-1": {"title": "Asteroid Field", "effect": "lose 1 fuel"},
    "asteroid-field-2": {"title": "Asteroid Field", "effect": "lose 2 fuel"},
    "asteroid-field-3": {"title": "Asteroid Field", "effect": "lose 3 fuel"},
    "helium-cloud-1": {"title": "Helium Cloud", "effect": "gain 1 fuel"},
    "helium-cloud-2": {"title": "Helium Cloud", "effect": "gain 2 fuel"},
    "helium-cloud-3": {"title": "Helium Cloud", "effect": "gain 3 fuel"},
    "engine-failure": {
        "title": "Engine Failure",
        "effect": "no burn this turn — only the free drift target is available",
    },
    "ship-wreck": {
        "title": "Ship Wreck",
        "effect": "collect a random upgrade, if not already at its cap",
    },
    "hidden-ore": {
        "title": "Hidden Ore",
        "effect": "pick up the lowest-value ore on the board, if you have cargo room",
    },
}


def _ids(prefix, n):
    return [f"{prefix}-{i:02d}" for i in range(1, n + 1)]


def build_booster_deck(cfg):
    b = cfg["modes"]["prospector"]["decks"]["booster"]
    cards = []
    for group in ("shield", "laser", "reserveFuel", "engine"):
        for value_str, count in b[group].items():
            v = int(value_str)
            for cid in _ids(f"booster-{group}-{v}", count):
                cards.append({
                    "id": cid,
                    "deck": "booster",
                    "type": group,
                    "value": v,
                    "effect": BOOSTER_EFFECT[group].format(v=v),
                })
    for cid in _ids("booster-hyperspace", b["hyperspace"]):
        cards.append({
            "id": cid,
            "deck": "booster",
            "type": "hyperspace",
            "value": None,
            "effect": "jump: reroll position via coordinate dice; also playable as combat defence",
        })
    return cards


def build_event_deck(cfg):
    """The event deck is entirely separate from the booster deck — see engine/game.ts's
    drawBooster, which rolls an independent per-draw probability (decks.event.drawChance)
    to pick this deck instead of the booster one, rather than mixing events into one pile."""
    e = cfg["modes"]["prospector"]["decks"]["event"]
    cards = []
    for event_id, count in e.get("counts", {}).items():
        meta = EVENT_META[event_id]
        for cid in _ids(f"event-{event_id}", count):
            cards.append({
                "id": cid,
                "deck": "booster",  # matches engine BoosterCard's literal "deck" tag — this
                                     # field isn't branched on anywhere, only `type`/`eventId`
                                     # are; the event DECK itself is a separate pool
                "type": "event",
                "value": None,
                "effect": meta["effect"],
                "eventId": event_id,
                "title": meta["title"],
            })
    return cards


def build_equipment_deck(cfg):
    e = cfg["modes"]["prospector"]["decks"]["equipment"]
    per = e["perType"]
    fuel_equip = e.get("fuelEquip", {})
    cards = []
    for stat, amount in e["types"].items():
        for cid in _ids(f"equip-{stat}", per):
            card = {
                "id": cid,
                "deck": "equipment",
                "stat": stat,
                "amount": amount,
                "effect": f"permanent {stat} +{amount}",
            }
            if stat == "fuelTanks":
                card["grantFuel"] = fuel_equip.get("grantFuel", amount)
                card["effect"] += f", and fuel += {card['grantFuel']}"
            cards.append(card)
    return cards


def build_fuel_deck(cfg):
    """Physical only — the engine uses an integer fuel pool (core.fuel.model = 'pool')."""
    f = cfg["modes"]["prospector"]["decks"]["fuel"]
    cards = []
    for value_str, count in f["denominations"].items():
        v = int(value_str)
        for cid in _ids(f"fuel-{v}", count):
            cards.append({"id": cid, "deck": "fuel", "value": v})
    return {
        "note": "Physical representation only; engine tracks an integer pool.",
        "cards": cards,
        "sharedField": {"count": f["sharedFieldCards"], "value": f["sharedFieldValue"]},
    }


def build_ship_roster(cfg):
    m = cfg["modes"]["prospector"]
    schema = m["statSchema"]
    roster = []
    for colour, ship in m["ships"].items():
        stats = {k: ship[k] for k in schema}
        roster.append({
            "id": f"ship-{colour}",
            "colour": colour,
            "name": ship["name"],
            "stats": stats,
        })
    return roster


def build_supply_table(cfg):
    r = cfg["modes"]["prospector"]["resources"]
    pl = cfg["modes"]["prospector"]["players"]
    base, per = r["perColour"]["base"], r["perColour"]["perPlayer"]
    table = {}
    for n in range(pl["min"], pl["max"] + 1):
        std = base + per * n
        table[str(n)] = {
            "perColour": std,
            "short": std + r["gameLengthAdjust"]["short"],
            "long": std + r["gameLengthAdjust"]["long"],
            "totalStandard": std * len(r["colours"]),
        }
    return table


def build_components(cfg):
    board = cfg["core"]["board"]
    dice = cfg["core"]["dice"]
    r = cfg["modes"]["prospector"]["resources"]
    box_per_colour = r["boxTilesPerColour"]

    cones = []
    for colour in board["colourOrder"]:
        cones += [{"id": f"cone-{colour}-{i}", "colour": colour} for i in (1, 2, 3)]

    tiles = []
    for colour in r["colours"]:
        for cid in _ids(f"tile-{colour}", box_per_colour):
            tiles.append({"id": cid, "colour": colour, "value": r["values"][colour]})

    return {
        "meta": {"generatedFrom": "config/default.config.json",
                 "note": "Do not hand-edit; re-run content/build_content.py."},
        "coordinateDice": {
            "count": dice["coordinate"]["count"],
            "steps": dice["coordinate"]["steps"],
            "faceColours": board["colourOrder"],
            "note": "one die per step value; every face is one board colour = its base direction",
        },
        "combatDice": {
            "attack": {"colour": dice["combat"]["attack"]["colour"],
                       "faces": dice["combat"]["attack"]["faces"], "rolledBy": "attacker"},
            "defence": {"colour": dice["combat"]["defence"]["colour"],
                        "faces": dice["combat"]["defence"]["faces"], "rolledBy": "defender"},
        },
        "cones": cones,
        "resourceTiles": {"perColour": box_per_colour, "total": box_per_colour * len(r["colours"]),
                          "tiles": tiles},
    }


def main():
    cfg = json.load(open(CONFIG, encoding="utf-8"))

    components = build_components(cfg)
    json.dump(components, open(OUT_COMPONENTS, "w", encoding="utf-8"), indent=1)

    booster = build_booster_deck(cfg)
    event = build_event_deck(cfg)
    equipment = build_equipment_deck(cfg)
    fuel = build_fuel_deck(cfg)
    prospector = {
        "meta": {"generatedFrom": "config/default.config.json",
                 "note": "Do not hand-edit; re-run content/build_content.py."},
        "mode": "prospector",
        "ships": build_ship_roster(cfg),
        "upgradeCaps": cfg["modes"]["prospector"]["upgradeCaps"],
        "decks": {
            "booster": {"count": len(booster), "cards": booster},
            "event": {"count": len(event), "cards": event},
            "equipment": {"count": len(equipment), "cards": equipment},
            "fuel": fuel,
        },
        "resourceSupplyByPlayers": build_supply_table(cfg),
    }
    json.dump(prospector, open(OUT_PROSPECTOR, "w", encoding="utf-8"), indent=1)

    print(f"wrote {OUT_COMPONENTS}")
    print(f"  coordinate dice: {components['coordinateDice']['count']}  "
          f"cones: {len(components['cones'])}  resource tiles: {components['resourceTiles']['total']}")
    print(f"wrote {OUT_PROSPECTOR}")
    print(f"  booster deck: {len(booster)}   event deck: {len(event)}   "
          f"equipment deck: {len(equipment)}   fuel cards: {len(fuel['cards'])}")
    print(f"  ships: {len(prospector['ships'])}")


if __name__ == "__main__":
    main()
