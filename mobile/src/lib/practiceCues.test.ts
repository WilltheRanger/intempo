import { describe, expect, it } from 'vitest';

import type { Duration, ScoreJson } from '../data/types';
import {
  longRestCues,
  MIN_BARS_TO_CUE,
  restCueAt,
  restPulseDots,
} from './practiceCues';

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

describe('the pulse a rest is counted on', () => {
  /*
   * **The value the screen flashes and the device taps on.**
   *
   * It has to change exactly once per felt pulse and hold steady between, or
   * the flash either stutters or runs as a second clock beside the metronome —
   * which is the failure the whole cue exists to prevent, arrived at from the
   * other side.
   */
  it('advances once per beat and holds between beats', () => {
    const cues = longRestCues(scoreOf([['note'], ['rest'], ['rest'], ['note']]));
    // 60 BPM, so one quarter-note beat is one second. The rest starts at beat
    // 4 and runs to 12: eight pulses.
    const at = (seconds: number) => restCueAt(cues, seconds * 1000, 60)?.pulse;

    expect(at(4)).toBe(0);
    expect(at(4.4)).toBe(0);
    expect(at(4.9)).toBe(0);
    expect(at(5)).toBe(1);
    expect(at(5.5)).toBe(1);
    expect(at(6)).toBe(2);
  });

  it('keeps counting across the bar line rather than restarting', () => {
    // A rest of two bars is eight pulses, not two runs of four — restarting at
    // the bar would show the same number twice in a row and read as a stall.
    const cues = longRestCues(scoreOf([['note'], ['rest'], ['rest'], ['note']]));

    expect(restCueAt(cues, 7999, 60)?.pulse).toBe(3);
    expect(restCueAt(cues, 8000, 60)?.pulse).toBe(4);
    expect(restCueAt(cues, 11000, 60)?.pulse).toBe(7);
  });
});

describe('longRestCues', () => {
  it('cues a silent bar and names the re-entry measure', () => {
    const cues = longRestCues(
      scoreOf([['note'], ['rest'], ['rest'], ['note']]),
    );

    // One bar since 2026-09-13, not two. A single silent bar is long enough to
    // lose the count in and was the one case nothing on screen acknowledged.
    expect(MIN_BARS_TO_CUE).toBe(1);
    expect(cues).toEqual([
      {
        startBeat: 4,
        endBeat: 12,
        barEndBeats: [8, 12],
        barQuarterBeatsPerPulse: [1, 1],
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

  /*
   * **A single rest is now a cue, and the other two cases are still not.**
   *
   * This asserted all three were silent, which was true while the threshold
   * was two bars. Lowering it to one deliberately changes the middle case —
   * so the test is split rather than relaxed, and the two properties that did
   * not change are still pinned here.
   */
  it('cues a lone silent bar that leads back into music', () => {
    const score = scoreOf([
      ['note'],
      [],
      ['rest'],
      ['note'],
      ['rest'],
      ['rest'],
    ]);

    expect(longRestCues(score)).toEqual([
      {
        startBeat: 4,
        endBeat: 8,
        barEndBeats: [8],
        barQuarterBeatsPerPulse: [1],
        bars: 1,
        resumeMeasure: 4,
      },
    ]);
  });

  it('still refuses an empty bar and a trailing rest, whatever the threshold', () => {
    // An empty bar is a hole in the reading, not silence the musician counts.
    expect(longRestCues(scoreOf([['note'], [], ['note']]))).toEqual([]);
    // Trailing silence has no re-entry, so there is nothing to come in for.
    expect(longRestCues(scoreOf([['note'], ['rest'], ['rest']]))).toEqual([]);
  });

  it('does not cue an unreadable bar or jump across it to a later note', () => {
    const score = scoreOf([['rest'], ['rest'], [], ['note']]);

    expect(longRestCues(score)).toEqual([]);
  });

  it('still cues a later complete rest run after an unreadable bar', () => {
    const score = scoreOf([
      ['rest'], ['rest'], [], ['rest'], ['rest'], ['note'],
    ]);

    expect(longRestCues(score)).toEqual([
      {
        startBeat: 8,
        endBeat: 16,
        barEndBeats: [12, 16],
        barQuarterBeatsPerPulse: [1, 1],
        bars: 2,
        resumeMeasure: 6,
      },
    ]);
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
        barQuarterBeatsPerPulse: [1, 1],
        bars: 2,
        resumeMeasure: 1,
      },
      {
        startBeat: 16,
        endBeat: 24,
        barEndBeats: [20, 24],
        barQuarterBeatsPerPulse: [1, 1],
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

  it('counts a 6/8 final bar in dotted-quarter pulses', () => {
    const compoundScore = scoreOf(
      [['note'], ['rest'], ['rest'], ['note']],
      ['dotted_half'],
    );
    compoundScore.time_signature = '6/8';
    const compound = longRestCues(compoundScore);

    expect(restCueAt(compound, 3_000, 60)).toMatchObject({
      barsRemaining: 2,
      beatsRemainingInBar: 2,
    });
    expect(restCueAt(compound, 7_500, 60)).toMatchObject({
      barsRemaining: 1,
      beatsRemainingInBar: 1,
    });
  });
  it('uses a meter change inside the rest for the final-bar countdown', () => {
    const changed = scoreOf(
      [['note'], ['rest'], ['rest'], ['note']],
      ['dotted_half'],
    );
    // The first rest is still 4/4; the final rest changes to 6/8. At 7.5
    // quarter beats, half of that final 6/8 bar remains: one dotted-quarter
    // pulse, not two quarter-note clicks.
    changed.measures[2].time_signature = '6/8';
    const cues = longRestCues(changed);

    expect(cues[0].barQuarterBeatsPerPulse).toEqual([1, 1.5]);
    expect(restCueAt(cues, 7_500, 60)).toMatchObject({
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

describe('the pulse row a musician counts on', () => {
  const cues = longRestCues(scoreOf([['note'], ['rest'], ['rest'], ['note']]));
  const at = (seconds: number) => {
    const state = restCueAt(cues, seconds * 1000, 60);
    if (!state) throw new Error('expected a rest at ' + seconds);
    return restPulseDots(state);
  };

  /*
   * **An off-by-one here is worse than no dots.** The filled dot would sit a
   * beat ahead of the tap the hand feels, and a musician trusting it comes in
   * early — the exact failure the cue exists to prevent.
   */
  it('fills up to the beat being counted, not past it', () => {
    expect(at(4)).toMatchObject({ current: 0, total: 4 });
    expect(at(4).dots).toEqual([true, false, false, false]);

    expect(at(5)).toMatchObject({ current: 1, total: 4 });
    expect(at(5).dots).toEqual([true, true, false, false]);

    expect(at(7)).toMatchObject({ current: 3, total: 4 });
    expect(at(7).dots).toEqual([true, true, true, true]);
  });

  it('starts the row again on the next bar of the rest', () => {
    // Eight pulses of rest, two bars of four. The row is the bar, not the run.
    expect(at(8)).toMatchObject({ current: 0, total: 4 });
    expect(at(8).dots).toEqual([true, false, false, false]);
  });

  it('never runs past its own row, whatever the clock does', () => {
    for (let t = 4; t < 12; t += 0.125) {
      const row = at(t);
      expect(row.current).toBeGreaterThanOrEqual(0);
      expect(row.current).toBeLessThan(row.total);
      expect(row.dots).toHaveLength(row.total);
    }
  });
});
