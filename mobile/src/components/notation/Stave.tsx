import Svg, { Ellipse, G, Line, Path, Rect, Text as SvgText } from 'react-native-svg';

import type { Clef } from '../../data/types';
import { colors, fontFamily, typography } from '../../design';
import {
  engrave,
  type NoteValue,
  type StaveItem,
} from '../../lib/notation/engrave';

export interface StaveProps {
  /** Notes, rests and multi-bar rests, in reading order. */
  notes: StaveItem[];
  clef: Clef;
  /**
   * Which ground it is drawn on.
   *
   * `dark` inverts the ink so the same engraving can sit on the warmup panel.
   * Not a theme — it is the one place in the app with a full-bleed dark
   * surface, and the `action*`/`onDark*` pair already exists for exactly that.
   */
  tone?: 'light' | 'dark';
  /**
   * Wrap onto further systems past this width.
   *
   * Give it the space available and the music fills it downwards. Without it
   * the run stays on one system, which is what the Today preview wants.
   */
  maxWidth?: number;
  /** Cap the notes drawn, for a preview that only suggests the shape. */
  maxNotes?: number;
  /**
   * Overall size, as a multiple of the base staff.
   *
   * The warmup page draws bigger than the Today preview: one is read from a
   * music stand and the other is glanced at.
   */
  scale?: number;
  /** Stretch systems to fill `maxWidth`. */
  justify?: boolean;
  /**
   * Print each note's letter under the system.
   *
   * On by default: the warmup is an exercise for a student, and the letters
   * teach. Off for reading a real piece, where a letter under every note reads
   * as a beginner's crib.
   *
   * **A caller that turns this off has to state the clef**, because nothing
   * here draws one and the names were carrying that information — the same
   * notehead is a different pitch in alto clef. See `engrave.ts`.
   */
  showNoteNames?: boolean;
}

const LINE_GAP = 9;
const NOTE_GAP = 30;
const LEFT_PAD = 22;
const RIGHT_PAD = 12;
/** Noteheads are wider than they are tall, and tilted. */
const HEAD_RX_FACTOR = 0.62;
const HEAD_RY_FACTOR = 0.46;
const HEAD_TILT = -20;
const STROKE = 1.1;
/**
 * Staff lines are thinner than stems and lighter than noteheads, but they are
 * still ink. Drawn in the border colour they read as a divider rather than as
 * a staff, and the notes float in the middle of nothing.
 */
const STAFF_STROKE = 0.9;
const BEAM_FACTOR = 0.55;
/** Half the height of the little upright strokes on a multi-bar rest's ends. */
const MULTI_REST_SERIF_FACTOR = 0.55;
const MULTI_REST_NUMBER_SIZE = 1.5;
/** A rest bar is about as wide as a notehead and rather flatter. */
const REST_WIDTH_FACTOR = 1.4;
const REST_HEIGHT_FACTOR = 0.58;

/**
 * Engraved notation, wrapped onto as many systems as it takes.
 *
 * Draws what `engrave` laid out and nothing more. **No clef** — the reasoning is
 * in `engrave.ts`. With `showNoteNames` on, the names under each system carry
 * the information a clef would; with it off, the caller owes the reader that
 * information some other way.
 *
 * The names are SVG text rather than React Native text so they travel with the
 * system they belong to. A row of absolutely positioned labels worked for one
 * stave and would have needed a second layout pass for four. They can be turned
 * off — see `showNoteNames`, and read the obligation that comes with it.
 */
