/**
 * Who opened a web overlay, and whether focus can go back to them.
 *
 * **Closing a sheet left keyboard focus on nothing.** React Native Web's
 * `Modal` means to hand focus back on close — its comment cites WCAG — but it
 * reads "the element focused before opening" in an effect that runs *after* its
 * own trap has moved focus inside, so it remembers something in the sheet,
 * which is gone by the time it closes. Measured 2026-10-05 on Piece options and
 * Add piece: Escape closed the sheet and focus fell to `<body>`, so the next
 * Tab started again from the top of the page and a screen reader lost its
 * place.
 *
 * The rules are here and tested; `useReturnFocus` in `modalAccessibility.ts`
 * is the part that needs a browser — which element, and when.
 */

/** The part of a DOM element this needs — the real one, or a stand-in. */
export interface Focusable {
  isConnected: boolean;
  closest(selector: string): unknown;
  focus(options?: { preventScroll?: boolean }): void;
}

/**
 * Whoever had focus as the overlay opened — unless that was nobody.
 *
 * `<body>` is where focus sits when nothing has it (a tap on empty page, or a
 * pointer that never focused anything), and sending focus "back" there is the
 * failure this exists to fix, not a restoration.
 */
export function openerOf(active: Focusable | null, body: unknown): Focusable | null {
  return active && active !== body ? active : null;
}

/**
 * An opener that could not take focus back yet, because another overlay was
 * still covering it.
 *
 * **Overlays hand over to each other.** "Delete piece" closes the Piece
 * options sheet and opens a confirmation over it. The sheet closes while the
 * confirmation still covers the app, so "Piece options" cannot be focused
 * then; the confirmation's own opener, "Delete piece", left with the sheet. By
 * the time the confirmation closes, neither has a target — unless the sheet's
 * opener was kept for it. Counted the way `rootInert.ts` counts, in a state
 * object rather than module variables, so the sequence can be tested.
 */
export interface FocusReturn {
  stranded: Focusable | null;
}

export const nothingStranded = (): FocusReturn => ({ stranded: null });

const reachable = (element: Focusable): boolean =>
  element.isConnected && !element.closest('[inert]');

/**
 * Put focus back on the opener if a keyboard could still reach it.
 *
 * Not if it has left the document — a "Delete piece" that went with its sheet
 * — and not if it is inside something `inert`, where `focus()` does nothing.
 * An opener that is only *covered* is kept for whichever overlay closes next;
 * one that has gone falls back to an opener kept that way. `preventScroll`,
 * because the opener is where the person already was.
 */
export function returnFocusTo(state: FocusReturn, opener: Focusable | null): boolean {
  if (opener && reachable(opener)) {
    state.stranded = null;
    opener.focus({ preventScroll: true });
    return true;
  }
  if (opener && opener.isConnected) {
    // Covered by another overlay: that one hands focus back when it closes.
    state.stranded = opener;
    return false;
  }
  const kept = state.stranded;
  if (kept && reachable(kept)) {
    state.stranded = null;
    kept.focus({ preventScroll: true });
    return true;
  }
  return false;
}
