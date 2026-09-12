import { describe, expect, it } from 'vitest';

import { engrave, spellAccidentals, type StaveNote } from './engrave';
import { keySignatureFor } from './keySignature';
import { scheduleScore } from '../score/schedule';
import type { ScoreJson } from '../../data/types';

/**
 * Chords, which the app had been silently dropping.
 *
 * `musicxml.py` has read `<chord>` members into `ScoreNote.chord_pitches` for a
 * while and nothing in the app looked at the field — so a double stop was drawn
 * as one notehead and played as one pitch. On a string part that is not an edge
 * case: the demo fixture is Bach's G minor Sonata, whose first bar is a
 * four-note chord.
 *
 * The rules that matter and are easy to get wrong are the geometric ones. Two
 * heads a second apart overlap into a blob unless one moves across the stem; a
 * stem drawn from the principal leaves the outer head unattached; a chord above
 * the staff needs its top note's ledger lines, not its bottom note's.
 */

function chord(pitch: string, members: string[], extra: Partial<StaveNote> = {}): StaveNote {
  return { pitch, value: 'quarter', chord: members, ...extra };
}

function scoreWith(notes: { pitch: string; chord?: string[] }[]): ScoreJson {
  return {
    time_signature: '4/4',
    key_signature: 'C major',
    tempo_marking: null,
    bpm_hint: null,
    clef: 'treble',
    repeats: [],
    ocr_confidence: 1,
    notes_to_human: '',
    measures: [
      {
        measure_number: 1,
        slurs: [],
        notes: notes.map((n) => ({
          pitch: n.pitch,
          duration: 'quarter',
          tied_to_next: false,
          ...(n.chord ? { chord_pitches: n.chord } : {}),
        })),
      },
    ],
  } as unknown as ScoreJson;
}

const only = (items: ReturnType<typeof engrave>) => items.systems[0].notes[0];

