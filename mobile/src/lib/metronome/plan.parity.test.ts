import { describe, expect, it } from 'vitest';

import type { ScoreJson } from '../../data/types';
import { scheduleScore } from '../score/schedule';
import { buildMetronomePlan } from './plan';

// The shared contract, imported rather than read off disk — the same reason
// `schedule.parity.test.ts` gives.
import parity from '../../../../fixtures/timeline/parity.json';

/**
 * The click a musician plays to, against the grid they are judged on.
 *
 * `fixtures/timeline/parity.json` holds two of the three walks over a score:
 * `alignment.build_timeline` builds what the analysis expects to hear, and
 * `lib/score/schedule.ts` builds what the app plays back. **There is a third,
 * and nothing held it.** `buildMetronomePlan` accumulates its own quarters
 * over `measuresInPlayOrder`, and it is the one a musician actually
 * synchronises to: playback is a reference you listen to before a take, the
 * click is what you are hearing *while* you play.
 *
 * So the failure it can have is the worse one. If the click drifts from the
 * timeline, a musician plays exactly with it and is told they rushed — every
 * part behaving, nothing to notice, and the recording is evidence against
 * them. That is the same argument the timeline fixture already makes for
 * playback, and it applies harder here.
 *
 * `plan.ts` says its times "remain quarter-note based, exactly like playback
 * and alignment", and meter only groups those quarters into felt pulses. This
 * is that sentence, checked.
 *
 * **Anchored on the first played downbeat, and that is not an approximation.**
 * `RecordScreen` calls `discardCapturedSoFar()` on the downbeat, so the
 * uploaded file starts where the music does, and `to_timeline_base` re-zeros
 * the detected onsets on the first of them. Both sides therefore measure from
 * the same instant — asserted below rather than assumed, because it is only
 * true while the first performed measure opens with a note.
 */
describe('the metronome against the timeline the analysis uses', () => {
  const score = parity.score as unknown as ScoreJson;
  const plan = buildMetronomePlan(score, parity.bpm);
  const played = plan.beats.slice(plan.countInPulses);
  const downbeats = played.filter((beat) => beat.downbeat).map((beat) => beat.atS - played[0].atS);

  /**
   * Which performed measure each onset belongs to, taken from the server's own
   * list rather than recomputed here.
   *
   * `expected_measures` is one written measure number per onset, in performed
   * order, so a change of number is a change of measure. That reading holds
   * for this score because no two adjacent performed measures share a number —
   * the assertion below is what stops a future fixture breaking it silently.
   */
  const performedIndex: number[] = [];
  let performed = -1;
  parity.expected_measures.forEach((measure, i) => {
    if (i === 0 || measure !== parity.expected_measures[i - 1]) performed += 1;
    performedIndex.push(performed);
  });

  it('starts where the analysis starts counting', () => {
    // Both sides are relative to the first note. `expected_onsets_s[0]` being
    // zero is what makes the first downbeat and the first onset the same
    // instant; a fixture whose first measure opened with a rest would need
    // this test rewritten, not silently reinterpreted.
    expect(parity.expected_onsets_s[0]).toBe(0);
    expect(downbeats[0]).toBe(0);
  });

  it('strikes one downbeat per performed measure', () => {
    // The count comes from the server's list, so a walk that dropped a repeat
    // — or expanded one twice — fails here rather than only in the times.
    expect(downbeats).toHaveLength(performed + 1);
  });

  it('reads a change of measure the same way the server does', () => {
    // Guards the derivation above: two adjacent performed measures sharing a
    // number would make `performedIndex` undercount, and every window after it
    // would be wrong while this file still claimed to check them.
    const runs = new Set<number>();
    parity.expected_measures.forEach((measure, i) => {
      if (i > 0 && measure === parity.expected_measures[i - 1]) return;
      expect(runs.has(measure * 1000 + performedIndex[i])).toBe(false);
      runs.add(measure * 1000 + performedIndex[i]);
    });
    expect(runs.size).toBe(performed + 1);
  });

  it('puts every note the analysis expects inside the bar it is clicked in', () => {
    parity.expected_onsets_s.forEach((onset, i) => {
      const bar = performedIndex[i];
      const from = downbeats[bar];
      const to = bar + 1 < downbeats.length ? downbeats[bar + 1] : Infinity;

      expect(
        onset,
        `onset ${i} at ${onset}s is in written measure ${parity.expected_measures[i]}, ` +
          `which the metronome clicks from ${from}s to ${to}s`,
      ).toBeGreaterThanOrEqual(from - 1e-6);
      expect(onset).toBeLessThan(to);
    });
  });
});

