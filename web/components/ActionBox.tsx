/**
 * The fixed hex frame shared by every action box (guidance popup, ship picker, combat box)
 * and every button inside them. Reproduces the exact "flattened, pointed left/right, 60°-
 * from-horizontal edges" hex shape the old SVG hex popup/buttons used — computed from the
 * element's own real pixel size via ResizeObserver, since a CSS clip-path's percentages
 * warp the angle as size changes, and both boxes and buttons here come in very different
 * sizes (a two-line message vs. the full combat box; a "‹" arrow vs. "Counter-attack +30").
 * Not board content — a fixed screen overlay, like the zoom controls or the status panel
 * (see this file's note history / HexPopup.tsx for why these moved out of board space).
 */
import { useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";

/** the true regular-hexagon cut ratio (point extends this fraction of the height past the
   flat top/bottom edge, per side) — cut = h * REGULAR_CUT is the old hexButtonPoints' 60°
   formula. A short, wide button (most of them: "Counter-attack +30" is far wider than
   tall) barely shows a point at all at that ratio — genuinely hexagonal by the numbers,
   but reads as a plain rectangle at a glance. Buttons use a deliberately more pronounced
   ratio instead, trading strict regularity for a shape that's unmistakably a hexagon. */
const REGULAR_CUT = 1 / (2 * Math.tan(Math.PI / 3));
const BUTTON_CUT = 0.55;

/** corner points of a `w`×`h` hexagon, pointed left/right, cut `cutRatio * h` past the
   flat top/bottom edge on each side */
export function hexFramePoints(w: number, h: number, cutRatio: number = REGULAR_CUT): string {
  const cut = Math.min(h * cutRatio, w * 0.4); // never let the point eat more than 40% of the width
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

interface HexFrame<T extends HTMLElement> {
  ref: RefObject<T>;
  size: { w: number; h: number } | null;
  /** horizontal padding (px) content needs so it doesn't spill past the hexagon's point —
     the point's own reach (`cut`) scales with height, so this isn't a single fixed value */
  padX: number;
}

/** measures `ref`'s own element (via ResizeObserver) and derives the hex polygon size plus
   the horizontal padding its content needs to clear the point on each side */
function useHexFrame<T extends HTMLElement>(minPad: number, cutRatio: number = REGULAR_CUT): HexFrame<T> {
  const ref = useRef<T>(null);
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
  const cut = size ? Math.min(size.h * cutRatio, size.w * 0.4) : 0;
  return { ref, size, padX: Math.max(minPad, cut + 6) };
}

export function ActionBox({ children, className }: { children: ReactNode; className?: string }) {
  const { ref, size, padX } = useHexFrame<HTMLDivElement>(24);
  return (
    <div ref={ref} className={`actionbox${className ? ` ${className}` : ""}`}>
      {size && (
        // viewBox + preserveAspectRatio="none" (not width/height attributes) so the
        // polygon always exactly fills whatever box CSS actually renders, even the one
        // render where `size` (from the previous measurement) is a beat behind the
        // padding it just caused — no gap/overflow between the fill and the real edges
        <svg className="actionbox-hex" viewBox={`0 0 ${size.w} ${size.h}`} preserveAspectRatio="none">
          <polygon points={hexFramePoints(size.w, size.h)} />
        </svg>
      )}
      <div className="actionbox-content" style={{ paddingLeft: padX, paddingRight: padX }}>
        {children}
      </div>
    </div>
  );
}

export interface HexButtonProps {
  children: ReactNode;
  onClick?: (() => void) | undefined;
  disabled?: boolean | undefined;
  kind?: "primary" | "danger" | undefined;
  className?: string | undefined;
  "aria-label"?: string | undefined;
  /** overrides the hex outline's colour (e.g. a staged card's own aspect colour) instead
     of the default/kind-based one */
  accent?: string | undefined;
}

/** every button inside an action box — same hex silhouette as the box itself, just sized
   to its own (usually much smaller) content instead of measuring separately per caller */
export function HexButton({ children, onClick, disabled, kind, className, accent, ...aria }: HexButtonProps) {
  const { ref, size, padX } = useHexFrame<HTMLButtonElement>(10, BUTTON_CUT);
  return (
    <button
      ref={ref}
      type="button"
      className={`hexbutton${kind ? ` ${kind}` : ""}${className ? ` ${className}` : ""}`}
      onClick={onClick}
      disabled={disabled}
      {...aria}
    >
      {size && (
        <svg className="hexbutton-hex" viewBox={`0 0 ${size.w} ${size.h}`} preserveAspectRatio="none">
          <polygon points={hexFramePoints(size.w, size.h, BUTTON_CUT)} style={accent ? { stroke: accent } : undefined} />
        </svg>
      )}
      <span className="hexbutton-content" style={{ paddingLeft: padX, paddingRight: padX }}>
        {children}
      </span>
    </button>
  );
}
