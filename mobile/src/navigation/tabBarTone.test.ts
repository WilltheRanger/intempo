import { describe, expect, it } from 'vitest';

// `?raw` so this can read the component as text — the project has no
// `@types/node`, and `BottomTabBar` is a React component with no testing
// library here to render it (`DECISIONS.md`, 2026-08-24).
import tabBarSource from './BottomTabBar.tsx?raw';
import { tabBarToneFor } from './tabBarTone';

/**
 * The component with its comments taken out.
 *
 * Every assertion below is about what the component *does*, and this file
 * explains itself in prose that quotes the very identifiers it is checking are
 * absent. Matching the raw text made "we no longer use `onDarkMuted`" fail on
 * the comment saying so, which is a test that punishes writing down the
 * reason.
 */
const code = tabBarSource
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^[ \t]*\/\/.*$/gm, '');

/**
 * The tab bar's material follows the screen under it.
 *
 * Two separate things are checked here, and the second is the one that was
 * actually wrong: the rule itself, and that the component asks it. A tone
 * function nothing calls would leave the "+" at 1.36:1 exactly as before while
 * every test on this page passed — the same shape as the avatar-resize defect
 * (`data/profile/avatarImage.reach.test.ts`), found the same way.
 */
describe('the rule', () => {
  it('gives Today the dark material', () => {
    expect(tabBarToneFor('Today')).toBe('onDark');
  });

  it('leaves the other tabs on the appearance', () => {
    for (const name of ['Library', 'Insights', 'Profile']) {
      expect(tabBarToneFor(name)).toBe('auto');
    }
  });

  it('takes the appearance when there is no focused route', () => {
    // The navigator can report an empty state for a frame during a reset.
    // Nothing on screen to be dark over, so: ordinary glass.
    expect(tabBarToneFor(undefined)).toBe('auto');
  });

  it('does not match a screen whose name merely contains one', () => {
    expect(tabBarToneFor('TodayDetail')).toBe('auto');
  });
});

describe('the bar', () => {
  it('asks the rule which material to wear', () => {
    expect(code).toMatch(/tabBarToneFor\(/);
  });

  it('passes that tone to the glass', () => {
    // `GlassSurface` picks the palette its specular, rim and separator are
    // drawn from. Setting the glyph colours alone — which is what the first
    // attempt did — leaves ivory type on ivory glass.
    expect(code).toMatch(/<GlassSurface[\s\S]{0,200}tone=\{tone\}/);
  });

  it('lights the icons and labels from the same palette', () => {
    // An ink label under a gold icon is invisible on the photograph. The icon
    // reads its colour out of the resolved palette; the label passes the tone
    // down so `Text` resolves the *token* there, which is what keeps a hex
    // from being retyped into a screen.
    expect(code).toMatch(/palette\.accent/);
    expect(code).toMatch(/palette\.textSecondary/);
    expect(code).toMatch(/<Text[\s\S]{0,300}tone=\{tone\}/);
  });

  it("does not borrow the scanner's chrome token for its labels", () => {
    // `onDarkMuted` is white at 0.55, for chrome over a viewfinder. As a 13px
    // tab label on the capsule it measured 4.13:1 against the 4.5 floor, and
    // it is the kind of near-miss that comes back if the reason is only in a
    // commit message.
    expect(code).not.toMatch(/onDarkMuted/);
  });
});
