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

import { EASE_OUT, PRESSED_SCALE, SPRING, SPRING_CSS, motion } from '../../design';
import { useReducedMotion } from '../../lib/useReducedMotion';

const WEB_PRESSABLE_STYLE = Platform.select({
  web: {
    // Browsers otherwise wait to decide whether a touch is a gesture and add
    // their own blue/grey tap flash on top of the product's feedback.
    touchAction: 'manipulation',
    WebkitTapHighlightColor: 'transparent',
    cursor: 'pointer',
    userSelect: 'none',
  } as unknown as ViewStyle,
  default: undefined,
});

const WEB_DISABLED_PRESSABLE_STYLE = Platform.select({
  web: { cursor: 'default' } as unknown as ViewStyle,
  default: undefined,
});

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
 * Press-in is very short and press-out springs, which is the asymmetry iOS
 * uses: the response has to meet the finger without snapping between frames,
 * while the release settles with a hair of overshoot. Both halves are below,
 * each with its own note.
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

  /**
   * Contact: a timed run, because the only thing that matters is that it
   * arrives. `motion.pressIn` is 55ms, which meets the finger without the
   * control snapping to its pressed size between two frames.
   */
  function pressIn() {
    // Web gets the same behaviour from the CSS transition below. Keeping it off
    // the JavaScript animation loop prevents dropped frames while a tap is also
    // navigating or starting network work.
    if (reduceMotion || Platform.OS === 'web') {
      return;
    }
    Animated.timing(scale, {
      toValue: activeScale,
      duration: motion.pressIn,
      easing: EASE_OUT,
      useNativeDriver: true,
    }).start();
  }

  /**
   * Release: the shared spring, which **overshoots by a hair and settles**.
   *
   * It was a 120ms `timing` on `EASE_OUT`, which returns a control to its own
   * size and stops dead there. That is the difference between a button that
   * lets go and a button that springs back, and it is most of what "more
   * satisfying to tap" describes — the release is the half of a press anybody
   * actually watches, because the contact is under their fingertip.
   *
   * `SPRING` is the app's own (stiffness 260, damping 24), so this bounces
   * exactly as much as the floating control layer does and no more. A spring
   * is also interruptible from wherever it has reached, which a duration is
   * not: tapping twice quickly no longer restarts the second press from a
   * size the control was never at.
   */
  function pressOut() {
    if (reduceMotion || Platform.OS === 'web') {
      return;
    }
    Animated.spring(scale, {
      toValue: 1,
      ...SPRING,
      useNativeDriver: true,
    }).start();
  }

  return (
    <Pressable
      {...rest}
      onPressIn={(event) => {
        pressIn();
        rest.onPressIn?.(event);
      }}
      onPressOut={(event) => {
        pressOut();
        rest.onPressOut?.(event);
      }}
      style={[
        WEB_PRESSABLE_STYLE,
        rest.disabled && WEB_DISABLED_PRESSABLE_STYLE,
      ]}
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
                      // Contact is quick enough to meet the finger without
                      // making a card snap smaller between two frames.
                      transform: [{ scale: state.pressed ? activeScale : 1 }],
                      // The row/button supplies its own pressed fill. Give it
                      // the same contact and release timing as the movement so
                      // colour does not flash while the surface settles.
                      transitionProperty:
                        'transform, background-color, border-color, opacity',
                      // **The release is longer than the contact and curves
                      // differently**, which is the same asymmetry the native
                      // branch gets from `SPRING`: `SPRING_CSS` carries its
                      // control point past 1, so the control overshoots its own
                      // size by a hair on the way back rather than arriving and
                      // stopping. There is no `Animated.spring` on
                      // react-native-web, and this is what stands in for it.
                      transitionDuration: state.pressed
                        ? `${motion.pressIn}ms`
                        : `${motion.spring}ms`,
                      transitionTimingFunction: state.pressed
                        ? 'cubic-bezier(0.22, 1, 0.36, 1)'
                        : SPRING_CSS,
                      willChange: 'transform',
                    } as unknown as ViewStyle),
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
