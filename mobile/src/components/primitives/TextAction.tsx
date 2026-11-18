import { Pressable, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';

import { MIN_TOUCH_TARGET } from '../../design';
import { Text } from './Text';

export interface TextActionProps {
  label: string;
  onPress: () => void;
  /**
   * `regular` under a button and beside body text; `small` in a dense row and
   * beside a field's label.
   */
  size?: 'regular' | 'small';
  /** Where the word sits in its column. Under a button it is centred. */
  align?: 'center' | 'start' | 'end';
  /** Read out instead of the word, where the word alone does not say what it changes. */
  accessibilityLabel?: string;
  disabled?: boolean;
  /** Margins from the caller: the space around a control is its parent's. */
  style?: StyleProp<ViewStyle>;
}

/**
 * A tappable word: "Record again", "From the start", "Change", "Sign in
 * instead".
 *
 * **One look for all of them** (the UI review, 2026-11-12). Tappable words
 * were gold on the sign-in screen and the bar editor, grey under the result's
 * button and the piece's, and ink on the Library's failed tile. A grey word
 * could be a caption or a control, and "Hear bar 1" on the tempo screen was a
 * caption that read as a control. Now gold (`accentText`) means a word can be
 * tapped, and grey means it is information.
 *
 * It stays the quieter way on, the job the grey was doing: a 14pt word under
 * the ink of the primary button is still the second thing on the screen.
 * Padded to a full touch target with layout rather than `hitSlop`, which does
 * nothing on the web build, and dimmed under the finger so the tap answers
 * before whatever it opens arrives.
 */
export function TextAction({
  label,
  onPress,
  size = 'regular',
  align = 'center',
  accessibilityLabel,
  disabled = false,
  style,
}: TextActionProps) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled }}
      style={({ pressed }) => [
        styles.target,
        ALIGN[align],
        pressed && !disabled && styles.pressed,
        style,
      ]}
    >
      <Text
        variant={size === 'small' ? 'metadataSmall' : 'metadata'}
        color={disabled ? 'textTertiary' : 'accentText'}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // No horizontal padding: a word is wider than the 44pt floor almost always,
  // so its own edge is the target's and lines up with the text around it. A
  // shorter one ("Show") is centred in the floor's width.
  target: {
    minHeight: MIN_TOUCH_TARGET,
    minWidth: MIN_TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // The dim every one of these already used under the finger. `pressedOpacity`
  // is for a surface that also scales; a word does not, so it dims further.
  pressed: {
    opacity: 0.55,
  },
});

/** Where the target sits in a column; in a row, how it centres on the line. */
const ALIGN = StyleSheet.create({
  center: { alignSelf: 'center' },
  start: { alignSelf: 'flex-start' },
  end: { alignSelf: 'flex-end' },
});
