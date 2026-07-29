import { useRef, useState } from "react";
import { Minus, Plus } from "@phosphor-icons/react";

const MIN_BPM = 40;
const MAX_BPM = 240;

/** Manual tempo: number + ± steppers + tap-tempo, with a "calibrate" link. */
export function TempoSelector({
  bpm,
  onChange,
  onCalibrate,
}: {
  bpm: number;
  onChange: (bpm: number) => void;
  onCalibrate: () => void;
}) {
  const taps = useRef<number[]>([]);
  const [tapHint, setTapHint] = useState(false);

  function clamp(v: number) {
    return Math.min(MAX_BPM, Math.max(MIN_BPM, Math.round(v)));
  }

  function tap() {
    const now = performance.now();
    taps.current = [...taps.current.filter((t) => now - t < 3000), now];
    if (taps.current.length >= 2) {
      const gaps = taps.current
        .slice(1)
        .map((t, i) => t - taps.current[i]);
      const avg = gaps.reduce((a, b) => a + b, 0) / gaps.length;
      if (avg > 0) onChange(clamp(60000 / avg));
      setTapHint(true);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-center gap-4">
        <button
          onClick={() => onChange(clamp(bpm - 1))}
          aria-label="Slower"
          className="grid size-10 place-items-center rounded-full border border-line-2 text-ink active:scale-90"
        >
          <Minus size={16} weight="bold" />
        </button>
        <div className="flex flex-col items-center">
          <span className="font-serif text-4xl tabular-nums text-ink">{bpm}</span>
          <span className="text-[10px] uppercase tracking-[0.16em] text-ink-mute">
            BPM
          </span>
        </div>
        <button
          onClick={() => onChange(clamp(bpm + 1))}
          aria-label="Faster"
          className="grid size-10 place-items-center rounded-full border border-line-2 text-ink active:scale-90"
        >
          <Plus size={16} weight="bold" />
        </button>
      </div>
      <div className="flex items-center justify-center gap-4 text-sm">
        <button
          onClick={tap}
          className="rounded-md border border-line-2 px-3 py-1.5 text-ink transition-colors duration-200 ease-ios hover:bg-paper-warm active:scale-95"
        >
          {tapHint ? "Tap…" : "Tap tempo"}
        </button>
        <button
          onClick={onCalibrate}
          className="text-amber-deep transition-colors duration-200 ease-ios hover:text-ink"
        >
          Play it instead
        </button>
      </div>
    </div>
  );
}
