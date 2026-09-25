import { describe, expect, it } from 'vitest';

import type { ScoreJson, ScoreTempoChange } from '../../data/types';
import {
  applyTempoMarkEdit,
  choiceOf,
  describeTempoMark,
  markFor,
  nextMetronomeMark,
  printedAfterStep,
  printedForNewTempo,
  startingBpm,
  statedTempoBefore,
  tempoMarksAt,
  usualPrinted,
} from './tempoMarkEdit';

function score(changes: ScoreTempoChange[], bpmHint: number | null = 104): ScoreJson {
  return {
    clef: 'bass',
    time_signature: '4/4',
    ocr_confidence: 1,
    bpm_hint: bpmHint,
    measures: Array.from({ length: 12 }, (_, i) => ({
      measure_number: i + 1,
      notes: [{ pitch: 'E2', duration: 'whole' }],
    })),
    tempo_changes: changes,
  } as unknown as ScoreJson;
}

const MENO: ScoreTempoChange = { measure_number: 5, kind: 'new_tempo', text: 'meno mosso', bpm: 88 };

describe('the tempo in force as a bar begins', () => {
  it('is the opening before anything is marked', () => {
    expect(statedTempoBefore(score([]), 9)).toBeNull();
    expect(startingBpm(score([]), 9)).toBe(104);
    expect(startingBpm(score([], null), 9)).toBe(100);
  });

  it('follows a new tempo, and "a tempo" back from a rit. inside it', () => {
    const marks = [
      MENO,
      { measure_number: 7, kind: 'ritardando', text: 'poco rit.' },
      { measure_number: 9, kind: 'a_tempo', text: 'a tempo' },
    ] as ScoreTempoChange[];

    expect(statedTempoBefore(score(marks), 6)).toBe(88);
    expect(statedTempoBefore(score(marks), 10)).toBe(88);
    expect(startingBpm(score(marks), 10)).toBe(88);
  });

  it('goes back to the opening at "Tempo I"', () => {
    const marks = [MENO, { measure_number: 9, kind: 'a_tempo', text: 'Tempo I' }] as ScoreTempoChange[];

    expect(statedTempoBefore(score(marks), 10)).toBeNull();
  });

  it('does not count a marking printed at the bar itself', () => {
    expect(statedTempoBefore(score([MENO]), 5)).toBeNull();
  });
});

describe('writing a marking', () => {
  it('keeps what was typed, or writes what is usually printed', () => {
    expect(markFor('slowing', 3, 'poco rit.', null)).toEqual({
      measure_number: 3,
      kind: 'ritardando',
      text: 'poco rit.',
    });
    expect(markFor('slowing', 3, '  ', null).text).toBe('rit.');
    expect(markFor('speeding', 3, '', null).kind).toBe('accelerando');
  });

  it('writes "Tempo I" so the analysis recognises it', () => {
    const mark = markFor('tempo_primo', 9, 'back to the start', null);

    expect(mark.kind).toBe('a_tempo');
    expect(choiceOf(mark)).toBe('tempo_primo');
  });

  it('writes a new tempo with its number, held to what the schema allows', () => {
    expect(markFor('new_tempo', 5, 'meno mosso', 88)).toEqual(MENO);
    expect(markFor('new_tempo', 5, '', 500).bpm).toBe(300);
    expect(markFor('new_tempo', 5, '', 88).text).toBe('new tempo');
  });

  it('suggests the usual words for which way a new tempo goes', () => {
    expect(printedForNewTempo(88, 104)).toBe('meno mosso');
    expect(printedForNewTempo(120, 104)).toBe('più mosso');
    expect(printedForNewTempo(104, 104)).toBe('');
  });
});

describe('the score', () => {
  it('holds one marking per bar, in bar order', () => {
    const marked = applyTempoMarkEdit(score([MENO]), 2, markFor('slowing', 2, 'rall.', null));
    const replaced = applyTempoMarkEdit(marked, 5, markFor('a_tempo', 5, '', null));

    expect(replaced.tempo_changes!.map((c) => [c.measure_number, c.kind])).toEqual([
      [2, 'ritardando'],
      [5, 'a_tempo'],
    ]);
    expect(tempoMarksAt(replaced, 5)).toHaveLength(1);
  });

  it('removes a marking', () => {
    expect(applyTempoMarkEdit(score([MENO]), 5, null).tempo_changes).toEqual([]);
  });
});

describe('the settings row', () => {
  it('says the marking as printed, and a new tempo with its number', () => {
    expect(describeTempoMark(null)).toBe('No change at this bar');
    expect(describeTempoMark({ measure_number: 3, kind: 'ritardando', text: 'poco rit.' })).toBe(
      'poco rit.',
    );
    expect(describeTempoMark(MENO)).toBe('meno mosso · 88');
  });
});

describe('the stepper', () => {
  it('steps through the marks on a metronome', () => {
    expect(nextMetronomeMark(104, -1)).toBe(100);
    expect(nextMetronomeMark(100, -1)).toBe(96);
    expect(nextMetronomeMark(90, 1)).toBe(92);
    expect(nextMetronomeMark(208, 1)).toBe(209);
    expect(nextMetronomeMark(20, -1)).toBe(20);
  });

  it('keeps suggesting the words until the musician types their own', () => {
    expect(usualPrinted('new_tempo', 88, 104)).toBe('meno mosso');
    expect(usualPrinted('slowing', 88, 104)).toBe('rit.');
    expect(printedAfterStep('meno mosso', 112, 104)).toBe('più mosso');
    expect(printedAfterStep('Andante', 112, 104)).toBe('Andante');
  });
});
