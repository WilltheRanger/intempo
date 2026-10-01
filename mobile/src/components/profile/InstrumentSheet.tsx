import { Pressable, StyleSheet, View } from 'react-native';

import { Check } from '../icons';
import { BottomSheet } from '../overlays/BottomSheet';
import { Text } from '../primitives/Text';
import { BORDER_WIDTH, colors, ICON_SIZE, spacing } from '../../design';
import type { Instrument } from '../../data/types';
import { impact, ImpactFeedbackStyle } from '../../lib/haptics';
import { INSTRUMENT_GROUPS } from '../../lib/instrumentGroups';
import { INSTRUMENT_LABELS } from '../../lib/warmup';

export interface InstrumentSheetProps {
  visible: boolean;
  value: Instrument;
  onChange: (instrument: Instrument) => void;
  onClose: () => void;
}

/**
 * "Instrument": every instrument the app can listen to, under Strings and Winds
 * (`InstrumentSheet.dc.html`, the owner's go-ahead of 2026-10-01).
 *
 * **It replaced a four-way switch on Profile**, which could not take a fifth
 * and sixth: four segments across a phone already had to call a double bass
 * "Bass". A list has room for the full name of everything, and grows a row at
 * a time rather than a column. The tick marks the current one, as "Start from"
 * does; choosing closes the sheet, because the choice is the whole task.
 */
export function InstrumentSheet({ visible, value, onChange, onClose }: InstrumentSheetProps) {
  return (
    <BottomSheet visible={visible} onClose={onClose} title="Instrument">
      {INSTRUMENT_GROUPS.map((group, groupIndex) => (
        <View
          key={group.label}
          accessibilityRole="radiogroup"
          accessibilityLabel={group.label}
          style={groupIndex > 0 && styles.laterGroup}
        >
          <Text variant="sectionLabel" color="textTertiary" style={styles.heading}>
            {group.label}
          </Text>
          {group.instruments.map((instrument, index) => {
            const on = instrument === value;
            return (
              <Pressable
                key={instrument}
                onPress={() => {
                  impact(ImpactFeedbackStyle.Light);
                  onChange(instrument);
                  onClose();
                }}
                accessibilityRole="radio"
                // A radio announces itself with `aria-checked`; the native
                // prop does not produce it. See `ariaState.test.ts`.
                aria-checked={on}
                accessibilityState={{ checked: on }}
                accessibilityLabel={INSTRUMENT_LABELS[instrument]}
                style={({ pressed }) => [
                  styles.option,
                  index > 0 && styles.divided,
                  pressed && styles.pressed,
                ]}
              >
                <Text variant="body" style={styles.label}>
                  {INSTRUMENT_LABELS[instrument]}
                </Text>
                {on ? <Check size={ICON_SIZE.md} strokeWidth={2} color={colors.accent} /> : null}
              </Pressable>
            );
          })}
        </View>
      ))}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  laterGroup: {
    marginTop: spacing.xl,
  },
  heading: {
    marginBottom: spacing.xs,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: 52,
  },
  divided: {
    borderTopWidth: BORDER_WIDTH,
    borderTopColor: colors.border,
  },
  pressed: {
    opacity: 0.6,
  },
  label: {
    flex: 1,
    minWidth: 0,
  },
});
