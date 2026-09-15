/**
 * The outer boundary of a cluster of hex cells (e.g. a 4-cell base region), as one closed
 * polyline — used to highlight "pick this whole region" as a single shape instead of
 * outlining/filling each cell separately.
 *
 * Standard shared-edge-cancellation trick: every hex contributes its 6 edges; an edge shared
 * by two cells in the cluster is internal and cancels out, so whatever's left is exactly the
 * boundary. Those edges are then stitched corner-to-corner into one loop. Works for any
 * simply-connected cluster (no holes), which a base region always is.
 */
export interface Point {
  x: number;
  y: number;
}

/** the 6 corners of a pointy-top hex centred at (cx, cy) with circumradius `size` */
export function hexCorners(cx: number, cy: number, size: number): Point[] {
  const pts: Point[] = [];
  for (let i = 0; i < 6; i++) {
    const a = ((60 * i - 90) * Math.PI) / 180;
    pts.push({ x: cx + size * Math.cos(a), y: cy + size * Math.sin(a) });
  }
  return pts;
}

const round = (n: number) => Math.round(n * 4) / 4; // quarter-pixel tolerance for float noise
const keyOf = (p: Point) => `${round(p.x)},${round(p.y)}`;

/**
 * `centres`: the pixel center of every cell in the cluster. `size` matches whatever radius
 * the cells themselves are drawn at. Returns an ordered list of boundary points (a closed
 * loop — first point is not repeated at the end), or [] if the cluster is empty.
 */
export function clusterOutline(centres: readonly Point[], size: number): Point[] {
  const edges = new Map<string, [Point, Point]>();
  for (const { x: cx, y: cy } of centres) {
    const corners = hexCorners(cx, cy, size);
    for (let i = 0; i < 6; i++) {
      const a = corners[i]!;
      const b = corners[(i + 1) % 6]!;
      const ka = keyOf(a);
      const kb = keyOf(b);
      const ek = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
      if (edges.has(ek)) edges.delete(ek); // shared with a neighbour in the cluster: internal
      else edges.set(ek, [a, b]);
    }
  }
  if (edges.size === 0) return [];

  const adj = new Map<string, Point[]>();
  const pointOf = new Map<string, Point>();
  for (const [a, b] of edges.values()) {
    const ka = keyOf(a);
    const kb = keyOf(b);
    pointOf.set(ka, a);
    pointOf.set(kb, b);
    if (!adj.has(ka)) adj.set(ka, []);
    if (!adj.has(kb)) adj.set(kb, []);
    adj.get(ka)!.push(b);
    adj.get(kb)!.push(a);
  }

  const startKey = [...adj.keys()][0]!;
  const loop: Point[] = [pointOf.get(startKey)!];
  let curKey = startKey;
  let prevKey: string | null = null;
  for (let guard = 0; guard < adj.size; guard++) {
    const options = adj.get(curKey) ?? [];
    const next = options.find((p) => keyOf(p) !== prevKey) ?? options[0];
    if (!next) break;
    const nextKey = keyOf(next);
    if (nextKey === startKey) break;
    loop.push(next);
    prevKey = curKey;
    curKey = nextKey;
  }
  return loop;
}

export function pointsAttr(points: readonly Point[]): string {
  return points.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(" ");
}