export function Stave({
  notes,
  clef,
  tone = 'light',
  maxWidth,
  maxNotes,
  scale = 1,
  justify = false,
  showNoteNames = true,
}: StaveProps) {
  const dark = tone === 'dark';
  const ink = dark ? colors.actionText : colors.textPrimary;
  const rule = dark ? colors.onDarkMuted : colors.textSecondary;
  const label = dark ? colors.onDarkMuted : colors.textTertiary;

  const lineGap = LINE_GAP * scale;
  const layout = engrave(notes, clef, {
    lineGap,
    noteGap: NOTE_GAP * scale,
    leftPad: LEFT_PAD * scale,
    rightPad: RIGHT_PAD * scale,
    maxWidth,
    maxNotes,
    justify,
    // Also stops the layout reserving the row's height, so hiding the names
    // doesn't leave a band of empty space under every system.
    nameRow: showNoteNames,
  });

  const headRx = lineGap * HEAD_RX_FACTOR;
  const headRy = lineGap * HEAD_RY_FACTOR;
  const beamNode = lineGap * BEAM_FACTOR;
  const stroke = STROKE * scale;

  return (
    <Svg
      width={layout.width}
      height={layout.height}
      accessibilityRole="image"
      // Not described. With names on, a screen reader spelling out fifteen note
      // letters is noise and the exercise is named above; with them off there is
      // no text here to read at all. Either way the screen carries the piece's
      // name, clef and tempo in real text, which is the useful alternative.
      accessible={false}
    >
      {layout.systems.map((system, s) => (
        <G key={`system-${s}`}>
          {system.staffLines.map((y, index) => (
            <Line
              key={`staff-${index}`}
              x1={0}
              y1={y}
              x2={system.width}
              y2={y}
              stroke={rule}
              strokeWidth={STAFF_STROKE * scale}
            />
          ))}

          {system.barlines.map((x, index) => (
            <Line
              key={`bar-${index}`}
              x1={x}
              y1={system.staffLines[0]}
              x2={x}
              y2={system.staffLines[4]}
              stroke={rule}
              strokeWidth={STAFF_STROKE * 1.2 * scale}
            />
          ))}

          {system.multiRests.map((block, index) => (
            <G key={`multirest-${index}`}>
              <Rect
                x={block.x}
                y={block.y - block.halfHeight}
                width={block.width}
                height={block.halfHeight * 2}
                fill={rule}
              />
              {/* The end serifs. Without them the block is a dash; with them
                  it is the symbol a musician has counted since school. */}
              {[block.x, block.x + block.width].map((x, side) => (
                <Line
                  key={`serif-${side}`}
                  x1={x}
                  y1={block.y - lineGap * MULTI_REST_SERIF_FACTOR}
                  x2={x}
                  y2={block.y + lineGap * MULTI_REST_SERIF_FACTOR}
                  stroke={rule}
                  strokeWidth={stroke * 1.4}
                />
              ))}
              <SvgText
                x={block.x + block.width / 2}
                y={block.numberY}
                fill={label}
                fontFamily={fontFamily.sansMedium}
                fontSize={lineGap * MULTI_REST_NUMBER_SIZE}
                textAnchor="middle"
              >
                {block.bars}
              </SvgText>
            </G>
          ))}

          {/* **Rests are ink, the block is not**, and the split is deliberate.
              A rest is a note-sized mark and drawing it in the staff-line
              colour made it a speck of dust — measured on the first render,
              where the hierarchy came out notes, number, staff, *then* rests.
              The multi-bar block is large enough that full ink would make it
              the first thing seen on the page, which is the wrong subject. */}
          {system.rests.map((rest, index) => (
            <Rest
              key={`rest-${index}`}
              x={rest.x}
              y={rest.y}
              value={rest.value}
              ink={ink}
              lineGap={lineGap}
              stroke={stroke}
            />
          ))}

          {system.notes.map((note, index) => (
            <G key={`note-${index}`}>
              {note.ledgers.map((y, ledger) => (
                <Line
                  key={`ledger-${ledger}`}
                  x1={note.x - headRx * 1.7}
                  y1={y}
                  x2={note.x + headRx * 1.7}
                  y2={y}
                  stroke={ink}
                  strokeWidth={stroke}
                />
              ))}

              {note.accidental === 'sharp' ? (
                <Sharp
                  x={note.x - lineGap * 1.55}
                  y={note.y}
                  ink={ink}
                  lineGap={lineGap}
                  stroke={stroke}
                />
              ) : null}

              {note.stem ? (
                <Line
                  x1={note.stem.x}
                  y1={note.stem.from}
                  x2={note.stem.x}
                  y2={note.stem.to}
                  stroke={ink}
                  strokeWidth={stroke * 1.2}
                />
              ) : null}

              <Ellipse
                cx={note.x}
                cy={note.y}
                rx={headRx}
                ry={headRy}
                transform={`rotate(${HEAD_TILT} ${note.x} ${note.y})`}
                fill={note.filled ? ink : 'none'}
                stroke={ink}
                strokeWidth={note.filled ? 0 : stroke * 1.3}
              />

              {showNoteNames ? (
                <SvgText
                  x={note.x}
                  y={system.nameY}
                  fill={label}
                  fontSize={typography.metadataSmall.fontSize * scale}
                  fontFamily={fontFamily.sansRegular}
                  textAnchor="middle"
                >
                  {note.name}
                </SvgText>
              ) : null}
            </G>
          ))}

          {system.beams.map((beam, index) => (
            <Line
              key={`beam-${index}`}
              x1={beam.from}
              // Half a thickness in from the stem end, so the beam sits flush
              // with the tip rather than overhanging it.
              y1={beam.y + (beam.stemUp ? beamNode / 2 : -beamNode / 2)}
              x2={beam.to}
              y2={beam.y + (beam.stemUp ? beamNode / 2 : -beamNode / 2)}
              stroke={ink}
              strokeWidth={beamNode}
            />
          ))}
        </G>
      ))}
    </Svg>
  );
}

