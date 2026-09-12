import { describe, expect, it } from 'vitest';

import { barsOnPages, pageReadout, systemOfMeasure } from './barPages';
import type { StavePage } from './pages';

const spans = (...numbers: number[]) => ({
  measureSpans: numbers.map((measureNumber) => ({ measureNumber })),
});

const page = (from: number, to: number): StavePage => ({
  from,
  to,
  top: 0,
  height: 0,
  overflows: false,
});

describe('systemOfMeasure', () => {
  const systems = [spans(1, 2, 3), spans(3, 4, 5), spans(6, 7)];

  it('finds the system a bar is printed on', () => {
    expect(systemOfMeasure(systems, 4)).toBe(1);
    expect(systemOfMeasure(systems, 7)).toBe(2);
  });

  it('takes the first system of a bar split across a line break', () => {
    expect(systemOfMeasure(systems, 3)).toBe(0);
  });

  it('says so rather than guessing for a bar that is not drawn', () => {
    expect(systemOfMeasure(systems, 99)).toBe(-1);
  });
});

describe('barsOnPages', () => {
  const systems = [spans(1, 2, 3), spans(3, 4, 5), spans(6, 7), spans(8)];

  it('spans the bars its systems carry', () => {
    expect(barsOnPages(systems, [page(0, 2), page(2, 4)])).toEqual([
      { first: 1, last: 5 },
      { first: 6, last: 8 },
    ]);
  });

  it('says nothing for a page with no numbered bar on it', () => {
    expect(barsOnPages([spans()], [page(0, 1)])).toEqual([null]);
  });
});

describe('pageReadout', () => {
  it('names the bars and the place', () => {
    expect(pageReadout({ first: 13, last: 24 }, 1, 6)).toBe('Bars 13–24 · Page 2 of 6');
  });

  it('says bar, singular, for a page holding one', () => {
    expect(pageReadout({ first: 9, last: 9 }, 2, 4)).toBe('Bar 9 · Page 3 of 4');
  });

  it('says nothing at all when the music is all on screen', () => {
    expect(pageReadout({ first: 1, last: 8 }, 0, 1)).toBeNull();
  });

  it('still places you on a page whose bars it cannot name', () => {
    expect(pageReadout(null, 0, 3)).toBe('Page 1 of 3');
  });
});
