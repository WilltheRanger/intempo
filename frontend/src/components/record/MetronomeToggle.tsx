import { cn } from "../../lib/cn";

export type MetronomeMode = "off" | "visual";

/** off / visual segmented control. Haptic is mobile-only (Batch 9), hidden on web. */
export function MetronomeToggle({
  value,
  onChange,
}: {
  value: MetronomeMode;
  onChange: (mode: MetronomeMode) => void;
}) {
  const options: Array<[MetronomeMode, string]> = [
    ["off", "Off"],
    ["visual", "Visual"],
  ];
  return (
    <div className="flex items-center justify-between">
      <span className="text-sm text-ink-soft">Metronome</span>
      <div className="flex gap-1 rounded-md border border-line bg-paper-warm p-0.5">
        {options.map(([mode, label]) => (
          <button
            key={mode}
            onClick={() => onChange(mode)}
            className={cn(
              "rounded-[7px] px-3 py-1 text-sm transition-colors duration-200 ease-ios",
              value === mode
                ? "bg-paper-raised text-ink shadow-hair"
                : "text-ink-mute",
            )}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}
