import { arrivalTarget, focusIsLost, type Focusable } from './screenFocus';
import type { ScreenFocus } from './installScreenFocus';
import { SCREEN_STEP_EVENT } from './screenStep.web';
import { screenTitleCandidates } from './screenTitles.web';

/**
 * Puts focus somewhere when the screen changes; the rule is `screenFocus.ts`.
 *
 * What was last focused is remembered per route, from every `focusin`, so
 * that coming back to a screen can return to it. `arrived` is called on every
 * change to the navigation state, and does nothing unless the screen showing
 * is a different one from last time — the state also changes when a tab is
 * built in the background, which is not arriving anywhere, and the screen a
 * page loads on is not a change at all (`ready` records it). When the screen
 * has changed it looks a few times over the next half-second, because a screen
 * whose content waits on data draws its title after its first frame, and acts
 * once, only if focus is lost by then.
 *
 * A title gets `tabindex="-1"` — focusable from code, never a Tab stop — and
 * no outline: it is where reading resumes, not a control.
 */
const LOOKS_MS = [0, 60, 200, 450];
const TITLE = 'data-screen-title';

export function installScreenFocus(currentRoute: () => string | undefined): ScreenFocus {
  const last = new Map<string, HTMLElement>();
  let showing: string | undefined;
  let timers: ReturnType<typeof setTimeout>[] = [];
  // The step within the screen, for a screen whose content changes in steps
  // (`screenStep.web.ts`). Part of the key, so each step is its own arrival
  // and remembers its own focus.
  let step: string | undefined;
  const showingKey = () => `${currentRoute() ?? ''}|${step ?? ''}`;

  const style = document.createElement('style');
  style.textContent = `[${TITLE}]:focus { outline: none; }`;
  document.head.appendChild(style);

  const remember = (event: FocusEvent) => {
    if (event.target instanceof HTMLElement) last.set(showingKey(), event.target);
  };
  document.addEventListener('focusin', remember);

  const stop = () => {
    timers.forEach(clearTimeout);
    timers = [];
  };

  const look = (route: string) => {
    const active = document.activeElement as (Focusable & Element) | null;
    if (!focusIsLost(active, document.body)) return false;
    // Level 1 first, then level 2 — see `screenTitleCandidates`. Focus
    // landing on nothing on a screen whose only heading is a state's own was
    // the defect this file exists to fix (2026-10-05).
    const target = arrivalTarget(last.get(route), screenTitleCandidates());
    if (target === null) return false;
    if (/^H[12]$/.test(target.tagName) && !target.hasAttribute('tabindex')) {
      target.tabIndex = -1;
      target.setAttribute(TITLE, '');
    }
    target.focus({ preventScroll: true });
    return true;
  };

  const arrived = () => {
    const key = showingKey();
    if (key === showing) return;
    showing = key;
    stop();
    timers = LOOKS_MS.map((delay) =>
      setTimeout(() => {
        if (look(key)) stop();
      }, delay),
    );
  };

  const stepped = (event: Event) => {
    step = (event as CustomEvent<string>).detail;
    arrived();
  };
  document.addEventListener(SCREEN_STEP_EVENT, stepped);

  return {
    ready() {
      showing = showingKey();
    },
    arrived,
    dispose() {
      stop();
      document.removeEventListener('focusin', remember);
      document.removeEventListener(SCREEN_STEP_EVENT, stepped);
      style.remove();
    },
  };
}
