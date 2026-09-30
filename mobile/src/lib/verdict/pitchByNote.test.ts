import { describe, expect, it } from 'vitest';

import type { NoteIntonation, TakeIntonation } from '../../data/types';
import { namedMarks, noteDetail, noteMarks, notesLine, spell, takeNoteMarks } from './pitchByNote';

const BANDS = { inTuneCents: 15, slightCents: 30 };

function note(pitch: string, midi: number, cents: number, notes = 6, bars = [1]): NoteIntonation {
  return { pitch, midi, cents, notes, bars };
}

function take(byNote: NoteIntonation[], byNoteShowNotes = 4): TakeIntonation {
  return {
    tuningCents: -26,
    spreadCents: 15,
    notes: 60,
    inTuneCents: 15,
    slightCents: 30,
    tuningWorthSayingCents: 10,
    byNote,
    byNoteShowNotes,
  };
}

/** The owner's take 1940 (2026-09-30), as the pipeline reported it. */
const TAKE_1940 = [
  note('E2', 40, -27.2, 2),
  note('A2', 45, -13.2, 4),
  note('B2', 47, -7.5, 3),
  note('C3', 48, -11.7, 7),
  note('D3', 50, 1.7, 10),
  note('Eb3', 51, 16.9, 7, [1, 3, 4, 6, 8, 10, 18]),
  note('F3', 53, -3.3, 9),
  note('G3', 55, 15.6, 6),
];

describe('spell', () => {
  it('drops the octave and draws the accidental', () => {
    expect(spell('Eb3')).toBe('E♭');
    expect(spell('F#4')).toBe('F♯');
    expect(spell('C4')).toBe('C');
    expect(spell('Bbb2')).toBe('B𝄫');
    expect(spell('F##5')).toBe('F𝄪');
  });

  it('leaves what it cannot read alone rather than inventing a note', () => {
    expect(spell('H3')).toBe('H3');
  });
});

describe('takeNoteMarks', () => {
  it('shows the notes read often enough, low to high', () => {
    const marks = takeNoteMarks(take(TAKE_1940));

    expect(marks.map((m) => m.name)).toEqual(['A', 'C', 'D', 'E♭', 'F', 'G']);
  });

  it('uses the threshold the take was measured with', () => {
    expect(takeNoteMarks(take(TAKE_1940, 8)).map((m) => m.name)).toEqual(['D', 'F']);
  });

  it('has nothing to show for a take stored before notes were reported', () => {
    expect(takeNoteMarks(take([]))).toEqual([]);
    expect(takeNoteMarks(null)).toEqual([]);
  });

  it('bands each note as the bars are banded', () => {
    const marks = takeNoteMarks(take(TAKE_1940));
    const band = Object.fromEntries(marks.map((m) => [m.name, m.band]));

    expect(band['E♭']).toBe('slight');
    expect(band.D).toBe('in_tune');
  });
});

describe('noteMarks', () => {
  it('calls a letter in two octaves low and high', () => {
    const marks = noteMarks([note('G2', 43, -20), note('D3', 50, 0), note('G3', 55, 16)], BANDS);

    expect(marks.map((m) => m.name)).toEqual(['G', 'D', 'G']);
    expect(marks.map((m) => m.fullName)).toEqual(['low G', 'D', 'high G']);
  });

  it('spells three octaves of one letter out', () => {
    const marks = noteMarks([note('G3', 55, 0), note('G4', 67, 0), note('G5', 79, 0)], BANDS);

    expect(marks.map((m) => m.fullName)).toEqual(['G3', 'G4', 'G5']);
  });

  it('sorts by pitch whatever order it was given in', () => {
    const marks = noteMarks([note('F3', 53, 0), note('C3', 48, 0)], BANDS);

    expect(marks.map((m) => m.name)).toEqual(['C', 'F']);
  });
});

describe('notesLine', () => {
  it("names the owner's sharp notes together when they went the same way", () => {
    expect(notesLine(takeNoteMarks(take(TAKE_1940)), 'take')).toBe('Your E♭s and Gs were sharp');
  });

  it('names one note when the next went the other way', () => {
    const marks = noteMarks([note('Eb3', 51, 25), note('C3', 48, -18), note('D3', 50, 0)], BANDS);

    expect(notesLine(marks, 'take')).toBe('Your E♭s were sharp');
  });

  it('names at most two', () => {
    const marks = noteMarks(
      [note('C3', 48, -40), note('D3', 50, -30), note('E3', 52, -20), note('F3', 53, 0)],
      BANDS,
    );

    expect(notesLine(marks, 'take')).toBe('Your Cs and Ds were flat');
  });

  it('says so when every note sat in tune', () => {
    const marks = noteMarks([note('C3', 48, 3), note('D3', 50, -5)], BANDS);

    expect(notesLine(marks, 'take')).toBe('Every note in tune');
  });

  it('says a habit in the present tense', () => {
    const marks = noteMarks([note('Eb3', 51, 18), note('D3', 50, 0)], BANDS);

    expect(notesLine(marks, 'habit')).toBe('Your E♭s run sharp');
  });

  it('keeps low and high in the sentence', () => {
    const marks = noteMarks([note('G2', 43, -25), note('G3', 55, 0)], BANDS);

    expect(notesLine(marks, 'take')).toBe('Your low Gs were flat');
  });

  it('says nothing with no notes to show', () => {
    expect(notesLine([], 'take')).toBeNull();
  });

  it('names the same notes the row sets heavier', () => {
    const marks = takeNoteMarks(take(TAKE_1940));

    expect(namedMarks(marks).map((m) => m.name)).toEqual(['E♭', 'G']);
  });
});

describe('noteDetail', () => {
  it('says a tapped note in words, not cents', () => {
    const [eb] = noteMarks([note('Eb3', 51, 16.9, 7)], BANDS);

    expect(noteDetail(eb)).toBe('Your 7 E♭s were a little sharp');
  });

  it('says in tune, and further off plainly', () => {
    const marks = noteMarks([note('D3', 50, 1, 10), note('Bb2', 46, 32, 4)], BANDS);

    expect(marks.map(noteDetail)).toEqual(['Your 4 B♭s were sharp', 'Your 10 Ds were in tune']);
  });

  it('keeps low and high in the sentence', () => {
    const marks = noteMarks([note('G2', 43, -20, 3), note('G3', 55, 0)], BANDS);

    expect(noteDetail(marks[0])).toBe('Your 3 low Gs were a little flat');
  });
});
