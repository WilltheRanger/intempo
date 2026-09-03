import { Pressable, StyleSheet } from 'react-native';

import { MIN_TOUCH_TARGET } from '../../design';
import { Text } from './Text';

export interface RevealPasswordActionProps {
  revealed: boolean;
  onPress: () => void;
}

/**
 * The Show/Hide control beside a password field.
 *
 * **One copy, because there were three screens and only two had it.** The
 * sign-in screen and the change-password screen each carried their own; the
 * *set-password* screen — where someone who has just followed a reset link
 * types a brand-new password twice on a phone keyboard, with no way to check
 * either — had none. That is the screen it helps most and it was the one
 * without it.
 *
 * Where a screen has two new-password fields it belongs on the first and
 * governs both: one tap reveals the pair, because the second field exists to
 * catch a typo in the first and hiding one while showing the other would be a
 * strange thing to offer.
 */
export function RevealPasswordAction({
  revealed,
  onPress,
}: RevealPasswordActionProps) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={revealed ? 'Hide password' : 'Show password'}
      style={({ pressed }) => [styles.target, pressed && styles.pressed]}
    >
      <Text variant="sectionAction" color="textPrimary">
        {revealed ? 'Hide' : 'Show'}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  /**
   * Padded to a real touch target, not `hitSlop`-ed to one.
   *
   * `hitSlop` does nothing on the web build — measured in Chromium on this very
   * control: a click 8pt above it, inside its 12pt slop, did not activate it
   * while a click on its visible 18pt box did.
   */
  target: {
    minHeight: MIN_TOUCH_TARGET,
    // **Both dimensions, and only one of them was set.** The height was padded
    // to the floor and the width was left at whatever the word measures —
    // 35pt for "Show", on a control that only appears on the two screens a
    // fixtures build cannot reach, so nothing had looked at it. The box grows
    // leftward into the gap beside the label; the word does not move enough to
    // see (4.5pt) and the target reaches 44.
    minWidth: MIN_TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: {
    opacity: 0.6,
  },
});
