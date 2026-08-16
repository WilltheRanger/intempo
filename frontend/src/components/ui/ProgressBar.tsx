/** Indeterminate progress — for the long, synchronous OCR request. */
export function ProgressBar({ label }: { label?: string }) {
  return (
    <div className="flex flex-col gap-2" role="status" aria-live="polite">
      <div className="h-1 w-full overflow-hidden rounded-full bg-paper-warm">
        <div className="h-full w-1/4 rounded-full bg-amber animate-progress" />
      </div>
      {label && <p className="text-sm text-ink-soft">{label}</p>}
    </div>
  );
}
