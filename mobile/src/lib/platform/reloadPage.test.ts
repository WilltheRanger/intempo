import { afterEach, describe, expect, it, vi } from 'vitest';

import { canReloadPage, reloadPage } from './reloadPage';

/**
 * The one recovery a web build can perform on its own.
 *
 * Tested here rather than asserted in the screen because there is no React
 * Native testing library in this project (`DECISIONS.md`, 2026-08-24), so a
 * rule inside a `.tsx` is a rule nothing checks — `CLAUDE.md` §3.
 *
 * `Platform.OS` is `'web'` under vitest, which is the platform this module has
 * anything to say about.
 */

const originalLocation = globalThis.location;

afterEach(() => {
  Object.defineProperty(globalThis, 'location', {
    configurable: true,
    value: originalLocation,
  });
  vi.restoreAllMocks();
});

function withLocation(value: unknown) {
  Object.defineProperty(globalThis, 'location', {
    configurable: true,
    value,
  });
}

describe('reloading the page', () => {
  it('reloads, and says that it did', () => {
    const reload = vi.fn();
    withLocation({ reload });

    expect(reloadPage()).toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  /*
   * **The affordance rule, enforced rather than trusted.** `CLAUDE.md` §3 says
   * a drawn control must do the thing it depicts, and the screen decides
   * whether to draw the reload button from `canReloadPage()`. If that could
   * answer true somewhere `reload` is missing, the button would be the exact
   * lie the rule forbids — and this whole change exists because a *sentence*
   * named a route that was not there.
   */
  it('does not claim it can reload where there is nothing to reload', () => {
    withLocation(undefined);
    expect(canReloadPage()).toBe(false);
    expect(reloadPage()).toBe(false);

    withLocation({});
    expect(canReloadPage()).toBe(false);
    expect(reloadPage()).toBe(false);
  });

  it('agrees with itself: it only reloads when it said it could', () => {
    const reload = vi.fn();
    withLocation({ reload });
    expect(canReloadPage()).toBe(true);

    withLocation({});
    expect(canReloadPage()).toBe(false);
    reloadPage();
    expect(reload).not.toHaveBeenCalled();
  });
});
