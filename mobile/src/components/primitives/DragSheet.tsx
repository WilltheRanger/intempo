import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  AccessibilityInfo,
  Animated,
  PanResponder,
  Pressable,
  StyleSheet,
  View,
  type LayoutChangeEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { colors, radii, spacing } from '../../design';
import {
  isVerticalDrag,
  offsetDuring,
  settleTo,
  travelFor,
  type SheetPosition,
} from '../../lib/record/sheet';
import { useReducedMotion } from '../../lib/useReducedMotion';
import { GlassSurface } from './GlassSurface';

/**
 * How much of the sheet stays on screen when it is down, by default.
 *
 * Enough for the handle and the one control that has to remain reachable. A
 * sheet that goes away entirely is a sheet with no way back, and the way back
 * cannot be the thing it is covering.
 */
const DEFAULT_PEEK = 84;

export interface DragSheetProps {
  children: ReactNode;
  /**
   * What this sheet is called, for the screen reader and the hint.
   *
   * A grab handle is not an accessible affordance: no name, no role, no
   * keyboard. So the handle is a real button underneath, and this names it.
   */
  label: string;
  /** What lowering it reveals, for the accessibility hint. */
  reveals: string;
  /**
   * Where the sheet sits before anything is dragged. Raised by default.
   *
   * **The record screen starts lowered, and that is the whole composition.**
   * Raised, this sheet covers about 625 of an 844pt display, so a screen whose
   * own style comment reads *"the music is the ground, and it owns the whole
   * display"* opened with the music behind frosted glass and a musician
   * expected to discover a drag to see the part they were about to play.
   * Starting lowered makes the first thing on screen the thing the screen is
   * for; the controls are one pull away and `peek` keeps the record button
   * where the thumb already is.
   */
  initialPosition?: SheetPosition;
  style?: StyleProp<ViewStyle>;
  onPositionChange?: (position: SheetPosition) => void;
  /**
   * How much stays on screen when lowered.
   *
   * The caller decides, because the caller knows which of its controls has to
   * survive the lowering. On the record screen that is the record button: a
   * musician who has put the controls away still has to be able to start.
   */
  peek?: number;
  /**
   * Raise the sheet whenever this value changes to something truthy.
   *
   * For the case the gesture cannot cover: something appears inside the sheet
   * that the musician has to read — a microphone failure, a refused upload —
   * while the sheet is down and hiding it. A message nobody can see is the
   * same bug as no message.
   */
  raiseSignal?: unknown;
}

/**
 * Controls on a glass sheet you can drag down out of the way.
 *
 * The record screen is the one screen in this app where the content and the
 * chrome genuinely compete: the music is what a musician wants to see, and the
 * controls are what they came to set. Every other arrangement picks a winner.
 * This one lets them pick, which is the argument the Sheet Up frame makes.
 *
 * **The handle drags, and that is a condition of drawing one.** `CLAUDE.md` §3:
 * a drawn affordance must do the thing it depicts, because a handle that does
 * not drag costs a try before it teaches you it is a lie. This app shipped that
 * exact bug once, which is why the rule exists.
 *
 * The drag rule lives in `lib/record/sheet.ts` with tests — and earned its
 * place there on the first run, when the test caught that the first version
 * committed on any movement at all. What is left here is the wiring.
 */
