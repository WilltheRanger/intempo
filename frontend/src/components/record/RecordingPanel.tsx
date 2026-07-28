import { useEffect, useMemo } from "react";
import {
  BookmarkSimple,
  Microphone,
  Metronome,
  Headphones,
  Minus,
  Plus,
} from "@phosphor-icons/react";

import type { MetronomeMode } from "./MetronomeToggle";
import { useRecorder, WARN_SECONDS } from "../../hooks/useRecorder";
import { WaveformPreview } from "../ui/WaveformPreview";
import { VisualMetronome } from "./VisualMetronome";
import { cn } from "../../lib/cn";

const CREAM = "#EDE4CE";

function fmt(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/** The Deep Spruce recording surface — the one dark, front-lit panel. */
export function RecordingPanel({
  bpm,
  meter,
  onBpmChange,
  onCalibrate,
  metronomeMode,
  onToggleMetronome,
  submitting,
  onSubmit,
}: {
  bpm: number;
  meter: string;
  onBpmChange: (bpm: number) => void;
  onCalibrate: () => void;
  metronomeMode: MetronomeMode;
  onToggleMetronome: () => void;
  submitting: boolean;
  onSubmit: (blob: Blob) => void;
}) {
  const rec = useRecorder();
  const listening = rec.state === "recording";
  const done = rec.state === "stopped" && rec.blob;

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

  // Needle angle: 40 BPM → -110°, 240 BPM → 110°.
  const angle = -110 + ((Math.min(240, Math.max(40, bpm)) - 40) / 200) * 220;

  return (
    <div
      className="flex flex-col items-center gap-5 rounded-2xl bg-spruce px-6 pb-6 pt-7 text-[#EDE4CE] shadow-[inset_0_1px_0_rgba(237,228,206,0.13),0_18px_40px_-24px_rgba(23,48,41,0.95)]"
      style={{ background: "linear-gradient(168deg, var(--spruce), var(--spruce-lo))" }}
    >
      <VisualMetronome bpm={bpm} active={listening && metronomeMode === "visual"} />

      {/* bow / tempo arc */}
      <div className="relative h-14 w-full max-w-[260px]">
        <svg viewBox="0 0 260 56" className="absolute inset-0 overflow-visible">
          <path
            d="M 10 44 Q 130 4 250 44"
            fill="none"
            stroke="rgba(199,138,58,0.5)"
            strokeWidth="1.4"
            strokeDasharray="2 5"
            strokeLinecap="round"
          />
        </svg>
        <span
          className={cn(
            "absolute left-0 top-0 -ml-[6px] -mt-[6px] size-3 rounded-full bg-amber shadow-[0_0_12px_3px_rgba(199,138,58,0.55)]",
            listening && "animate-bow",
          )}
          style={{ offsetPath: 'path("M 10 44 Q 130 4 250 44")' } as React.CSSProperties}
        />
      </div>

      {/* state line */}
      <div className="flex flex-col items-center gap-0.5 text-center">
        <p className="font-serif text-2xl italic">
          {done ? "Take a listen" : listening ? "Listening…" : "Ready when you are"}
        </p>
        <p className="text-[13px]" style={{ color: "rgba(237,228,206,0.6)" }}>
          {done
            ? "Send it over when it feels right."
            : listening
              ? "Keep playing"
              : `Play at ♩=${bpm}, we'll follow along`}
        </p>
      </div>

      {done && playbackUrl ? (
        <div className="flex w-full flex-col items-center gap-4">
          <audio controls src={playbackUrl} className="w-full max-w-[280px]" />
          <div className="flex gap-3">
            <button
              onClick={rec.reset}
              className="rounded-full border border-[#EDE4CE]/30 px-5 py-2.5 text-sm transition-colors duration-200 ease-ios hover:bg-white/5 active:scale-[0.98]"
            >
              Redo
            </button>
            <button
              onClick={() => rec.blob && onSubmit(rec.blob)}
              disabled={submitting}
              className="rounded-full bg-amber px-6 py-2.5 text-sm font-medium text-white shadow-[0_8px_18px_-8px_rgba(199,138,58,0.8)] transition-transform duration-200 ease-ios active:scale-[0.98] disabled:opacity-60"
            >
              {submitting ? "Sending…" : "Analyze"}
            </button>
          </div>
        </div>
      ) : (
        <>
          {/* readouts */}
          <div className="flex w-full max-w-[280px] items-center justify-between">
            <Readout
              value={String(bpm)}
              label="Tempo"
              steppers={
                !listening
                  ? {
                      onDown: () => onBpmChange(Math.max(40, bpm - 1)),
                      onUp: () => onBpmChange(Math.min(240, bpm + 1)),
                    }
                  : undefined
              }
            />
            <svg viewBox="0 0 60 60" className="size-14 shrink-0">
              <circle cx="30" cy="30" r="25" fill="none" stroke="rgba(237,228,206,0.28)" />
              <line
                x1="30"
                y1="30"
                x2="30"
                y2="9"
                stroke="var(--amber)"
                strokeWidth="2"
                strokeLinecap="round"
                transform={`rotate(${angle} 30 30)`}
              />
              <circle cx="30" cy="30" r="2.6" fill="var(--amber)" />
            </svg>
            <Readout value={meter} label="Meter" />
          </div>

          {listening ? (
            <div className="flex w-full max-w-[280px] flex-col items-center gap-3">
              <WaveformPreview analyser={rec.analyser} active />
              <span className="font-serif text-3xl tabular-nums">{fmt(rec.seconds)}</span>
              {rec.seconds >= WARN_SECONDS && (
                <p className="text-xs" style={{ color: "#E8C98A" }}>
                  Approaching the 5-minute limit.
                </p>
              )}
            </div>
          ) : null}

          {rec.error && <p className="text-sm" style={{ color: "#E8A0A0" }}>{rec.error}</p>}

          {/* controls */}
          <div className="flex w-full max-w-[280px] items-center justify-between">
            <IconButton
              label={`Metronome ${metronomeMode === "visual" ? "on" : "off"}`}
              active={metronomeMode === "visual"}
              onClick={onToggleMetronome}
            >
              <Metronome size={19} weight={metronomeMode === "visual" ? "fill" : "regular"} />
            </IconButton>

            {listening ? (
              <button
                onClick={rec.stop}
                aria-label="Stop recording"
                className="grid size-[68px] place-items-center rounded-full border-4 border-[#EDE4CE]/85 transition-transform duration-200 ease-ios active:scale-95"
              >
                <span className="size-6 rounded-md" style={{ background: CREAM }} />
              </button>
            ) : (
              <button
                onClick={rec.start}
                aria-label="Start recording"
                className="grid size-[68px] place-items-center rounded-full border-4 border-[#EDE4CE]/85 transition-transform duration-200 ease-ios active:scale-95"
              >
                <span className="grid size-[52px] place-items-center rounded-full bg-[#C4453C]">
                  <Microphone size={24} weight="fill" className="text-white" />
                </span>
              </button>
            )}

            <IconButton label="Bookmark">
              <BookmarkSimple size={19} />
            </IconButton>
          </div>

          {!listening && (
            <button
              onClick={onCalibrate}
              className="text-[13px] underline decoration-[rgba(237,228,206,0.35)] underline-offset-4 transition-colors duration-200 ease-ios hover:text-amber"
              style={{ color: "rgba(237,228,206,0.75)" }}
            >
              Set the tempo by ear instead
            </button>
          )}

          <p
            className="flex items-center gap-1.5 text-[12px]"
            style={{ color: "rgba(237,228,206,0.55)" }}
          >
            <Headphones size={14} />
            We&rsquo;ll let you know when you&rsquo;re done.
          </p>
        </>
      )}
    </div>
  );
}

function Readout({
  value,
  label,
  steppers,
}: {
  value: string;
  label: string;
  steppers?: { onDown: () => void; onUp: () => void };
}) {
  return (
    <div className="flex flex-col items-center gap-1">
      <div className="flex items-center gap-2">
        {steppers && (
          <button
            onClick={steppers.onDown}
            aria-label="Slower"
            className="grid size-6 place-items-center rounded-full border border-[#EDE4CE]/30 active:scale-90"
          >
            <Minus size={12} />
          </button>
        )}
        <span className="min-w-[2ch] text-center font-serif text-[26px] tabular-nums leading-none">
          {value}
        </span>
        {steppers && (
          <button
            onClick={steppers.onUp}
            aria-label="Faster"
            className="grid size-6 place-items-center rounded-full border border-[#EDE4CE]/30 active:scale-90"
          >
            <Plus size={12} />
          </button>
        )}
      </div>
      <span
        className="text-[9px] uppercase tracking-[0.18em]"
        style={{ color: "rgba(237,228,206,0.55)" }}
      >
        {label}
      </span>
    </div>
  );
}

function IconButton({
  children,
  label,
  active,
  onClick,
}: {
  children: React.ReactNode;
  label: string;
  active?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      aria-pressed={active}
      className={cn(
        "grid size-11 place-items-center rounded-full border transition-colors duration-200 ease-ios active:scale-90",
        active
          ? "border-amber/60 bg-amber/15 text-amber"
          : "border-[#EDE4CE]/25 text-[#EDE4CE] hover:bg-white/5",
      )}
    >
      {children}
    </button>
  );
}
