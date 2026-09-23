import { describe, expect, it } from 'vitest';

/**
 * Every screen in the navigator has something that opens it.
 *
 * **On a phone there is no address bar.** `linking.ts` gives each screen a URL
 * and `linking.test.ts` holds it to the route list — but a URL is how a screen
 * is *returned to*, not how it is found. A screen added to `RootNavigator`
 * with nothing navigating to it is dead code on a device, reachable only in
 * the web build by typing a path, and `tsc` is perfectly happy with it.
 *
 * CLAUDE.md names navigation as the part still untested here (there is no
 * React Native testing library — `DECISIONS.md`, 2026-08-24). This is the
 * static half of that: not *where* a tap lands, which `walk-app.mjs` drives in
 * a browser, but whether anything at all leads to each screen.
 *
 * The first version of this check passed vacuously and the reason is worth
 * keeping: it read `name:\s*'(\w+)'` across the whole tree, which matches
 * `<Stack.Screen name="Foo">` — so every route was "reached" by its own
 * declaration. `DECLARERS` is the fix and `the corpus excludes the navigator`
 * below is what stops it coming back.
 */

declare global {
  interface ImportMeta {
    glob(pattern: string, options: object): Record<string, string>;
  }
}

// `./**` from the tree root, the same pattern `importPlacement.test.ts` uses.
// `'../**'` from inside `src/navigation/` silently omits that directory's own
// files, so the two declarers were never in the corpus and `types.ts` could
// not be read at all — a filter that excludes nothing, on files that are not
// there.
const files: Record<string, string> = import.meta.glob('./**/*.{ts,tsx}', {
  query: '?raw',
  import: 'default',
  eager: true,
});

/**
 * The three files that name every route by construction.
 *
 * `RootNavigator` declares them, `linking.ts` maps them to paths and
 * `types.ts` types them. Including any of these makes the whole check pass
 * whatever the app does.
 */
const DECLARERS = [
  './navigation/RootNavigator.tsx',
  './navigation/linking.ts',
  './navigation/types.ts',
];

function routeNames(type: string): string[] {
  const source = files['./navigation/types.ts'];
  expect(source, 'navigation/types.ts is not in the glob').toBeTruthy();
  const block = new RegExp(`export type ${type} = \\{([\\s\\S]*?)\\n\\};`).exec(
    source as string,
  );
  expect(block, `no \`${type}\` in navigation/types.ts`).toBeTruthy();
  return [...(block as RegExpExecArray)[1].matchAll(/^ {2}(\w+)\s*:/gm)].map((m) => m[1]);
}

/** Every source file except the tests and the three that declare the routes. */
const corpus = Object.entries(files)
  .filter(([path]) => !path.includes('.test.'))
  .filter(([path]) => !DECLARERS.includes(path))
  .map(([, source]) => source)
  .join('\n');

/** Route names that something actually asks the navigator to open. */
const opened = new Set<string>();
for (const pattern of [
  /navigate\(\s*['"](\w+)['"]/g,
  /navigate\(\s*\{\s*name:\s*['"](\w+)['"]/g,
  /\bpush\(\s*['"](\w+)['"]/g,
  /\breplace\(\s*['"](\w+)['"]/g,
]) {
  for (const match of corpus.matchAll(pattern)) {
    opened.add(match[1]);
  }
}
// **Every route a `reset` lays down, not only its first.** A reset to
// `[Tabs, SetTempo]` opens SetTempo, and matching just the first `name:` after
// `routes: [` read that as opening Tabs and nothing else. The array body is
// taken whole (one level of nested brackets, for a tab's own `routes`) and
// every literal name in it counts.
for (const block of corpus.matchAll(/routes:\s*\[((?:[^[\]]|\[[^[\]]*\])*)\]/g)) {
  for (const match of block[1].matchAll(/name:\s*['"](\w+)['"]/g)) {
    opened.add(match[1]);
  }
}

describe('every screen has a way in', () => {
  it('the corpus excludes the navigator', () => {
    // The exact mistake that made this check pass while measuring nothing.
    expect(corpus).not.toContain('<Stack.Screen');
    expect(corpus).not.toContain('RootStackParamList = {');
  });

  it('finds navigation calls at all', () => {
    // Every rule below is a set difference, and an empty `opened` would report
    // every screen as unreachable — loud rather than silent, but still a
    // broken extractor rather than a finding.
    expect(opened.size).toBeGreaterThan(10);
  });

  it('opens every screen in the root stack', () => {
    const tabs = new Set(routeNames('TabParamList'));
    const unreached = routeNames('RootStackParamList')
      .filter((route) => route !== 'Tabs' && !tabs.has(route) && !opened.has(route))
      .sort();

    expect(
      unreached,
      'declared in RootNavigator with nothing navigating to it — on a phone ' +
        'there is no address bar, so this screen cannot be opened at all',
    ).toEqual([]);
  });

  it('has the tabs as tabs rather than pushed screens', () => {
    // `Tabs` is the one route the navigator opens itself, and the four
    // destinations live inside it. A tab that had become a pushed screen would
    // pass the rule above for the wrong reason.
    expect(routeNames('RootStackParamList')).toContain('Tabs');
    expect(routeNames('TabParamList').sort()).toEqual([
      'Insights',
      'Library',
      'Profile',
      'Today',
    ]);
  });
});
