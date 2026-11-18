import { describe, expect, it } from 'vitest';

import { MENU_EDGE, MENU_GAP, MENU_WIDTH, originOffset, placeMenu } from './menuPlacement';

const phone = { window: { width: 390, height: 844 }, insets: { top: 0, bottom: 0 } };

describe('a menu from the bar’s •••', () => {
  // The bar's trailing glyph: a 44pt square at the top right.
  const anchor = { x: 338, y: 0, width: 44, height: 44 };

  it('opens under it, at the trailing edge as far as the margin allows, from the top right', () => {
    const placed = placeMenu({ ...phone, anchor, height: 88 });
    expect(placed.top).toBe(44 + MENU_GAP);
    // The glyph's square ends 8pt from the edge; the menu keeps its 16.
    expect(placed.left + placed.width).toBe(390 - MENU_EDGE);
    expect(placed.origin).toBe('top-right');
  });

  it('lines up with a control further in exactly', () => {
    const inner = { x: 280, y: 0, width: 44, height: 44 };
    const placed = placeMenu({ ...phone, anchor: inner, height: 88 });
    expect(placed.left + placed.width).toBe(280 + 44);
  });

  it('is UIKit’s width', () => {
    expect(placeMenu({ ...phone, anchor, height: 88 }).width).toBe(MENU_WIDTH);
  });
});

describe('a menu from a piece on the shelf', () => {
  it('lines up with a tile in the leading column', () => {
    const tile = { x: 24, y: 300, width: 165, height: 260 };
    const placed = placeMenu({ ...phone, anchor: tile, height: 88 });
    expect(placed.left).toBe(24);
    expect(placed.origin).toBe('top-left');
  });

  it('opens over a tile near the bottom of the screen', () => {
    const tile = { x: 201, y: 600, width: 165, height: 220 };
    const placed = placeMenu({ ...phone, anchor: tile, height: 88 });
    expect(placed.top).toBe(600 - MENU_GAP - 88);
    expect(placed.origin).toBe('bottom-right');
  });

  it('stays clear of the edges, the island and the home indicator', () => {
    const insets = { top: 59, bottom: 34 };
    const tall = { x: 24, y: 70, width: 342, height: 760 };
    const placed = placeMenu({ ...phone, insets, anchor: tall, height: 132 });
    expect(placed.left).toBeGreaterThanOrEqual(MENU_EDGE);
    expect(placed.left + placed.width).toBeLessThanOrEqual(390 - MENU_EDGE);
    expect(placed.top).toBeGreaterThanOrEqual(59 + MENU_EDGE);
    expect(placed.top + 132).toBeLessThanOrEqual(844 - 34 - MENU_EDGE);
  });
});

describe('a narrow window', () => {
  it('narrows the menu to fit inside the edges', () => {
    const placed = placeMenu({
      window: { width: 260, height: 600 },
      insets: { top: 0, bottom: 0 },
      anchor: { x: 200, y: 0, width: 44, height: 44 },
      height: 88,
    });
    expect(placed.width).toBe(260 - MENU_EDGE * 2);
    expect(placed.left).toBe(MENU_EDGE);
  });
});

describe('where it grows from', () => {
  it('is the corner nearest the control, relative to the centre', () => {
    expect(originOffset('top-right', { width: 250, height: 100 })).toEqual({ x: 125, y: -50 });
    expect(originOffset('bottom-left', { width: 250, height: 100 })).toEqual({ x: -125, y: 50 });
  });
});
