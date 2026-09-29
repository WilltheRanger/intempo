import { describe, expect, it } from 'vitest';

import type { RestEntry } from '../../data/types';
import {
  describeOffset,
  displayPitch,
  mistakeBars,
  restEntriesInBar,
  wrongNotesInBar,
} from './mistakes';

describe('naming wrong notes', () => {
  it('names what was heard and what is written, in the bar’s card', () => {
    const notes = [
      { bar: 6, heard: 'E', written: 'Eb' },
      { bar: 9, heard: 'F', written: 'F#' },
    ];
    expect(wrongNotesInBar(notes, 6)).toEqual(['We heard E where the page has E♭.']);
    expect(wrongNotesInBar(notes, 7)).toEqual([]);
  });

  it('prints sharps and flats as the page does, and leaves B alone', () => {
    expect(displayPitch('F#')).toBe('F♯');
    expect(displayPitch('Bb')).toBe('B♭');
    expect(displayPitch('B')).toBe('B');
    expect(displayPitch('Eb')).toBe('E♭');
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
    expect(restEntriesInBar([entry(5, -4)], 7)).toEqual(['You came in a bar early after the rest.']);
    expect(describeOffset(8, 4)).toBe('2 bars late');
    expect(describeOffset(-3, 3)).toBe('a bar early');
  });

  it('says beats when it was not a whole bar', () => {
    expect(restEntriesInBar([entry(5, 1)], 7)).toEqual(['You came in a beat late after the rest.']);
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
