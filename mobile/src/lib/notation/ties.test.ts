import { describe, expect, it } from 'vitest';

import { readTies } from './ties';
import { scheduleScore } from '../score/schedule';
import type { ScoreJson, ScoreMeasure, ScoreNote } from '../../data/types';

const n = (pitch: string, duration = 'quarter', tied = false): ScoreNote =>
  ({ pitch, duration, tied_to_next: tied }) as ScoreNote;

const bar = (number: number, notes: ScoreNote[]): ScoreMeasure => ({
  measure_number: number,
  notes,
  slurs: [],
});

const score = (measures: ScoreMeasure[]): ScoreJson =>
  ({
    time_signature: '4/4',
    key_signature: 'C major',
    tempo_marking: null,
    bpm_hint: null,
    clef: 'bass',
    measures,
    repeats: [],
    ocr_confidence: 0.9,
    notes_to_human: '',
  }) as ScoreJson;

describe('reading ties', () => {
  it('absorbs a tie between the same pitch', () => {
    const { absorbed, broken } = readTies([bar(1, [n('E2', 'quarter', true), n('E2')])]);
    expect(absorbed).toEqual([false, true]);
    expect(broken).toEqual([false, false]);
  });

  it('does not absorb a curve between two different pitches', () => {
    // A tie joins one pitch to itself. Between two pitches it is a slur, and
    // the two notes sound separately.
    const { absorbed, broken } = readTies([bar(1, [n('E2', 'quarter', true), n('G2')])]);
    expect(absorbed).toEqual([false, false]);
    expect(broken).toEqual([false, true]);
  });

  it('reaches across a barline', () => {
    // The commonest kind of tie, and the one the per-measure loop could not see.
    const { absorbed } = readTies([
      bar(1, [n('E2'), n('E2', 'quarter', true)]),
      bar(2, [n('E2'), n('E2')]),
    ]);
    expect(absorbed[2]).toBe(true);
  });

  it('will not tie a rest', () => {
    const { absorbed, broken } = readTies([bar(1, [n('rest', 'quarter', true), n('E2')])]);
    expect(absorbed.some(Boolean)).toBe(false);
    expect(broken.some(Boolean)).toBe(false);
  });
});

describe('what the app plays', () => {
  // The *written* length is what this is about, so the notes are asked to
  // sound all of it. This used to divide by a copy of the default articulation,
  // which broke the day the default changed.
  const WRITTEN = { articulation: 1 };
  const at = (s: ReturnType<typeof scheduleScore>) =>
    s.notes.map((x) => [
      Number(x.startS.toFixed(3)),
      Number(x.durationS.toFixed(3)),
    ]);

  it('holds a real tie as one sound', () => {
    // Two tied quarters at 60bpm: one note, two seconds long.
    const s = scheduleScore(
      score([bar(1, [n('E2', 'quarter', true), n('E2')])]),
      60,
      WRITTEN,
    );
    expect(s.notes).toHaveLength(1);
    expect(at(s)).toEqual([[0, 2]]);
  });

  it('holds a tie that crosses a barline', () => {
    // This used to re-attack the second note, because the loop stopped at the
    // end of the measure — while the analysis held it straight through.
    const s = scheduleScore(
      score([bar(1, [n('E2', 'quarter', true)]), bar(2, [n('E2'), n('E2')])]),
      60,
      WRITTEN,
    );
    expect(s.notes).toHaveLength(2);
    expect(at(s)).toEqual([[0, 2], [2, 1]]);
  });

  it('sounds a slur written as a tie as two notes', () => {
    // The app merged these into one long note while the backend counted two.
    const s = scheduleScore(
      score([bar(1, [n('E2', 'quarter', true), n('G2')])]),
      60,
      WRITTEN,
    );
    expect(s.notes).toHaveLength(2);
    expect(at(s)).toEqual([[0, 1], [1, 1]]);
  });

  it('keeps the total length of the piece right', () => {
    // Whatever is absorbed, the clock must still cover every written beat.
    const s = scheduleScore(
      score([
        bar(1, [n('E2', 'quarter', true), n('E2'), n('E2'), n('E2')]),
        bar(2, [n('G2'), n('G2'), n('G2'), n('G2')]),
      ]),
      60,
    );
    expect(s.durationS).toBeCloseTo(8, 6);
  });

  it('still names the measure a note came from', () => {
    const s = scheduleScore(
      score([bar(1, [n('E2'), n('E2')]), bar(2, [n('G2'), n('G2')])]),
      60,
    );
    expect(s.notes.map((x) => x.measureNumber)).toEqual([1, 1, 2, 2]);
  });
});
