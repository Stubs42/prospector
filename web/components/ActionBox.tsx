/**
 * The fixed hex frame shared by every action box (guidance popup, ship picker, combat box).
 * Reproduces the exact "flattened, pointed left/right, 60°-from-horizontal edges" hex shape
 * the old SVG hex buttons used (see the removed hexButtonPoints) — computed from the box's
 * own real pixel size via ResizeObserver, since a CSS clip-path's percentages warp the angle
 * as content size changes, and content here varies a lot (a two-line message vs. the full
 * combat box). Not board content — a fixed screen overlay, like the zoom controls or the
 * status panel (see HexPopup.tsx's note on why these moved out of board space).
 */
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";

/** corner points of a `w`×`h` hexagon, pointed left/right, cut at 60° from horizontal —
   same formula the old hexButtonPoints used, just driven by the box's real pixel size */
function hexFramePoints(w: number, h: number): string {
  const cut = h / 2 / Math.tan(Math.PI / 3);
  const pts: [number, number][] = [
    [0, h / 2],
    [cut, 0],
    [w - cut, 0],
    [w, h / 2],
    [w - cut, h],
    [cut, h],
  ];
  return pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
}

export function ActionBox({ children, className }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setSize({ w: el.offsetWidth, h: el.offsetHeight });
    measure(); // synchronous, before paint — no border-less flash on first mount
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // a regular hexagon's point extends `cut` px past its flat top/bottom edges on each side —
  // content needs at least that much horizontal padding, or it visually spills past the
  // point into the transparent corner. `cut` scales with height, so a tall box (the full
  // combat box) needs noticeably more side padding than a short two-line message does —
  // this can't be a single fixed CSS value.
  const cut = size ? size.h / 2 / Math.tan(Math.PI / 3) : 0;
  const padX = Math.max(24, cut + 10);
  return (
    <div ref={ref} className={`actionbox${className ? ` ${className}` : ""}`}>
      {size && (
        <svg className="actionbox-hex" width={size.w} height={size.h}>
          <polygon points={hexFramePoints(size.w, size.h)} />
        </svg>
      )}
      <div className="actionbox-content" style={{ paddingLeft: padX, paddingRight: padX }}>
        {children}
      </div>
    </div>
  );
}
