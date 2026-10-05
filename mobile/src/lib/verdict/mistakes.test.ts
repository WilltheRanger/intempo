import { describe, expect, it } from 'vitest';

import type { RestEntry } from '../../data/types';
import {
  describeOffset,
  mistakeBars,
  mistakesInPassage,
  restEntriesInBar,
  wrongNotesInBar,
} from './mistakes';

describe('naming wrong notes', () => {
  it('names what was heard and what is written, in the bar’s card', () => {
    const notes = [
      { bar: 6, heard: 'E', written: 'Eb' },
      { bar: 9, heard: 'F', written: 'F#' },
    ];
    expect(wrongNotesInBar(notes, 6)).toEqual(['E instead of E♭']);
    expect(wrongNotesInBar(notes, 7)).toEqual([]);
  });
});

describe('saying a rest was miscounted', () => {
  const entry = (restBar: number, beats: number, barBeats: number | null = 4): RestEntry => ({
    restBar,
    bar: restBar + 2,
    beats,
    barBeats,
  });

  it('says a whole bar as a bar, the way a rest is counted', () => {
    expect(restEntriesInBar([entry(5, -4)], 7)).toEqual(['came in a bar early']);
    expect(describeOffset(8, 4)).toBe('2 bars late');
    expect(describeOffset(-3, 3)).toBe('a bar early');
  });

  it('says beats when it was not a whole bar', () => {
    expect(restEntriesInBar([entry(5, 1)], 7)).toEqual(['came in a beat late']);
    expect(describeOffset(-1.5, 4)).toBe('a beat and a half early');
    expect(describeOffset(2, 4)).toBe('2 beats late');
    expect(describeOffset(2.5, null)).toBe('2½ beats late');
  });

  it('is said in the bar of the entrance, not the rest', () => {
    expect(restEntriesInBar([entry(5, -4)], 5)).toEqual([]);
  });
});

describe('the bars the chart marks', () => {
  const rest = (restBar: number, bar: number): RestEntry => ({ restBar, bar, beats: 1, barBeats: 4 });
  const wrong = (bar: number) => ({ bar, heard: 'F', written: 'F#' });

  it('marks nothing when nothing went wrong', () => {
    expect(mistakeBars([], []).size).toBe(0);
  });

  it('marks a wrong note’s bar and the bar an entrance landed in, once each', () => {
    expect([...mistakeBars([wrong(6), wrong(6)], [rest(10, 12)])].sort((a, b) => a - b)).toEqual([
      6, 12,
    ]);
  });
});

describe('the mistakes inside a tapped passage', () => {
  const wrong = [{ bar: 6, heard: 'E', written: 'Eb' }];
  const rests: RestEntry[] = [{ restBar: 7, bar: 9, beats: 1, barBeats: 4 }];

  it('names the bar of each, in a passage of several', () => {
    expect(mistakesInPassage(wrong, rests, { from: 5, to: 9 })).toEqual([
      'Bar 6: E instead of E♭',
      'Bar 9: came in a beat late',
    ]);
  });

  it('says the finding alone for a passage of one bar, which the line above names', () => {
    expect(mistakesInPassage(wrong, rests, { from: 9, to: 9 })).toEqual(['Came in a beat late']);
    expect(mistakesInPassage(wrong, rests, { from: 6, to: 6 })).toEqual(['E instead of E♭']);
  });

  it('leaves out what happened outside the passage', () => {
    expect(mistakesInPassage(wrong, rests, { from: 1, to: 4 })).toEqual([]);
  });
});
