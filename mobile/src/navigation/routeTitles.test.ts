import { describe, expect, it } from 'vitest';

import { BACK_TITLE_MAX } from './navigationBar';
import { ROUTE_TITLES, TAB_TITLES, destinationTitle, tabsTitle } from './routeTitles';

const navigator = import.meta.glob('./RootNavigator.tsx', {
  query: '?raw',
  import: 'default',
  eager: true,
});

describe('route titles', () => {
  it('names every route the root stack registers', () => {
    const source = Object.values(navigator)[0] as string;
    const registered = [...source.matchAll(/<Stack\.Screen[\s\S]*?name="([A-Za-z]+)"/g)].map(
      (match) => match[1],
    );
    // A glob or a pattern that matched nothing would pass the check below.
    expect(registered.length).toBeGreaterThanOrEqual(20);
    expect(registered.filter((name) => !(name in ROUTE_TITLES))).toEqual([]);
  });

  it('never falls back to a code name', () => {
    for (const [route, title] of Object.entries(ROUTE_TITLES)) {
      expect(title, route).not.toMatch(/^[A-Z][a-z]+[A-Z]/);
      expect(title.trim(), route).not.toBe('');
    }
  });

  it('keeps every tab short enough for a back button to repeat it', () => {
    for (const tab of TAB_TITLES) {
      expect(tab.length).toBeLessThanOrEqual(BACK_TITLE_MAX);
    }
  });
});

describe('the tabs’ title', () => {
  it('is the tab showing', () => {
    expect(tabsTitle('Insights')).toBe('Insights');
    expect(tabsTitle('Profile')).toBe('Profile');
  });

  it('is the first tab before the tabs have been navigated', () => {
    expect(tabsTitle(undefined)).toBe('Library');
  });

  it('is never a name the tab bar does not show', () => {
    expect(tabsTitle('Today')).toBe('Library');
  });
});

describe('a back destination’s title', () => {
  it('is the tab’s name or the route’s title', () => {
    expect(destinationTitle({ tab: 'Profile' })).toBe('Profile');
    expect(destinationTitle({ route: 'PieceScore' })).toBe('Score');
  });
});
