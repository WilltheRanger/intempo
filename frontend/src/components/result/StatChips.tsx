export function StatChips({
  range,
  steadiest,
  longest,
}: {
  range: string;
  steadiest: string;
  longest: string;
}) {
  const chips: Array<[string, string]> = [
    ["Tempo range", range],
    ["Steadiest", steadiest],
    ["Longest drift", longest],
  ];
  return (
    <div className="grid grid-cols-3 gap-2">
      {chips.map(([label, value]) => (
        <div key={label} className="rounded-md border border-line bg-paper-raised px-3 py-2.5 shadow-hair">
          <p className="text-[9px] font-semibold uppercase tracking-[0.1em] text-ink-mute">{label}</p>
          <p className="mt-1 text-[13px] font-medium tabular-nums text-ink">{value}</p>
        </div>
      ))}
    </div>
  );
}
