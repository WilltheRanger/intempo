import { useEffect } from 'react';
import { Platform } from 'react-native';

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
