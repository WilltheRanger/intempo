import { useState } from 'react';
import { Pressable, StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import Svg, { Circle, G, Line, Rect } from 'react-native-svg';

import { BORDER_WIDTH, colors, fontFamily, spacing } from '../../design';
import type { PitchBand } from '../../lib/verdict/intonation';
import {
  NOTE_COLUMN_MIN,
  fitNoteMarks,
  noteDetail,
  otherNotesLine,
  type NoteMark,
} from '../../lib/verdict/pitchByNote';
import { Text } from '../primitives/Text';
import { useDrawIn } from './useDrawIn';

/** The words at the right edge: "sharp", "in tune", "flat". */
const GUTTER = 48;
/** How far up and down the row reaches, in cents; further is drawn at the edge. */
const REACH = 40;
const STEM = 3;
const DOT = 5;
const LABELS = 22;

export interface NoteRowProps {
  marks: readonly NoteMark[];
  /** The band drawn behind the row: the take's in-tune width. */
  inTuneCents: number;
  /** Notes set in the heavier weight — the ones the line above names. */
  named?: readonly number[];
  height?: number;
  /** The tapped note, by MIDI number. */
  selected?: number | null;
  /** When given, each note answers a tap: tapping it again lets it go. */
  onSelect?: (midi: number | null) => void;
  /** How the line under a row too narrow for every note speaks: one take, or a habit. */
  tense?: 'take' | 'habit';
  /**
   * A line of the caller's under the row — Insights' "Flat in all 7 takes" —
   * set before the row's own, so the evidence for the sentence above comes
   * first and one line holds both.
   */
  caption?: string | null;
}

/**
 * Which written notes ran sharp or flat: one per column, low to high, a stem
 * from the player's own tuning up or down to where the note sat, over the
 * in-tune band the pitch graph above it draws (the owner, 2026-09-30).
 *
 * It reads as a row of tuner needles. The same colours as the trend line —
 * green in the band, amber past it, deep red further — from the same tokens,
 * so the two graphs are one language.
 *
 * **On the result every note answers the finger** (`onSelect`): tapped, it
 * takes the cursor the pitch graph uses and the screen marks its bars. On
 * Insights it is a picture, and is announced as one.
 *
 * **As many notes as fit** (the owner, 2026-09-30, "Fit to the width"): a
 * column is never narrower than `NOTE_COLUMN_MIN`, the notes off pitch are
 * the ones kept, and a line under the row says what the rest were
 * (`fitNoteMarks`).
 */
export function NoteRow({
  marks: allMarks,
  inTuneCents,
  named = [],
  height = 92,
  selected = null,
  onSelect,
  tense = 'take',
  caption = null,
}: NoteRowProps) {
  const [width, setWidth] = useState(0);
  // The dots rise from the in-tune line to where they sit, on each visit.
  const drawn = useDrawIn();
  const area = Math.max(0, width - GUTTER);
  // Until it is measured the row holds every note; after, as many as fit —
  // keeping the tapped one, so a narrower window never hides what the line
  // above is describing.
  const fitted = fitNoteMarks(
    allMarks,
    width > 0 ? Math.floor(area / NOTE_COLUMN_MIN) : allMarks.length,
    selected === null ? named : [selected, ...named],
  );
  const marks = fitted.shown;
  const footer = [caption, otherNotesLine(fitted, tense)].filter(Boolean).join('. ');
  const column = marks.length > 0 ? area / marks.length : 0;
  const x = (index: number) => (index + 0.5) * column;
  const y = (cents: number) =>
    ((REACH - Math.max(-REACH, Math.min(REACH, cents))) / (2 * REACH)) * height;

  function handleLayout(event: LayoutChangeEvent) {
    const next = event.nativeEvent.layout.width;
    setWidth((current) => (current === next ? current : next));
  }

  return (
    <View
      onLayout={handleLayout}
      accessible={!onSelect}
      accessibilityRole={onSelect ? undefined : 'image'}
      accessibilityLabel={
        onSelect ? undefined : [...marks.map(noteDetail), ...(footer ? [footer] : [])].join('. ')
      }
    >
      <View style={{ height }}>
        {width > 0 ? (
          <Svg width={width} height={height} pointerEvents="none">
            <Rect
              x={0}
              y={y(inTuneCents)}
              width={area}
              height={y(-inTuneCents) - y(inTuneCents)}
              fill={colors.border}
              opacity={0.55}
            />
            <Line
              x1={0}
              x2={area}
              y1={y(0)}
              y2={y(0)}
              stroke={colors.chartRule}
              strokeWidth={BORDER_WIDTH}
              opacity={0.7}
            />
            {marks.map((mark, index) => {
              const colour = bandColour(mark.band);
              const on = mark.midi === selected;
              return (
                <G key={mark.midi}>
                  {on ? (
                    <Line
                      x1={x(index)}
                      x2={x(index)}
                      y1={0}
                      y2={height}
                      stroke={colors.chartRule}
                      strokeWidth={BORDER_WIDTH}
                    />
                  ) : null}
                  <Line
                    x1={x(index)}
                    x2={x(index)}
                    y1={y(0)}
                    y2={y(mark.cents * drawn)}
                    stroke={colour}
                    strokeWidth={STEM}
                    strokeLinecap="round"
                  />
                  <Circle
                    cx={x(index)}
                    cy={y(mark.cents * drawn)}
                    r={on ? DOT + 1.5 : DOT}
                    fill={colour}
                    stroke={on ? colors.bg : undefined}
                    strokeWidth={on ? 2 : 0}
                  />
                </G>
              );
            })}
          </Svg>
        ) : null}
        <Text variant="caption" color="textTertiary" style={[styles.end, styles.endUp]} pointerEvents="none">
          sharp
        </Text>
        <Text
          variant="caption"
          color="textSecondary"
          style={[styles.end, { top: y(0) - 9 }]}
          pointerEvents="none"
        >
          in tune
        </Text>
        <Text variant="caption" color="textTertiary" style={[styles.end, styles.endDown]} pointerEvents="none">
          flat
        </Text>
      </View>

      <View style={[styles.labels, { width: area }]} pointerEvents="none">
        {marks.map((mark) => {
          const strong = mark.midi === selected || named.includes(mark.midi);
          return (
            <Text
              key={mark.midi}
              variant="caption"
              color={strong ? 'textPrimary' : 'textTertiary'}
              style={[styles.label, strong && styles.labelStrong]}
            >
              {mark.name}
            </Text>
          );
        })}
      </View>

      {footer ? (
        <Text variant="caption" color="textTertiary" style={styles.footer}>
          {footer}
        </Text>
      ) : null}

      {onSelect && width > 0 ? (
        <View style={[styles.targets, { width: area, height: height + LABELS }]}>
          {marks.map((mark) => {
            const on = mark.midi === selected;
            return (
              <Pressable
                key={mark.midi}
                onPress={() => onSelect(on ? null : mark.midi)}
                accessibilityRole="button"
                accessibilityLabel={noteDetail(mark)}
                accessibilityHint={on ? 'Shows every bar again' : 'Marks the bars it is in'}
                accessibilityState={{ selected: on }}
                // react-native-web emits no state from `accessibilityState`
                // (`ariaState.test.ts`); a note that toggles is a pressed button.
                aria-pressed={on}
                style={({ pressed }) => [styles.target, pressed && styles.pressed]}
              />
            );
          })}
        </View>
      ) : null}
    </View>
  );
}

/** The trend line's colours for the pitch bands (`TrendPlot`). */
function bandColour(band: PitchBand): string {
  if (band === 'off') return colors.trendBad;
  if (band === 'slight') return colors.trendMid;
  return colors.trendOn;
}

const styles = StyleSheet.create({
  end: {
    position: 'absolute',
    right: 0,
    textAlign: 'right',
  },
  endUp: {
    top: -2,
  },
  endDown: {
    bottom: -2,
  },
  labels: {
    flexDirection: 'row',
    height: LABELS,
    alignItems: 'flex-end',
  },
  label: {
    flex: 1,
    textAlign: 'center',
  },
  labelStrong: {
    fontFamily: fontFamily.sansMedium,
  },
  footer: {
    marginTop: spacing.sm,
  },
  // Each note's column, the full height of the row and its name — not the
  // footer under them, which is words, not a note.
  targets: {
    position: 'absolute',
    top: 0,
    left: 0,
    flexDirection: 'row',
  },
  target: {
    flex: 1,
  },
  pressed: {
    backgroundColor: colors.surfacePressed,
  },
});
