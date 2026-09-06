import { describe, expect, it } from 'vitest';

import fadeInSource from './FadeIn?raw';
import iconButtonSource from '../primitives/IconButton?raw';
import tabBarSource from '../../navigation/BottomTabBar?raw';
import bottomSheetSource from '../overlays/BottomSheet?raw';
import confirmDialogSource from '../overlays/ConfirmDialog?raw';
import pressableScaleSource from './PressableScale?raw';
import reducedMotionSource from '../../lib/useReducedMotion?raw';
import screenContainerSource from '../primitives/ScreenContainer?raw';

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

  it('shares the system motion listener across animated rows', () => {
    expect(reducedMotionSource).toContain('useSyncExternalStore');
    expect(reducedMotionSource.match(/AccessibilityInfo\.addEventListener/g)).toHaveLength(1);
  });

  it('leaves scroll gestures native and programmatic jumps immediate', () => {
    expect(screenContainerSource).toContain("scrollBehavior: 'auto'");
    expect(screenContainerSource).toContain('decelerationRate="normal"');
  });
});
