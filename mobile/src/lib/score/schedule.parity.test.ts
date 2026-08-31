import { describe, expect, it } from 'vitest';

import type { ScoreJson } from '../../data/types';
import { scheduleScore } from './schedule';

// The shared contract, imported rather than read off disk: this is the one
// file in the repository that both trees are held to, and a bundler-resolved
// import fails at build time if it moves, where a path string would fail at
// run time in whichever suite happened to run first.
import parity from '../../../../fixtures/timeline/parity.json';

/**
 * The app's note times, against the server's.
 *
 * There are two walks over a score and there have to be: the server builds
 * what the analysis *expects to hear*, this builds what the app *plays*.
 * Different languages, no way to share the code. What they cannot be is
 * different arithmetic.
 *
 * If they drift, nothing looks broken from either side. The app plays the
 * piece, the analysis judges the recording, and a musician who played exactly
 * along with what the app sounded is told they rushed. Both halves are
 * behaving; there is nothing to notice.
 *
 * So `fixtures/timeline/parity.json` is the contract, and it holds the times
 * the *server* produces — `backend/app/tests/test_timeline_parity.py` fails if
 * the server stops producing them. Whichever side drifts, its own suite goes
 * red.
 *
 * The fixture leaves out slurs on purpose. The server emits no onset under a
 * bow stroke because there is no attack, while playback still sounds the note
 * because a reference has to be audible. Repeats are no longer an intentional
 * difference: both walks now follow the performed order.
 */

interface Fixture {
  bpm: number;
  score: ScoreJson;
  expected_onsets_s: number[];
}

const fixture = parity as unknown as Fixture;

describe('scheduleScore against the server timeline', () => {
  // `articulation: 1` so a note fills its written value. Articulation shortens
  // how long a note *sounds*, never when it *starts*, and the server has no
  // equivalent because it is measuring attacks. Comparing start times is the
  // comparison that means something.
  const schedule = scheduleScore(fixture.score, fixture.bpm, { articulation: 1 });

  it('starts every note where the server expects to hear it', () => {
    const startS = schedule.notes.map((n) => n.startS);

    expect(startS).toHaveLength(fixture.expected_onsets_s.length);
    startS.forEach((value, index) => {
      expect(value).toBeCloseTo(fixture.expected_onsets_s[index], 9);
    });
  });

  it('sounds nothing for a rest, but keeps counting', () => {
    // The fixture's first bar is quarter, eighth, rest, dotted quarter. If the
    // rest were skipped rather than counted, the fourth note would arrive an
    // eighth early and every note after it would too.
    const gaps = schedule.notes.slice(1).map((n, i) => n.startS - schedule.notes[i].startS);

    expect(Math.max(...gaps)).toBeGreaterThan(60 / fixture.bpm);
  });

  it('follows the same repeat order the backend grades', () => {
    const repeated: ScoreJson = {
      clef: 'bass',
      time_signature: '4/4',
      key_signature: null,
      tempo_marking: null,
      bpm_hint: 120,
      ocr_confidence: 1,
      notes_to_human: '',
      repeats: [{ start_measure: 1, end_measure: 2, type: 'repeat' }],
      measures: [1, 2, 3].map((measure_number) => ({
        measure_number,
        slurs: [],
        notes: [
          { pitch: 'C3', duration: 'quarter' as const, tied_to_next: false },
        ],
      })),
    };

    const performed = scheduleScore(repeated, 120, { articulation: 1 });

    expect(performed.notes.map((note) => note.measureNumber)).toEqual([
      1, 2, 1, 2, 3,
    ]);
    expect(performed.notes.map((note) => note.startS)).toEqual([
      0, 0.5, 1, 1.5, 2,
    ]);
  });

  it('folds a real tie into one note and leaves a fake one alone', () => {
    const written = fixture.score.measures.flatMap((m) => m.notes ?? []);
    const rests = written.filter((n) => n.pitch === 'rest').length;
    const realTies = written.filter(
      (note, i) => note.tied_to_next && written[i + 1]?.pitch === note.pitch,
    ).length;

    // A tie between two *different* pitches is a slur written badly. Folding it
    // would delete an onset the musician actually attacked, and every note
    // after it would be matched against the wrong one.
    expect(schedule.notes).toHaveLength(written.length - rests - realTies);
  });
});
