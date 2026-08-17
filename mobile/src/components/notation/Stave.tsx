import { View, StyleSheet } from 'react-native';
import Svg, { Ellipse, G, Line } from 'react-native-svg';

import { Text } from '../primitives/Text';
import type { Clef } from '../../data/types';
import { colors, spacing } from '../../design';
import { engrave, type StaveNote } from '../../lib/notation/engrave';

export interface StaveProps {
  notes: StaveNote[];
  clef: Clef;
  /**
   * Which ground it is drawn on.
   *
   * `dark` inverts the ink so the same engraving can sit on the warmup panel.
   * Not a theme — it is the one place in the app with a full-bleed dark
   * surface, and the `action*`/`onDark*` pair already exists for exactly that.
   */
  tone?: 'light' | 'dark';
  /** Cap the bars drawn, for a preview that only needs to suggest the shape. */
  maxNotes?: number;
}

const LINE_GAP = 9;
const NOTE_GAP = 30;
/** Noteheads are wider than they are tall, and tilted. */
const HEAD_RX = LINE_GAP * 0.62;
const HEAD_RY = LINE_GAP * 0.46;
const HEAD_TILT = -20;
const STROKE = 1.1;
/**
 * Staff lines are thinner than stems and lighter than noteheads, but they are
 * still ink. Drawn in the border colour they read as a divider rather than as
 * a staff, and the notes float in the middle of nothing.
 */
const STAFF_STROKE = 0.9;
const BEAM_THICKNESS = LINE_GAP * 0.55;

/**
 * A few bars of engraved notation.
 *
 * Draws what `engrave` laid out and nothing more. **No clef** — the reasoning
 * is in `engrave.ts`, and the note names printed underneath carry the
 * information a clef would.
 *
 * Ink on the page background rather than on a white card: this is notation, and
 * notation on a warm ground is what a study book looks like.
 */
export function Stave({ notes, clef, tone = 'light', maxNotes }: StaveProps) {
  const dark = tone === 'dark';
  const ink = dark ? colors.actionText : colors.textPrimary;
  const rule = dark ? colors.onDarkMuted : colors.textSecondary;

  // Truncated at a barline where possible, so a preview never ends mid-bar.
  const shown = maxNotes ? truncateAtBar(notes, maxNotes) : notes;
  const layout = engrave(shown, clef, { lineGap: LINE_GAP, noteGap: NOTE_GAP });

  return (
    <View>
      <Svg
        width={layout.width}
        height={layout.height}
        accessibilityRole="image"
        // The notes are named in the row below, which a screen reader can read
        // in order; describing the drawing as well would say it twice.
        accessible={false}
      >
        <G transform={`translate(0 ${layout.offsetY})`}>
        {layout.staffLines.map((y, index) => (
          <Line
            key={`staff-${index}`}
            x1={0}
            y1={y}
            x2={layout.width}
            y2={y}
            stroke={rule}
            strokeWidth={STAFF_STROKE}
          />
        ))}

        {layout.barlines.map((x, index) => (
          <Line
            key={`bar-${index}`}
            x1={x}
            y1={layout.staffLines[0]}
            x2={x}
            y2={layout.staffLines[4]}
            stroke={rule}
            strokeWidth={STAFF_STROKE * 1.2}
          />
        ))}

        {layout.notes.map((note, index) => (
          <G key={`note-${index}`}>
            {note.ledgers.map((y, ledger) => (
              <Line
                key={`ledger-${ledger}`}
                x1={note.x - HEAD_RX * 1.7}
                y1={y}
                x2={note.x + HEAD_RX * 1.7}
                y2={y}
                stroke={ink}
                strokeWidth={STROKE}
              />
            ))}

            {note.accidental === 'sharp' ? (
              <Sharp x={note.x - LINE_GAP * 1.55} y={note.y} ink={ink} />
            ) : null}

            {note.stem ? (
              <Line
                x1={note.stem.x}
                y1={note.stem.from}
                x2={note.stem.x}
                y2={note.stem.to}
                stroke={ink}
                strokeWidth={STROKE * 1.2}
              />
            ) : null}

            <Ellipse
              cx={note.x}
              cy={note.y}
              rx={HEAD_RX}
              ry={HEAD_RY}
              transform={`rotate(${HEAD_TILT} ${note.x} ${note.y})`}
              fill={note.filled ? ink : 'none'}
              stroke={ink}
              strokeWidth={note.filled ? 0 : STROKE * 1.3}
            />
          </G>
        ))}

        {layout.beams.map((beam, index) => (
          <Line
            key={`beam-${index}`}
            x1={beam.from}
            // Half a thickness in from the stem end, so the beam sits flush
            // with the tip rather than overhanging it.
            y1={beam.y + (beam.stemUp ? BEAM_THICKNESS / 2 : -BEAM_THICKNESS / 2)}
            x2={beam.to}
            y2={beam.y + (beam.stemUp ? BEAM_THICKNESS / 2 : -BEAM_THICKNESS / 2)}
            stroke={ink}
            strokeWidth={BEAM_THICKNESS}
          />
        ))}
        </G>
      </Svg>

      {/*
        Note names, aligned under their noteheads. This is what a study book
        does for a beginner and what stands in for the clef here.
      */}
      {/* One note-gap wider than the staff, or the last name is clipped. */}
      <View style={[styles.names, { width: layout.width + NOTE_GAP }]}>
        {layout.notes.map((note, index) => (
          <Text
            key={`name-${index}`}
            variant="metadataSmall"
            color={dark ? 'onDarkMuted' : 'textTertiary'}
            style={[styles.name, { left: note.x - NOTE_GAP / 2, width: NOTE_GAP }]}
          >
            {displayName(shown[index].pitch)}
          </Text>
        ))}
      </View>
    </View>
  );
}

