import { cn } from "../lib/cn";

/** The InTempo wordmark — Playfair with the "barline that breathes". */
export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <span className="h-[22px] w-[3px] rounded-sm bg-ink" aria-hidden />
      <span className="font-serif text-[22px] font-semibold tracking-[-0.01em] text-ink">
        InTempo
      </span>
    </span>
  );
}
