/**
 * The web's announcer: one polite live region, outside the app's root so an
 * open sheet's `inert` never covers it, and drawn nowhere.
 *
 * react-native-web's `AccessibilityInfo.announceForAccessibility` does
 * nothing (measured 2026-10-05: a page moved by key said nothing, and the
 * region it should have used did not exist). The text is cleared and set on
 * the next frame, so the same sentence twice is announced twice.
 */
let region: HTMLElement | null = null;

function liveRegion(): HTMLElement {
  if (region?.isConnected) return region;
  region = document.createElement('div');
  region.setAttribute('role', 'status');
  region.setAttribute('aria-live', 'polite');
  region.setAttribute('aria-atomic', 'true');
  Object.assign(region.style, {
    position: 'absolute',
    width: '1px',
    height: '1px',
    margin: '-1px',
    padding: '0',
    overflow: 'hidden',
    clip: 'rect(0 0 0 0)',
    whiteSpace: 'nowrap',
    border: '0',
  });
  document.body.appendChild(region);
  return region;
}

export function announce(message: string): void {
  const target = liveRegion();
  target.textContent = '';
  requestAnimationFrame(() => {
    target.textContent = message;
  });
}
