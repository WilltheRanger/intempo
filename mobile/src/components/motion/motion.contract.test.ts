import { describe, expect, it } from 'vitest';

import fadeInSource from './FadeIn?raw';
import iconButtonSource from '../primitives/IconButton?raw';
import secondaryButtonSource from '../primitives/SecondaryButton?raw';
import linkRowSource from '../primitives/LinkRow?raw';
import sheetOptionRowSource from '../overlays/SheetOptionRow?raw';
import tabBarSource from '../../navigation/BottomTabBar?raw';
import bottomSheetSource from '../overlays/BottomSheet?raw';
import confirmDialogSource from '../overlays/ConfirmDialog?raw';
import pressableScaleSource from './PressableScale?raw';
import reducedMotionSource from '../../lib/useReducedMotion?raw';
import screenContainerSource from '../primitives/ScreenContainer?raw';
import stackSceneSource from '../../navigation/StackScene?raw';
import rootNavigatorSource from '../../navigation/RootNavigator?raw';
import motionSource from '../../design/motion?raw';

/**
 * Motion is a performance and interaction contract, not decoration.
 *
 * Source assertions match the repository's existing accessibility and touch
 * target tests: React Native is not mounted in Vitest, but these invariants
 * must remain visible whenever a control or entrance is refactored.
 */
