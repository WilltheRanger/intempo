/**
 * Where keyboard focus goes when the screen changes, on the web.
 *
 * **It went nowhere.** Opening a piece made the Library inert, which blurs
 * whatever was focused in it, and nothing focused anything in the piece: the
 * page's `<body>` held focus, so a screen reader said nothing about the
 * screen that had arrived, and the next Tab started from the top of the
 * document. Back did the same in reverse — the row that opened the piece was
 * still there, and focus was not on it. Measured 2026-10-05 on Library →
 * piece → Back.
 *
 * The rule, when the screen changes and focus has been lost:
 *  - return to what was last focused on the screen arrived at, if it is still
 *    there to focus — which is what Back should do;
 *  - otherwise the screen's title, its one level-1 heading — which is what a
 *    newly opened screen should do, and what a screen reader then announces;
 *  - and on a screen with no level-1 heading, its first level-2 one: a state
 *    such as "Couldn't load this take" fills the screen with an `EmptyState`,
 *    whose title is level 2 because elsewhere it sits under a page title.
 *
 * **Only when focus has been lost.** A tab switch keeps focus on its tab, and
 * a screen that focuses a field of its own has already put it somewhere
 * better; neither is overridden.
 */

/** The part of an element this reads. */
export interface Focusable {
  isConnected: boolean;
  closest(selector: string): unknown;
  checkVisibility?(): boolean;
}

/** Somewhere focus can usefully be: attached, shown, and not shut away. */
export function canHoldFocus(element: Focusable | null | undefined): element is Focusable {
  return (
    element != null &&
    element.isConnected &&
    element.closest('[inert]') === null &&
    element.closest('[aria-hidden="true"]') === null &&
    (element.checkVisibility?.() ?? true)
  );
}

/** Nothing has focus, or what has it can no longer be seen or reached. */
export function focusIsLost(active: Focusable | null, body: unknown): boolean {
  return active === null || active === body || !canHoldFocus(active);
}

/** Where focus goes on arrival: back to where it was, or to the title. */
export function arrivalTarget<T extends Focusable>(
  remembered: T | null | undefined,
  titles: readonly T[],
): T | null {
  if (canHoldFocus(remembered)) return remembered;
  return titles.find((title) => canHoldFocus(title)) ?? null;
}
