import { describe, expect, it } from 'vitest';

import type { Duration, ScoreJson, ScoreTempoChange } from '../../data/types';
import { buildMetronomePlan } from '../metronome/plan';
import { playheadAt } from '../record/playhead';
import { scheduleScore } from './schedule';
import { steadyElapsedMs, tempoClock } from './tempoClock';

function note(duration: Duration = 'whole') {
  return { pitch: 'E2', duration, tied_to_next: false } as const;
}

/** Six bars of 4/4, one whole note each, marked 120. */
function score(tempo_changes: ScoreTempoChange[] = []): ScoreJson {
  return {
    clef: 'bass',
    time_signature: '4/4',
    key_signature: null,
    tempo_marking: null,
    bpm_hint: 120,
    repeats: [],
    ocr_confidence: 1,
    notes_to_human: '',
    measures: [1, 2, 3, 4, 5, 6].map((n) => ({
      measure_number: n,
      notes: [note()],
      slurs: [],
    })),
    tempo_changes,
  };
}

const MENO_MOSSO: ScoreTempoChange[] = [
  { measure_number: 3, kind: 'new_tempo', text: 'meno mosso', bpm: 60 },
  { measure_number: 5, kind: 'a_tempo', text: 'a tempo' },
];

describe('the page clock', () => {
  it('is one steady tempo on a page that never changes it', () => {
    const clock = tempoClock(score(), 120);

    expect(clock.secondsAt(8)).toBeCloseTo(4);
    expect(clock.beatsAt(4)).toBeCloseTo(8);
    expect(steadyElapsedMs(clock, 3_700, 120)).toBeCloseTo(3_700);
  });

  it('spends each bar at the tempo the page sets for it', () => {
    // Bars 1–2 at 120 (2 s each), 3–4 at 60 (4 s each), 5–6 back at 120.
    const clock = tempoClock(score(MENO_MOSSO), 120);

    expect(clock.secondsAt(8)).toBeCloseTo(4); // bar 3 begins
    expect(clock.secondsAt(16)).toBeCloseTo(12); // bar 5 begins
    expect(clock.secondsAt(24)).toBeCloseTo(16); // the end
    expect(clock.beatsAt(8)).toBeCloseTo(12); // bar 4 begins, four seconds at 60
    expect(clock.beatsAt(14)).toBeCloseTo(20); // one bar into the a tempo
  });

  it('scales a stated tempo as the take is scaled', () => {
    // Practised at half the marked 120: the meno mosso's 60 is 30.
    const clock = tempoClock(score(MENO_MOSSO), 60);

    expect(clock.secondsAt(8)).toBeCloseTo(8);
    expect(clock.secondsAt(16)).toBeCloseTo(8 + 16);
  });

  it('carries on past the last bar at the last tempo, and converts both ways', () => {
    const clock = tempoClock(score(MENO_MOSSO), 120);

    expect(clock.secondsAt(26)).toBeCloseTo(17);
    for (const beats of [0, 3, 8, 11.5, 16, 23]) {
      expect(clock.beatsAt(clock.secondsAt(beats))).toBeCloseTo(beats);
    }
  });

  it('counts a take in at the tempo of the bar it starts on', () => {
    const inside = score([{ measure_number: 1, kind: 'new_tempo', text: 'meno mosso', bpm: 60 }]);

    expect(tempoClock(inside, 120).openingSecondsPerBeat).toBeCloseTo(1);
    expect(tempoClock(score(), 120).openingSecondsPerBeat).toBeCloseTo(0.5);
  });

  it('does not change for a rit., which states no number', () => {
    const clock = tempoClock(score([{ measure_number: 3, kind: 'ritardando', text: 'rit.' }]), 120);

    expect(clock.secondsAt(24)).toBeCloseTo(12);
  });

  it('survives a nonsense tempo and a missing score', () => {
    expect(Number.isFinite(tempoClock(score(), Number.NaN).secondsAt(4))).toBe(true);
    expect(tempoClock(null, 60).secondsAt(4)).toBeCloseTo(4);
  });
});

describe('the click on a page that changes tempo', () => {
  it('clicks the meno mosso at its own tempo and comes back for the a tempo', () => {
    const plan = buildMetronomePlan(score(MENO_MOSSO), 120);
    const played = plan.beats.slice(plan.countInPulses);
    const gaps = played.slice(1).map((beat, i) => beat.atS - played[i].atS);

    expect(gaps.slice(0, 8).every((gap) => Math.abs(gap - 0.5) < 1e-9)).toBe(true);
    expect(gaps.slice(8, 16).every((gap) => Math.abs(gap - 1) < 1e-9)).toBe(true);
    expect(gaps.slice(16).every((gap) => Math.abs(gap - 0.5) < 1e-9)).toBe(true);
  });

  it('lands every downbeat where Listen plays the bar', () => {
    // Listen is the reference a musician learns the passage from; a click
    // that parts from it at the meno mosso teaches one tempo and times another.
    const page = score(MENO_MOSSO);
    const plan = buildMetronomePlan(page, 120);
    const played = plan.beats.slice(plan.countInPulses);
    const downbeats = played.filter((beat) => beat.downbeat).map((beat) => beat.atS - played[0].atS);
    const barStarts = scheduleScore(page, 120).notes.map((n) => n.startS);

    expect(downbeats).toHaveLength(barStarts.length);
    downbeats.forEach((at, i) => expect(at).toBeCloseTo(barStarts[i] - barStarts[0], 9));
  });

  it('counts in at the tempo of the first bar played', () => {
    const inside = score([{ measure_number: 1, kind: 'new_tempo', text: 'meno mosso', bpm: 60 }]);
    const plan = buildMetronomePlan(inside, 120);

    expect(plan.beats[1].atS - plan.beats[0].atS).toBeCloseTo(1);
    expect(plan.beats[plan.countInPulses].atS).toBeCloseTo(4);
  });
});

describe('the mark on the page follows the same clock', () => {
  it('is on the bar the click is in, through the meno mosso', () => {
    const clock = tempoClock(score(MENO_MOSSO), 120);
    const at = (seconds: number) =>
      playheadAt({
        elapsedMs: steadyElapsedMs(clock, seconds * 1000, 120),
        bpm: 120,
        beatsPerBar: 4,
        startFrom: 1,
        lastBar: 6,
      });

    expect(at(3)?.measureNumber).toBe(2);
    // Seven seconds in is three quarters through bar 3 at 60, where a steady
    // clock would already have put the mark in bar 4.
    expect(at(7)?.measureNumber).toBe(3);
    expect(at(7)?.through).toBeCloseTo(0.75);
    expect(at(13)?.measureNumber).toBe(5);
  });
});
