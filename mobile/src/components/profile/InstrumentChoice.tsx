import { Pressable, StyleSheet, View } from 'react-native';

import { BORDER_WIDTH, colors, spacing } from '../../design';
import type { Instrument } from '../../data/types';
import { INSTRUMENT_GROUPS } from '../../lib/instrumentGroups';
import { INSTRUMENT_LABELS } from '../../lib/warmup';
import { Text } from '../primitives/Text';

/**
 * Choosing the instrument the app listens for, during onboarding.
 *
 * **Not a `SegmentedControl`,** whose own docstring reserves it for "two or
 * three mutually exclusive *views* of the same thing… where the point is
 * comparison". These are not views: nothing is being compared, an answer is
 * being given. A grid of cells two across lets the full name fit and makes
 * each target a comfortable tap rather than a slice of a track — which is also
 * why Profile stopped using a switch for this (`InstrumentSheet`).
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
 * **Grouped, from the one list** (`lib/instrumentGroups.ts`): the four strings
 * as the two-by-two grid they always were, and the saxophones (2026-10-01) as
 * a row of their own under "Winds". Profile offers the same list in a sheet.
 * Full names everywhere — "Double bass", "Tenor saxophone" — because a cell
 * has the room.
 */
export function InstrumentChoice({ value, onChange, label }: InstrumentChoiceProps) {
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={label}>
      {INSTRUMENT_GROUPS.map((group, groupIndex) => (
        <View key={group.label} style={groupIndex > 0 && styles.laterGroup}>
          <Text variant="sectionLabel" color="textTertiary" style={styles.heading}>
            {group.label}
          </Text>
          <View style={styles.grid}>
            {group.instruments.map((instrument) => (
              <Cell
                key={instrument}
                instrument={instrument}
                selected={value === instrument}
                onPress={() => onChange(instrument)}
              />
            ))}
          </View>
        </View>
      ))}
    </View>
  );
}

function Cell({
  instrument,
  selected,
  onPress,
}: {
  instrument: Instrument;
  selected: boolean;
  onPress: () => void;
}) {
  const name = INSTRUMENT_LABELS[instrument];
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      // A radio announces itself with `aria-checked`; the native prop
      // does not produce it. See `ariaState.test.ts`.
      aria-checked={selected}
      accessibilityState={{ selected }}
      accessibilityLabel={name}
      style={({ pressed }) => [
        styles.cell,
        selected && styles.selected,
        pressed && !selected && styles.pressed,
      ]}
    >
      <Text
        variant="pieceTitle"
        color={selected ? 'actionText' : 'textPrimary'}
      >
        {name}
      </Text>
    </Pressable>
  );
}

const CELL_HEIGHT = 80;
const CELL_RADIUS = 14;

const styles = StyleSheet.create({
  laterGroup: {
    marginTop: spacing.xl,
  },
  heading: {
    marginBottom: spacing.sm,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    // The gap is the only separation. Borders on adjacent cells would double
    // up into a two-pixel rule between them.
    gap: 10,
  },
  cell: {
    // Two per row, minus half the gap each. Not a fixed width: the same
    // control has to sit in a phone column and in Profile.
    flexBasis: '48%',
    flexGrow: 1,
    // The redesign's 80 (`redesign/OnboardInstrument.dc.html`): four of these
    // are the whole of the screen, and at the standard control height they
    // read as a list of buttons rather than as the answer being asked for.
    minHeight: CELL_HEIGHT,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
    borderWidth: BORDER_WIDTH,
    borderColor: colors.border,
    borderRadius: CELL_RADIUS,
  },
  selected: {
    backgroundColor: colors.actionBg,
    borderColor: colors.actionBg,
  },
  pressed: {
    backgroundColor: colors.surfacePressed,
  },
});