describe('interaction motion', () => {
  it('keeps web list entrances on compositor-friendly CSS properties', () => {
    expect(fadeInSource).toContain("Platform.OS === 'web'");
    expect(fadeInSource).toContain("transitionProperty: 'opacity, transform'");
    expect(fadeInSource).toContain("willChange: webVisible ? 'auto' : 'opacity, transform'");
    expect(fadeInSource).toContain('requestAnimationFrame');
    expect(fadeInSource).not.toContain("useNativeDriver: Platform.OS !== 'web'");
  });

  it('gives tabs and icon controls immediate press feedback', () => {
    expect(iconButtonSource).toContain('PressableScale');
    expect(iconButtonSource).toContain('activeScale={0.92}');
    expect(tabBarSource).toContain('styles.tabPressed');
    expect(tabBarSource).toContain('ImpactFeedbackStyle.Light');
  });

  /**
   * **Every** timed animation on the sheet uses the shared curve, and every
   * spring uses the shared spring.
   *
   * This counted `easing: EASE_OUT` occurrences against the literal 2 — a
   * stand-in for "the enter and the exit", which held only while those were the
   * only two animations. Adding swipe-to-dismiss made it three and the test
   * failed on a change it had no opinion about, which is the failure mode of
   * asserting a count instead of a rule.
   *
   * Comparing the two counts says the thing that was actually meant: no timed
   * animation here gets a different curve, or the default one, however many
   * there come to be.
   */
  it('uses the shared decelerating curve for every timed sheet animation', () => {
    const timings = bottomSheetSource.match(/Animated\.timing\(/g) ?? [];
    const easings = bottomSheetSource.match(/easing: EASE_OUT/g) ?? [];
    expect(timings.length).toBeGreaterThan(0);
    expect(easings).toHaveLength(timings.length);
  });

  it('uses the shared spring for every sheet spring', () => {
    const springs = bottomSheetSource.match(/Animated\.spring\(/g) ?? [];
    const shared = bottomSheetSource.match(/\.\.\.SPRING,/g) ?? [];
    expect(springs.length).toBeGreaterThan(0);
    expect(shared).toHaveLength(springs.length);
  });

  /**
   * The gesture's thresholds live in a tested module, not in the component.
   * There is no React Native testing library here, so a number inside the
   * `.tsx` is a number nothing checks (`CLAUDE.md` §3).
   */
  it('keeps the sheet dismissal rule out of the component', () => {
    expect(bottomSheetSource).toContain("from '../../lib/motion/sheetDrag'");
    expect(bottomSheetSource).toContain('shouldDismiss(');
    expect(bottomSheetSource).not.toMatch(/dy\s*[><]=?\s*\d/);
  });

  /**
   * The dialog arrives, rather than being revealed.
   *
   * It shipped on `Modal`'s own fade: a card cross-fading at a fixed size,
   * which reads as having been behind the scrim all along. So the check is
   * both halves — the built-in animation off, and a scale in its place.
   */
  it('grows the confirm dialog into place instead of only fading it', () => {
    expect(confirmDialogSource).toContain('animationType="none"');
    expect(confirmDialogSource).toContain('DIALOG_ENTER_SCALE');
    expect(confirmDialogSource).toContain('transform: [{ scale }]');
  });

  it('keeps touch feedback direct without browser gesture delay', () => {
    expect(pressableScaleSource).toContain("touchAction: 'manipulation'");
    expect(pressableScaleSource).toContain("WebkitTapHighlightColor: 'transparent'");
    expect(pressableScaleSource).toContain('motion.pressIn');
    expect(pressableScaleSource).toContain(
      "'transform, background-color, border-color, opacity'",
    );
  });

  /**
   * **The release springs; the contact does not.** That asymmetry is the
   * whole of what a press feels like — the contact is under a fingertip and
   * nobody watches it, and the release is the half anybody sees.
   *
   * It was a 120ms `timing` on `EASE_OUT` on both platforms, which returns a
   * control to its own size and stops dead. Asserted on both branches because
   * they are separate implementations of one behaviour: `Animated.spring` on
   * device, and `SPRING_CSS` — whose control point is past 1, which is where
   * the overshoot comes from — on the web build, which has no spring at all.
   */
  it('springs a control back to size rather than easing it', () => {
    expect(pressableScaleSource).toContain('Animated.spring(scale');
    expect(pressableScaleSource).toContain('...SPRING,');
    expect(pressableScaleSource).toContain('SPRING_CSS');
    // The contact keeps its own short, non-overshooting curve.
    expect(pressableScaleSource).toContain("'cubic-bezier(0.22, 1, 0.36, 1)'");
  });

  /**
   * **Every control that answers a finger answers it the same way.** The tab
   * bar and the primary button had a tick; back, close, add, the secondary
   * button and every settings row did not — so how hard a press registered
   * depended on which control you happened to touch, which reads as the quiet
   * ones being broken rather than as being quiet.
   */
  it('gives the shared controls the same haptic weight', () => {
    for (const source of [
      iconButtonSource,
      secondaryButtonSource,
      linkRowSource,
      sheetOptionRowSource,
    ]) {
      expect(source).toContain('ImpactFeedbackStyle.Light');
    }
  });

  it('shares the system motion listener across animated rows', () => {
    expect(reducedMotionSource).toContain('useSyncExternalStore');
    expect(reducedMotionSource.match(/AccessibilityInfo\.addEventListener/g)).toHaveLength(1);
  });

  it('leaves scroll gestures native and programmatic jumps immediate', () => {
    expect(screenContainerSource).toContain("scrollBehavior: 'auto'");
    expect(screenContainerSource).toContain('decelerationRate="normal"');
  });

  /**
   * **Every screen the stack pushes is wrapped, not a list of them.**
   *
   * The web build draws no transition of its own — `react-native-screens` is a
   * stub there and a push is a `display` swap — so a screen that is not
   * wrapped is a screen that pops. Nineteen hand-wrapped components would put
   * the twentieth one tap away from being the one nobody notices; one
   * `screenLayout` on the navigator cannot be forgotten.
   */
  it('gives every pushed screen an entrance, from the navigator', () => {
    expect(rootNavigatorSource).toContain('screenLayout=');
    expect(rootNavigatorSource).toContain('<StackScene>{children}</StackScene>');
    // And nothing wraps a screen individually, which is how the two would
    // drift into disagreeing about which screens animate.
    expect(rootNavigatorSource).not.toMatch(/component=\{\(\)\s*=>\s*<StackScene/);
  });

  /**
   * The entrance paints its start state, rather than reaching it backwards.
   *
   * Measured on the built bundle: the first version held the arrived state in
   * `useState(true)` and pushed it to false from an effect, and the scene was
   * at full opacity and zero offset on the first frame it existed. An effect
   * is a commit too late. The start has to be decided during render — the same
   * reason `FadeIn` starts hidden on this platform — and the two animation
   * frames after it are what let the browser paint it.
   */
  it('decides the pushed entrance during render, not in an effect', () => {
    expect(stackSceneSource).toContain('if (seen !== index)');
    expect(stackSceneSource).toContain('requestAnimationFrame');
    expect(stackSceneSource).toContain("transitionProperty: 'opacity, transform'");
    // The direction rule stays in a module with tests, not in the component.
    expect(stackSceneSource).toContain("from './sceneMotion'");
    expect(stackSceneSource).not.toMatch(/index\s*[<>]\s*\w/);
  });

  /**
   * Native keeps its own transition.
   *
   * `native-stack` is UINavigationController on a phone: interruptible, with
   * the back gesture attached to it. A second animation layered over that
   * would fight it, so the wrapper has to be inert there.
   */
  it('leaves the native push to the platform', () => {
    expect(stackSceneSource).toContain("Platform.OS !== 'web'");
    expect(stackSceneSource).toContain('if (still)');
  });

  /**
   * The sheet's duration is read against the curve, not chosen against a feel.
   *
   * `EASE_OUT` delivers 96% of its travel in half its duration, so a sheet at
   * `motion.base` was measured arriving in about 140ms of a 240ms animation —
   * reported as "it just pops up". The number is only meaningful beside that
   * note, so this holds the two together: the sheet takes the token named for
   * it, and the token carries the measurement.
   */
  it('gives the sheet its own duration, with the curve written down', () => {
    expect(bottomSheetSource).toContain('duration: reduceMotion ? 0 : motion.sheet');
    expect(motionSource).toMatch(/sheet:\s*(\d+)/);
    const sheet = Number(/sheet:\s*(\d+)/.exec(motionSource)?.[1]);
    const base = Number(/base:\s*(\d+)/.exec(motionSource)?.[1]);
    expect(sheet).toBeGreaterThan(base);
    // The curve's shape is the reason for the number, and a duration with no
    // note of it is one somebody halves again next time.
    expect(motionSource).toContain('96%');
  });
});
