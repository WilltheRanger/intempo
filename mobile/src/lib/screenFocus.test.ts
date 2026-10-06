import { describe, expect, it } from 'vitest';

import { arrivalTarget, canHoldFocus, focusIsLost, type Focusable } from './screenFocus';

const el = ({
  connected = true,
  within = [] as string[],
  visible = true,
  name = '',
} = {}): Focusable & { name: string } => ({
  name,
  isConnected: connected,
  closest: (selector) => (within.includes(selector) ? {} : null),
  checkVisibility: () => visible,
});

describe('somewhere focus can be', () => {
  it('is attached, shown and reachable', () => {
    expect(canHoldFocus(el())).toBe(true);
  });

  it('is not inside a screen that has been made inert or hidden', () => {
    expect(canHoldFocus(el({ within: ['[inert]'] }))).toBe(false);
    expect(canHoldFocus(el({ within: ['[aria-hidden="true"]'] }))).toBe(false);
  });

  it('is not detached or invisible', () => {
    expect(canHoldFocus(el({ connected: false }))).toBe(false);
    expect(canHoldFocus(el({ visible: false }))).toBe(false);
    expect(canHoldFocus(null)).toBe(false);
  });
});

describe('when focus has been lost', () => {
  const body = el();

  it('is lost on the page body, or on something shut away', () => {
    expect(focusIsLost(body, body)).toBe(true);
    expect(focusIsLost(null, body)).toBe(true);
    expect(focusIsLost(el({ within: ['[inert]'] }), body)).toBe(true);
  });

  it('is not lost on a tab that is still showing, or a field the screen focused', () => {
    expect(focusIsLost(el(), body)).toBe(false);
  });
});

describe('where focus goes on arrival', () => {
  const title = el({ name: 'title' });
  const hiddenTitle = el({ name: 'hidden title', within: ['[inert]'] });

  it('goes back to what was last focused on the screen, when it is still there', () => {
    const row = el({ name: 'row' });
    expect(arrivalTarget(row, [title])?.name).toBe('row');
  });

  it('goes to the screen title when there is nothing to go back to', () => {
    expect(arrivalTarget(null, [hiddenTitle, title])?.name).toBe('title');
    expect(arrivalTarget(el({ connected: false }), [title])?.name).toBe('title');
  });

  it('goes nowhere on a screen with no title showing', () => {
    expect(arrivalTarget(null, [hiddenTitle])).toBeNull();
  });
});
