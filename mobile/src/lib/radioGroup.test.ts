import { describe, expect, it } from 'vitest';

import { radioAfter, radioStep, radioTabStop, type RadioState } from './radioGroup';

const radios = (spec: string): RadioState[] =>
  // "x" chosen, "o" not chosen, "-" disabled, "X" disabled and chosen.
  [...spec].map((c) => ({ checked: c === 'x' || c === 'X', enabled: c === 'x' || c === 'o' }));

describe('radioStep', () => {
  it('moves forward on down and right, back on up and left', () => {
    expect(radioStep('ArrowDown')).toBe(1);
    expect(radioStep('ArrowRight')).toBe(1);
    expect(radioStep('ArrowUp')).toBe(-1);
    expect(radioStep('ArrowLeft')).toBe(-1);
  });

  it('leaves every other key alone, Home and End included', () => {
    for (const key of ['Home', 'End', 'PageDown', 'Tab', ' ', 'Enter', 'a']) {
      expect(radioStep(key)).toBeNull();
    }
  });
});

describe('radioAfter', () => {
  it('steps to the neighbour', () => {
    expect(radioAfter(radios('xoo'), 0, 1)).toBe(1);
    expect(radioAfter(radios('oxo'), 1, -1)).toBe(0);
  });

  it('goes round from the last to the first, and back', () => {
    expect(radioAfter(radios('oox'), 2, 1)).toBe(0);
    expect(radioAfter(radios('xoo'), 0, -1)).toBe(2);
  });

  it('skips a disabled radio', () => {
    expect(radioAfter(radios('x-o'), 0, 1)).toBe(2);
    expect(radioAfter(radios('o-x'), 2, -1)).toBe(0);
  });

  it('stays put when nothing else can be reached', () => {
    expect(radioAfter(radios('x--'), 0, 1)).toBe(0);
    expect(radioAfter(radios('x'), 0, -1)).toBe(0);
  });

  it('has nowhere to go in an empty group', () => {
    expect(radioAfter([], 0, 1)).toBe(-1);
  });
});

describe('radioTabStop', () => {
  it('is the chosen radio', () => {
    expect(radioTabStop(radios('oox'))).toBe(2);
  });

  it('is the first radio when none is chosen', () => {
    expect(radioTabStop(radios('ooo'))).toBe(0);
  });

  it('passes over disabled radios, chosen or not', () => {
    expect(radioTabStop(radios('-oo'))).toBe(1);
    expect(radioTabStop(radios('Xoo'))).toBe(1);
  });

  it('is nowhere when nothing can take focus', () => {
    expect(radioTabStop(radios('--'))).toBe(-1);
    expect(radioTabStop([])).toBe(-1);
  });
});
