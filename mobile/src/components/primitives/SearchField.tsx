import { Search, X } from '../icons';
import { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Platform,
  Pressable,
  StyleSheet,
  TextInput,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import {
  BORDER_WIDTH,
  colors,
  ICON_SIZE,
  ICON_STROKE_WIDTH,
  MIN_TOUCH_TARGET,
  pressedOpacity,
  radii,
  spacing,
  typography,
  EASE_OUT,
  motion,
} from '../../design';
import { useReducedMotion } from '../../lib/useReducedMotion';

/**
 * react-native-web renders TextInput as a DOM input, which draws the browser's
 * own focus ring inside our container. The container carries the focus
 * treatment, so suppress the inner one. No-op on native, where TextInput draws
 * no outline of its own.
 */
const NO_INNER_OUTLINE = Platform.select({
  web: { outlineStyle: 'none', outlineWidth: 0 },
  default: {},
}) as TextStyle;

export interface SearchFieldProps {
  value: string;
  onChangeText: (value: string) => void;
  placeholder?: string;
  style?: StyleProp<ViewStyle>;
  /**
   * Take the keyboard as soon as this mounts.
   *
   * For a field that appears because somebody asked for it. Library's search
   * lives behind a magnifier, and a field that arrives without the caret makes
   * the tap cost two: one to reveal, one to focus. `CLAUDE.md` §3 — a tap gets
   * an immediate response, and revealing an input the user then has to go and
   * poke is not one.
   */
  autoFocus?: boolean;
}

/**
 * Search input. Same surface, border, and radius as a card, so it belongs to
 * the same family rather than reading as a control bolted on top.
 *
 * Focus is tracked in state because React Native has no `:focus` — the border
 * darkens rather than gaining a ring, which would mean a shadow.
 */
export function SearchField({
  value,
  onChangeText,
  placeholder = 'Search',
  style,
  autoFocus = false,
}: SearchFieldProps) {
  const [focused, setFocused] = useState(false);
  const reduceMotion = useReducedMotion();

  /**
   * Focus, as a number, so the border can travel between the two colours.
   *
   * It was a boolean driving a style swap, so the edge of the field changed
   * colour between one frame and the next. On the one control whose job is to
   * answer a tap, that reads as a jolt rather than as an answer.
   *
   * `useNativeDriver` cannot be true here: a colour is neither a transform nor
   * an opacity, so it interpolates on the JavaScript thread. Acceptable for a
   * short run on a single edge, and the reason this is the only colour in the
   * app that animates rather than swapping.
   */
  const focus = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (reduceMotion) {
      focus.setValue(focused ? 1 : 0);
      return;
    }
    Animated.timing(focus, {
      toValue: focused ? 1 : 0,
      duration: motion.fast,
      easing: EASE_OUT,
      useNativeDriver: false,
    }).start();
  }, [focused, focus, reduceMotion]);

  /**
   * The clear button's presence, and **why it now stays mounted.**
   *
   * It rendered only when there was text, so it appeared and vanished between
   * frames — and its arrival took width from the input, so the text being
   * typed shifted left under the caret on the first character. Keeping it
   * mounted at zero opacity holds the layout still and lets it fade.
   *
   * Hidden from touch and from the screen reader while invisible: a control
   * that cannot be seen but can still be selected, and does nothing when it
   * is, is worse than one that is not there.
   */
  const hasText = value.length > 0;
  const clear = useRef(new Animated.Value(hasText ? 1 : 0)).current;
  useEffect(() => {
    if (reduceMotion) {
      clear.setValue(hasText ? 1 : 0);
      return;
    }
    Animated.timing(clear, {
      toValue: hasText ? 1 : 0,
      duration: motion.fast,
      easing: EASE_OUT,
      useNativeDriver: true,
    }).start();
  }, [hasText, clear, reduceMotion]);

  return (
    <Animated.View
      style={[
        styles.field,
        {
          // The whole container takes the accent on focus: the one place the
          // gold marks state rather than an action. It is interpolated here
          // rather than swapped by a `focused` style, which is what this
          // replaced.
          borderColor: focus.interpolate({
            inputRange: [0, 1],
            outputRange: [colors.border, colors.accent],
          }),
        },
        style,
      ]}
    >
      <Search
        size={ICON_SIZE.md}
        strokeWidth={ICON_STROKE_WIDTH}
        color={colors.textTertiary}
      />

      <TextInput
        value={value}
        onChangeText={onChangeText}
        autoFocus={autoFocus}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        placeholder={placeholder}
        placeholderTextColor={colors.textTertiary}
        // Android draws its own underline under TextInput; the container's
        // border is the only edge this field should have.
        underlineColorAndroid="transparent"
        style={[styles.input, NO_INNER_OUTLINE]}
        autoCorrect={false}
        autoCapitalize="none"
        returnKeyType="search"
        clearButtonMode="never"
        accessibilityLabel={placeholder}
      />

      <Animated.View
        pointerEvents={hasText ? 'auto' : 'none'}
        accessibilityElementsHidden={!hasText}
        importantForAccessibility={hasText ? 'auto' : 'no-hide-descendants'}
        style={{
          opacity: clear,
          // A small rise out of nothing rather than a plain fade: it is
          // arriving, and the scale is what says so in the time available.
          transform: [
            { scale: clear.interpolate({ inputRange: [0, 1], outputRange: [0.8, 1] }) },
          ],
        }}
      >
        <Pressable
          onPress={() => onChangeText('')}
          accessibilityRole="button"
          accessibilityLabel="Clear search"
          style={({ pressed }) => [styles.target, pressed && styles.pressed]}
        >
          <X
            size={ICON_SIZE.md}
            strokeWidth={ICON_STROKE_WIDTH}
            color={colors.textTertiary}
          />
        </Pressable>
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  /*
    Every tappable thing on this screen acknowledges the touch. These were bare
    `Pressable`s with a static style, so a tap produced no response at all until
    whatever it triggered appeared — which on a slow action reads as the control
    being dead. `PressableScale` is for the large targets; the app's answer for
    small ones is a colour or opacity change, and these had neither.
  */
  pressed: {
    opacity: pressedOpacity,
  },
  /**
   * Padded to a real touch target, not `hitSlop`-ed to one.
   *
   * **`hitSlop` does nothing on the web build.** Measured in Chromium: a click
   * 8pt above this control — well inside a 12pt slop — did not activate it,
   * while a click on the visible 18pt box did. `PlaybackSettings` reached the
   * same conclusion from the other direction: "a hit area nothing can see is a
   * hit area nothing checks."
   */
  target: {
    minHeight: MIN_TOUCH_TARGET,
    justifyContent: 'center',
  },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    // Shorter than a button — a field this size still taps comfortably, and
    // it sits at the minimum target rather than below it.
    height: MIN_TOUCH_TARGET,
    paddingHorizontal: spacing.lg,
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: BORDER_WIDTH,
    borderColor: colors.border,
  },
  input: {
    flex: 1,
    /*
     * **`flex: 1` alone does not let a DOM input shrink.**
     *
     * react-native-web renders `TextInput` as an `<input>`, and a flex item in
     * CSS defaults to `min-width: auto` — which for a replaced element is its
     * *intrinsic* width. So the field grows with the text size and cannot be
     * squeezed back. Measured in Chromium at a 390px viewport: it fits at 1x
     * (right edge 343), and at 1.5x it is already 32px off the screen, at 2x
     * 164px, at 3x 407px. Yoga has no `min-width: auto` rule, so native was
     * never affected and nothing on a phone would ever have shown it.
     *
     * With this line the field measures 274px and ends at 343 at **every**
     * scale; the text scrolls inside it, which is what an input is for. The
     * same one-line fix is already on seven flex rows elsewhere in the app.
     */
    minWidth: 0,
    // **Full height, so the target is the field and not the text.** The
    // container is `MIN_TOUCH_TARGET` tall; the input inside it measured 24pt,
    // so half the row looked tappable and was not.
    alignSelf: 'stretch',
    ...typography.body,
    color: colors.textPrimary,
    // Android centres poorly without this; iOS ignores it.
    paddingVertical: 0,
  },
});