/**
 * A rest, drawn rather than set in type — the same reasoning as `Sharp`, and
 * the same risk `engrave.ts` names about clefs: a badly approximated glyph is
 * the first thing a musician notices and the last thing they forgive.
 *
 * **Two of these are exact and two are approximations, and the difference is
 * worth knowing.** A whole and a half rest genuinely *are* rectangles — the
 * only thing to get right is which line they touch, and they are opposites:
 * the whole hangs below the second line from the top, the half sits on the
 * middle line. Drawn the same way round, every bar of rest in the app would be
 * a beat wrong to anyone who reads music.
 *
 * The quarter and eighth are calligraphic figures rendered as strokes. They
 * read correctly at the size this draws them and they are not typeset music.
 * The alternative was to count them as undrawable and leave holes in the bar,
 * which for a part written in quarter rests is most of the bar.
 */
function Rest({
  x,
  y,
  value,
  ink,
  lineGap,
  stroke,
}: {
  x: number;
  y: number;
  value: NoteValue;
  ink: string;
  lineGap: number;
  stroke: number;
}) {
  const g = lineGap;
  if (value === 'whole' || value === 'half') {
    const w = g * REST_WIDTH_FACTOR;
    const h = g * REST_HEIGHT_FACTOR;
    return (
      <Rect
        x={x - w / 2}
        // Hanging below its line, or standing on it.
        y={value === 'whole' ? y : y - h}
        width={w}
        height={h}
        fill={ink}
      />
    );
  }

  if (value === 'quarter') {
    return (
      <G>
        <Path
          d={`M ${x - g * 0.38} ${y - g * 1.05} L ${x + g * 0.34} ${y - g * 0.34} L ${x - g * 0.2} ${y + g * 0.1} L ${x + g * 0.4} ${y + g * 0.78}`}
          fill="none"
          stroke={ink}
          strokeWidth={g * 0.26}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {/* The terminal curl. Without it the zigzag reads as a chevron — the
            first render of this looked like a "<" from across the room. */}
        <Path
          d={`M ${x + g * 0.4} ${y + g * 0.78} q ${-g * 0.5} ${-g * 0.18} ${-g * 0.34} ${g * 0.34}`}
          fill="none"
          stroke={ink}
          strokeWidth={g * 0.2}
          strokeLinecap="round"
        />
      </G>
    );
  }

  // An eighth rest: one slanted stroke, a filled hook at its head, and the
  // short bar that joins them.
  return (
    <G>
      <Path
        d={`M ${x + g * 0.36} ${y - g * 0.72} L ${x - g * 0.24} ${y + g * 0.95}`}
        fill="none"
        stroke={ink}
        strokeWidth={g * 0.17}
        strokeLinecap="round"
      />
      <Ellipse
        cx={x - g * 0.06}
        cy={y - g * 0.5}
        rx={g * 0.26}
        ry={g * 0.21}
        transform={`rotate(-18 ${x - g * 0.06} ${y - g * 0.5})`}
        fill={ink}
      />
      <Path
        d={`M ${x + g * 0.36} ${y - g * 0.72} L ${x + g * 0.1} ${y - g * 0.62}`}
        fill="none"
        stroke={ink}
        strokeWidth={g * 0.15}
        strokeLinecap="round"
      />
    </G>
  );
}

/**
 * A sharp, drawn rather than set in type.
 *
 * `♯` exists in Unicode but lands on the font stack, which on Android often
 * has no glyph for it — and a tofu box in the middle of a stave is worse than
 * no accidental at all. Four strokes: two uprights and two crossbars, the
 * crossbars slanted upwards the way they are cut in every music face.
 */
function Sharp({
  x,
  y,
  ink,
  lineGap,
  stroke,
}: {
  x: number;
  y: number;
  ink: string;
  lineGap: number;
  stroke: number;
}) {
  const w = lineGap * 0.34;
  const h = lineGap * 1.1;
  const slant = lineGap * 0.16;
  return (
    <G>
      <Line x1={x - w} y1={y - h} x2={x - w} y2={y + h * 0.75} stroke={ink} strokeWidth={stroke} />
      <Line x1={x + w} y1={y - h * 0.75} x2={x + w} y2={y + h} stroke={ink} strokeWidth={stroke} />
      <Line x1={x - w * 2} y1={y - slant * 0.4} x2={x + w * 2} y2={y - slant * 1.6} stroke={ink} strokeWidth={stroke * 1.5} />
      <Line x1={x - w * 2} y1={y + slant * 1.6} x2={x + w * 2} y2={y + slant * 0.4} stroke={ink} strokeWidth={stroke * 1.5} />
    </G>
  );
}
