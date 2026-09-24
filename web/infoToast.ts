/**
 * The generic "just keep a player informed" popup, as opposed to the decision-bearing boxes
 * (FightBox/EventCardBox/the guidance popup/EquipmentPopup) that pause the game for a real
 * choice — those stay in their own strict priority chain in GameScreen.tsx untouched.
 *
 * Deliberately minimal: showing one always REPLACES whatever's currently up (no FIFO queue,
 * never stacked), and a viewer's own confirm click closes it too. Non-blocking — nothing
 * waits on it, so an away player never stalls anyone else. One slot per browser is exactly
 * "per player" from that browser's own point of view (offline hot-seat: whichever seat is
 * being shown; online: this viewer's own seat), so no extra per-player bookkeeping is needed.
 */
import { useCallback, useState } from "react";

export interface InfoToast {
  /** lets a future caller dedupe against an identical message already showing — unused today */
  id: string;
  lines: string[];
}

export function useInfoToast() {
  const [toast, setToast] = useState<InfoToast | null>(null);
  const show = useCallback((t: InfoToast) => setToast(t), []);
  const dismiss = useCallback(() => setToast(null), []);
  return { toast, show, dismiss };
}