export function DragSheet({
  children,
  label,
  reveals,
  initialPosition = 'raised',
  style,
  onPositionChange,
  peek = DEFAULT_PEEK,
  raiseSignal,
}: DragSheetProps) {
  const [position, setPosition] = useState<SheetPosition>(initialPosition);
  const [height, setHeight] = useState(0);
  const reducedMotion = useReducedMotion();

  // Refs alongside the state: the pan handlers are built once and would
  // otherwise close over the position and the travel as they were on the first
  // render, which is a sheet that always thinks it is raised.
  const positionRef = useRef<SheetPosition>(initialPosition);
  const travelRef = useRef(1);
  const offset = useRef(new Animated.Value(0)).current;
  const reducedRef = useRef(reducedMotion);
  const onPositionChangeRef = useRef(onPositionChange);

  reducedRef.current = reducedMotion;
  onPositionChangeRef.current = onPositionChange;
  travelRef.current = travelFor(height, peek);

  const settle = useRef((next: SheetPosition) => {
    positionRef.current = next;
    setPosition(next);
    onPositionChangeRef.current?.(next);
    const to = next === 'lowered' ? travelRef.current : 0;
    if (reducedRef.current) {
      offset.setValue(to);
      return;
    }
    Animated.spring(offset, {
      toValue: to,
      useNativeDriver: true,
      damping: 24,
      stiffness: 220,
      mass: 0.9,
    }).start();
  }).current;

  /**
   * Put a sheet that starts lowered where it says it is, once there is a
   * height to lower it by.
   *
   * **`initialPosition` alone was a lie, and the screen showed it.** The
   * offset starts at 0 — the raised transform — and only ever moves through
   * `settle`, so a sheet constructed as `lowered` reported itself lowered to
   * the state, the ref and the screen reader while sitting visibly over the
   * thing it was supposed to be revealing. Travel is not known on the first
   * render either: it is `travelFor(height, peek)` and `height` is 0 until
   * layout, so this cannot be done at construction and has to wait for a
   * measurement.
   *
   * Guarded on `laid.current` rather than on the position, so it fires exactly
   * once. Without that, any later re-layout — a message appearing inside the
   * sheet, the keyboard, a rotation — would snap a sheet the musician had
   * raised back down under their hand.
   */
  const laid = useRef(false);
  useEffect(() => {
    if (laid.current || height === 0) {
      return;
    }
    laid.current = true;
    if (initialPosition === 'lowered') {
      offset.setValue(travelFor(height, peek));
    }
  }, [height, initialPosition, offset, peek]);

  useEffect(() => {
    if (raiseSignal && positionRef.current === 'lowered') {
      settle('raised');
    }
  }, [raiseSignal, settle]);

  function toggle() {
    const next = positionRef.current === 'raised' ? 'lowered' : 'raised';
    settle(next);
    AccessibilityInfo.announceForAccessibility?.(
      next === 'lowered' ? `${label} lowered` : `${label} raised`,
    );
  }

  const pan = useMemo(
    () =>
      PanResponder.create({
        // Never claimed on the touch down: a press that turns out to be a tap
        // on a control inside the sheet has to reach it. Movement claims it.
        onStartShouldSetPanResponder: () => false,
        onMoveShouldSetPanResponder: (_event, { dx, dy }) => isVerticalDrag(dx, dy),
        onPanResponderMove: (_event, { dy }) => {
          offset.setValue(offsetDuring(positionRef.current, dy, travelRef.current));
        },
        onPanResponderRelease: (_event, { dy, vy }) => {
          settle(settleTo(positionRef.current, { dy, vy }, travelRef.current));
        },
        // A gesture taken away mid-drag — a call arriving, a system sheet —
        // returns to where it started rather than committing on a movement the
        // musician never finished.
        onPanResponderTerminate: () => settle(positionRef.current),
      }),
    [offset, settle],
  );

  function handleLayout(event: LayoutChangeEvent) {
    const measured = event.nativeEvent.layout.height;
    setHeight((current) => (current === measured ? current : measured));
  }

  return (
    <Animated.View
      onLayout={handleLayout}
      style={[styles.sheet, style, { transform: [{ translateY: offset }] }]}
      {...pan.panHandlers}
    >
      {/*
        `bar`, not `control`, and the reason is design law 6. The specular
        catch reads as a highlight across a small capsule and as a pale band
        across a full-width surface — which is what this is. The law names the
        tab bar because that is where it was found; the property it describes
        belongs to the shape, and this is that shape.
      */}
      <GlassSurface radius={radii.lg} variant="bar" style={styles.glass}>
        <Pressable
          onPress={toggle}
          accessibilityRole="button"
          accessibilityLabel={label}
          accessibilityHint={
            position === 'raised'
              ? `Lowers the controls to show ${reveals}`
              : 'Raises the controls'
          }
          style={({ pressed }) => [styles.handle, pressed && styles.handlePressed]}
        >
          <View style={styles.grip} />
        </Pressable>
        {children}
      </GlassSurface>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
  },
  glass: {
    borderTopLeftRadius: radii.lg,
    borderTopRightRadius: radii.lg,
    paddingBottom: spacing['2xl'],
  },
  handle: {
    alignSelf: 'center',
    // The drawn grip is 4pt tall; the target around it clears the 44pt floor.
    paddingVertical: spacing.xl,
    paddingHorizontal: spacing['4xl'],
  },
  handlePressed: {
    opacity: 0.6,
  },
  grip: {
    width: 44,
    height: 4,
    borderRadius: radii.pill,
    backgroundColor: colors.borderStrong,
  },
});
