import { describe, expect, it } from 'vitest';

import { moveIndex, sliderMove } from './sliderKeys';

describe('what a key does to a slider', () => {
  it('steps by one on the arrows, up and right being more', () => {
    expect(sliderMove('ArrowRight', { big: 4 })).toEqual({ by: 1 });
    expect(sliderMove('ArrowUp', { big: 4 })).toEqual({ by: 1 });
    expect(sliderMove('ArrowLeft', { big: 4 })).toEqual({ by: -1 });
    expect(sliderMove('ArrowDown', { big: 4 })).toEqual({ by: -1 });
  });

  it('takes the big step on Page Up and Page Down, and on Shift with an arrow', () => {
    expect(sliderMove('PageUp', { big: 4 })).toEqual({ by: 4 });
    expect(sliderMove('PageDown', { big: 4 })).toEqual({ by: -4 });
    expect(sliderMove('ArrowRight', { big: 5, shift: true })).toEqual({ by: 5 });
    expect(sliderMove('ArrowLeft', { big: 5, shift: true })).toEqual({ by: -5 });
  });

  it('jumps to the ends on Home and End', () => {
    expect(sliderMove('Home', { big: 4 })).toEqual({ to: 'first' });
    expect(sliderMove('End', { big: 4 })).toEqual({ to: 'last' });
  });

  it('leaves every other key alone', () => {
    for (const key of ['Enter', ' ', 'Tab', 'a', 'Escape']) {
      expect(sliderMove(key, { big: 4 }), key).toBeNull();
    }
  });
});

describe('where a move lands', () => {
  it('steps and stops at the ends', () => {
    expect(moveIndex(3, 13, { by: 1 })).toBe(4);
    expect(moveIndex(12, 13, { by: 1 })).toBe(12);
    expect(moveIndex(0, 13, { by: -4 })).toBe(0);
  });

  it('jumps to the first and last', () => {
    expect(moveIndex(5, 13, { to: 'first' })).toBe(0);
    expect(moveIndex(5, 13, { to: 'last' })).toBe(12);
    expect(moveIndex(-1, 13, { to: 'last' })).toBe(12);
  });

  it('starts on the first step when nothing is picked, whichever way', () => {
    expect(moveIndex(-1, 13, { by: 1 })).toBe(0);
    expect(moveIndex(-1, 13, { by: -1 })).toBe(0);
  });

  it('has nowhere to land on an empty slider', () => {
    expect(moveIndex(-1, 0, { by: 1 })).toBe(-1);
  });
});