/**
 * Cut a run of notes down, preferring to stop where a bar does.
 *
 * A preview that ends halfway through a bar reads as a rendering failure
 * rather than as an extract, so this drops back to the last barline inside the
 * limit — unless that would leave almost nothing, in which case a hard cut is
 * the lesser problem.
 */
function truncateAtBar(notes: StaveNote[], limit: number): StaveNote[] {
  if (notes.length <= limit) {
    return notes;
  }
  const head = notes.slice(0, limit);
  for (let i = head.length - 1; i > 0; i -= 1) {
    if (head[i].barBefore) {
      return i >= limit / 2 ? head.slice(0, i) : head;
    }
  }
  return head;
}

/** `F#4` reads as `F♯` — the octave is on the staff, and the sharp is a glyph. */
function displayName(pitch: string): string {
  return pitch.replace(/#/, '♯').replace(/\d+$/, '');
}

/**
 * A sharp, drawn rather than set in type.
 *
 * `♯` exists in Unicode but lands on the font stack, which on Android often
 * has no glyph for it — and a tofu box in the middle of a stave is worse than
 * no accidental at all. Four strokes: two uprights and two crossbars, the
 * crossbars slanted upwards the way they are cut in every music face.
 */
function Sharp({ x, y, ink }: { x: number; y: number; ink: string }) {
  const w = LINE_GAP * 0.34;
  const h = LINE_GAP * 1.1;
  const slant = LINE_GAP * 0.16;
  return (
    <G>
      <Line x1={x - w} y1={y - h} x2={x - w} y2={y + h * 0.75} stroke={ink} strokeWidth={STROKE} />
      <Line x1={x + w} y1={y - h * 0.75} x2={x + w} y2={y + h} stroke={ink} strokeWidth={STROKE} />
      <Line x1={x - w * 2} y1={y - slant * 0.4} x2={x + w * 2} y2={y - slant * 1.6} stroke={ink} strokeWidth={STROKE * 1.5} />
      <Line x1={x - w * 2} y1={y + slant * 1.6} x2={x + w * 2} y2={y + slant * 0.4} stroke={ink} strokeWidth={STROKE * 1.5} />
    </G>
  );
}

const styles = StyleSheet.create({
  names: {
    height: 18,
    marginTop: spacing.xs,
  },
  name: {
    position: 'absolute',
    textAlign: 'center',
  },
});
