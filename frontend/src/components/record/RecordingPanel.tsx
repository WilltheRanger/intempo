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

/** The Deep Spruce recording surface — the one dark, front-lit panel.
 *  Composition follows the locked Figma: the tempo readout is the hero,
 *  over an amber-tipped waveform and the record controls. */
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

  return (
    <div
      className="flex flex-col items-center gap-6 rounded-lg bg-spruce px-6 pb-9 pt-8 text-[#EDE4CE] shadow-[inset_0_1px_0_rgba(237,228,206,0.13),0_18px_40px_-24px_rgba(23,48,41,0.95)]"
      style={{ background: "linear-gradient(168deg, var(--spruce), var(--spruce-lo))" }}
    >
      <VisualMetronome bpm={bpm} active={listening && metronomeMode === "visual"} />

      {/* state line */}
      <div className="flex flex-col items-center gap-1 text-center">
        <p className="font-serif text-[26px] leading-tight">
          {done ? "Take a listen" : listening ? "Listening…" : "Ready when you are"}
        </p>
        <p className="text-[13px]" style={{ color: "rgba(237,228,206,0.6)" }}>
          {done
            ? "Send it over when it feels right."
            : listening
              ? "Keep playing, we're following along."
              : `Play at ♩=${bpm}, we'll follow along.`}
        </p>
      </div>

      {done && playbackUrl ? (
        <div className="flex w-full flex-col items-center gap-4">
          <audio controls src={playbackUrl} className="w-full max-w-[280px]" />
          <div className="flex gap-3">
            <button
              onClick={rec.reset}
              className="press rounded-sm border border-[#EDE4CE]/30 px-5 py-2.5 text-sm transition-colors duration-200 ease-ios hover:bg-white/5"
            >
              Redo
            </button>
            <button
              onClick={() => rec.blob && onSubmit(rec.blob)}
              disabled={submitting}
              className="press rounded-sm bg-paper px-6 py-2.5 text-sm font-medium text-ink transition-colors duration-200 ease-ios disabled:opacity-60"
            >
              {submitting ? "Sending…" : "Analyze"}
            </button>
          </div>
        </div>
      ) : (
        <>
          {/* hero tempo readout */}
          <div className="flex items-center gap-6">
            <Stepper
              icon={<Minus size={18} weight="bold" />}
              label="Slower"
              disabled={listening}
              onClick={() => onBpmChange(Math.max(40, bpm - 1))}
            />
            <div className="flex flex-col items-center">
              <span className="font-serif text-[64px] leading-none tabular-nums text-white">
                {bpm}
              </span>
              <span
                className="mt-1 text-[11px] font-medium uppercase tracking-[0.14em]"
                style={{ color: "rgba(237,228,206,0.6)" }}
              >
                BPM · {meter}
              </span>
            </div>
            <Stepper
              icon={<Plus size={18} weight="bold" />}
              label="Faster"
              disabled={listening}
              onClick={() => onBpmChange(Math.min(240, bpm + 1))}
            />
          </div>

          {/* waveform: live while listening, idle bars otherwise */}
          <div className="flex w-full max-w-[280px] flex-col items-center gap-3">
            {listening ? (
              <>
                <WaveformPreview analyser={rec.analyser} active />
                <span className="font-serif text-3xl tabular-nums">{fmt(rec.seconds)}</span>
                {rec.seconds >= WARN_SECONDS && (
                  <p className="text-xs" style={{ color: "#E8C98A" }}>
                    Approaching the 5-minute limit.
                  </p>
                )}
              </>
            ) : (
              <IdleWave />
            )}
          </div>

          {rec.error && <p className="text-sm" style={{ color: "#E8A0A0" }}>{rec.error}</p>}

          {/* controls */}
          <div className="flex w-full max-w-[260px] items-center justify-between">
            <IconButton
              label={`Metronome ${metronomeMode === "visual" ? "on" : "off"}`}
              active={metronomeMode === "visual"}
              onClick={onToggleMetronome}
            >
              <Metronome size={20} weight={metronomeMode === "visual" ? "fill" : "regular"} />
            </IconButton>

            {listening ? (
              <button
                onClick={rec.stop}
                aria-label="Stop recording"
                className="grid size-[76px] place-items-center rounded-full border-4 border-[#EDE4CE]/85 transition-transform duration-200 ease-ios active:scale-95"
              >
                <span className="size-6 rounded-md" style={{ background: CREAM }} />
              </button>
            ) : (
              <button
                onClick={rec.start}
                aria-label="Start recording"
                className="grid size-[76px] place-items-center rounded-full border-4 border-[#EDE4CE]/85 transition-transform duration-200 ease-ios active:scale-95"
              >
                <span className="grid size-[54px] place-items-center rounded-full bg-[#C4453C]">
                  <Microphone size={24} weight="fill" className="text-white" />
                </span>
              </button>
            )}

            <IconButton label="Bookmark">
              <BookmarkSimple size={20} />
            </IconButton>
          </div>

          {!listening && (
            <button
              onClick={onCalibrate}
              className="-mt-1 text-[13px] underline decoration-[rgba(237,228,206,0.35)] underline-offset-4 transition-colors duration-200 ease-ios hover:text-amber"
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

/** A static amber-tipped waveform strip shown before recording starts. */
function IdleWave() {
  const amps = [
    8, 16, 26, 14, 34, 22, 40, 18, 30, 12, 24, 38, 16, 28, 10, 20, 32, 14, 22,
    36, 18, 26, 12, 30, 16, 24, 34, 14, 20, 28,
  ];
  return (
    <div className="flex h-12 w-full items-center justify-center gap-[3px]" aria-hidden>
      {amps.map((a, i) => {
        const near = Math.abs(i - 15) < 4;
        return (
          <span
            key={i}
            className={cn("w-1 rounded-full", near ? "bg-amber" : "bg-[#EDE4CE]")}
            style={{ height: `${a}px`, opacity: near ? 1 : 0.4 }}
          />
        );
      })}
    </div>
  );
}

function Stepper({
  icon,
  label,
  disabled,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className={cn(
        "grid size-10 place-items-center rounded-full bg-white/[0.07] text-[#EDE4CE] transition-all duration-200 ease-ios",
        "hover:bg-white/[0.12] active:scale-90",
        disabled && "pointer-events-none opacity-0",
      )}
    >
      {icon}
    </button>
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
        "grid size-12 place-items-center rounded-full border transition-colors duration-200 ease-ios active:scale-90",
        active
          ? "border-amber/60 bg-amber/15 text-amber"
          : "border-[#EDE4CE]/25 text-[#EDE4CE] hover:bg-white/5",
      )}
    >
      {children}
    </button>
  );
}
