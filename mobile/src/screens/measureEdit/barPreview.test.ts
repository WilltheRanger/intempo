import { describe, expect, it } from 'vitest';

import type { ScoreJson, ScoreMeasure, ScoreNote } from '../../data/types';
import { barPreviewScore, contextAt } from './barPreview';

const note = (pitch: string, duration: ScoreNote['duration'] = 'quarter') =>
  ({ pitch, duration }) as ScoreNote;

function score(measures: Partial<ScoreMeasure>[]): ScoreJson {
  return {
    time_signature: '4/4',
    key_signature: 'G major',
    tempo_marking: null,
    bpm_hint: 96,
    clef: 'treble',
    measures: measures.map((m, i) => ({
      measure_number: i + 1,
      notes: [note('G4', 'whole')],
      slurs: [],
      ...m,
    })) as ScoreMeasure[],
    repeats: [{ start_measure: 1, end_measure: 2 }] as unknown as ScoreJson['repeats'],
    tempo_changes: [{ measure: 2 }] as unknown as ScoreJson['tempo_changes'],
    ocr_confidence: 0.9,
    notes_to_human: '',
  };
}

describe('contextAt', () => {
  it('is the page’s opening where nothing has changed', () => {
    const s = score([{}, {}]);
    expect(contextAt(s, s.measures[1])).toEqual({ key: 'G major', clef: 'treble', meter: '4/4' });
  });

  it('carries a change from an earlier bar, and takes the bar’s own change over it', () => {
    const s = score([{}, { clef: 'tenor', key_signature: 'F major' }, {}, { time_signature: '3/4' }]);
    expect(contextAt(s, s.measures[2])).toEqual({ key: 'F major', clef: 'tenor', meter: '4/4' });
    expect(contextAt(s, s.measures[3]).meter).toBe('3/4');
    expect(contextAt(s, s.measures[1]).clef).toBe('tenor');
  });
});

describe('barPreviewScore', () => {
  const s = score([{}, { clef: 'tenor' }]);

  it('is one bar, opened in what it is read in, without the page’s repeats or tempo marks', () => {
    const preview = barPreviewScore(s, s.measures[1], contextAt(s, s.measures[1]));
    expect(preview.measures).toHaveLength(1);
    expect(preview.clef).toBe('tenor');
    expect(preview.measures[0].clef).toBeUndefined();
    expect(preview.repeats).toEqual([]);
    expect(preview.tempo_changes).toEqual([]);
  });

  it('draws the working notes, so an edit shows before it is saved', () => {
    const working = { notes: [note('A4', 'half'), note('B4', 'half')], marks: { slurs: [], tuplets: [] } };
    const preview = barPreviewScore(s, s.measures[0], contextAt(s, s.measures[0]), working);
    expect(preview.measures[0].notes.map((n) => n.pitch)).toEqual(['A4', 'B4']);
    expect(preview.measures[0].measure_number).toBe(1);
  });
});
