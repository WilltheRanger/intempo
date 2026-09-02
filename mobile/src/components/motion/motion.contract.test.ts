import { describe, expect, it } from 'vitest';

import fadeInSource from './FadeIn?raw';
import iconButtonSource from '../primitives/IconButton?raw';
import tabBarSource from '../../navigation/BottomTabBar?raw';
import bottomSheetSource from '../overlays/BottomSheet?raw';

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

  it('uses the shared decelerating curve for sheets', () => {
    expect(bottomSheetSource).toContain('EASE_OUT');
    expect(bottomSheetSource.match(/easing: EASE_OUT/g)).toHaveLength(2);
  });
});
