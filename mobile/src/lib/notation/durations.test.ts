import { describe, expect, it } from 'vitest';

import type { Duration, ScoreJson } from '../../data/types';
import { BEATS } from '../score/schedule';
import { QUARTERS, TAILS, engrave, type NoteValue } from './engrave';
import { staveScoreFor } from './fromScore';

/**
 * Which of the notation the schema can carry actually reaches a stave.
 *
 * **The corpus said 100% and the corpus was the problem.**
 * `tools/engraver-coverage.py` reported every fixture fully drawn, because not
 * one of its ten pages has a note shorter than a sixteenth — and its own header
 * says so: every page in it is one somebody chose to check something with. A
 * Kreutzer study, a written-out ornament or any cadenza is thirty-seconds, and
 * the app would have drawn that page as holes with a line underneath saying how
 * many it left out.
 *
 * So the measurement that matters is not against the fixtures. It is against
 * the **schema** — every duration the backend is allowed to send — which is
 * what this file checks.
 */

function noteOf(duration: string): ScoreJson {
  return {
    clef: 'treble',
    time_signature: '4/4',
    key_signature: null,
    tempo_marking: null,
    bpm_hint: null,
    measures: [
      {
        measure_number: 1,
        notes: [{ pitch: 'B4', duration, tied_to_next: false }],
        slurs: [],
      },
    ],
    repeats: [],
    ocr_confidence: 1,
    notes_to_human: '',
  } as unknown as ScoreJson;
}

function restOf(duration: string): ScoreJson {
  const score = noteOf(duration);
  score.measures[0].notes![0].pitch = 'rest';
  return score;
}

/**
 * The four the engraver refuses, and why.
 *
 * A 128th carries five beams. At the size this app draws a stave that is a
 * black smudge, not a rhythm — and `staveScoreFor` counts what it leaves out
 * and the screen says so, which is a better answer to a musician than an
 * illegible mark presented as a reading.
 *
 * Listed rather than derived. If one of these becomes drawable the list gets
 * shorter and this test says so; if a *new* duration joins the schema
 * undrawable, it fails.
 */
const DELIBERATELY_UNDRAWN: Duration[] = [
  'one_twenty_eighth',
  'triplet_one_twenty_eighth',
  'quintuplet_one_twenty_eighth',
  'septuplet_one_twenty_eighth',
];

const ALL: Duration[] = Object.keys(BEATS) as Duration[];

describe('every duration the schema can send', () => {
  it('has more of them than the fixtures contain', () => {
    // The corpus holds fourteen distinct values. The schema holds forty-six,
    // and it is the schema a real page arrives under.
    expect(ALL.length).toBeGreaterThan(40);
  });

  it.each(ALL.filter((d) => !DELIBERATELY_UNDRAWN.includes(d)))(
    'draws a %s',
    (duration) => {
      const stave = staveScoreFor(noteOf(duration));

      expect(stave.undrawable, `${duration} was dropped`).toBe(0);
      expect(stave.noteCount, `${duration} drew nothing`).toBe(1);
    },
  );

  it.each(ALL.filter((d) => !DELIBERATELY_UNDRAWN.includes(d)))(
    'draws a %s rest',
    (duration) => {
      const stave = staveScoreFor(restOf(duration));

      expect(stave.rests, `${duration} rest was dropped`).toBe(0);
      expect(stave.items.length, `${duration} rest drew nothing`).toBe(1);
    },
  );

  it.each(DELIBERATELY_UNDRAWN)('leaves out a %s and counts it', (duration) => {
    const stave = staveScoreFor(noteOf(duration));

    expect(stave.items).toHaveLength(0);
    expect(stave.undrawable).toBe(1);
  });
});

describe('the values the engraver added', () => {
  it('gives a thirty-second three tails and a sixty-fourth four', () => {
    // The flag glyph and the beam count are the same number. Getting it wrong
    // draws a sixteenth where the page prints a thirty-second — half the note,
    // in the same ink as the notes around it that are right.
    expect(TAILS.thirty_second).toBe(3);
    expect(TAILS.sixty_fourth).toBe(4);
  });

  it('keeps QUARTERS and BEATS agreeing about how long each one is', () => {
    // Two tables in two vocabularies. Beam grouping counts in real time using
    // `QUARTERS`; the player uses `BEATS`. A disagreement beams the bar one way
    // and sounds it another.
    expect(QUARTERS.thirty_second).toBe(BEATS.thirty_second);
    expect(QUARTERS.sixty_fourth).toBe(BEATS.sixty_fourth);
    expect(QUARTERS.breve).toBe(BEATS.double_whole);
  });

  it('draws both dots of a double-dotted note', () => {
    // A double dot adds three quarters of the base value. `Stave` drew one dot
    // whatever the count, so this came out as a dotted quarter — 1.5 beats
    // where the page says 1.75.
    const stave = staveScoreFor(noteOf('double_dotted_quarter'));
    const note = stave.items[0];

    expect(note).toMatchObject({ value: 'quarter', dots: 2 });
  });

  it('answers to both spellings of a breve', () => {
    // The schema calls the plain value `double_whole` and the tuplet form
    // `triplet_breve`; `tupletOf` strips the prefix and looks up what is left.
    // One spelling in the table and the other silently drops.
    expect(staveScoreFor(noteOf('double_whole')).undrawable).toBe(0);
    expect(staveScoreFor(noteOf('triplet_breve')).undrawable).toBe(0);
  });
});

describe('the system makes room for the flag', () => {
  const LINE_GAP = 10;

  /**
   * The furthest a flag reaches past the end of its stem, in staff spaces.
   *
   * Measured out of Bravura and written here independently of the engraver's
   * own table, so this fails if either the box or that table shrinks:
   * `flag64thDown` overshoots the stem tip by 1.50 spaces, `flag32ndUp` by
   * 0.60. Every flag reaches the same 3.25 spaces back *toward* the notehead
   * whatever its value, which is why an eighth and a sixteenth sit entirely
   * inside a 3.5-space stem and need nothing.
   */
  const WORST_OVERSHOOT = 1.5;

  it.each(['eighth', 'sixteenth', 'thirty_second', 'sixty_fourth'] as NoteValue[])(
    'draws a %s inside its own box',
    (value) => {
      // **The bug this is for**: the system's height is measured from
      // `stem.to`, so the outer hooks of a sixty-fourth fell outside it and
      // were cut off — the same way an accent above a high note used to be.
      // A low note takes an up-stem, so the flag reaches toward the top edge.
      const drawing = engrave([{ pitch: 'D4', value }], 'treble', {
        lineGap: LINE_GAP,
      });
      const note = drawing.systems[0].notes[0];

      expect(note.stem).not.toBeNull();
      const reach = note.stem!.to - WORST_OVERSHOOT * LINE_GAP;
      expect(reach, `${value} is clipped at the top by ${-reach}`).toBeGreaterThanOrEqual(0);
    },
  );

  it('grows the box only for the values that need it', () => {
    // The box already carried enough slack for a thirty-second, which is why
    // the first version of this test asserted a taller box and failed: the
    // rule is that no flag falls outside, not that every value costs height.
    const boxOf = (value: NoteValue) =>
      engrave([{ pitch: 'D4', value }], 'treble', { lineGap: LINE_GAP }).height;

    expect(boxOf('sixteenth')).toBe(boxOf('eighth'));
    expect(boxOf('thirty_second')).toBe(boxOf('sixteenth'));
    expect(boxOf('sixty_fourth')).toBeGreaterThan(boxOf('thirty_second'));
  });
});
