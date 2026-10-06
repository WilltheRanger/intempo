import { useEffect, useLayoutEffect, useRef } from 'react';
import { Platform } from 'react-native';

import { nothingStranded, openerOf, returnFocusTo, type Focusable } from './returnFocus';
import { cover, noOverlays, uncover } from './rootInert';

/**
 * How many web overlays are covering the app root, and what to put back.
 *
 * **The counting is in `rootInert.ts` and tested there.** It used to be two
 * module-level variables in this file, inside the hook — so the rule that
 * decides whether the whole app is reachable by a mouse or a keyboard was the
 * one thing here nothing could check. What is left in this file is the part
 * that genuinely needs a browser: which element, and when.
 */
const overlays = noOverlays();
const focusReturn = nothingStranded();

/** Keep the app behind a visible web overlay completely non-interactive. */
export function useInertAppRoot(active: boolean): void {
  useEffect(() => {
    if (Platform.OS !== 'web' || !active || typeof document === 'undefined') {
      return;
    }

    const root = document.getElementById('root');
    if (!root) {
      return;
    }

    cover(overlays, root);
    return () => uncover(overlays, root);
  }, [active]);
}

/**
 * Give keyboard focus back to whatever opened a web overlay, once it has gone.
 *
 * **Call it after `useInertAppRoot`, with the same flag.** Effect cleanups run
 * in the order the effects were declared, so the root is uncovered first and
 * the opener is focusable again by the time this reaches for it. The rules are
 * in `returnFocus.ts`, with tests.
 */
export function useReturnFocus(active: boolean): void {
  const opener = useRef<Focusable | null>(null);

  // **Layout, not passive.** React Native Web's `Modal` moves focus into
  // itself in a passive effect, and every layout effect in a commit runs before
  // any passive one — so this is the last moment the opener still has focus.
  useLayoutEffect(() => {
    if (Platform.OS !== 'web' || !active || typeof document === 'undefined') {
      return;
    }
    opener.current = openerOf(document.activeElement as Focusable | null, document.body);
  }, [active]);

  useEffect(() => {
    if (Platform.OS !== 'web' || !active) {
      return;
    }
    return () => {
      returnFocusTo(focusReturn, opener.current);
      opener.current = null;
    };
  }, [active]);
}
