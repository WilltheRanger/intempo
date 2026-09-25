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

  it('swells through a crescendo, and still moves no note', () => {
    // At 120 each quarter is short, so this is the notes' attacks alone; a
    // note long enough to be carried through is the next test.
    const rising = scheduleScore(
      bar([
        { ...SCALE[0], dynamics: 'p', hairpin: 'crescendo' },
        SCALE[1],
        SCALE[2],
        { ...SCALE[3], dynamics: 'f', hairpin_end: true },
      ]),
      120,
    ).notes;
    const flat = scheduleScore(bar([{ ...SCALE[0], dynamics: 'p' }, SCALE[1], SCALE[2], SCALE[3]]), 120)
      .notes;
    // Each note of the crescendo is louder than the same note left at piano,
    // and more so the further along it is.
    const lift = rising.map((note, index) => note.velocity! - flat[index].velocity!);
    expect(lift[0]).toBe(0);
    expect(lift).toEqual([...lift].sort((a, b) => a - b));
    expect(lift[3]).toBeGreaterThan(20);
    expect(rising.map((note) => note.startS)).toEqual(flat.map((note) => note.startS));
  });

  it('carries a held note through its hairpin', () => {
    const whole = { pitch: 'C4', duration: 'whole' as const, tied_to_next: false };
    const [held] = scheduleScore(
      {
        ...bar([{ ...whole, dynamics: 'p', hairpin: 'crescendo' }]),
        measures: [
          { measure_number: 1, notes: [{ ...whole, dynamics: 'p', hairpin: 'crescendo' }], slurs: [] },
          { measure_number: 2, notes: [{ ...whole, dynamics: 'f', hairpin_end: true }], slurs: [] },
        ],
      },
      60,
    ).notes;
    // Struck at the loud end, and brought in quiet: the expression opens low
    // and rises to the neutral level as the bar goes on.
    expect(held.expression).toBeDefined();
    expect(held.expression!.from).toBeLessThan(held.expression!.to);
    expect(held.expression!.to).toBeLessThanOrEqual(120);
    const [struckAtPiano] = scheduleScore(bar([{ ...whole, dynamics: 'p' }]), 60).notes;
    expect(held.velocity!).toBeGreaterThan(struckAtPiano.velocity! + 20);
    expect(struckAtPiano.expression).toBeUndefined();
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

describe('grace notes', () => {
  /** Quarters at 60, a beat to the second. */
  function line(notes: ScoreJson['measures'][number]['notes']): ScoreJson {
    return {
      time_signature: '4/4',
      key_signature: 'C major',
      tempo_marking: null,
      bpm_hint: null,
      clef: 'treble',
      measures: [{ measure_number: 1, notes, slurs: [] }],
      repeats: [],
      ocr_confidence: 1,
      notes_to_human: '',
    };
  }
  const quarter = (pitch: string, extra = {}) => ({
    pitch,
    duration: 'quarter' as const,
    tied_to_next: false,
    ...extra,
  });
  const plain = scheduleScore(line(['C4', 'D4', 'E4', 'F4'].map((p) => quarter(p))), 60);

  it('sound just before the note they lead into, which does not move', () => {
    const schedule = scheduleScore(
      line([
        quarter('C4'),
        quarter('D4', { grace_notes: 2, grace_pitches: ['F4', 'E4'] }),
        quarter('E4'),
        quarter('F4'),
      ]),
      60,
    );
    const [c, graceF, graceE, d] = schedule.notes;
    expect(d.startS).toBe(plain.notes[1].startS);
    expect(graceE.startS + graceE.durationS).toBeCloseTo(d.startS);
    expect(graceF.startS).toBeLessThan(graceE.startS);
    expect(graceF.startS).toBeGreaterThan(c.startS);
    expect([graceF.frequency, graceE.frequency].map(Math.round)).toEqual([349, 330]);
    expect(graceE.velocity!).toBeLessThan(d.velocity!);
    expect(graceE.legato).toBe(true);
    expect(schedule.notes.filter((n) => !plain.notes.some((q) => q.startS === n.startS)))
      .toHaveLength(2);
    // Time order, which the playhead's scan rests on.
    const starts = schedule.notes.map((note) => note.startS);
    expect(starts).toEqual([...starts].sort((a, b) => a - b));
  });

  it('stay silent when their notes are not all known', () => {
    for (const marks of [
      { grace_notes: 1 },
      { grace_notes: 2, grace_pitches: ['E4'] },
      { grace_notes: 1, grace_pitches: ['H9'] },
    ]) {
      const schedule = scheduleScore(
        line([quarter('C4'), quarter('D4', marks), quarter('E4'), quarter('F4')]),
        60,
      );
      expect(schedule.notes).toEqual(plain.notes);
    }
  });

  it('take no more than half of a fast note before them', () => {
    const fast = scheduleScore(
      line([
        quarter('C4'),
        quarter('D4', { grace_notes: 3, grace_pitches: ['E4', 'F4', 'G4'] }),
        quarter('E4'),
        quarter('F4'),
      ]),
      480,
    );
    const beat = 60 / 480;
    const firstGrace = fast.notes[1];
    expect(firstGrace.startS).toBeGreaterThanOrEqual(beat / 2 - 1e-9);
  });

  it('on the very first note, start the piece a little later rather than be lost', () => {
    const schedule = scheduleScore(
      line([
        quarter('C4', { grace_notes: 1, grace_pitches: ['D4'] }),
        quarter('D4'),
        quarter('E4'),
        quarter('F4'),
      ]),
      60,
    );
    const [grace, ...rest] = schedule.notes;
    expect(grace.startS).toBe(0);
    // Everything after moves together: no note moves against another.
    rest.forEach((note, index) => {
      expect(note.startS - rest[0].startS).toBeCloseTo(plain.notes[index].startS, 9);
    });
    expect(schedule.durationS - rest[0].startS).toBeCloseTo(plain.durationS, 9);
  });
});

describe('a page that changes tempo', () => {
  // Marked 104; "meno mosso · 88" from bar 3. Four quarters a bar.
  const stepped = (bpmHint: number | null): ScoreJson =>
    ({
      clef: 'treble',
      time_signature: '4/4',
      ocr_confidence: 1,
      bpm_hint: bpmHint,
      measures: Array.from({ length: 4 }, (_, i) => ({
        measure_number: i + 1,
        notes: Array.from({ length: 4 }, () => ({ pitch: 'A4', duration: 'quarter' })),
      })),
      tempo_changes: [{ measure_number: 3, kind: 'new_tempo', text: 'meno mosso', bpm: 88 }],
    }) as unknown as ScoreJson;

  it('plays the new tempo from its bar, and nothing before it moves', () => {
    const played = scheduleScore(stepped(104), 104);
    const bar = (n: number) => played.notes.filter((note) => note.measureNumber === n);

    expect(bar(1)[1].startS - bar(1)[0].startS).toBeCloseTo(60 / 104);
    expect(bar(3)[1].startS - bar(3)[0].startS).toBeCloseTo(60 / 88);
    expect(bar(3)[0].startS).toBeCloseTo((8 * 60) / 104);
  });

  it('scales the new tempo with the tempo Listen is set to', () => {
    const played = scheduleScore(stepped(104), 52);
    const bar3 = played.notes.filter((note) => note.measureNumber === 3);

    expect(bar3[1].startS - bar3[0].startS).toBeCloseTo(60 / 44);
  });
});
