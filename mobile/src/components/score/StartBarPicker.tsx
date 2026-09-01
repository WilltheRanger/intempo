import { Minus, Plus } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import type { Clef, ScoreJson } from '../../data/types';
import { ICON_SIZE, ICON_STROKE_WIDTH, MIN_TOUCH_TARGET, colors, spacing } from '../../design';
import { staveScoreFor } from '../../lib/notation/fromScore';
import { keySignatureFor, timeSignatureDigits } from '../../lib/notation/keySignature';
import { canStepBar, stepBar } from '../../lib/score/stepBar';
import { Stave } from '../notation/Stave';
import { Text } from '../primitives/Text';

export interface StartBarPickerProps {
  score: ScoreJson;
  /** Bars that actually sound, in playing order — `startableMeasures`. */
  bars: number[];
  value: number;
  onChange: (measureNumber: number) => void;
}

/**
 * Where the noteheads go while nothing has read a clef. The one named
 * assumption, the same one `PieceScoreScreen` makes and for the same reason:
 * the stave must place notes somewhere, and this is the placement — not a
 * claim about what the page says.
 */
const UNREAD_CLEF_PLACEMENT: Clef = 'treble';

/** Same size as the score screen's stave, so a bar looks like the same bar. */
const STAVE_SCALE = 1.25;

/**
 * Pick the bar a take starts on, by looking at the music.
 *
 * **This replaced a list of bar numbers.** "Bar 1, Bar 2 … Bar 74" in a
 * scrolling sheet asked a musician to find a place in a piece the way a
 * spreadsheet would, and the owner said so. A musician knows where they want
 * to start because they can see it: the run after the double bar, the entry
 * after the long rest. So the picker is the stave — every bar that sounds is
 * a tap target, and the chosen one carries the same wash the playhead does,
 * because "you are here" is what both of them mean.
 *
 * The stepper underneath is for precision, not discovery. A bar of sixteenths
 * on a phone is narrow, and a thumb that lands on the neighbour should be one
 * tap from the right one rather than another aim. It walks the list of bars
 * that sound rather than adding one, so it can never land on a bar of rest.
 *
 * The score is engraved at the score screen's own scale and fitted to the
 * sheet, so a bar here looks like the same bar there.
 */
export function StartBarPicker({ score, bars, value, onChange }: StartBarPickerProps) {
  const [width, setWidth] = useState<number | null>(null);
  const stave = useMemo(() => staveScoreFor(score), [score]);
  const clef = score.clef ?? UNREAD_CLEF_PLACEMENT;

  const back = canStepBar(bars, value, -1);
  const forward = canStepBar(bars, value, 1);

  return (
    <View>
      <ScrollView
        style={styles.music}
        // The sheet already scrolls the page; this scrolls the music inside it
        // so a long piece does not push the stepper off the bottom.
        nestedScrollEnabled
      >
        <View onLayout={(event) => setWidth(event.nativeEvent.layout.width)}>
          {width && stave ? (
            <Stave
              notes={stave.items}
              clef={clef}
              maxWidth={width}
              fitWidth={width}
              scale={STAVE_SCALE}
              justify
              beatQuarters={stave.beatQuarters}
              closesWithRepeat={stave.closesWithRepeat}
              endings={stave.endings}
              head={{
                clef: score.clef ?? null,
                key: keySignatureFor(score.key_signature, clef),
                time: timeSignatureDigits(score.time_signature),
              }}
              showNoteNames={false}
              highlightMeasure={value}
              onMeasurePress={onChange}
              pressableMeasures={bars}
            />
          ) : null}
        </View>
      </ScrollView>

      <View style={styles.stepper}>
        <Pressable
          onPress={() => onChange(stepBar(bars, value, -1))}
          disabled={!back}
          accessibilityRole="button"
          accessibilityLabel="Previous bar"
          accessibilityState={{ disabled: !back }}
          style={({ pressed }) => [styles.step, pressed && styles.pressed]}
        >
          <Minus
            size={ICON_SIZE.sm}
            strokeWidth={ICON_STROKE_WIDTH}
            color={back ? colors.textPrimary : colors.textTertiary}
          />
        </Pressable>

        <View style={styles.readout} accessibilityLiveRegion="polite">
          <Text variant="metadataSmall" color="textTertiary">
            Start at
          </Text>
          <Text variant="pieceTitle">Bar {value}</Text>
        </View>

        <Pressable
          onPress={() => onChange(stepBar(bars, value, 1))}
          disabled={!forward}
          accessibilityRole="button"
          accessibilityLabel="Next bar"
          accessibilityState={{ disabled: !forward }}
          style={({ pressed }) => [styles.step, pressed && styles.pressed]}
        >
          <Plus
            size={ICON_SIZE.sm}
            strokeWidth={ICON_STROKE_WIDTH}
            color={forward ? colors.textPrimary : colors.textTertiary}
          />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  music: {
    // Enough for three or four systems before it scrolls; the whole phone
    // would put the stepper, which is the precise control, out of reach.
    maxHeight: 300,
    marginHorizontal: -spacing.md,
    paddingHorizontal: spacing.md,
  },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.lg,
    paddingTop: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  step: {
    width: MIN_TOUCH_TARGET,
    height: MIN_TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
  },
  readout: {
    alignItems: 'center',
    gap: 2,
  },
  pressed: {
    opacity: 0.6,
  },
});
