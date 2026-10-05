import { describe, expect, it, vi } from 'vitest';

import { nothingStranded, openerOf, returnFocusTo, type Focusable } from './returnFocus';

type Element = Focusable & { focus: ReturnType<typeof vi.fn>; inert: boolean };

/** A control whose reachability can change, the way the app root's does. */
function element(overrides: Partial<Element> = {}): Element {
  const el: Element = {
    isConnected: true,
    inert: false,
    closest: (selector: string) => (selector === '[inert]' && el.inert ? {} : null),
    focus: vi.fn(),
    ...overrides,
  } as Element;
  return el;
}

describe('who opened the overlay', () => {
  it('is whatever had focus', () => {
    const button = element();
    expect(openerOf(button, {})).toBe(button);
  });

  it('is nobody when focus was on the body, or nowhere', () => {
    const body = element();
    expect(openerOf(body, body)).toBeNull();
    expect(openerOf(null, body)).toBeNull();
  });
});

describe('giving focus back', () => {
  it('focuses the opener without scrolling to it', () => {
    const button = element();
    expect(returnFocusTo(nothingStranded(), button)).toBe(true);
    expect(button.focus).toHaveBeenCalledWith({ preventScroll: true });
  });

  it('leaves an opener that is no longer in the document', () => {
    const gone = element({ isConnected: false });
    expect(returnFocusTo(nothingStranded(), gone)).toBe(false);
    expect(gone.focus).not.toHaveBeenCalled();
  });

  it('does nothing when there was no opener and nothing is kept', () => {
    expect(returnFocusTo(nothingStranded(), null)).toBe(false);
  });

  it('hands a covered opener to the overlay that closes next', () => {
    // Piece options → sheet → "Delete piece" → the sheet closes and a
    // confirmation opens over the app. Measured: focus ended on <body>.
    const state = nothingStranded();
    const pieceOptions = element({ inert: true }); // the root, still covered
    const deletePiece = element();

    // The sheet closes while the confirmation covers the root.
    expect(returnFocusTo(state, pieceOptions)).toBe(false);
    expect(pieceOptions.focus).not.toHaveBeenCalled();

    // "Delete piece" went with the sheet; the confirmation closes and the
    // root is uncovered.
    deletePiece.isConnected = false;
    pieceOptions.inert = false;
    expect(returnFocusTo(state, deletePiece)).toBe(true);
    expect(pieceOptions.focus).toHaveBeenCalledTimes(1);
    expect(state.stranded).toBeNull();
  });

  it('prefers the overlay’s own opener over a kept one', () => {
    const state = nothingStranded();
    const kept = element({ inert: true });
    returnFocusTo(state, kept);
    kept.inert = false;

    const own = element();
    expect(returnFocusTo(state, own)).toBe(true);
    expect(own.focus).toHaveBeenCalled();
    expect(kept.focus).not.toHaveBeenCalled();
    // Used or not, a kept opener is not carried past a successful return.
    expect(state.stranded).toBeNull();
  });

  it('drops a kept opener that has since left the page', () => {
    const state = nothingStranded();
    const kept = element({ inert: true });
    returnFocusTo(state, kept);
    kept.isConnected = false;
    expect(returnFocusTo(state, null)).toBe(false);
  });
});
