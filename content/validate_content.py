"""Phase 2 — validate the generated content packs against the rulebook's stated totals and
the config's own constraints. Exit code 1 on any failure.

Run:  python content/validate_content.py
"""

import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CONFIG = os.path.join(ROOT, "config", "default.config.json")
COMPONENTS = os.path.join(ROOT, "content", "components.json")
PROSPECTOR = os.path.join(ROOT, "content", "prospector.json")

# Rulebook (Part I, Components) — the physical box.
EXPECT = {
    "booster": 45,
    "event": 13,
    "equipment": 36,
    "fuel": 43,
    "resourceTiles": 27,
    "ships": 6,
    "conesPerShip": 3,
}

checks = []


def ok(name, cond, detail=""):
    checks.append((cond, name, detail))


def main():
    cfg = json.load(open(CONFIG, encoding="utf-8"))
    comp = json.load(open(COMPONENTS, encoding="utf-8"))
    pro = json.load(open(PROSPECTOR, encoding="utf-8"))
    m = cfg["modes"]["prospector"]

    booster = pro["decks"]["booster"]["cards"]
    event = pro["decks"]["event"]["cards"]
    equipment = pro["decks"]["equipment"]["cards"]
    fuel = pro["decks"]["fuel"]["cards"]

    # --- box totals ---
    ok("booster deck total", len(booster) == EXPECT["booster"], f"{len(booster)} vs {EXPECT['booster']}")
    ok("event deck total", len(event) == EXPECT["event"], f"{len(event)} vs {EXPECT['event']}")
    ok("equipment deck total", len(equipment) == EXPECT["equipment"], f"{len(equipment)} vs {EXPECT['equipment']}")
    ok("fuel card total", len(fuel) == EXPECT["fuel"], f"{len(fuel)} vs {EXPECT['fuel']}")
    ok("resource tile total", comp["resourceTiles"]["total"] == EXPECT["resourceTiles"],
       f"{comp['resourceTiles']['total']} vs {EXPECT['resourceTiles']}")
    ok("ship roster size", len(pro["ships"]) == EXPECT["ships"], f"{len(pro['ships'])}")
    ok("cones", len(comp["cones"]) == EXPECT["ships"] * EXPECT["conesPerShip"], f"{len(comp['cones'])}")

    # --- booster composition matches config exactly ---
    bcfg = m["decks"]["booster"]
    for group in ("shield", "laser", "reserveFuel", "engine"):
        for v_str, want in bcfg[group].items():
            got = sum(1 for c in booster if c["type"] == group and c["value"] == int(v_str))
            ok(f"booster {group} +{v_str}", got == want, f"{got} vs {want}")
    got_hyper = sum(1 for c in booster if c["type"] == "hyperspace")
    ok("booster hyperspace", got_hyper == bcfg["hyperspace"], f"{got_hyper} vs {bcfg['hyperspace']}")

    # --- event composition matches config exactly ---
    ecfg2 = m["decks"]["event"]["counts"]
    for event_id, want in ecfg2.items():
        got = sum(1 for c in event if c.get("eventId") == event_id)
        ok(f"event {event_id}", got == want, f"{got} vs {want}")

    # --- equipment composition ---
    ecfg = m["decks"]["equipment"]
    for stat in ecfg["types"]:
        got = sum(1 for c in equipment if c["stat"] == stat)
        ok(f"equipment {stat}", got == ecfg["perType"], f"{got} vs {ecfg['perType']}")
    fe = next(c for c in equipment if c["stat"] == "fuelTanks")
    ok("fuelTanks equip grantFuel", fe.get("grantFuel") == ecfg["fuelEquip"]["grantFuel"],
       f"{fe.get('grantFuel')}")

    # --- fuel denominations ---
    fcfg = m["decks"]["fuel"]["denominations"]
    for v_str, want in fcfg.items():
        got = sum(1 for c in fuel if c["value"] == int(v_str))
        ok(f"fuel value-{v_str} count", got == want, f"{got} vs {want}")

    # --- ship stats within schema + caps ---
    schema = set(m["statSchema"])
    caps = m["upgradeCaps"]
    for ship in pro["ships"]:
        ok(f"{ship['colour']} stat keys", set(ship["stats"]) == schema, str(set(ship["stats"])))
        for stat, val in ship["stats"].items():
            cap = caps.get(stat)
            if cap is not None:
                ok(f"{ship['colour']} {stat} <= cap", val <= cap, f"{val} > {cap}")

    # --- ids unique across all decks ---
    all_ids = [c["id"] for c in booster] + [c["id"] for c in event] + [c["id"] for c in equipment] + [c["id"] for c in fuel]
    all_ids += [c["id"] for c in comp["cones"]] + [t["id"] for t in comp["resourceTiles"]["tiles"]]
    ok("all ids unique", len(all_ids) == len(set(all_ids)), f"{len(all_ids) - len(set(all_ids))} dup(s)")

    # --- supply table sanity: standard supply <= box tiles, for every player count ---
    box = m["resources"]["boxTilesPerColour"]
    for n, row in pro["resourceSupplyByPlayers"].items():
        ok(f"supply {n}p <= box", row["perColour"] <= box, f"{row['perColour']} > {box}")

    # --- report ---
    fails = [c for c in checks if not c[0]]
    for cond, name, detail in checks:
        if not cond:
            print(f"  FAIL  {name}: {detail}")
    print(f"\n{len(checks) - len(fails)}/{len(checks)} checks passed.")
    if fails:
        sys.exit(1)
    print("content packs OK.")


if __name__ == "__main__":
    main()
