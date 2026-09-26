import { describe, expect, it } from 'vitest';

import type { RestEntry } from '../../data/types';
import {
  describeOffset,
  displayPitch,
  restEntriesLine,
  wrongNotesInBar,
  wrongNotesLine,
} from './mistakes';

describe('naming wrong notes', () => {
  it('says nothing when every note was the page’s', () => {
    expect(wrongNotesLine([])).toBeNull();
  });

  it('counts them and lists their bars once each, in order', () => {
    expect(wrongNotesLine([{ bar: 5, heard: 'F', written: 'F#' }])).toBe(
      "1 note wasn’t what’s written: bar 5.",
    );
    expect(
      wrongNotesLine([
        { bar: 7, heard: 'F', written: 'F#' },
        { bar: 5, heard: 'F', written: 'F#' },
        { bar: 7, heard: 'C', written: 'C#' },
      ]),
    ).toBe("3 notes weren’t what’s written: bars 5 and 7.");
    expect(
      wrongNotesLine([2, 3, 4, 6].map((bar) => ({ bar, heard: 'F', written: 'F#' }))),
    ).toBe("4 notes weren’t what’s written: bars 2, 3, 4 and 6.");
  });

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

  it('says nothing when every rest was counted', () => {
    expect(restEntriesLine([])).toBeNull();
  });

  it('says a whole bar as a bar, the way a rest is counted', () => {
    expect(restEntriesLine([entry(5, -4)])).toBe('You came in a bar early after the rest at bar 5.');
    expect(describeOffset(8, 4)).toBe('2 bars late');
    expect(describeOffset(-3, 3)).toBe('a bar early');
  });

  it('says beats when it was not a whole bar', () => {
    expect(restEntriesLine([entry(5, 1)])).toBe('You came in a beat late after the rest at bar 5.');
    expect(describeOffset(-1.5, 4)).toBe('a beat and a half early');
    expect(describeOffset(2, 4)).toBe('2 beats late');
    expect(describeOffset(2.5, null)).toBe('2½ beats late');
  });

  it('joins two and lists more by bar', () => {
    expect(restEntriesLine([entry(5, -4), entry(20, 1)])).toBe(
      'You came in a bar early after the rest at bar 5, and a beat late after the rest at bar 20.',
    );
    expect(restEntriesLine([entry(5, -4), entry(20, 1), entry(31, 2)])).toBe(
      'You miscounted 3 rests: bars 5, 20 and 31.',
    );
  });
});
