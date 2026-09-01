import { describe, expect, it } from 'vitest';

import contract from '../../../../fixtures/practice/start_at.json';
import type { ScoreJson } from '../../data/types';
import { startFromMeasure } from './startFrom';

/**
 * The app's half of `fixtures/practice/start_at.json`.
 *
 * The backend runs the same cases in `test_start_at_parity.py`. Two
 * implementations of one rule, in two languages, and a drift between them
 * means the take is judged against a different score than the one it was
 * played to — which is the exact failure this feature exists to avoid.
 */
interface Case {
  name: string;
  bars: number[];
  repeats: [number, number][];
  tempo_changes: [number, string][];
  from_measure: number;
  out_bars: number[];
  out_repeats: [number, number][];
  out_tempo_changes: [number, string][];
}

function scoreFrom(item: Case): ScoreJson {
  return {
    time_signature: '4/4',
    key_signature: null,
    tempo_marking: null,
    bpm_hint: null,
    clef: 'treble',
    measures: item.bars.map((measure_number) => ({
      measure_number,
      notes: [{ pitch: 'D4', duration: 'quarter' as const, tied_to_next: false }],
      slurs: [],
    })),
    repeats: item.repeats.map(([start_measure, end_measure]) => ({
      start_measure,
      end_measure,
      type: 'repeat' as const,
    })),
    tempo_changes: item.tempo_changes.map(([measure_number, kind]) => ({
      measure_number,
      kind: kind as 'ritardando' | 'accelerando' | 'a_tempo',
      text: kind,
    })),
    ocr_confidence: 1,
    notes_to_human: '',
  } as ScoreJson;
}

describe('starting a take partway in — the shared contract', () => {
  it.each((contract.cases as Case[]).map((item) => [item.name, item] as const))(
    '%s',
    (_name, item) => {
      const out = startFromMeasure(scoreFrom(item), item.from_measure);

      expect(out.measures.map((m) => m.measure_number)).toEqual(item.out_bars);
      expect(
        (out.repeats ?? []).map((r) => [r.start_measure, r.end_measure]),
      ).toEqual(item.out_repeats);
      expect(
        (out.tempo_changes ?? []).map((c) => [c.measure_number, c.kind]),
      ).toEqual(item.out_tempo_changes);
    },
  );
});
