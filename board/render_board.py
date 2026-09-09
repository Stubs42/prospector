"""Phase 1 — render board/board.json to board/board.svg for visual verification.

Draws purely from board.json: nothing about the board is hard-coded here.

Run:  python board/render_board.py
"""

import json
import math
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BOARD = os.path.join(ROOT, "board", "board.json")
OUT = os.path.join(ROOT, "board", "board.svg")

HEX = 26  # px per unit hex size

FILL = {
    "inner": "#12171d",
    "outer": "#2b3037",
}
BASE_FILL = {
    "black": "#3a3a3a",
    "red": "#c9463a",
    "blue": "#3f74c9",
    "white": "#e7e7e7",
    "green": "#3f9f63",
    "yellow": "#d8b53a",
}
STROKE = "#586170"
ORIGIN_STROKE = "#e6a13c"


def hex_points(cx, cy, size, orientation):
    # pointy-top: vertices at -90, -30, 30, ... ; flat-top: at 0, 60, 120, ...
    start = -90 if orientation == "pointy-top" else 0
    pts = []
    for i in range(6):
        a = math.radians(start + 60 * i)
        pts.append(f"{cx + size * math.cos(a):.2f},{cy + size * math.sin(a):.2f}")
    return " ".join(pts)


def main():
    board = json.load(open(BOARD, encoding="utf-8"))
    orient = board["orientation"]
    cells = board["cells"]

    xs = [c["x"] * HEX for c in cells]
    ys = [c["y"] * HEX for c in cells]
    pad = HEX * 2
    minx, maxx = min(xs) - pad, max(xs) + pad
    miny, maxy = min(ys) - pad, max(ys) + pad
    w, h = maxx - minx, maxy - miny

    out = [
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{minx:.1f} {miny:.1f} {w:.1f} {h:.1f}" '
        f'width="{w:.0f}" height="{h:.0f}" font-family="monospace">',
        f'<rect x="{minx:.1f}" y="{miny:.1f}" width="{w:.1f}" height="{h:.1f}" fill="#0b0e12"/>',
    ]

    for c in cells:
        cx, cy = c["x"] * HEX, c["y"] * HEX
        fill = BASE_FILL[c["base"]] if c["base"] else FILL[c["region"]]
        stroke = ORIGIN_STROKE if c["origin"] else STROKE
        sw = 3 if c["origin"] else 1
        out.append(
            f'<polygon points="{hex_points(cx, cy, HEX, orient)}" '
            f'fill="{fill}" stroke="{stroke}" stroke-width="{sw}"/>'
        )

    # base colour labels at each cluster centroid
    for colour, cluster in board["bases"].items():
        pcs = [next(c for c in cells if c["q"] == q and c["r"] == r) for q, r in cluster]
        cx = sum(c["x"] for c in pcs) / len(pcs) * HEX
        cy = sum(c["y"] for c in pcs) / len(pcs) * HEX
        tcol = "#111" if colour in ("white", "yellow", "green") else "#fff"
        out.append(
            f'<text x="{cx:.1f}" y="{cy + 4:.1f}" text-anchor="middle" '
            f'font-size="13" fill="{tcol}">{colour}</text>'
        )

    out.append(
        f'<text x="{minx + 12:.1f}" y="{miny + 24:.1f}" font-size="14" fill="#9aa4ad">'
        f'Prospector board — {orient} cells, radius {board["radius"]} '
        f'(inner {board["innerRadius"]}), {board["cellCount"]} cells</text>'
    )
    out.append("</svg>")

    open(OUT, "w", encoding="utf-8").write("\n".join(out))
    print(f"wrote {OUT}  ({w:.0f}x{h:.0f})")


if __name__ == "__main__":
    main()
