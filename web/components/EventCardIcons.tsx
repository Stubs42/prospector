/**
 * One small glyph per event card family, echoing the same "abstract prop, not photoreal"
 * style as kit.tsx's booster CardIcon — currentColor, viewBox 0 0 40 40. Asteroid Field and
 * Helium Cloud each come as 3 physical cards (X=1/2/3, see engine/events.ts's makeAsteroidField/
 * makeHeliumCloud) that share one family icon, keyed by stripping the trailing "-N".
 */
function eventIconFamily(eventId: string): string {
  return eventId.replace(/-[123]$/, "");
}

export function EventCardIcon({ eventId }: { eventId: string }) {
  switch (eventIconFamily(eventId)) {
    case "pirate-ambush":
      return (
        <svg viewBox="0 0 40 40" className="cicon" aria-hidden="true">
          {[-1, 1].map((s) => (
            <rect
              key={s}
              x={-2}
              y={-15}
              width={4}
              height={30}
              rx={2}
              fill="currentColor"
              opacity={0.8}
              transform={`translate(20 20) rotate(${s * 32})`}
            />
          ))}
          <circle cx={20} cy={20} r={4.5} fill="currentColor" opacity={0.95} />
        </svg>
      );
    case "hyperspace-quake":
      return (
        <svg viewBox="0 0 40 40" className="cicon" aria-hidden="true">
          {[5, 10, 15].map((r, i) => (
            <circle key={r} cx={20} cy={20} r={r} fill="none" stroke="currentColor" strokeWidth={2} opacity={0.9 - i * 0.25} />
          ))}
        </svg>
      );
    case "salvage-cache":
      return (
        <svg viewBox="0 0 40 40" className="cicon" aria-hidden="true">
          <rect x={8} y={17} width={24} height={15} rx={2} fill="none" stroke="currentColor" strokeWidth={2.4} opacity={0.85} />
          <path d="M8 17 L20 9 L32 17" fill="none" stroke="currentColor" strokeWidth={2.4} opacity={0.85} strokeLinejoin="round" />
          <circle cx={20} cy={24.5} r={2.6} fill="currentColor" opacity={0.9} />
        </svg>
      );
    case "asteroid-field":
      return (
        <svg viewBox="0 0 40 40" className="cicon" aria-hidden="true">
          <path d="M8 22 L13 15 L22 16 L24 24 L17 29 L9 27 Z" fill="currentColor" opacity={0.85} />
          <path d="M23 11 L29 9 L33 14 L30 20 L24 18 Z" fill="currentColor" opacity={0.6} />
        </svg>
      );
    case "helium-cloud":
      return (
        <svg viewBox="0 0 40 40" className="cicon" aria-hidden="true">
          <circle cx={15} cy={23} r={7} fill="currentColor" opacity={0.85} />
          <circle cx={24} cy={20} r={9} fill="currentColor" opacity={0.85} />
          <circle cx={30} cy={25} r={5.5} fill="currentColor" opacity={0.85} />
          <rect x={9} y={25} width={24} height={6} rx={3} fill="currentColor" opacity={0.85} />
        </svg>
      );
    case "engine-failure":
      return (
        <svg viewBox="0 0 40 40" className="cicon" aria-hidden="true">
          {[[-7, -6], [7, -6], [-7, 7], [7, 7]].map(([x, y]) => (
            <ellipse key={`${x},${y}`} cx={20 + x!} cy={20 + y!} rx={7} ry={5.5} fill="none" stroke="currentColor" strokeWidth={2.4} opacity={0.5} />
          ))}
          <line x1={9} y1={9} x2={31} y2={31} stroke="currentColor" strokeWidth={3} opacity={0.9} strokeLinecap="round" />
        </svg>
      );
    case "ship-wreck":
      return (
        <svg viewBox="0 0 40 40" className="cicon" aria-hidden="true">
          <path d="M20 7 L30 26 L20 33 L10 26 Z" fill="none" stroke="currentColor" strokeWidth={2.4} opacity={0.85} strokeLinejoin="round" />
          <path d="M14 17 L21 22 L16 27 L24 30" fill="none" stroke="currentColor" strokeWidth={2.2} opacity={0.9} strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case "hidden-ore":
      return (
        <svg viewBox="0 0 40 40" className="cicon" aria-hidden="true">
          <circle cx={17} cy={17} r={9} fill="none" stroke="currentColor" strokeWidth={2.6} opacity={0.85} />
          <line x1={23.5} y1={23.5} x2={32} y2={32} stroke="currentColor" strokeWidth={3} opacity={0.9} strokeLinecap="round" />
          <path d="M17 12 L20.5 17 L17 22 L13.5 17 Z" fill="currentColor" opacity={0.8} />
        </svg>
      );
    default:
      // fallback for an unknown/future event id — the old generic starburst
      return (
        <svg viewBox="0 0 40 40" className="cicon" aria-hidden="true">
          <circle cx={20} cy={20} r={4} fill="currentColor" opacity={0.9} />
          {[0, 45, 90, 135].map((deg) => (
            <rect key={deg} x={18.6} y={5} width={2.8} height={12} rx={1.4} fill="currentColor" opacity={0.65} transform={`rotate(${deg} 20 20)`} />
          ))}
        </svg>
      );
  }
}
