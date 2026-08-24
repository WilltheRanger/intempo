import { describe, expect, it } from 'vitest';

import { BEAT_TOLERANCE, beatsPerMeasure } from './reading';
import parity from '../../../../fixtures/meters/parity.json';

/**
 * The app's meter reading, against the server's.
 *
 * `ocr/validate.beats_per_measure` and this decide the same thing — how many
 * quarter-note beats a bar should hold — and the app's copy exists so a
 * musician editing a measure sees the beat count move as they type, without a
 * round trip. Quarter beats, not notated beats: `target_bpm` is always
 * quarter-notes-per-minute whatever the lower number says, so 6/8 is 3.
 *
 * They disagreed on one case when this was written: `" 4 / 4 "`. The server
 * accepts it, because `int(" 4 ")` strips whitespace; the app's regex did not.
 * A meter OCR read with spaces therefore switched the app's beat check off
 * while the server went on reporting the same bars as short — the app
 * disagreeing with itself in front of the person trying to fix the bar.
 *
 * `fixtures/meters/parity.json` holds the server's answers.
 * `backend/app/tests/test_meter_parity.py` fails if the server stops giving
 * them.
 */

const CASES = (parity as { cases: Record<string, number | null> }).cases;

describe('beatsPerMeasure against the server', () => {
  it('agrees on every case, including the malformed ones', () => {
    const entries = Object.entries(CASES);

    // Counted: an empty fixture would make the loop below vacuous, and the
    // first version of this comparison reported "no divergences" because
    // vitest swallowed its console.log.
    expect(entries.length).toBeGreaterThan(30);

    const differences = entries
      .map(([key, expected]) => {
        const got = beatsPerMeasure(key === '__null__' ? null : key);
        return got === expected ? null : `${JSON.stringify(key)}: app ${got}, server ${expected}`;
      })
      .filter(Boolean);

    expect(differences).toEqual([]);
  });

  it('reads a compound meter in quarter beats, not notated ones', () => {
    // The distinction the whole file turns on. 6/8 counted as six would make
    // every bar of a jig look twice as long as it is.
    expect(beatsPerMeasure('6/8')).toBe(3);
    expect(beatsPerMeasure('12/8')).toBe(6);
    expect(beatsPerMeasure('2/2')).toBe(4);
  });

  it('answers null rather than guessing when the meter is unreadable', () => {
    // "Inventing 4/4 would flag every waltz on the page."
    for (const unreadable of ['unknown', '', 'C', '4', '0/4', '4/0']) {
      expect(beatsPerMeasure(unreadable), unreadable).toBeNull();
    }
    expect(beatsPerMeasure(null)).toBeNull();
  });
});

describe('BEAT_TOLERANCE', () => {
  it('is small enough to be a rounding allowance and not a real difference', () => {
    // The backend's `validate.TOLERANCE` is checked against this from the
    // Python side. Here: it has to be far below the smallest note value, or a
    // genuinely short bar would pass as balanced.
    expect(BEAT_TOLERANCE).toBeGreaterThan(0);
    expect(BEAT_TOLERANCE).toBeLessThan(1 / 32);
  });
});
