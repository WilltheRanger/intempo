import { useRef, type ReactNode } from 'react';
import {
  Animated,
  Platform,
  Pressable,
  type PressableProps,
  type PressableStateCallbackType,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { EASE_OUT, PRESSED_SCALE, motion } from '../../design';
import { useReducedMotion } from '../../lib/useReducedMotion';

export interface PressableScaleProps extends Omit<PressableProps, 'style' | 'children'> {
  /**
   * Children, or a function of the press state — the same contract `Pressable`
   * offers, kept so a control that already swaps a colour on press can gain
   * scale without being restructured.
   */
  children: ReactNode | ((state: PressableStateCallbackType) => ReactNode);
  /** Static styles, or the same press-state callback accepted by Pressable. */
  style?:
    | StyleProp<ViewStyle>
    | ((state: PressableStateCallbackType) => StyleProp<ViewStyle>);
  /** Scale at full press. Defaults to the token; smaller controls need less. */
  activeScale?: number;
}

/**
 * A pressable that gives under the finger.
 *
 * For the large targets — a card, the record control — where a colour swap
 * alone doesn't register as touch. Small controls keep their colour change:
 * shrinking a 44pt button by 3% is invisible, and the app already has a
 * consistent pressed colour for them.
 *
 * Press-in is instant and press-out eases, which is the asymmetry iOS uses:
 * the response has to feel like it happened *under* the finger, while the
 * release can settle.
 *
 * Scale is a transform, so native builds use the native driver and hold 60fps
 * regardless of what the JS thread is doing — which matters most exactly when
 * a press kicks off work. Web uses the JavaScript driver because react-native-
 * web has no native animation module.
 */
export function PressableScale({
  children,
  style,
  activeScale = PRESSED_SCALE,
  ...rest
}: PressableScaleProps) {
  const reduceMotion = useReducedMotion();
  const scale = useRef(new Animated.Value(1)).current;

  function animateTo(value: number, duration: number) {
    if (reduceMotion) {
      return;
    }
    Animated.timing(scale, {
      toValue: value,
      duration,
      easing: EASE_OUT,
      useNativeDriver: Platform.OS !== 'web',
    }).start();
  }

  return (
    <Pressable
      {...rest}
      onPressIn={(event) => {
        animateTo(activeScale, 0);
        rest.onPressIn?.(event);
      }}
      onPressOut={(event) => {
        animateTo(1, motion.fast);
        rest.onPressOut?.(event);
      }}
    >
      {(state) => (
        <Animated.View
          style={[
            typeof style === 'function' ? style(state) : style,
            { transform: [{ scale }] },
          ]}
        >
          {typeof children === 'function' ? children(state) : children}
        </Animated.View>
      )}
    </Pressable>
  );
}
