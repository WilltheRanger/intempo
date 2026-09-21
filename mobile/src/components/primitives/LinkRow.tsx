import { ChevronRight } from '../icons';
import { StyleSheet, View } from 'react-native';

import { PressableScale } from '../motion';
import { Text } from './Text';
import {
  BORDER_WIDTH,
  colors,
  disabledOpacity,
  ICON_SIZE,
  ICON_STROKE_WIDTH,
  MIN_TOUCH_TARGET,
  spacing,
} from '../../design';
import { impact, ImpactFeedbackStyle } from '../../lib/haptics';
import { ROW_PADDING_VERTICAL } from '../rowMetrics';

export interface LinkRowProps {
  label: string;
  /** Current state, shown before the chevron — an address, a count. */
  value?: string;
  onPress: () => void;
  /** Hairline above the row. Omit on the first row in a group. */
  divided?: boolean;
  /**
   * Locked, for a setting that cannot be changed right now.
   *
   * The record panel's rows are written onto a take the moment it starts, so
   * they have a real locked state — the row greys, stops answering, and tells
   * a screen reader it is disabled rather than silently doing nothing.
   */
  disabled?: boolean;
  /** Announced after the label, for a row whose destination isn't obvious. */
  hint?: string;
}

/**
 * A settings row that opens something else.
 *
 * The chevron is the whole point: it separates rows that go somewhere from
 * rows that only report a value, which otherwise look identical.
 *
 * **A primitive, since 2026-09-20, and it was Profile's own.** The record
 * panel needed the same row and had been drawing three near-misses of it by
 * hand — one centred, one at half the vertical padding, one ruled and one not
 * — which is the drift `rowMetrics` was written to stop and could not, because
 * the rule was in a module while the row was copied. One component is the
 * enforcement the constant could not be.
 */
export function LinkRow({
  label,
  value,
  onPress,
  divided = true,
  disabled = false,
  hint,
}: LinkRowProps) {
  return (
    <PressableScale
      onPress={() => {
        // The same weight the tab bar and the primary button use. A settings
        // row that opens a sheet is a navigation, and a navigation that starts
        // with a tick under the finger reads as having been received.
        impact(ImpactFeedbackStyle.Light);
        onPress();
      }}
      disabled={disabled}
      activeScale={0.99}
      accessibilityRole="button"
      accessibilityLabel={value ? `${label}, ${value}` : label}
      accessibilityHint={hint}
      accessibilityState={{ disabled }}
      style={({ pressed }) => [
        styles.row,
        divided && styles.divided,
        pressed && !disabled && styles.pressed,
        disabled && styles.disabled,
      ]}
    >
      <Text variant="button" color={disabled ? 'textTertiary' : 'textPrimary'} style={styles.label}>
        {label}
      </Text>

      <View style={styles.trailing}>
        {value ? (
          <Text
            variant="metadata"
            color="textTertiary"
            numberOfLines={1}
            style={styles.value}
          >
            {value}
          </Text>
        ) : null}
        <ChevronRight
          size={ICON_SIZE.md}
          strokeWidth={ICON_STROKE_WIDTH}
          color={colors.textTertiary}
        />
      </View>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    minHeight: MIN_TOUCH_TARGET,
    paddingVertical: ROW_PADDING_VERTICAL,
  },
  divided: {
    borderTopWidth: BORDER_WIDTH,
    borderTopColor: colors.border,
  },
  pressed: {
    backgroundColor: colors.surfacePressed,
    opacity: 0.88,
  },
  disabled: {
    opacity: disabledOpacity,
  },
  label: {
    flexShrink: 0,
  },
  trailing: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    flexShrink: 1,
    /**
     * **`flexShrink` alone does not shrink it on the web build.** A flex item's
     * CSS `min-width` is `auto`, which is its content, so a long unbreakable
     * value — an email address — pushed the row past the screen edge with
     * `numberOfLines={1}` set and never truncating. Measured at 2x type:
     * "you@example.com" ran 11pt off a 390pt screen.
     *
     * React Native's own layout treats this as 0 already, so it is a no-op on
     * device and a fix in the one place these screens can be driven.
     */
    minWidth: 0,
  },
  value: {
    flexShrink: 1,
    minWidth: 0,
  },
});
