/**
 * The window's own backdrop: a starfield, fixed to the viewport — no relation to the board's
 * pan/zoom/rotate at all, same as the earlier fix moved the action boxes out of that
 * transform. Regenerated (a fresh field of stars) once per game, seeded off the game's own
 * `state.seed` so it's reproducible for a given seed and stable across re-renders within one
 * game, only changing when a new game actually starts.
 */
import { useEffect, useRef } from "react";
import { theme } from "../theme.js";

/** small, dependency-free seeded PRNG (mulberry32) — deterministic per seed */
function mulberry32(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function paint(ctx: CanvasRenderingContext2D, w: number, h: number, seed: number) {
  const cfg = theme.starfield;
  const rand = mulberry32(seed);
  ctx.clearRect(0, 0, w, h);

  // deep-space backdrop, a soft radial glow off-centre so it doesn't look perfectly flat
  const bg = ctx.createRadialGradient(w * 0.5, h * 0.35, 0, w * 0.5, h * 0.35, Math.max(w, h) * 0.85);
  bg.addColorStop(0, cfg.bgInner);
  bg.addColorStop(1, cfg.bgOuter);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);

  // a few faint nebula blobs — a different hue and layout every game, low-opacity so they
  // read as atmosphere, not decoration competing with the board
  const nebulae = cfg.nebulaCountMin + Math.floor(rand() * (cfg.nebulaCountMax - cfg.nebulaCountMin + 1));
  for (let i = 0; i < nebulae; i++) {
    const nx = rand() * w;
    const ny = rand() * h;
    const nr = Math.max(w, h) * (0.18 + rand() * 0.22);
    const hue = cfg.nebulaHueMin + rand() * (cfg.nebulaHueMax - cfg.nebulaHueMin);
    const g = ctx.createRadialGradient(nx, ny, 0, nx, ny, nr);
    g.addColorStop(0, `hsla(${hue}, 45%, 32%, ${cfg.nebulaOpacity})`);
    g.addColorStop(1, `hsla(${hue}, 45%, 22%, 0)`);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(nx, ny, nr, 0, Math.PI * 2);
    ctx.fill();
  }

  // the stars themselves — mostly tiny and dim, a handful bright enough for a little
  // sparkle, and each tinted just slightly (a real starfield isn't pure white: cooler
  // blue-white, neutral, and warmer amber-white stars) rather than uniformly white
  const count = Math.floor((w * h) / cfg.densityDivisor);
  for (let i = 0; i < count; i++) {
    const x = rand() * w;
    const y = rand() * h;
    const sizeT = Math.pow(rand(), cfg.sizeSkew);
    const r = cfg.sizeMin + sizeT * (cfg.sizeMax - cfg.sizeMin);
    const b = cfg.brightnessMin + rand() * (cfg.brightnessMax - cfg.brightnessMin);
    // hue skews toward the ends (cool or warm) more often than dead-neutral, like real
    // starlight temperature; saturation stays low so it still reads mostly white
    const hue = rand() < 0.5 ? 200 + rand() * 40 : 25 + rand() * 40;
    const sat = cfg.colorSaturation * (0.5 + rand() * 0.5) * 100;
    const light = 78 + rand() * 18;
    const colour = `hsla(${hue.toFixed(0)}, ${sat.toFixed(0)}%, ${light.toFixed(0)}%, ${b.toFixed(2)})`;
    ctx.beginPath();
    ctx.fillStyle = colour;
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    if (r > cfg.sizeMin + (cfg.sizeMax - cfg.sizeMin) * 0.55) {
      ctx.strokeStyle = `hsla(${hue.toFixed(0)}, ${sat.toFixed(0)}%, ${light.toFixed(0)}%, ${(b * 0.35).toFixed(2)})`;
      ctx.lineWidth = 0.6;
      ctx.beginPath();
      ctx.moveTo(x - r * 3, y);
      ctx.lineTo(x + r * 3, y);
      ctx.moveTo(x, y - r * 3);
      ctx.lineTo(x, y + r * 3);
      ctx.stroke();
    }
  }
}

export function Starfield({ seed }: { seed: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const draw = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = window.innerWidth;
      const h = window.innerHeight;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      paint(ctx, w, h, seed);
    };
    draw();
    window.addEventListener("resize", draw);
    return () => window.removeEventListener("resize", draw);
  }, [seed]);

  return <canvas ref={canvasRef} className="starfield" aria-hidden="true" />;
}
