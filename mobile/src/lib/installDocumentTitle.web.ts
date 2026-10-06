import { formatDocumentTitle, titlesTheScreen } from './documentTitle';
import type { DocumentTitle } from './installDocumentTitle';
import { screenTitleCandidates } from './screenTitles.web';

/**
 * Keep the browser tab's title on the screen showing; the rule is
 * `documentTitle.ts`.
 *
 * Read again at most once a frame whenever the page's text changes — a
 * screen's title can arrive with its data, or change in place on a rename —
 * and a few times after each navigation, because switching between tabs that
 * are already built changes only what is visible, which the observer does not
 * watch. Returns the handle for an effect.
 */
const LOOKS_MS = [0, 120, 450];

export function installDocumentTitle(currentRoute?: () => string | undefined): DocumentTitle {
  let frame = 0;
  let timers: ReturnType<typeof setTimeout>[] = [];

  const apply = () => {
    frame = 0;
    const root = document.getElementById('root');
    const heading = screenTitleCandidates().find((candidate) => titlesTheScreen(candidate, root));
    const next = formatDocumentTitle(heading?.innerText, currentRoute?.());
    if (document.title !== next) document.title = next;
  };
  const soon = () => {
    if (frame === 0) frame = requestAnimationFrame(apply);
  };

  // The <title> is in <head>, so writing it does not set this off again.
  const observer = new MutationObserver(soon);
  observer.observe(document.body, { subtree: true, childList: true, characterData: true });
  apply();

  return {
    changed() {
      timers.forEach(clearTimeout);
      timers = LOOKS_MS.map((delay) => setTimeout(apply, delay));
    },
    dispose() {
      observer.disconnect();
      if (frame !== 0) cancelAnimationFrame(frame);
      timers.forEach(clearTimeout);
    },
  };
}
