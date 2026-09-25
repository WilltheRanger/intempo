import { describe, expect, it } from 'vitest';

import { startBarFor, startOptions, type LastTakeBars } from './startOptions';

const BARS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

function take(
  measures: [number, LastTakeBars['measures'][number]['verdict']][],
): LastTakeBars {
  return { measures: measures.map(([measure, verdict]) => ({ measure, verdict })) };
}

describe('startOptions', () => {
  it('offers only the top when there is no last take', () => {
    expect(startOptions(BARS, null)).toEqual([
      { key: 'top', label: 'From the top', bar: 1 },
    ]);
  });

  it('names the first sounding bar as the top, not bar 1', () => {
    // A piece that opens on rests starts where the music does.
    expect(startOptions([3, 4, 5], null)[0].bar).toBe(3);
  });

  it('offers nothing for a piece with no sounding bars', () => {
    expect(startOptions([], null)).toEqual([]);
  });

  it('picks up after the last bar a take that stopped short reached', () => {
    const options = startOptions(
      BARS,
      take([
        [1, 'on_tempo'],
        [2, 'on_tempo'],
        [8, 'on_tempo'],
      ]),
    );
    expect(options.find((o) => o.key === 'stopped')?.bar).toBe(9);
  });

  it('does not offer "where you stopped" after a take that reached the end', () => {
    const options = startOptions(
      BARS,
      take(BARS.map((bar) => [bar, 'on_tempo'] as [number, 'on_tempo'])),
    );
    expect(options.map((o) => o.key)).toEqual(['top']);
  });

  it('skips to the next sounding bar when the next one is a rest', () => {
    const options = startOptions([1, 2, 3, 6, 7], take([[3, 'on_tempo']]));
    expect(options.find((o) => o.key === 'stopped')?.bar).toBe(6);
  });

  it('names the first bar the last take was told it rushed', () => {
    const options = startOptions(
      BARS,
      take([
        [1, 'on_tempo'],
        [4, 'slight_rush'],
        [6, 'rushing'],
        [9, 'rushing'],
        [12, 'on_tempo'],
      ]),
    );
    expect(options.find((o) => o.key === 'rushed')?.bar).toBe(6);
  });

  it('does not call a slight rush a rush', () => {
    const options = startOptions(BARS, take([[4, 'slight_rush'], [12, 'on_tempo']]));
    expect(options.some((o) => o.key === 'rushed')).toBe(false);
  });

  it('keeps the sheet order: top, stopped, rushed', () => {
    const options = startOptions(BARS, take([[2, 'rushing'], [5, 'on_tempo']]));
    expect(options.map((o) => [o.key, o.bar])).toEqual([
      ['top', 1],
      ['stopped', 6],
      ['rushed', 2],
    ]);
  });
});

describe('startBarFor', () => {
  it('starts where the musician chose', () => {
    expect(startBarFor(7, BARS)).toBe(7);
  });

  it('starts at the top when nothing was chosen', () => {
    expect(startBarFor(null, [3, 4, 5])).toBe(3);
  });

  it('moves a bar of rest forward to the next bar that sounds, never back to the top', () => {
    // Bars 5–8 are rest: a part that waits four bars.
    const withRests = [1, 2, 3, 4, 9, 10, 11, 12];
    expect(startBarFor(6, withRests)).toBe(9);
    expect(startBarFor(6, withRests)).not.toBe(1);
  });

  it('keeps the last bar that sounds for a choice past the end of the music', () => {
    expect(startBarFor(20, [1, 2, 3])).toBe(3);
  });

  it('keeps the choice when nothing is known to sound yet', () => {
    expect(startBarFor(7, [])).toBe(7);
    expect(startBarFor(null, [])).toBe(1);
  });
});
