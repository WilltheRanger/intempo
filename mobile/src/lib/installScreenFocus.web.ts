import { arrivalTarget, focusIsLost, type Focusable } from './screenFocus';
import type { ScreenFocus } from './installScreenFocus';

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

  const style = document.createElement('style');
  style.textContent = `[${TITLE}]:focus { outline: none; }`;
  document.head.appendChild(style);

  const remember = (event: FocusEvent) => {
    const route = currentRoute();
    if (route && event.target instanceof HTMLElement) last.set(route, event.target);
  };
  document.addEventListener('focusin', remember);

  const stop = () => {
    timers.forEach(clearTimeout);
    timers = [];
  };

  const look = (route: string | undefined) => {
    const active = document.activeElement as (Focusable & Element) | null;
    if (!focusIsLost(active, document.body)) return false;
    const titles = [...document.querySelectorAll<HTMLElement>('h1')];
    const target = arrivalTarget(route ? last.get(route) : null, titles);
    if (target === null) return false;
    if (target.tagName === 'H1' && !target.hasAttribute('tabindex')) {
      target.tabIndex = -1;
      target.setAttribute(TITLE, '');
    }
    target.focus({ preventScroll: true });
    return true;
  };

  return {
    ready() {
      showing = currentRoute();
    },
    arrived() {
      const route = currentRoute();
      if (route === showing) return;
      showing = route;
      stop();
      timers = LOOKS_MS.map((delay) =>
        setTimeout(() => {
          if (look(route)) stop();
        }, delay),
      );
    },
    dispose() {
      stop();
      document.removeEventListener('focusin', remember);
      style.remove();
    },
  };
}
