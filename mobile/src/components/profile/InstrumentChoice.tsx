import { Pressable, StyleSheet, View } from 'react-native';

import {
  BORDER_WIDTH,
  colors,
  CONTROL_HEIGHT,
  radii,
  spacing,
} from '../../design';
import type { Instrument } from '../../data/types';
import { Text } from '../primitives/Text';

/**
 * Choosing one of the four instruments the app is written for.
 *
 * **Not a `SegmentedControl`,** whose own docstring reserves it for "two or
 * three mutually exclusive *views* of the same thing… where the point is
 * comparison". Four is past that, and these are not views: nothing is being
 * compared, an answer is being given. On a phone a four-way track leaves each
 * segment about eighty points wide, which is why the Profile screen's copy has
 * to say "Bass" — a name a bassist does not use for the instrument and which
 * `INSTRUMENT_OPTIONS` already apologises for in a comment.
 *
 * A two-by-two grid fixes both: the full name fits, and each target is a
 * comfortable tap rather than a quarter of a track.
 *
 * Structure comes from hairline borders and the selected cell's ink, not from
 * elevation or fill — §3 law 6. Ochre would be the obvious choice for the
 * selection and is wrong here: it is an accent for progress and favourites,
 * never a surface (§3 law 5).
 *
 * **The unselected cells sit on `surface`, not on the page.** A first pass
 * left them on the ivory ground with only a hairline, and the three-foot test
 * on the screenshot found them: the one answer that changes what the app does
 * was the faintest thing on the screen, weaker than a Continue button that
 * does nothing until it is answered. A control has to look like a control —
 * that is the same white-on-ivory the `Input` beside it already uses, so this
 * is the app's existing language for "you can act on this", not a new one.
 */

export interface InstrumentChoiceProps {
  value: Instrument | null;
  onChange: (instrument: Instrument) => void;
  /** Names the group for screen readers. */
  label: string;
}

/**
 * The full names, in the order a string section sits.
 *
 * Highest to lowest, which is the order a musician expects to see them in and
 * is not alphabetical by accident. "Double bass" in full: a bassist does not
 * call it "Bass", and this is the one control where the space exists to say so.
 */
const INSTRUMENTS: { value: Instrument; label: string }[] = [
  { value: 'violin', label: 'Violin' },
  { value: 'viola', label: 'Viola' },
  { value: 'cello', label: 'Cello' },
  { value: 'double_bass', label: 'Double bass' },
];

export function InstrumentChoice({ value, onChange, label }: InstrumentChoiceProps) {
  return (
    <View style={styles.grid} accessibilityRole="radiogroup" accessibilityLabel={label}>
      {INSTRUMENTS.map((instrument) => {
        const selected = value === instrument.value;
        return (
          <Pressable
            key={instrument.value}
            onPress={() => onChange(instrument.value)}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            accessibilityLabel={instrument.label}
            style={({ pressed }) => [
              styles.cell,
              selected && styles.selected,
              pressed && !selected && styles.pressed,
            ]}
          >
            <Text
              variant="button"
              color={selected ? 'actionText' : 'textPrimary'}
            >
              {instrument.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    // The gap is the only separation. Borders on adjacent cells would double
    // up into a two-pixel rule between them.
    gap: spacing.sm,
  },
  cell: {
    // Two per row, minus half the gap each. Not a fixed width: the same
    // control has to sit in a phone column and in Profile.
    flexBasis: '48%',
    flexGrow: 1,
    // The app's standard control height, not the bare minimum target: four of
    // these are the substance of the screen, and a 44pt row reads as a list
    // item rather than as an answer.
    minHeight: CONTROL_HEIGHT,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
    borderWidth: BORDER_WIDTH,
    borderColor: colors.border,
    borderRadius: radii.sm,
  },
  selected: {
    backgroundColor: colors.actionBg,
    borderColor: colors.actionBg,
  },
  pressed: {
    backgroundColor: colors.surfacePressed,
  },
});