/**
 * A bar whose notes do not fill its metre, which is the ordinary case.
 *
 * **This is the state no fixture in the repository has.** Every bar in
 * `parity.json`, and every bar in `plan.test.ts`'s hand-built scores, sums
 * exactly to its time signature — so all three walks advance by four quarters
 * whether they read the notes or the metre, and the difference is invisible.
 *
 * A page that reads short is not an edge case here. It is what
 * `validate.py`'s beat check exists to flag, what `MeasureEditScreen` exists
 * to repair, and what `MeasureConcern` reports on the score screen. The app is
 * expected to be holding scores with bars like this one.
 *
 * `plan.ts` advances by `duration` — the notes actually in the bar — exactly
 * as `scheduleScore` and `build_timeline` do. Advancing by the metre instead
 * is a one-token change that passes every other test in this tree, and it
 * would put the click a quarter ahead of the reference from the short bar
 * onward: the musician follows the click, plays what the page says, and every
 * bar after the misread one comes back late.
 */
const SHORT_BAR: ScoreJson = {
  clef: 'treble',
  time_signature: '4/4',
  key_signature: null,
  tempo_bpm: null,
  ocr_confidence: 1,
  repeats: [],
  measures: [
    {
      measure_number: 1,
      time_signature: '4/4',
      notes: [1, 2, 3, 4].map((n) => ({ pitch: 'C4', duration: 'quarter', beat: n })),
    },
    // Three quarters where the metre says four. Nothing here is a rest: the
    // reader simply did not see the fourth note.
    {
      measure_number: 2,
      notes: [1, 2, 3].map((n) => ({ pitch: 'D4', duration: 'quarter', beat: n })),
    },
    {
      measure_number: 3,
      notes: [1, 2, 3, 4].map((n) => ({ pitch: 'E4', duration: 'quarter', beat: n })),
    },
  ],
} as unknown as ScoreJson;

describe('a bar the reader got wrong', () => {
  const bpm = 96;
  const quarter = 60 / bpm;
  const plan = buildMetronomePlan(SHORT_BAR, bpm);
  const played = plan.beats.slice(plan.countInPulses);
  const downbeats = played.filter((beat) => beat.downbeat).map((beat) => beat.atS - played[0].atS);

  it('advances by the notes in the bar, not by the metre', () => {
    // 0, then four quarters, then **three** — not four.
    expect(downbeats).toEqual([0, 4 * quarter, 7 * quarter]);
  });

  it('keeps the click on the same instant as the reference playback', () => {
    // The tie that makes this a parity check rather than a preference:
    // `scheduleScore` is held to `alignment.build_timeline` by
    // `schedule.parity.test.ts`, so a click that agrees with playback agrees
    // with the timeline the verdict is measured against.
    const notes = scheduleScore(SHORT_BAR, bpm).notes;
    const firstOf = (measureNumber: number) =>
      notes.find((note) => note.measureNumber === measureNumber)?.startS;

    expect(firstOf(1)).toBe(downbeats[0]);
    expect(firstOf(2)).toBe(downbeats[1]);
    expect(firstOf(3)).toBe(downbeats[2]);
  });
});
