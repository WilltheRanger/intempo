/**
 * The manuscript panel at the top of the Recording screen — a few systems
 * of engraved-paper notation with the "now playing" system washed in amber.
 * Placeholder notation (real OCR page crops land later); drawn in the locked
 * palette so it reads as warm paper, never a grey box.
 */

const SYSTEMS = 4;
const NOTES_PER_SYSTEM = 8;

// Deterministic contour so noteheads sit musically but never jump per render.
function contour(system: number): number[] {
  const base = [0, 2, 1, 3, 2, 4, 3, 1];
  return Array.from({ length: NOTES_PER_SYSTEM }, (_, i) => base[(i + system) % base.length]);
}

export function ScorePanel({ activeSystem = 2 }: { activeSystem?: number }) {
  const rowH = 34;
  const padY = 14;
  const width = 320;
  const height = padY * 2 + SYSTEMS * rowH;

  return (
    <div className="relative overflow-hidden rounded-lg border border-line bg-paper-warm shadow-hair">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="block w-full"
        role="img"
        aria-label="Sheet music"
      >
        {Array.from({ length: SYSTEMS }).map((_, s) => {
          const top = padY + s * rowH;
          const active = s === activeSystem;
          return (
            <g key={s}>
              {active && (
                <rect
                  x="8"
                  y={top - 4}
                  width={width - 16}
                  height={rowH - 4}
                  rx="4"
                  fill="var(--amber-soft)"
                />
              )}
              {active && (
                <rect x="8" y={top - 4} width="3" height={rowH - 4} rx="1.5" fill="var(--amber)" />
              )}
              {/* staff */}
              {[0, 1, 2, 3, 4].map((l) => (
                <line
                  key={l}
                  x1="20"
                  x2={width - 16}
                  y1={top + 4 + l * 4}
                  y2={top + 4 + l * 4}
                  stroke="var(--ink-mute)"
                  strokeWidth="0.6"
                  opacity="0.5"
                />
              ))}
              {/* clef on the first system, abstracted */}
              {s === 0 && (
                <path
                  d={`M26 ${top + 2} C 22 ${top + 8}, 22 ${top + 18}, 28 ${top + 20} C 33 ${top + 22}, 34 ${top + 15}, 30 ${top + 13}`}
                  fill="none"
                  stroke="var(--ink-soft)"
                  strokeWidth="1.4"
                  strokeLinecap="round"
                />
              )}
              {/* noteheads */}
              {contour(s).map((c, i) => {
                const x = 44 + i * ((width - 70) / NOTES_PER_SYSTEM);
                const y = top + 6 + c * 3.2;
                return (
                  <g key={i}>
                    <ellipse
                      cx={x}
                      cy={y}
                      rx="2.4"
                      ry="1.8"
                      transform={`rotate(-20 ${x} ${y})`}
                      fill="var(--ink)"
                    />
                    <line
                      x1={x + 2.1}
                      x2={x + 2.1}
                      y1={y - 0.4}
                      y2={y - 11}
                      stroke="var(--ink)"
                      strokeWidth="0.9"
                    />
                  </g>
                );
              })}
            </g>
          );
        })}
      </svg>
      <span className="absolute bottom-2 right-3 text-[9px] uppercase tracking-[0.14em] text-ink-mute">
        Now playing
      </span>
    </div>
  );
}
