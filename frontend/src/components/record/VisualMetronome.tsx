import { useVisualMetronome } from "../../hooks/useVisualMetronome";

/** Full-screen amber border flash on each beat. Adds no audio to the recording.
 *  Keyed on the beat counter so the CSS flash re-triggers without setState. */
export function VisualMetronome({
  bpm,
  active,
}: {
  bpm: number;
  active: boolean;
}) {
  const beat = useVisualMetronome(bpm, active);
  if (!active) return null;
  return (
    <div
      key={beat}
      aria-hidden
      className="animate-beatflash pointer-events-none fixed inset-0 z-40"
      style={{ boxShadow: "inset 0 0 0 6px var(--amber)" }}
    />
  );
}
