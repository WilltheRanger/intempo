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
    // Web gets the same instant-down / eased-release behavior from a CSS
    // transition below. Keeping it off the JavaScript animation loop prevents
    // dropped frames while a tap is also navigating or starting network work.
    if (reduceMotion || Platform.OS === 'web') {
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
      {(state) => {
        const resolvedStyle = typeof style === 'function' ? style(state) : style;
        const resolvedChildren =
          typeof children === 'function' ? children(state) : children;

        if (Platform.OS === 'web') {
          return (
            <Animated.View
              style={[
                resolvedStyle,
                reduceMotion
                  ? null
                  : ({
                      // Down is immediate; only release settles. This makes
                      // the response meet the finger instead of chasing it.
                      transform: [{ scale: state.pressed ? activeScale : 1 }],
                      transitionProperty: 'transform',
                      transitionDuration: state.pressed ? '0ms' : `${motion.fast}ms`,
                      transitionTimingFunction: 'cubic-bezier(0.22, 1, 0.36, 1)',
                      willChange: 'transform',
                    } as object),
              ]}
            >
              {resolvedChildren}
            </Animated.View>
          );
        }

        return (
          <Animated.View style={[resolvedStyle, { transform: [{ scale }] }]}>
            {resolvedChildren}
          </Animated.View>
        );
      }}
    </Pressable>
  );
}
