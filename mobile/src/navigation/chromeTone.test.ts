import { describe, expect, it } from 'vitest';

// `?raw` so these can read components as text — the project has no
// `@types/node`, and there is no React Native testing library here to render
// them (`DECISIONS.md`, 2026-08-24).
import barSource from './BottomTabBar.tsx?raw';
import containerSource from '../components/primitives/ScreenContainer.tsx?raw';
import todaySource from '../screens/today/TodayScreen.tsx?raw';
import { chromeToneFor } from './chromeTone';

/** Components with their comments taken out. */
const strip = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
const bar = strip(barSource);
const container = strip(containerSource);
const today = strip(todaySource);

/**
 * One viewport of photograph, then ordinary page. The numbers below are that
 * screen: an 844pt phone, the capsule's midline about 806pt down.
 */
const HERO = 844;
const MIDLINE = 806;
const at = (scrollY: number) =>
  chromeToneFor({ scrollY, darkGroundHeight: HERO, chromeMidline: MIDLINE });

describe('the rule', () => {
  it('is dark while the chrome is over the dark ground', () => {
    expect(at(0)).toBe('onDark');
  });

  it('lets go once the screen has scrolled past it', () => {
    // The defect this exists for. Keyed on the route name instead, the capsule
    // stayed dark all the way down Today and its inactive labels measured
    // 1.46:1 on the ivory page — navigation furniture you cannot see.
    expect(at(HERO)).toBe('auto');
    expect(at(1175)).toBe('auto');
  });

  it('changes over at the midline, not at an edge', () => {
    expect(at(HERO - MIDLINE - 1)).toBe('onDark');
    expect(at(HERO - MIDLINE)).toBe('auto');
  });

  it('stays dark through an overscroll at the top', () => {
    // `onScroll` reports a negative offset for the whole of a rubber band, and
    // that is the hero moving further *under* the chrome, not less.
    expect(at(-120)).toBe('onDark');
  });

  it('is ordinary glass for a screen with no dark ground', () => {
    for (const darkGroundHeight of [0, -1, Number.NaN]) {
      expect(chromeToneFor({ scrollY: 0, darkGroundHeight, chromeMidline: MIDLINE })).toBe(
        'auto',
      );
    }
  });

  it('does not go dark on a viewport that has not measured yet', () => {
    // Layout reports 0 before the first pass. A chrome midline of 0 is "the
    // very top of the screen", which is inside any dark ground — so this is
    // the one case where the arithmetic is right and the answer is still
    // useless. It resolves on the next frame; what matters is that it is the
    // *dark* material that appears late rather than a light capsule flashing
    // over the photograph.
    expect(chromeToneFor({ scrollY: 0, darkGroundHeight: 0, chromeMidline: 0 })).toBe('auto');
  });
});

/**
 * The rule reaches the screen.
 *
 * A rule module nothing calls is this repository's most-repeated defect — the
 * route-keyed version of this file had a test that passed while the "+" sat at
 * 1.36:1, because it only ever checked the function. These check the chain:
 * the screen declares the ground, the container runs the rule and reports, the
 * bar reads the answer.
 */
describe('the wiring', () => {
  it('has Today declare its hero as the dark ground', () => {
    expect(today).toMatch(/darkGround=\{heroHeight\}/);
    /*
      **Every full-bleed container on this screen declares the ground** — a
      rule, rather than the literal 3 this used to assert.

      Three was the number of branches that drew the hero when the screen also
      had a loading state and an empty-library state of its own; they are one
      branch now, because `heroContentFor` decides what the photograph says in
      all three cases and the container around it stopped differing. Asserting
      the count made the check fail on a change it had no opinion about, which
      is the same failure the sheet's curve test had and recorded.

      What was actually meant is below: a full-bleed Today is a photograph, and
      a photograph without `darkGround` is a light tab bar on it — the defect
      this whole module exists for, and worst on the screen a new account sees
      first.
    */
    const bleeding = today.match(/<ScreenContainer[^>]*\bbleed\b/g) ?? [];
    const declaring = today.match(/darkGround=\{heroHeight\}/g) ?? [];
    expect(bleeding.length).toBeGreaterThan(0);
    expect(declaring).toHaveLength(bleeding.length);
  });

  it('takes the height from the hero rather than measuring it again', () => {
    expect(today).toMatch(/useHeroHeight/);
  });

  it('runs the rule in the container and reports the answer', () => {
    expect(container).toMatch(/chromeToneFor\(/);
    expect(container).toMatch(/reportTone\(/);
    expect(container).toMatch(/onScroll=\{handleScroll\}/);
  });

  it('clears the tone when the screen loses focus', () => {
    // React Navigation keeps a tab mounted when you leave it, so a screen that
    // reported `onDark` and went quiet would hand its material to Library.
    expect(container).toMatch(/const onFocus = useCallback\([\s\S]{0,200}reportTone\('auto'\)/);
    expect(container).toMatch(/<OnFocus effect=\{onFocus\} \/>/);
    expect(container).toMatch(/useFocusEffect\(effect\)/);
  });

  it('listens for focus only under a navigator', () => {
    // `ErrorBoundary` draws in this container above the `NavigationContainer`,
    // where `useFocusEffect` throws — and a crashing crash screen lost the
    // real error on every launch it mattered (2026-09-25).
    expect(container).toMatch(/\{navigated \? <OnFocus/);
  });

  it('has the bar read the reported tone, not the route', () => {
    expect(bar).toMatch(/useChromeTone\(\)/);
    expect(bar).not.toMatch(/state\.routes\[state\.index\]/);
  });

  it('passes that tone to the glass and to the glyphs', () => {
    // Setting the glyph colours alone is what shipped the "+" at 1.36:1: an
    // ivory mark on ivory glass. Material and colour are one decision.
    expect(bar).toMatch(/<GlassSurface[\s\S]{0,200}tone=\{tone\}/);
    expect(bar).toMatch(/palette\.accent/);
    expect(bar).toMatch(/palette\.textSecondary/);
    expect(bar).toMatch(/<Text[\s\S]{0,300}tone=\{tone\}/);
  });
});
