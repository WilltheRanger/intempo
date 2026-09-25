import { describe, expect, it } from 'vitest';

import contract from '../../../../fixtures/practice/tempo_map.json';
import type { ScoreJson, ScoreTempoChange } from '../../data/types';
import { statedTempoByMeasure, tempoByMeasure } from './tempoMap';

/**
 * The app's half of `fixtures/practice/tempo_map.json`; the backend runs the
 * same cases in `test_tempo_map_parity.py`. A drift between them is Listen
 * playing a meno mosso at one tempo while the analysis judges it at another.
 */
interface Case {
  name: string;
  bars: number;
  tempo_changes: [number, ScoreTempoChange['kind'], string, number | null][];
  stated: (number | null)[];
}

function scoreOf(c: Case, bpmHint: number | null = null): ScoreJson {
  return {
    clef: 'treble',
    time_signature: '4/4',
    ocr_confidence: 1,
    bpm_hint: bpmHint,
    measures: Array.from({ length: c.bars }, (_, i) => ({
      measure_number: i + 1,
      notes: [{ pitch: 'D4', duration: 'whole' }],
    })),
    tempo_changes: c.tempo_changes.map(([measure_number, kind, text, bpm]) => ({
      measure_number,
      kind,
      text,
      bpm,
    })),
  } as unknown as ScoreJson;
}

describe('the shared tempo map contract', () => {
  for (const c of (contract as unknown as { cases: Case[] }).cases) {
    it(c.name, () => {
      const stated = statedTempoByMeasure(scoreOf(c));
      expect(Array.from({ length: c.bars }, (_, i) => stated.get(i + 1) ?? null)).toEqual(c.stated);
    });
  }
});

describe('the tempo a bar is played at', () => {
  it('scales a stated tempo with the performance, through the marked tempo', () => {
    const c = (contract as unknown as { cases: Case[] }).cases[1];
    const tempi = tempoByMeasure(scoreOf(c, 104), 52);

    expect(tempi.get(1)).toBe(52);
    expect(tempi.get(3)).toBe(44);
  });
});