describe('engraving a chord', () => {
  it('draws a notehead for every pitch, not just the principal', () => {
    const drawn = engrave([chord('G3', ['D4', 'B4'])], 'treble');
    expect(only(drawn).chord).toHaveLength(2);
  });

  it('puts the extra heads in staff order, whatever order they arrived in', () => {
    // `chord_pitches` comes in the order the importer met them in the XML.
    const drawn = engrave([chord('G3', ['B4', 'D4'])], 'treble');
    const ys = only(drawn).chord.map((head) => head.y);
    // Lower on the staff is a larger y, so staff order is descending y.
    expect(ys[0]).toBeGreaterThan(ys[1]);
  });

  it('shares the column when the heads are not adjacent', () => {
    const drawn = engrave([chord('G3', ['D4'])], 'treble');
    const note = only(drawn);
    expect(note.chord[0].x).toBe(note.x);
  });

  it('moves a head a second away off the column', () => {
    // **Two noteheads a step apart print on top of each other.** An engraver
    // puts the upper one across the stem; without this a third and a second
    // look identical, which is a different chord.
    const drawn = engrave([chord('C4', ['D4'])], 'treble');
    const note = only(drawn);
    expect(note.chord[0].x).not.toBe(note.x);
  });

  it('runs the stem from the far head, not from the principal', () => {
    // A stem that starts at the principal leaves the outer notehead floating
    // with nothing joining it to the chord.
    const drawn = engrave([chord('G3', ['D4', 'B4'])], 'treble');
    const note = only(drawn);
    const ys = [note.y, ...note.chord.map((head) => head.y)];
    expect(note.stem).not.toBeNull();
    const near = note.stemUp ? Math.max(...ys) : Math.min(...ys);
    expect(note.stem!.from).toBeCloseTo(near, 6);
  });

  it('leaves a single note stemming exactly as it always did', () => {
    // The chord rule replaced `y > 0` and has to reduce to it. An earlier
    // version compared absolute values, which is the same number for one note
    // and made every stem point up.
    const high = engrave([{ pitch: 'B5', value: 'quarter' }], 'treble');
    const low = engrave([{ pitch: 'D4', value: 'quarter' }], 'treble');
    expect(only(high).stemUp).toBe(false);
    expect(only(low).stemUp).toBe(true);
  });

  it('gives the chord the ledger lines its outer head needs', () => {
    // The principal is inside the staff and the top note is well above it.
    const drawn = engrave([chord('G4', ['C6'])], 'treble');
    expect(only(drawn).ledgers.length).toBeGreaterThan(0);
  });

  it('spells every member against the same key and bar', () => {
    // One moment: an F sharp in the chord puts F sharp in force for the bar,
    // and a member the signature already sharpens prints nothing.
    const key = keySignatureFor('D major', 'treble');
    const [spelled] = spellAccidentals([chord('D4', ['F#4', 'A4'])], key) as StaveNote[];
    expect(spelled.printed).toBeNull();
    expect(spelled.chordPrinted?.map((m) => m.accidental)).toEqual([null, null]);
  });

  it('stacks two accidentals in one chord into separate columns', () => {
    const drawn = engrave([chord('Eb4', ['Ab4'])], 'treble');
    const note = only(drawn);
    expect(note.accidental).toBe('flat');
    expect(note.chord[0].accidental).toBe('flat');

    // **Different columns, that being the whole point.** They would otherwise
    // print on top of each other.
    expect(note.chord[0].accidentalX).not.toBeCloseTo(note.accidentalX, 3);

    // And the higher note's is the one nearest the noteheads, which is the
    // convention: a stack reads downwards and leftwards from the top of the
    // chord. This assertion used to be the other way round, on the assumption
    // that the principal takes the near column — it does not, and which note is
    // the principal is an artefact of how the file was written.
    expect(note.chord[0].accidentalX).toBeGreaterThan(note.accidentalX);
  });

  it('leaves room for the whole stack, not just one column', () => {
    // The room and the glyph positions are the same arithmetic
    // (`accidentalStack`). When they were not, a chord's outer accidental was
    // drawn further left than the space reserved for it and landed on the
    // previous note.
    const drawn = engrave(
      [
        { pitch: 'C4', value: 'quarter' },
        chord('Eb4', ['Ab4', 'Db5']),
      ],
      'treble',
    );
    const [first, second] = drawn.systems[0].notes;
    const leftmost = Math.min(
      second.accidentalX,
      ...second.chord.map((head) => head.accidentalX),
    );
    expect(leftmost).toBeGreaterThan(first.x);
  });
});

describe('playing a chord', () => {
  it('sounds every pitch at the same instant', () => {
    const schedule = scheduleScore(scoreWith([{ pitch: 'G3', chord: ['D4', 'B4'] }]), 60);
    expect(schedule.notes).toHaveLength(3);
    const starts = new Set(schedule.notes.map((n) => n.startS));
    expect(starts.size).toBe(1);
  });

  it('counts a chord as one moment for the playhead', () => {
    // `globalIndex` names what you are hearing, and a chord is one thing you
    // are hearing. Numbering its members separately would make a playhead
    // report three notes where the page has one.
    const schedule = scheduleScore(
      scoreWith([{ pitch: 'G3', chord: ['D4'] }, { pitch: 'A3' }]),
      60,
    );
    expect(schedule.notes.map((n) => n.globalIndex)).toEqual([0, 0, 1]);
  });

  it('does not let a chord advance the clock twice', () => {
    // The members share the principal's duration; if they added their own, a
    // bar with a double stop in it would run long and every bar after it would
    // be judged early.
    const plain = scheduleScore(scoreWith([{ pitch: 'G3' }]), 60);
    const stopped = scheduleScore(scoreWith([{ pitch: 'G3', chord: ['D4'] }]), 60);
    expect(stopped.durationS).toBeCloseTo(plain.durationS, 9);
  });
});
