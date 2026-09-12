import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

import type { SurfaceTone } from './chromeTone';

/**
 * Carrying one boolean from the screen that knows it to the bar that needs it.
 *
 * The scrolling screen is the only thing that knows where its own content is,
 * and the tab bar is drawn outside it by the navigator — so the answer has to
 * cross that boundary. It is deliberately the *answer* that crosses and not
 * the scroll offset: `onScroll` fires at the frame rate, and a context holding
 * a number would re-render the whole tab bar sixty times a second to redraw
 * something that changes twice in a session. `report` runs the rule on the
 * screen's side and sets state only when the tone actually flips.
 */

interface ChromeTone {
  tone: SurfaceTone;
  /** Set the tone. A no-op when it already holds this value. */
  report: (tone: SurfaceTone) => void;
}

const ChromeToneContext = createContext<ChromeTone>({
  tone: 'auto',
  report: () => {},
});

export function ChromeToneProvider({ children }: { children: ReactNode }) {
  const [tone, setTone] = useState<SurfaceTone>('auto');

  const report = useCallback((next: SurfaceTone) => {
    setTone((current) => (current === next ? current : next));
  }, []);

  const value = useMemo(() => ({ tone, report }), [tone, report]);

  return <ChromeToneContext.Provider value={value}>{children}</ChromeToneContext.Provider>;
}

/** What the floating chrome should be drawn in. */
export function useChromeTone(): SurfaceTone {
  return useContext(ChromeToneContext).tone;
}

/**
 * For a screen to say what is currently behind the chrome.
 *
 * Screens that never have a dark ground never call this, and the default
 * `auto` is what they leave behind — so a screen reporting `onDark` must also
 * clear it when it stops being focused, or every other tab inherits its
 * material. `ScreenContainer` does that on blur.
 */
export function useChromeToneReporter(): (tone: SurfaceTone) => void {
  return useContext(ChromeToneContext).report;
}
