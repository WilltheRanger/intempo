import { useEffect, useState } from "react";

/**
 * A visual-only metronome clock. Uses `audioContext.currentTime` with a
 * lookahead scheduler (never `setInterval`, which drifts) — but plays NO
 * sound, so it adds zero signal to the recorded audio (spec §7). Returns a
 * beat counter that increments on each beat; the caller flashes on change.
 */
export function useVisualMetronome(bpm: number, enabled: boolean): number {
  const [beat, setBeat] = useState(0);

  useEffect(() => {
    if (!enabled || bpm <= 0) return;

    const ctx = new AudioContext();
    const interval = 60 / bpm; // seconds per beat
    let next = ctx.currentTime + 0.12;
    let raf = 0;
    const timeouts: number[] = [];

    const tick = () => {
      // Schedule any beats due within the next 120ms window.
      while (next < ctx.currentTime + 0.12) {
        const delayMs = Math.max(0, (next - ctx.currentTime) * 1000);
        timeouts.push(window.setTimeout(() => setBeat((b) => b + 1), delayMs));
        next += interval;
      }
      raf = requestAnimationFrame(tick);
    };
    tick();

    return () => {
      cancelAnimationFrame(raf);
      timeouts.forEach((t) => window.clearTimeout(t));
      void ctx.close();
    };
  }, [bpm, enabled]);

  return beat;
}
