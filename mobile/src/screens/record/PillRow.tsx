import { Pressable, StyleSheet, View } from 'react-native';

import { ChevronDown, ChevronRight } from '../../components/icons';
import { Text } from '../../components/primitives';
import { BORDER_WIDTH, colors, fontFamily, ICON_STROKE_WIDTH } from '../../design';

/**
 * A setting on the Record panel: label on the left, its value in a pill on the
 * right (`redesign/RecordReady.dc.html` — Tempo, Start at, Metronome).
 *
 * **The whole row is the control; the pill is what it looks like.** The
 * prototype's pill is 36pt tall, under the 44pt floor `audit-a11y.mjs` holds
 * every control to, and a thumb aiming at the right edge of a 48pt row should
 * not have to find a smaller target inside it. The pill still answers the
 * press, so the tap reads where it was drawn.
 *
 * The chevron says what happens: `right` goes to another screen (Tempo),
 * `down` opens a sheet here (Start at, Metronome) — CLAUDE.md §3, a drawn
 * affordance must do the thing it depicts.
 */
export function PillRow({
  label,
  sub,
  value,
  chevron,
  onPress,
  accessibilityLabel,
  last = false,
}: {
  label: string;
  /** A line under the label, for what the pill alone does not say. */
  sub?: string;
  value: string;
  chevron: 'right' | 'down';
  onPress: () => void;
  accessibilityLabel: string;
  /** Rule the bottom edge too: the last row closes the list. */
  last?: boolean;
}) {
  const Chevron = chevron === 'right' ? ChevronRight : ChevronDown;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={[styles.row, last && styles.last]}
    >
      {({ pressed }) => (
        <>
          <View style={styles.label}>
            <Text variant="metadata">{label}</Text>
            {sub ? (
              <Text variant="caption" color="textTertiary" style={styles.sub}>
                {sub}
              </Text>
            ) : null}
          </View>
          <View style={[styles.pill, chevron === 'right' && styles.pillForward, pressed && styles.pressed]}>
            <Text variant="metadata" style={styles.value}>
              {value}
            </Text>
            <Chevron size={15} strokeWidth={ICON_STROKE_WIDTH} color={colors.textTertiary} />
          </View>
        </>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 48,
    borderTopWidth: BORDER_WIDTH,
    borderTopColor: colors.border,
  },
  last: {
    borderBottomWidth: BORDER_WIDTH,
    borderBottomColor: colors.border,
  },
  label: {
    flex: 1,
    minWidth: 0,
  },
  sub: {
    marginTop: 2,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    height: 36,
    paddingHorizontal: 14,
    borderRadius: 18,
    borderWidth: BORDER_WIDTH,
    borderColor: colors.borderStrong,
  },
  // A forward chevron sits closer to the edge, as the prototype draws it.
  pillForward: {
    paddingRight: 12,
  },
  pressed: {
    backgroundColor: colors.surfacePressed,
  },
  value: {
    fontFamily: fontFamily.sansMedium,
    fontVariant: ['tabular-nums'],
  },
});
