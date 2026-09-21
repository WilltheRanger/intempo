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

import { BORDER_WIDTH, colors, radii, spacing } from '../../design';
import { settleVelocity } from '../../lib/motion/springHandoff';
import {
  anchorNearest,
  isVerticalDrag,
  offsetFromGrab,
  settleFrom,
  travelFor,
  type SheetPosition,
} from '../../lib/record/sheet';
import { useReducedMotion } from '../../lib/useReducedMotion';

/** The drawn grip. The target around it is what `HANDLE_HEIGHT` adds. */
const GRIP_HEIGHT = 4;

/**
 * How much of the sheet stays on screen when it is down: its handle, exactly.
 *
 * A sheet that goes away entirely is a sheet with no way back, and the way
 * back cannot be the thing it is covering. So the handle is the floor, and
 * this is **derived from the two tokens `styles.handle` is built out of**
 * rather than typed out beside them.
 *
 * That is not fussiness. The record screen passed `44 + spacing.xl * 2` for
 * this and counted the padding twice — 84 against a handle measuring 44 — so
 * the lowered sheet left 40 points of its first control showing above the bar
 * that was supposed to be the bottom of the screen. Two numbers that have to
 * agree, in two files, is a number that will stop agreeing.
 */
export const HANDLE_HEIGHT = GRIP_HEIGHT + spacing.xl * 2;

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
   * for; the controls are one pull away and the take bar below the sheet keeps
   * the record button where the thumb already is, whichever way this sits.
   */
  initialPosition?: SheetPosition;
  style?: StyleProp<ViewStyle>;
  onPositionChange?: (position: SheetPosition) => void;
  /**
   * How much stays on screen when lowered.
   *
   * The caller decides, because the caller knows what has to survive the
   * lowering. Keep it to chrome whose height is a property of *this* component
   * — the handle — rather than a guess at how tall the caller's content comes
   * out: the record screen kept its record button alive this way with a peek
   * of 232 against content measuring 256, and the 24 points of difference were
   * the button's own label, clipped by the bottom of the phone on every visit.
   * Content that must not move belongs outside a sheet that moves.
   *
   * **There was a `raiseSignal` here too, and it is gone with the same
   * mistake.** It hauled the sheet up over the music whenever a message the
   * musician had to read appeared inside it — a rescue that only exists
   * because something that always has to be seen was put somewhere that can be
   * hidden. The record screen's failures are in its take bar now, which is
   * always on screen, so there is nothing left to rescue.
   */
  peek?: number;
}

/**
 * Controls on a sheet you can drag down out of the way.
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
  peek = HANDLE_HEIGHT,
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

  /**
   * Where the sheet was when the finger claimed it.
   *
   * Live, not derived from `positionRef`: `settle` sets the target position
   * before the spring has moved anything, so a sheet caught mid-flight would
   * otherwise be measured from an anchor it is nowhere near.
   */
  const grabbedAtRef = useRef(0);

  const settle = useRef((next: SheetPosition, from?: number, vy = 0) => {
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
      // The finger's momentum, carried into the spring so the sheet keeps
      // moving at the speed it was thrown rather than restarting from rest.
      // Absent `from`, this is a tap on the handle, which has no velocity to
      // hand over.
      velocity: from === undefined ? 0 : settleVelocity(vy, { from, to }),
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
        // **Catching a sheet that is still moving.** `stopAnimation` halts the
        // settle and reports the value it had reached, which is the sheet's
        // *presentation* value — the one on screen. Reading the target instead
        // is what made a mid-flight grab jump: the spring was still at a third
        // of its travel while `positionRef` already said `lowered`.
        onPanResponderGrant: () => {
          offset.stopAnimation((value) => {
            grabbedAtRef.current = value;
          });
        },
        onPanResponderMove: (_event, { dy }) => {
          offset.setValue(
            offsetFromGrab(grabbedAtRef.current, dy, travelRef.current),
          );
        },
        onPanResponderRelease: (_event, { dy, vy }) => {
          const releasedAt = offsetFromGrab(
            grabbedAtRef.current,
            dy,
            travelRef.current,
          );
          settle(
            settleFrom(
              { grabbedAt: grabbedAtRef.current, releasedAt, vy },
              travelRef.current,
            ),
            releasedAt,
            vy,
          );
        },
        // A gesture taken away mid-drag — a call arriving, a system sheet —
        // returns to the anchor it was nearest rather than committing on a
        // movement the musician never finished. Nearest rather than
        // `positionRef`, because an interrupted mid-flight grab has no
        // position to go back to.
        onPanResponderTerminate: () => {
          offset.stopAnimation((value) => {
            settle(anchorNearest(value, travelRef.current), value, 0);
          });
        },
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
        **The ground the material is given, because glass alone could not take
        the detail out of engraved notation.**

        Raised, this sheet floats over the highest-contrast thing the app draws,
        and the two layers meant to soften it could not: the blur is declined
        outright by several browsers — it did not run at all on the iPhone this
        was reported from — and the tint alone leaves 20% of a stave, which is
        still a grid of lines behind a number and a record button drawn across
        a system.

        So the ground changes and the material does not. Inside the sheet
        rather than across the screen, and that is the whole of the second
        attempt: a full-screen wash also fogged the header, so the piece title
        and the music still on show read as disabled. What a musician can see
        past the sheet stays sharp, which is the reason this sheet drags rather
        than being a separate screen.

        No opacity of its own and no interpolation: it shares the sheet's
        transform, so it is exactly registered with the glass at every point of
        a drag and there is no edge to catch. Radii matched by hand, because
        `borderRadius: 'inherit'` does not exist in React Native.
      */}
      <View pointerEvents="none" style={styles.wash} />

      {/*
        **A solid panel.** This was glass in the `bar` context, on the argument
        that the specular catch reads as a pale band across a full-width
        surface rather than as a highlight. That argument was about which
        *kind* of glass; design law 6 now keeps the material for the bottom
        navigation bar alone, so this is an opaque surface with a hairline at
        its top edge.

        It loses nothing this screen was relying on. The wash that keeps the
        music from reading through is a separate layer and still does its job
        — see `styles.wash`, which is why the notes behind this do not compete
        with the controls on it.
      */}
      <View style={[styles.panel, styles.glass]}>
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
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wash: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: colors.contentWash,
    borderTopLeftRadius: radii.lg,
    borderTopRightRadius: radii.lg,
  },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
  },
  panel: {
    backgroundColor: colors.surface,
    borderTopWidth: BORDER_WIDTH,
    borderTopColor: colors.border,
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
    height: GRIP_HEIGHT,
    borderRadius: radii.pill,
    backgroundColor: colors.borderStrong,
  },
});
