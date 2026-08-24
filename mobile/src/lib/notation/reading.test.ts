import { describe, expect, it } from 'vitest';

import type { ScoreJson } from '../../data/types';
import {
  beatsIn,
  beatsOf,
  cycleAccidental,
  describeBeats,
  describeConfidence,
  problemMeasures,
  stepPitch,
} from './reading';

/**
 * What the app says about a page it has been given, and how a bar gets fixed.
 *
 * `beatsPerMeasure` and `BEAT_TOLERANCE` are held to the server in
 * `meters.parity.test.ts`. This is the rest of the file: counting a bar,
 * saying so, and the two controls the measure editor moves a notehead with.
 *
 * The editor matters more than it looks. A wrong pitch is not decoration —
 * a tie is only real when two noteheads share a pitch, so correcting one is
 * repairing the timeline, and putting the note somewhere the musician did not
 * point at would introduce the error it was opened to fix.
 */

function scoreOf(timeSignature: string | null, ...bars: string[][]): ScoreJson {
  return {
    clef: 'treble',
    time_signature: timeSignature,
    key_signature: null,
    tempo_marking: null,
    bpm_hint: null,
    measures: bars.map((durations, index) => ({
      measure_number: index + 1,
      notes: durations.map((duration) => ({ pitch: 'C4', duration, tied_to_next: false })),
      slurs: [],
    })),
    repeats: [],
    ocr_confidence: 1,
    notes_to_human: '',
  } as unknown as ScoreJson;
}

describe('counting a bar', () => {
  it('adds the durations up', () => {
    expect(beatsIn([{ duration: 'half' }, { duration: 'quarter' }])).toBe(3);
    expect(beatsOf('dotted_quarter')).toBe(1.5);
  });

  it('refuses to count a duration this build does not know', () => {
    // Nullable rather than defaulted. The two defaults this replaced disagreed
    // — `?? 0` here and `?? 1` in schedule.ts — so the same unknown duration
    // made a bar look short in one place and shifted the metronome in the
    // other, both silently.
    // 'long' rather than a value that might later ship: musicxml.py names
    // `long` and `maxima` as the values deliberately outside what this product
    // reads. This used to say 'sixty_fourth', which then shipped — the test was
    // right and its example expired.
    expect(beatsOf('long')).toBeNull();
    expect(beatsIn([{ duration: 'quarter' }, { duration: 'long' }])).toBeNull();
  });
});

describe('problemMeasures', () => {
  it('names the bars that do not fill their meter', () => {
    const score = scoreOf('4/4', ['whole'], ['half', 'quarter'], ['quarter', 'quarter', 'half']);

    expect(problemMeasures(score)).toEqual([2]);
  });

  it('says nothing when the meter was not read', () => {
    // "Inventing 4/4 would flag every waltz on the page."
    expect(problemMeasures(scoreOf(null, ['half', 'quarter']))).toEqual([]);
    expect(problemMeasures(scoreOf('unknown', ['half', 'quarter']))).toEqual([]);
  });

  it('leaves alone a bar it cannot count', () => {
    // An unknown duration means the app is older than the backend that read
    // the page — a bar this version cannot count, not a bar that is wrong.
    // Counting it as zero offered the musician a fix for nothing.
    const score = scoreOf('4/4', ['whole'], ['long']);

    expect(problemMeasures(score)).toEqual([]);
  });

  it('does not report floating-point noise as a short bar', () => {
    const triplets = scoreOf('4/4', [
      'half', 'quarter', 'eighth',
      'triplet_sixteenth', 'triplet_sixteenth', 'triplet_sixteenth',
    ]);

    expect(beatsIn(triplets.measures[0].notes!)).not.toBe(4); // it is 3.9999999999999996
    expect(problemMeasures(triplets)).toEqual([]);
  });
});

describe('describeBeats', () => {
  it('says the total against the meter', () => {
    expect(describeBeats([{ duration: 'half' }, { duration: 'quarter' }], '4/4')).toEqual({
      text: '3 of 4 beats',
      balanced: false,
      expected: 4,
    });
  });

  it('never leaves a decimal point dangling', () => {
    // An ordinary bar — half, quarter, eighth, three triplet sixteenths —
    // sums to 3.9999999999999996. `toFixed(2)` gives "4.00", and stripping
    // trailing zeros left "4.", so the editor read "4. of 4 beats".
    const bar = [
      { duration: 'half' }, { duration: 'quarter' }, { duration: 'eighth' },
      { duration: 'triplet_sixteenth' }, { duration: 'triplet_sixteenth' },
      { duration: 'triplet_sixteenth' },
    ];

    const described = describeBeats(bar, '4/4');

    expect(described.text).toBe('4 of 4 beats');
    expect(described.balanced).toBe(true);
  });

  it('shows a fraction when there is one', () => {
    expect(describeBeats([{ duration: 'dotted_quarter' }], '4/4').text).toBe('1.5 of 4 beats');
    expect(describeBeats([{ duration: 'triplet_eighth' }], '4/4').text).toBe('0.33 of 4 beats');
  });

  it('counts without judging when no meter was read', () => {
    // "Saying '4 beats' is still useful; claiming it is right would not be."
    const described = describeBeats([{ duration: 'whole' }], null);

    expect(described).toEqual({ text: '4 beats', balanced: true, expected: null });
  });

  it('does not show a confident wrong number for an uncountable bar', () => {
    expect(describeBeats([{ duration: 'long' }], '4/4')).toEqual({
      text: 'Beats not counted',
      balanced: true,
      expected: null,
    });
  });
});

describe('stepPitch', () => {
  it('moves by letter, not by semitone', () => {
    // A musician correcting a notehead is moving it a line or a space. By
    // semitone, F# -> G would be a different correction from F -> F#, and the
    // note would land somewhere they did not point at.
    expect(stepPitch('F#4', 1)).toBe('G#4');
    expect(stepPitch('F4', 1)).toBe('G4');
    expect(stepPitch('E4', -1)).toBe('D4');
  });

  it('carries the octave over at B and C', () => {
    expect(stepPitch('B3', 1)).toBe('C4');
    expect(stepPitch('C4', -1)).toBe('B3');
  });

  it('refuses at the ends rather than wrapping', () => {
    // "Silently jumping eight octaves would be a worse answer than refusing."
    expect(stepPitch('C0', -1)).toBe('C0');
    expect(stepPitch('B8', 1)).toBe('B8');
  });

  it('leaves anything that is not a pitch alone', () => {
    expect(stepPitch('rest', 1)).toBe('rest');
    expect(stepPitch('', -1)).toBe('');
  });
});

describe('cycleAccidental', () => {
  it('goes natural, sharp, flat, natural', () => {
    expect(cycleAccidental('D4')).toBe('D#4');
    expect(cycleAccidental('D#4')).toBe('Db4');
    expect(cycleAccidental('Db4')).toBe('D4');
  });

  it('keeps the letter and the octave', () => {
    expect(cycleAccidental('G2')).toBe('G#2');
  });

  it('leaves a rest alone', () => {
    expect(cycleAccidental('rest')).toBe('rest');
  });
});

describe('describeConfidence', () => {
  it('says nothing about a reading that was confident', () => {
    // "A percentage next to a good reading is noise."
    expect(describeConfidence(0.95)).toBeNull();
    expect(describeConfidence(null)).toBeNull();
  });

  it('warns without quoting a number when it was not', () => {
    const said = describeConfidence(0.2);

    expect(said).toBeTruthy();
    // "'62% confident' reads as a measurement; 'wasn't confident' is what it
    // actually means."
    expect(said).not.toMatch(/\d/);
  });
});
