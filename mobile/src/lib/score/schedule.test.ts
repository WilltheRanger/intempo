import { describe, expect, it } from 'vitest';

import type { ScoreJson } from '../../data/types';
import { FALLBACK_BPM, scheduleScore } from './schedule';

describe('a tempo that is not a number', () => {
  /**
   * **`Math.max(1, NaN)` is `NaN`**, so the clamp that looks like a guard is
   * not one. A non-finite tempo propagated into every note's start and
   * duration, and Web Audio throws on a non-finite time — out of the middle of
   * the scheduling loop, after earlier notes had already been started, with
   * nothing returned that could stop them.
   */
  const TWO_NOTES: ScoreJson = {
    time_signature: '4/4',
    key_signature: 'C major',
    tempo_marking: null,
    bpm_hint: null,
    clef: 'treble',
    measures: [
      {
        measure_number: 1,
        notes: [
          { pitch: 'D4', duration: 'quarter', tied_to_next: false },
          { pitch: 'E4', duration: 'quarter', tied_to_next: false },
        ],
        slurs: [],
      },
    ],
    repeats: [],
    ocr_confidence: 1,
    notes_to_human: '',
  };

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    'still produces a playable schedule at %s BPM',
    (bpm) => {
      const schedule = scheduleScore(TWO_NOTES, bpm);

      expect(Number.isFinite(schedule.durationS)).toBe(true);
      expect(schedule.durationS).toBeGreaterThan(0);
      for (const note of schedule.notes) {
        expect(Number.isFinite(note.startS)).toBe(true);
        expect(Number.isFinite(note.durationS)).toBe(true);
        expect(note.durationS).toBeGreaterThan(0);
      }
    },
  );

  it('agrees with the tempo store about what "no usable tempo" sounds like', () => {
    // One constant, re-exported by `practiceTempo`, so there is nothing to
    // drift. This pins the behaviour rather than the number.
    expect(scheduleScore(TWO_NOTES, Number.NaN).durationS).toBe(
      scheduleScore(TWO_NOTES, FALLBACK_BPM).durationS,
    );
  });
});

describe('how the notes are played', () => {
  /** One bar of 4/4 at 60, so a beat is a second. */
  function bar(
    notes: ScoreJson['measures'][number]['notes'],
    slurs: ScoreJson['measures'][number]['slurs'] = [],
  ): ScoreJson {
    return {
      time_signature: '4/4',
      key_signature: 'C major',
      tempo_marking: null,
      bpm_hint: null,
      clef: 'treble',
      measures: [{ measure_number: 1, notes, slurs }],
      repeats: [],
      ocr_confidence: 1,
      notes_to_human: '',
    };
  }
  const quarter = (pitch: string) => ({
    pitch,
    duration: 'quarter' as const,
    tied_to_next: false,
  });
  const SCALE = ['C4', 'D4', 'E4', 'F4'].map(quarter);

  /**
   * **The rule every other one here is under.** A reference that moved a
   * note to sound more human would teach the musician a rhythm the analysis
   * then marks them down for.
   */
  it('never moves a note', () => {
    const plain = scheduleScore(bar(SCALE), 60);
    const marked = scheduleScore(
      bar(
        [
          { ...SCALE[0], dynamics: 'p' },
          { ...SCALE[1], articulation: 'accent' },
          SCALE[2],
          { ...SCALE[3], dynamics: 'sfz' },
        ],
        [{ start_note_index: 0, end_note_index: 2 }],
      ),
      60,
    );
    expect(marked.notes.map((note) => note.startS)).toEqual(
      plain.notes.map((note) => note.startS),
    );
    expect(marked.durationS).toBe(plain.durationS);
  });

  it('plays a written dynamic until the next one', () => {
    const notes = scheduleScore(
      bar([{ ...SCALE[0], dynamics: 'p' }, SCALE[1], SCALE[2], SCALE[3]]),
      60,
    ).notes;
    const loud = scheduleScore(
      bar([{ ...SCALE[0], dynamics: 'f' }, SCALE[1], SCALE[2], SCALE[3]]),
      60,
    ).notes;
    notes.forEach((note, index) => {
      expect(note.velocity!).toBeLessThan(loud[index].velocity!);
    });
  });

  it('leans on the downbeat of an unmarked bar', () => {
    const [first, second, third, fourth] = scheduleScore(bar(SCALE), 60).notes;
    expect(first.velocity!).toBeGreaterThan(second.velocity!);
    expect(first.velocity!).toBeGreaterThan(fourth.velocity!);
    expect(third.velocity!).toBeGreaterThanOrEqual(fourth.velocity! - 2);
  });

  it('holds slurred notes their whole value into the next, and separates the last', () => {
    const notes = scheduleScore(
      bar(SCALE, [{ start_note_index: 0, end_note_index: 2 }]),
      60,
    ).notes;
    expect(notes.map((note) => note.legato ?? false)).toEqual([true, true, false, false]);
    expect(notes[0].durationS).toBe(1);
    expect(notes[1].durationS).toBe(1);
    // The slur's last note ends the bow stroke: an ordinary gap after it.
    expect(notes[2].durationS).toBeLessThan(1);
    // No new bow on the notes the slur carries on to.
    expect(notes[1].velocity!).toBeLessThan(
      scheduleScore(bar(SCALE), 60).notes[1].velocity!,
    );
  });

  it('keeps a staccato short under a slur', () => {
    const notes = scheduleScore(
      bar(
        [{ ...SCALE[0], articulation: 'staccato' }, SCALE[1], SCALE[2], SCALE[3]],
        [{ start_note_index: 0, end_note_index: 1 }],
      ),
      60,
    ).notes;
    expect(notes[0].legato).toBeUndefined();
    expect(notes[0].durationS).toBe(0.5);
  });

  it('carries the dynamic of a note tied over onto what follows', () => {
    const notes = scheduleScore(
      bar([
        { ...SCALE[0], tied_to_next: true },
        { ...SCALE[0], dynamics: 'pp' },
        SCALE[2],
        SCALE[3],
      ]),
      60,
    ).notes;
    expect(notes).toHaveLength(3);
    expect(notes[1].velocity!).toBeLessThan(notes[0].velocity! - 10);
  });
});
