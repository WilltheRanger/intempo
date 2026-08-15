import { cn } from "../../lib/cn";

/**
 * A crop of engraved sheet music, drawn as SVG.
 *
 * This is the app's main visual identity: a musician should recognise their
 * piece by the look of the page, the way they would on a shelf. Until real
 * scanned page crops exist (they arrive with the OCR upload), this renders
 * plausible engraving rather than an abstract placeholder: clef, key
 * signature, time signature, barlines, beamed groups, slurs.
 *
 * Everything is derived from `seed`, so a given piece always renders the same
 * page but no two pieces look alike.
 */

type Props = {
  seed: string;
  /** Show the engraved title block above the first system. */
  title?: string;
  composer?: string;
  className?: string;
  /** Fewer systems, no title — for small list rows. */
  dense?: boolean;
};

/** Deterministic 32-bit hash, so a seed always yields the same page. */
function hash(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Small deterministic PRNG seeded from the hash. */
function rng(seed: number) {
  let s = seed || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 10000) / 10000;
  };
}

const STAFF_GAP = 3.4; // distance between staff lines

export function SheetCrop({ seed, title, composer, className, dense }: Props) {
  const rand = rng(hash(seed));
  const systems = dense ? 3 : 4;
  const width = 260;
  const headerH = title && !dense ? 30 : 8;
  const systemH = 34;
  const height = headerH + systems * systemH + 6;

  const left = 14;
  const right = width - 12;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className={cn("block h-full w-full", className)}
      preserveAspectRatio="xMidYMid slice"
      role="img"
      aria-label={title ? `${title} sheet music` : "Sheet music"}
    >
      <rect width={width} height={height} fill="var(--paper-raised)" />

      {title && !dense && (
        <>
          <text
            x={width / 2}
            y={13}
            textAnchor="middle"
            fill="var(--ink)"
            style={{ font: '600 7px "Playfair Display", Georgia, serif', letterSpacing: "0.4px" }}
          >
            {title.length > 30 ? `${title.slice(0, 29)}…` : title}
          </text>
          {composer && (
            <text
              x={right - 20}
              y={22}
              textAnchor="end"
              fill="var(--ink-mute)"
              style={{ font: 'italic 5.5px "Playfair Display", Georgia, serif' }}
            >
              {composer}
            </text>
          )}
        </>
      )}

      {Array.from({ length: systems }).map((_, si) => {
        const top = headerH + si * systemH + 6;
        return (
          <System
            key={si}
            top={top}
            left={left}
            right={right}
            rand={rand}
            first={si === 0}
          />
        );
      })}
    </svg>
  );
}

function System({
  top,
  left,
  right,
  rand,
  first,
}: {
  top: number;
  left: number;
  right: number;
  rand: () => number;
  first: boolean;
}) {
  const lines = [0, 1, 2, 3, 4].map((i) => top + i * STAFF_GAP);
  const bottom = lines[4];
  const noteStart = left + (first ? 30 : 10);
  const span = right - noteStart - 4;

  // Lay out 7–9 events across the system, some beamed in pairs.
  const count = 7 + Math.floor(rand() * 3);
  const step = span / count;
  const notes = Array.from({ length: count }, (_, i) => {
    const pitch = Math.floor(rand() * 9); // 0 = below staff, 8 = above
    return {
      x: noteStart + i * step + step * 0.3,
      y: bottom - pitch * (STAFF_GAP / 2),
      beam: rand() > 0.55,
    };
  });

  // Barlines after roughly every third event.
  const bars = [Math.floor(count / 3), Math.floor((count * 2) / 3)].map(
    (i) => noteStart + i * step + step * 0.02,
  );

  return (
    <g>
      {lines.map((y) => (
        <line
          key={y}
          x1={left}
          x2={right}
          y1={y}
          y2={y}
          stroke="var(--ink)"
          strokeWidth="0.4"
          opacity="0.55"
        />
      ))}

      {/* Opening and closing barlines frame the system. */}
      <line x1={left} x2={left} y1={top} y2={bottom} stroke="var(--ink)" strokeWidth="0.5" opacity="0.6" />
      <line x1={right} x2={right} y1={top} y2={bottom} stroke="var(--ink)" strokeWidth="0.5" opacity="0.6" />
      {bars.map((x, i) => (
        <line key={i} x1={x} x2={x} y1={top} y2={bottom} stroke="var(--ink)" strokeWidth="0.4" opacity="0.45" />
      ))}

      {first && <BassClef x={left + 5} top={top} />}
      {first && <TimeSig x={left + 22} top={top} />}

      {notes.map((n, i) => {
        const nextBeamed = notes[i + 1]?.beam && n.beam;
        return (
          <g key={i}>
            <ellipse
              cx={n.x}
              cy={n.y}
              rx="1.9"
              ry="1.45"
              transform={`rotate(-18 ${n.x} ${n.y})`}
              fill="var(--ink)"
              opacity="0.88"
            />
            <line
              x1={n.x + 1.75}
              x2={n.x + 1.75}
              y1={n.y - 0.3}
              y2={n.y - 9}
              stroke="var(--ink)"
              strokeWidth="0.55"
              opacity="0.88"
            />
            {nextBeamed && (
              <line
                x1={n.x + 1.75}
                x2={notes[i + 1].x + 1.75}
                y1={n.y - 9}
                y2={notes[i + 1].y - 9}
                stroke="var(--ink)"
                strokeWidth="1.5"
                opacity="0.88"
              />
            )}
          </g>
        );
      })}
    </g>
  );
}

/** Simplified bass clef — this is a cello app; treble would be wrong here. */
function BassClef({ x, top }: { x: number; top: number }) {
  const y = top + STAFF_GAP; // F line
  return (
    <g fill="none" stroke="var(--ink)" strokeWidth="1.1" opacity="0.85" strokeLinecap="round">
      <path d={`M${x} ${y + 5.5} C ${x + 4.5} ${y + 5.5}, ${x + 6} ${y + 1}, ${x + 2.6} ${y - 0.6} C ${x + 0.6} ${y - 1.5}, ${x - 0.4} ${y + 0.4}, ${x + 0.6} ${y + 1.2}`} />
      <circle cx={x + 7.4} cy={y + 0.4} r="0.55" fill="var(--ink)" stroke="none" />
      <circle cx={x + 7.4} cy={y + 3.2} r="0.55" fill="var(--ink)" stroke="none" />
    </g>
  );
}

function TimeSig({ x, top }: { x: number; top: number }) {
  return (
    <g fill="var(--ink)" opacity="0.8" style={{ font: '600 6.5px Georgia, serif' }}>
      <text x={x} y={top + STAFF_GAP * 1.9} textAnchor="middle">
        3
      </text>
      <text x={x} y={top + STAFF_GAP * 4.1} textAnchor="middle">
        4
      </text>
    </g>
  );
}
