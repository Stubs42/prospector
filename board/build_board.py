"""Phase 1 — generate board/board.json from config/default.config.json.

The board is derived entirely from `core.board`:
  - a hexagon of axial cells out to `radius`
  - `region` = "inner" for distance <= innerRadius, else "outer"
  - the golden origin at `originCell`
  - six home bases, one per colour in `colourOrder`, each a 4-cell cluster hugging the
    hexagon corner that lies in that colour's direction (`directions[i]`)
  - pixel positions for a pointy-top layout (unit hex size; the renderer scales)

Run:  python board/build_board.py
"""

import json
import math
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CONFIG = os.path.join(ROOT, "config", "default.config.json")
OUT = os.path.join(ROOT, "board", "board.json")


def axial_distance(q, r):
    return (abs(q) + abs(r) + abs(q + r)) // 2


SQRT3 = math.sqrt(3)


def make_pixel(orientation):
    """Unit-size axial -> pixel (y grows downward), per hex orientation."""
    if orientation == "flat-top":
        return lambda q, r: (round(1.5 * q, 6), round(SQRT3 * (r + q / 2), 6))
    # pointy-top
    return lambda q, r: (round(SQRT3 * (q + r / 2), 6), round(1.5 * r, 6))


# module-level default; main() rebinds from config
to_pixel = make_pixel("pointy-top")


def neighbours(q, r, dirs):
    return [(q + dq, r + dr) for dq, dr in dirs]


def pick_base_cluster(direction, inner_radius, dirs, size=4):
    """A compact cluster hugging the hexagon corner in `direction`.

    Anchor = the corner cell `direction * inner_radius`. Add the anchor's neighbours that
    lie in the inner region (a 3-cell inward fan at a true corner), then, if still short,
    grow by the frontier cell nearest the anchor in pixel space."""
    dq, dr = direction
    anchor = (dq * inner_radius, dr * inner_radius)
    ax, ay = to_pixel(*anchor)

    def d2(c):
        x, y = to_pixel(*c)
        return (x - ax) ** 2 + (y - ay) ** 2

    cluster = [anchor]
    for nb in sorted(neighbours(*anchor, dirs), key=d2):
        if len(cluster) >= size:
            break
        if axial_distance(*nb) <= inner_radius and nb not in cluster:
            cluster.append(nb)

    while len(cluster) < size:
        frontier = {
            nb
            for c in cluster
            for nb in neighbours(*c, dirs)
            if nb not in cluster and axial_distance(*nb) <= inner_radius
        }
        if not frontier:
            break
        cluster.append(min(frontier, key=lambda c: (d2(c), c)))

    return [list(c) for c in cluster]


def main():
    global to_pixel
    cfg = json.load(open(CONFIG, encoding="utf-8"))
    b = cfg["core"]["board"]
    radius = b["radius"]
    inner_radius = b["innerRadius"]
    origin = tuple(b["originCell"])
    dirs = [tuple(d) for d in b["directions"]]
    colours = b["colourOrder"]
    to_pixel = make_pixel(b["orientation"])

    directions_by_colour = {c: list(dirs[i]) for i, c in enumerate(colours)}

    bases = {
        c: pick_base_cluster(dirs[i], inner_radius, dirs)
        for i, c in enumerate(colours)
    }
    base_owner = {}
    for colour, cells in bases.items():
        for cell in cells:
            key = (cell[0], cell[1])
            if key in base_owner:
                raise SystemExit(f"base cell {key} claimed by {base_owner[key]} and {colour}")
            base_owner[key] = colour

    cells = []
    for q in range(-radius, radius + 1):
        for r in range(-radius, radius + 1):
            d = axial_distance(q, r)
            if d > radius:
                continue
            x, y = to_pixel(q, r)
            cells.append({
                "q": q,
                "r": r,
                "dist": d,
                "region": "inner" if d <= inner_radius else "outer",
                "origin": (q, r) == origin,
                "base": base_owner.get((q, r)),
                "x": x,
                "y": y,
            })

    cells.sort(key=lambda c: (c["r"], c["q"]))

    board = {
        "meta": {
            "generatedFrom": "config/default.config.json",
            "note": "Derived board model — do not hand-edit; re-run board/build_board.py.",
        },
        "orientation": b["orientation"],
        "radius": radius,
        "innerRadius": inner_radius,
        "layout": {"type": b["orientation"], "hexSize": 1},
        "directionsByColour": directions_by_colour,
        "bases": bases,
        "cellCount": len(cells),
        "cells": cells,
    }

    json.dump(board, open(OUT, "w", encoding="utf-8"), indent=1)
    print(f"wrote {OUT}")
    print(f"  cells: {len(cells)}  (inner {sum(1 for c in cells if c['region']=='inner')}, "
          f"outer {sum(1 for c in cells if c['region']=='outer')})")
    for c in colours:
        print(f"  base {c:6s}: {bases[c]}")


if __name__ == "__main__":
    main()
