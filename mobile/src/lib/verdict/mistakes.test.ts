import { describe, expect, it } from 'vitest';

import type { RestEntry } from '../../data/types';
import {
  describeOffset,
  displayPitch,
  mistakesSummary,
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

describe('the one line under the verdict', () => {
  const rest = (restBar: number): RestEntry => ({ restBar, bar: restBar + 1, beats: 1, barBeats: 4 });
  const wrong = (bar: number) => ({ bar, heard: 'F', written: 'F#' });

  it('says nothing when nothing went wrong', () => {
    expect(mistakesSummary(0, [], [])).toBeNull();
  });

  it('names a missed note and a wrong note differently, so they cannot read as one', () => {
    expect(mistakesSummary(1, [wrong(6)], [])).toBe('1 note missed · 1 wrong note, bar 6');
  });

  it('counts each kind and lists its bars once, in order', () => {
    expect(mistakesSummary(3, [wrong(7), wrong(5), wrong(7)], [rest(12), rest(20)])).toBe(
      '3 notes missed · 3 wrong notes, bars 5 and 7 · 2 rests miscounted, bars 12 and 20',
    );
  });
});
