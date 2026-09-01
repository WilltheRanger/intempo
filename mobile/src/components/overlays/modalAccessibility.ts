import { useEffect } from 'react';
import { Platform } from 'react-native';

/**
 * Number of web overlays currently covering the app root.
 *
 * React Native Web renders Modal into a portal next to #root. The platform
 * adds aria-modal to the portal, but that does not remove the root's buttons
 * and fields from the browser's keyboard order. HTML inert does, and it also
 * blocks pointer input and removes the subtree from assistive technology.
 *
 * Counted rather than toggled so a confirmation dialog opened over another
 * overlay cannot re-enable the app when only the top dialog closes.
 */
let activeWebOverlays = 0;
let rootWasInert = false;

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

    if (activeWebOverlays === 0) {
      rootWasInert = root.inert;
    }
    activeWebOverlays += 1;
    root.inert = true;

    return () => {
      activeWebOverlays = Math.max(0, activeWebOverlays - 1);
      if (activeWebOverlays === 0) {
        root.inert = rootWasInert;
      }
    };
  }, [active]);
}
