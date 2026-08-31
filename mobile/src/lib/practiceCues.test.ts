import { describe, expect, it } from 'vitest';

import type { Duration, ScoreJson } from '../data/types';
import { longRestCues, MIN_BARS_TO_CUE, restCueAt } from './practiceCues';

function scoreOf(
  bars: Array<Array<'note' | 'rest'>>,
  durations: Duration[] = ['whole'],
): ScoreJson {
  return {
    clef: 'bass',
    time_signature: '4/4',
    key_signature: null,
    tempo_marking: null,
    bpm_hint: 60,
    repeats: [],
    ocr_confidence: 1,
    notes_to_human: '',
    measures: bars.map((notes, index) => ({
      measure_number: index + 1,
      slurs: [],
      notes: notes.map((kind, noteIndex) => ({
        pitch: kind === 'rest' ? 'rest' : 'E2',
        duration: durations[noteIndex] ?? durations[0] ?? 'quarter',
        tied_to_next: false,
      })),
    })),
  };
}

describe('longRestCues', () => {
  it('cues two or more silent bars and names the re-entry measure', () => {
    const cues = longRestCues(
      scoreOf([['note'], ['rest'], ['rest'], ['note']]),
    );

    expect(MIN_BARS_TO_CUE).toBe(2);
    expect(cues).toEqual([
      {
        startBeat: 4,
        endBeat: 12,
        barEndBeats: [8, 12],
        bars: 2,
        resumeMeasure: 4,
      },
    ]);
  });

  it('uses written durations, the same clock as playback and alignment', () => {
    const score = scoreOf(
      [['note'], ['rest'], ['rest'], ['note']],
      ['dotted_half'],
    );

    expect(longRestCues(score)[0]).toMatchObject({
      startBeat: 3,
      endBeat: 9,
      barEndBeats: [6, 9],
    });
  });

  it('does not call an empty bar, isolated rest, or trailing rest a re-entry cue', () => {
    const score = scoreOf([
      ['note'],
      [],
      ['rest'],
      ['note'],
      ['rest'],
      ['rest'],
    ]);

    expect(longRestCues(score)).toEqual([]);
  });

  it('follows repeats so every performed re-entry is cued', () => {
    const score = scoreOf([['note'], ['rest'], ['rest'], ['note']]);
    score.repeats = [
      { start_measure: 1, end_measure: 3, type: 'repeat' },
    ];

    expect(longRestCues(score)).toEqual([
      {
        startBeat: 4,
        endBeat: 12,
        barEndBeats: [8, 12],
        bars: 2,
        resumeMeasure: 1,
      },
      {
        startBeat: 16,
        endBeat: 24,
        barEndBeats: [20, 24],
        bars: 2,
        resumeMeasure: 4,
      },
    ]);
  });

  it('can cue the one kept bar when the skip-rest practice mode is active', () => {
    const cues = longRestCues(scoreOf([['note'], ['rest'], ['note']]), 1);
    expect(cues).toHaveLength(1);
    expect(cues[0].resumeMeasure).toBe(3);
  });
});

describe('restCueAt', () => {
  const cues = longRestCues(
    scoreOf([['note'], ['rest'], ['rest'], ['note']]),
  );

  it('shows bars first, then an exact beat countdown in the final bar', () => {
    expect(restCueAt(cues, 4_000, 60)).toMatchObject({
      barsRemaining: 2,
      beatsRemainingInBar: 4,
    });
    expect(restCueAt(cues, 8_000, 60)).toMatchObject({
      barsRemaining: 1,
      beatsRemainingInBar: 4,
    });
    expect(restCueAt(cues, 11_100, 60)).toMatchObject({
      barsRemaining: 1,
      beatsRemainingInBar: 1,
    });
  });

  it('is absent before the rest and on the re-entry downbeat', () => {
    expect(restCueAt(cues, 3_999, 60)).toBeNull();
    expect(restCueAt(cues, 12_000, 60)).toBeNull();
  });

  it('scales the same written beats to a different target tempo', () => {
    expect(restCueAt(cues, 2_000, 120)).toMatchObject({
      barsRemaining: 2,
      beatsRemainingInBar: 4,
    });
  });
});
