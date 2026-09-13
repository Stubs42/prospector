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
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";

/** corner points of a `w`×`h` hexagon, pointed left/right, cut at 60° from horizontal —
   same formula the old hexButtonPoints used, just driven by the element's real pixel size.
   Always this exact angle — a bigger point on a short, wide button comes from making the
   button taller (cut scales with height), never from changing this ratio. */
export function hexFramePoints(w: number, h: number): string {
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

interface HexFrame<T extends HTMLElement> {
  ref: RefObject<T>;
  size: { w: number; h: number } | null;
  /** horizontal padding (px) content needs so it doesn't spill past the hexagon's point —
     the point's own reach (`cut`) scales with height, so this isn't a single fixed value */
  padX: number;
}

/** measures `ref`'s own element (via ResizeObserver) and derives the hex polygon size plus
   the horizontal padding its content needs to clear the point on each side */
function useHexFrame<T extends HTMLElement>(minPad: number): HexFrame<T> {
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
  const cut = size ? size.h / 2 / Math.tan(Math.PI / 3) : 0;
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
   to its own (usually much smaller) content instead of measuring separately per caller.
   Keyboard model: the "primary" button (if any) is the box's default action — Space/Enter
   always fires it, no matter what (if anything) currently has focus, like a form's submit
   button. Every other button is mouse/touch-only: it never takes focus at all, so its own
   highlight only ever reflects the mouse actually being over it right now, and it can't be
   left "armed" for a stray Space/Enter later. */
export function HexButton({ children, onClick, disabled, kind, className, accent, ...aria }: HexButtonProps) {
  const { ref, size, padX } = useHexFrame<HTMLButtonElement>(10);
  const isPrimary = kind === "primary";

  useEffect(() => {
    if (!isPrimary || disabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      // already focused: the browser's own native activation handles this keypress —
      // firing onClick ourselves too would run it twice
      if (document.activeElement === ref.current) return;
      const tag = (document.activeElement as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return; // never hijack real text entry
      e.preventDefault();
      onClick?.();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isPrimary, disabled, onClick, ref]);

  return (
    <button
      ref={ref}
      type="button"
      className={`hexbutton${kind ? ` ${kind}` : ""}${className ? ` ${className}` : ""}`}
      onClick={onClick}
      disabled={disabled}
      // a non-primary button is mouse/touch-only: never let a click hand it keyboard
      // focus (that's what let a stray Space/Enter re-fire whatever arrow was clicked
      // last), and drop it from the Tab order entirely
      tabIndex={isPrimary ? undefined : -1}
      onMouseDown={isPrimary ? undefined : (e) => e.preventDefault()}
      {...aria}
    >
      {size && (
        <svg className="hexbutton-hex" viewBox={`0 0 ${size.w} ${size.h}`} preserveAspectRatio="none">
          <polygon points={hexFramePoints(size.w, size.h)} style={accent ? { stroke: accent } : undefined} />
        </svg>
      )}
      <span className="hexbutton-content" style={{ paddingLeft: padX, paddingRight: padX }}>
        {children}
      </span>
    </button>
  );
}
