/**
 * A small manuscript thumbnail for library rows. We don't have real
 * scanned-score crops as assets yet, so this draws a warm, engraved-paper
 * placeholder (staff + clef + a few noteheads) in the locked palette
 * rather than shipping an empty grey box. Swap for the real OCR page crop
 * once uploads are wired.
 */

type Props = {
  /** Stable id so each row's noteheads sit at a consistent height. */
  seed: string;
  className?: string;
};

// Tiny deterministic hash → per-note vertical position on the staff, so
// thumbnails differ per piece but never jump between renders.
function heights(seed: string): number[] {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  // staff lines sit at y = 16..36; keep noteheads inside that band.
  return [0, 1, 2, 3].map((i) => 20 + ((h >> (i * 3)) & 3) * 4);
}

export function ScoreThumb({ seed, className }: Props) {
  const ys = heights(seed);
  return (
    <svg viewBox="0 0 48 48" className={className} role="img" aria-hidden>
      <rect
        x="0.5"
        y="0.5"
        width="47"
        height="47"
        rx="6"
        fill="var(--paper-warm)"
        stroke="var(--line-2)"
      />
      {/* staff */}
      {[16, 21, 26, 31, 36].map((y) => (
        <line
          key={y}
          x1="7"
          x2="41"
          y1={y}
          y2={y}
          stroke="var(--ink-mute)"
          strokeWidth="0.6"
          opacity="0.55"
        />
      ))}
      {/* treble clef, abstracted to a single warm stroke */}
      <path
        d="M12 13 C 8 19, 8 30, 14 33 C 19 35, 21 28, 17 26 C 14 24.5, 12 27, 14 29"
        fill="none"
        stroke="var(--ink-soft)"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
      {/* noteheads with stems */}
      {ys.map((y, i) => {
        const x = 23 + i * 5;
        return (
          <g key={i} opacity={0.85 - i * 0.06}>
            <ellipse
              cx={x}
              cy={y}
              rx="2"
              ry="1.5"
              transform={`rotate(-20 ${x} ${y})`}
              fill="var(--ink)"
            />
            <line
              x1={x + 1.8}
              x2={x + 1.8}
              y1={y - 0.5}
              y2={y - 9}
              stroke="var(--ink)"
              strokeWidth="0.8"
            />
          </g>
        );
      })}
    </svg>
  );
}
