/**
 * The annotated score on the Verdict screen — manuscript notation with the
 * off-tempo measures washed amber and a couple of hand-written margin notes
 * sitting slightly off-grid, like a teacher's pencil in the margin.
 */

const SYSTEMS = 5;
const NOTES = 8;

function contour(system: number): number[] {
  const base = [1, 3, 2, 4, 2, 3, 1, 2];
  return Array.from({ length: NOTES }, (_, i) => base[(i + system) % base.length]);
}

export function AnnotatedScorePanel({
  highlight = [2, 3],
}: {
  /** Which systems (0-indexed) are the off-tempo region. */
  highlight?: number[];
}) {
  const rowH = 32;
  const padY = 14;
  const width = 320;
  const height = padY * 2 + SYSTEMS * rowH;
  const hi = new Set(highlight);

  return (
    <div className="relative overflow-hidden rounded-lg border border-line bg-paper-warm shadow-hair">
      <svg viewBox={`0 0 ${width} ${height}`} className="block w-full" role="img" aria-label="Annotated score">
        {Array.from({ length: SYSTEMS }).map((_, s) => {
          const top = padY + s * rowH;
          const active = hi.has(s);
          return (
            <g key={s}>
              {active && (
                <>
                  <rect x="8" y={top - 3} width={width - 16} height={rowH - 4} rx="4" fill="var(--amber-soft)" />
                  <rect x="8" y={top - 3} width="3" height={rowH - 4} rx="1.5" fill="var(--amber)" />
                </>
              )}
              {[0, 1, 2, 3, 4].map((l) => (
                <line
                  key={l}
                  x1="20"
                  x2={width - 16}
                  y1={top + 4 + l * 3.6}
                  y2={top + 4 + l * 3.6}
                  stroke="var(--ink-mute)"
                  strokeWidth="0.6"
                  opacity="0.5"
                />
              ))}
              {s === 0 && (
                <path
                  d={`M26 ${top + 2} C 22 ${top + 8}, 22 ${top + 17}, 28 ${top + 19} C 33 ${top + 21}, 34 ${top + 14}, 30 ${top + 12}`}
                  fill="none"
                  stroke="var(--ink-soft)"
                  strokeWidth="1.3"
                  strokeLinecap="round"
                />
              )}
              {contour(s).map((c, i) => {
                const x = 44 + i * ((width - 70) / NOTES);
                const y = top + 5 + c * 2.8;
                return (
                  <g key={i}>
                    <ellipse cx={x} cy={y} rx="2.3" ry="1.7" transform={`rotate(-20 ${x} ${y})`} fill="var(--ink)" />
                    <line x1={x + 2} x2={x + 2} y1={y - 0.4} y2={y - 10} stroke="var(--ink)" strokeWidth="0.9" />
                  </g>
                );
              })}
            </g>
          );
        })}
      </svg>

      {/* hand-written margin notes, slightly off-grid, with a faint paper
          backing so they read as pencil over the staff rather than a clash */}
      <span
        className="pointer-events-none absolute right-2 rounded-sm px-1 font-serif text-[13px] italic text-amber-deep"
        style={{
          top: `${((padY + highlight[0] * rowH) / height) * 100 - 5}%`,
          transform: "rotate(-5deg)",
          background: "rgba(247,242,228,0.85)",
        }}
      >
        a touch ahead
      </span>
      <span
        className="pointer-events-none absolute right-6 rounded-sm px-1 font-serif text-[13px] italic text-amber-deep"
        style={{
          top: `${((padY + (highlight[highlight.length - 1] + 1) * rowH) / height) * 100 + 1}%`,
          transform: "rotate(-3deg)",
          background: "rgba(247,242,228,0.85)",
        }}
      >
        breathe here
      </span>
    </div>
  );
}
