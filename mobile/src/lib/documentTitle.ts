/**
 * The name shown in a browser tab: the screen's own title, then the product.
 *
 * **Every screen was "InTempo".** A browser's history, its tab strip and a
 * screen reader's list of windows all name a page by its title, and every
 * screen of the app had the same one, so Back's long-press menu was a column
 * of identical entries. Measured 2026-10-06 on twenty routes.
 *
 * It was pinned on purpose: signed out, InTempo renders the auth gate outside
 * a navigator, so there is no focused route, and React Navigation's default
 * formatter wrote the string "undefined" into the tab. So the title is not
 * taken from the route at all. It is the screen's title as drawn — its one
 * level-1 heading, or the level-2 one of a state that fills the screen, the
 * same element `screenFocus.ts` moves focus to — which the auth gate has too.
 * With no heading, the product name alone.
 */
const PRODUCT = 'InTempo';

export function formatDocumentTitle(screenTitle?: string | null): string {
  const title = (screenTitle ?? '').replace(/\s+/g, ' ').trim();
  if (title === '' || title === PRODUCT) return PRODUCT;
  return `${title} – ${PRODUCT}`;
}

/** The part of a heading this reads. */
export interface TitleCandidate {
  isConnected: boolean;
  closest(selector: string): unknown;
  checkVisibility?(): boolean;
}

/**
 * Whether a heading is the title of the screen showing.
 *
 * Not `canHoldFocus`: an open sheet makes the whole app root inert, and the
 * screen under the sheet is still the page being looked at. Any other inert
 * ancestor is a screen the stack has covered, and its heading is not the
 * title.
 */
export function titlesTheScreen(heading: TitleCandidate, appRoot: unknown): boolean {
  if (!heading.isConnected) return false;
  if (heading.closest('[aria-hidden="true"]') !== null) return false;
  const inert = heading.closest('[inert]');
  if (inert !== null && inert !== appRoot) return false;
  return heading.checkVisibility?.() ?? true;
}
