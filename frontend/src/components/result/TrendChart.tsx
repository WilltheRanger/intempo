import { Eyebrow } from "../ui/Eyebrow";

/**
 * Rolling-tempo trend as an on-brand inline SVG (no chart lib):
 * x = note index, y = rush-positive % of a beat, dashed line at zero,
 * amber line, emphasized peak. Positive = ahead (rushing), negative = behind.
 */
export function TrendChart({ trend }: { trend: number[] }) {
  if (trend.length < 2) return null;

  const W = 320;
  const H = 120;
  const padX = 6;
  const padY = 14;
  const maxAbs = Math.max(0.5, ...trend.map((v) => Math.abs(v)));

  const x = (i: number) => padX + (i / (trend.length - 1)) * (W - padX * 2);
  const y = (v: number) => H / 2 - (v / maxAbs) * (H / 2 - padY);

  const line = trend.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");

  let peak = 0;
  trend.forEach((v, i) => {
    if (Math.abs(v) > Math.abs(trend[peak])) peak = i;
  });

  return (
    <div className="flex flex-col gap-3">
      <Eyebrow>Drift across the piece</Eyebrow>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="h-28 w-full"
        role="img"
        aria-label="Rolling tempo drift across the piece"
      >
        {[-0.5, 0.5].map((f) => (
          <line
            key={f}
            x1={padX}
            x2={W - padX}
            y1={y(maxAbs * f)}
            y2={y(maxAbs * f)}
            stroke="rgba(33,31,27,0.07)"
            strokeWidth={1}
          />
        ))}
        <line
          x1={padX}
          x2={W - padX}
          y1={H / 2}
          y2={H / 2}
          stroke="rgba(33,31,27,0.25)"
          strokeWidth={1}
          strokeDasharray="3 3"
        />
        <polyline
          points={line}
          fill="none"
          stroke="#C78A3A"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx={x(peak)} cy={y(trend[peak])} r={3.5} fill="#C78A3A" />
      </svg>
      <div className="flex justify-between text-[10px] text-ink-faint">
        <span>ahead ↑ · behind ↓</span>
        <span>note {trend.length}</span>
      </div>
    </div>
  );
}
