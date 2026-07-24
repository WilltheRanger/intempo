import { useEffect, useMemo } from "react";
import { Mic } from "lucide-react";

import type { MetronomeMode } from "./MetronomeToggle";
import { useRecorder, WARN_SECONDS } from "../../hooks/useRecorder";
import { WaveformPreview } from "../ui/WaveformPreview";
import { VisualMetronome } from "./VisualMetronome";
import { Button } from "../ui/Button";

function fmt(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function RecordingPanel({
  bpm,
  metronomeMode,
  submitting,
  onSubmit,
}: {
  bpm: number;
  metronomeMode: MetronomeMode;
  submitting: boolean;
  onSubmit: (blob: Blob) => void;
}) {
  const rec = useRecorder();
  const playbackUrl = useMemo(
    () => (rec.blob ? URL.createObjectURL(rec.blob) : null),
    [rec.blob],
  );
  useEffect(
    () => () => {
      if (playbackUrl) URL.revokeObjectURL(playbackUrl);
    },
    [playbackUrl],
  );

  return (
    <div className="flex flex-col items-center gap-5 rounded-lg border border-line bg-spruce p-6 text-[#EDE4CE] shadow-[inset_0_1px_0_rgba(237,228,206,0.13),0_14px_30px_-20px_rgba(23,48,41,0.9)]">
      <VisualMetronome bpm={bpm} active={rec.state === "recording" && metronomeMode === "visual"} />

      {rec.state === "recording" ? (
        <>
          <div className="flex items-center gap-2 text-sm">
            <span className="size-2.5 animate-pulse rounded-full bg-[#E0655C]" />
            Recording
          </div>
          <span className="font-serif text-4xl tabular-nums">{fmt(rec.seconds)}</span>
          <WaveformPreview analyser={rec.analyser} active />
          {rec.seconds >= WARN_SECONDS && (
            <p className="text-xs text-[#E8C98A]">
              Approaching the 5-minute limit.
            </p>
          )}
          <button
            onClick={rec.stop}
            aria-label="Stop recording"
            className="grid size-16 place-items-center rounded-full border-4 border-[#EDE4CE]/80 active:scale-95"
          >
            <span className="size-6 rounded-[5px] bg-[#EDE4CE]" />
          </button>
        </>
      ) : rec.blob && playbackUrl ? (
        <>
          <div className="text-sm text-[#EDE4CE]/70">
            Listen back, then send it for analysis.
          </div>
          <audio controls src={playbackUrl} className="w-full" />
          <div className="flex gap-3">
            <Button variant="ghost" onClick={rec.reset} className="border-[#EDE4CE]/30 text-[#EDE4CE] hover:bg-white/5">
              Redo
            </Button>
            <Button onClick={() => onSubmit(rec.blob!)} disabled={submitting}>
              {submitting ? "Sending…" : "Analyze"}
            </Button>
          </div>
        </>
      ) : (
        <>
          <div className="text-sm text-[#EDE4CE]/70">
            Play the piece at ♩={bpm}. We&rsquo;ll follow along.
          </div>
          {rec.error && <p className="text-sm text-[#E8A0A0]">{rec.error}</p>}
          <button
            onClick={rec.start}
            aria-label="Start recording"
            className="grid size-20 place-items-center rounded-full border-4 border-[#EDE4CE]/80 transition-transform duration-200 ease-ios active:scale-95"
          >
            <span className="grid size-14 place-items-center rounded-full bg-[#C4453C]">
              <Mic size={24} strokeWidth={1.5} className="text-white" />
            </span>
          </button>
        </>
      )}
    </div>
  );
}
