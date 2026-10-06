/**
 * A screen's title elements, best first: every level-1 heading, then every
 * level-2 one, for a screen whose only heading is a state's own — "Couldn't
 * load this take" is an `EmptyState` filling the screen, a level-2 heading
 * with no title above it. Focus on arrival (`installScreenFocus.web.ts`) and
 * the browser tab's title (`installDocumentTitle.web.ts`) both read it.
 */
export function screenTitleCandidates(): HTMLElement[] {
  return [
    ...document.querySelectorAll<HTMLElement>('h1'),
    ...document.querySelectorAll<HTMLElement>('h2'),
  ];
}
