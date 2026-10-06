import { describe, expect, it } from 'vitest';

import { rovingAfter, rovingStep, rovingTabStop, type RovingItem } from './rovingFocus';

const items = (spec: string): RovingItem[] =>
  // "x" chosen, "o" not chosen, "-" disabled, "X" disabled and chosen.
  [...spec].map((c) => ({ chosen: c === 'x' || c === 'X', enabled: c === 'x' || c === 'o' }));

describe('rovingStep', () => {
  it('moves a radio group with all four arrows', () => {
    expect(rovingStep('ArrowDown', 'radiogroup')).toBe(1);
    expect(rovingStep('ArrowRight', 'radiogroup')).toBe(1);
    expect(rovingStep('ArrowUp', 'radiogroup')).toBe(-1);
    expect(rovingStep('ArrowLeft', 'radiogroup')).toBe(-1);
  });

  it('moves a row of tabs with left and right only, so up and down still scroll', () => {
    expect(rovingStep('ArrowRight', 'tablist')).toBe(1);
    expect(rovingStep('ArrowLeft', 'tablist')).toBe(-1);
    expect(rovingStep('ArrowDown', 'tablist')).toBeNull();
    expect(rovingStep('ArrowUp', 'tablist')).toBeNull();
  });

  it('leaves every other key alone, Home and End included', () => {
    for (const key of ['Home', 'End', 'PageDown', 'Tab', ' ', 'Enter', 'a']) {
      expect(rovingStep(key, 'radiogroup')).toBeNull();
      expect(rovingStep(key, 'tablist')).toBeNull();
    }
  });
});

describe('rovingAfter', () => {
  it('steps to the neighbour', () => {
    expect(rovingAfter(items('xoo'), 0, 1)).toBe(1);
    expect(rovingAfter(items('oxo'), 1, -1)).toBe(0);
  });

  it('goes round from the last to the first, and back', () => {
    expect(rovingAfter(items('oox'), 2, 1)).toBe(0);
    expect(rovingAfter(items('xoo'), 0, -1)).toBe(2);
  });

  it('skips a disabled item', () => {
    expect(rovingAfter(items('x-o'), 0, 1)).toBe(2);
    expect(rovingAfter(items('o-x'), 2, -1)).toBe(0);
  });

  it('stays put when nothing else can be reached', () => {
    expect(rovingAfter(items('x--'), 0, 1)).toBe(0);
    expect(rovingAfter(items('x'), 0, -1)).toBe(0);
  });

  it('has nowhere to go in an empty group', () => {
    expect(rovingAfter([], 0, 1)).toBe(-1);
  });
});

describe('rovingTabStop', () => {
  it('is the chosen item', () => {
    expect(rovingTabStop(items('oox'))).toBe(2);
  });

  it('is the first item when none is chosen', () => {
    expect(rovingTabStop(items('ooo'))).toBe(0);
  });

  it('passes over disabled items, chosen or not', () => {
    expect(rovingTabStop(items('-oo'))).toBe(1);
    expect(rovingTabStop(items('Xoo'))).toBe(1);
  });

  it('is nowhere when nothing can take focus', () => {
    expect(rovingTabStop(items('--'))).toBe(-1);
    expect(rovingTabStop([])).toBe(-1);
  });
});
