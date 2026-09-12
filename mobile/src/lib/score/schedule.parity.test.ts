import { describe, expect, it } from 'vitest';

import type { ScoreJson } from '../../data/types';
import { measuresInPlayOrder } from './playOrder';
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
 * because a reference has to be audible.
 *
 * Repeats are not a difference, and the fixture now holds them. This file used
 * to say so in a comment while checking the performed order against numbers
 * typed in below, under a test named `follows the same repeat order the backend
 * grades` — which consulted no backend and would have passed unchanged if
 * `expand_repeats` had been rewritten. `measuresInPlayOrder` is a hand port of
 * that function, recursive, with first and second endings; it is the most
 * likely thing here to drift and it was the one thing not held.
 */

interface Fixture {
  bpm: number;
  score: ScoreJson;
  expected_onsets_s: number[];
  expected_measures: number[];
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

  it('plays the bars in the order the server grades them', () => {
    // Onsets alone cannot catch a swap between two bars of equal length, and a
    // repeated section is where that swap lives. The fixture's bars hold two,
    // four, one and three notes so the times *do* discriminate — and this
    // holds the order directly, so a later edit that evens those bars out
    // cannot quietly take the coverage with it.
    expect(schedule.notes.map((note) => note.measureNumber)).toEqual(
      fixture.expected_measures,
    );
  });

  it('folds a real tie into one note and leaves a fake one alone', () => {
    // Counted over the *performed* bars, not the written page: the fixture
    // repeats a section, so the page's note count is no longer the
    // performance's. Reading `fixture.score.measures` here would have made
    // this assertion fail for the repeat rather than for a tie.
    //
    // Not circular, though it reads that way. The test above holds that same
    // performed order against the server's, so a wrong `measuresInPlayOrder`
    // fails there first and this one never gets to agree with it.
    const played = measuresInPlayOrder(fixture.score);
    const written = played.flatMap((m) => m.notes ?? []);
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
