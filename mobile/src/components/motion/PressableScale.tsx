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
 * Press-in is very short and press-out eases, which is the asymmetry iOS uses:
 * the response has to meet the finger without snapping between frames, while
 * the release can settle.
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
    // Web gets the same quick-down / eased-release behavior from a CSS
    // transition below. Keeping it off the JavaScript animation loop prevents
    // dropped frames while a tap is also navigating or starting network work.
    if (reduceMotion || Platform.OS === 'web') {
      return;
    }
    Animated.timing(scale, {
      toValue: value,
      duration,
      easing: EASE_OUT,
      useNativeDriver: true,
    }).start();
  }

  return (
    <Pressable
      {...rest}
      onPressIn={(event) => {
        animateTo(activeScale, motion.pressIn);
        rest.onPressIn?.(event);
      }}
      onPressOut={(event) => {
        animateTo(1, motion.fast);
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
                      transitionProperty: 'transform',
                      transitionDuration: state.pressed
                        ? `${motion.pressIn}ms`
                        : `${motion.fast}ms`,
                      transitionTimingFunction: 'cubic-bezier(0.22, 1, 0.36, 1)',
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
