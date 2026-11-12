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

/** The part of a changed DOM node this reads. */
export interface ChangedNode {
  /** `Node.ELEMENT_NODE` for an element; anything else is text or a comment. */
  nodeType: number;
  parentElement: ChangedNode | null;
  closest?(selector: string): unknown;
  matches?(selector: string): boolean;
  querySelector?(selector: string): unknown;
}

/** The part of a `MutationRecord` this reads. */
export interface PageChange {
  target: ChangedNode;
  addedNodes: ArrayLike<ChangedNode>;
  removedNodes: ArrayLike<ChangedNode>;
}

const ELEMENT_NODE = 1;

/**
 * Whether a batch of changes to the page could change its title.
 *
 * The title is a heading's text (`titlesTheScreen`), so it can only move when a
 * heading arrives, leaves, or has its text changed — a change inside a heading,
 * or one that adds or removes something holding one. `headings` is the
 * selector for the elements that can title a screen.
 *
 * **Everything else was being read as a possible new title.** The tab's title
 * was looked for again after any change at all, and looking means asking every
 * heading on the page whether it is visible and reading the winner's text,
 * which brings the page's styles and layout up to date there and then. The
 * Library draws its shelf a tile at a time (`engravingTurns.ts`), each tile
 * hundreds of SVG nodes that cannot hold a heading; on a CPU slowed to phone
 * speed the looking took 290 ms of the 6.2 s the main thread worked while the
 * shelf was drawn, and 70 ms with this (2026-10-23).
 *
 * What changes visibility without changing a heading — a tab or a stack screen
 * covering another — is a change of screen, which the navigation reports on its
 * own (`DocumentTitle.changed`).
 */
export function changesTheTitle(changes: Iterable<PageChange>, headings: string): boolean {
  for (const change of changes) {
    const target =
      change.target.nodeType === ELEMENT_NODE ? change.target : change.target.parentElement;
    if (target?.closest?.(headings)) {
      return true;
    }
    for (const nodes of [change.addedNodes, change.removedNodes]) {
      for (let index = 0; index < nodes.length; index += 1) {
        const node = nodes[index];
        if (
          node.nodeType === ELEMENT_NODE &&
          (node.matches?.(headings) || node.querySelector?.(headings))
        ) {
          return true;
        }
      }
    }
  }
  return false;
}
