import { describe, expect, it } from 'vitest';

import type { Instrument } from '../data/types';
import { BEATS } from './score/schedule';
import { INSTRUMENT_LABELS, dayIndex, warmupFor, warmupScore } from './warmup';

/**
 * The daily warmups — hand-authored music, checked as music.
 *
 * `warmup.ts` is 297 lines of notes typed out by a person, four instruments
 * over, with a docstring making several claims about them: that every exercise
 * sits in first position, that a scale comes to "four bars of four", that the
 * warmup is the same all day on every device. None of it was tested.
 *
 * Hand-authored data is exactly where a typo survives: nothing else in the
 * codebase reads these notes, so a note out of range or a bar of three beats
 * is invisible until a musician is standing there with the instrument.
 *
 * **What these cannot check, measured rather than assumed.** Rewriting the
 * cello D major scale an octave down — D2 to D3 instead of D3 to D4 — leaves
 * every test here green, because D2 is still inside the cello's first position
 * and the bars still add up. It is a legitimate place to play those notes;
 * it is just not the exercise that was written. Catching that would mean
 * encoding which octave each exercise *ought* to sit in, which is taste rather
 * than arithmetic, and a test asserting taste is a test somebody eventually
 * edits to agree with them. These check what is checkable: range, bar sums,
 * coverage, and the rotation.
 */

const INSTRUMENTS = Object.keys(INSTRUMENT_LABELS) as Instrument[];

/**
 * The ranges `warmup.ts` states for itself, per instrument.
 *
 * Copied from its own docstrings rather than invented here — the point is to
 * hold the file to what it says about itself. First position on each
 * instrument, which is what makes these warmups rather than études.
 */
const FIRST_POSITION: Record<Instrument, [string, string]> = {
  violin: ['G3', 'B5'],
  viola: ['C3', 'E5'],
  cello: ['C2', 'D4'],
  double_bass: ['E2', 'B3'],
};

const SEMITONE: Record<string, number> = {
  C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11,
};

/** Scientific pitch to a number, so two pitches can be compared. */
function midi(pitch: string): number {
  const match = /^([A-G])(#|b)?(-?\d+)$/.exec(pitch);
  if (!match) {
    throw new Error(`not a pitch: ${pitch}`);
  }
  const [, letter, accidental, octave] = match;
  const offset = accidental === '#' ? 1 : accidental === 'b' ? -1 : 0;
  return (Number(octave) + 1) * 12 + SEMITONE[letter] + offset;
}

/** Every warmup an instrument has, by asking for a run of consecutive days. */
function allWarmupsFor(instrument: Instrument) {
  const seen = new Map<string, ReturnType<typeof warmupFor>>();
  for (let day = 0; day < 40; day += 1) {
    const warmup = warmupFor(instrument, new Date(2026, 0, 1 + day, 12));
    seen.set(warmup.id, warmup);
  }
  return [...seen.values()];
}

describe('every instrument gets its own warmups', () => {
  it('has a set for each instrument, not a violin fallback', () => {
    // `warmupFor` falls back to VIOLIN for an instrument it does not know. A
    // bassist handed a violin exercise gets notes that are not on the
    // instrument, and nothing anywhere says so.
    const violinIds = new Set(allWarmupsFor('violin').map((w) => w.id));

    for (const instrument of INSTRUMENTS) {
      if (instrument === 'violin') continue;
      const ids = allWarmupsFor(instrument).map((w) => w.id);
      expect(ids.length).toBeGreaterThan(0);
      expect(ids.some((id) => violinIds.has(id))).toBe(false);
    }
  });

  it('states what every exercise trains', () => {
    // "An exercise without a stated purpose is a warm-up ritual, and this app
    // has no business inventing rituals."
    for (const instrument of INSTRUMENTS) {
      for (const warmup of allWarmupsFor(instrument)) {
        expect(warmup.focus.trim(), `${warmup.id} has no focus`).not.toBe('');
        expect(warmup.name.trim(), `${warmup.id} has no name`).not.toBe('');
      }
    }
  });
});

describe('range discipline', () => {
  it('keeps every note in first position on its own instrument', () => {
    // Counted, because everything here is a loop over authored data: a
    // `warmupFor` that started returning nothing would make every assertion
    // below vacuous and every test in this file green.
    let checked = 0;
    for (const instrument of INSTRUMENTS) {
      const [low, high] = FIRST_POSITION[instrument];
      for (const warmup of allWarmupsFor(instrument)) {
        for (const note of warmup.notes) {
          const value = midi(note.pitch);
          expect(
            value >= midi(low) && value <= midi(high),
            `${warmup.id}: ${note.pitch} is outside ${instrument} first position (${low}–${high})`,
          ).toBe(true);
          checked += 1;
        }
      }
    }

    expect(checked, 'no notes were checked at all').toBeGreaterThan(100);
  });
});

describe('bar arithmetic', () => {
  /** The bars, as the file's own `barBefore` flags divide them. */
  function bars(notes: { pitch: string; value: keyof typeof BEATS; barBefore?: boolean }[]) {
    const out: number[][] = [];
    for (const note of notes) {
      if (note.barBefore || out.length === 0) {
        out.push([]);
      }
      out[out.length - 1].push(BEATS[note.value]);
    }
    return out;
  }

  it('writes every bar as four beats', () => {
    // The scale docstring works this out for itself: "eight up and seven down
    // is fifteen notes, and fifteen quarters leaves a bar three beats long.
    // Two beats on the last note makes sixteen." A bar that does not add up
    // means the player and the metronome disagree with the notation.
    for (const instrument of INSTRUMENTS) {
      for (const warmup of allWarmupsFor(instrument)) {
        bars(warmup.notes).forEach((bar, index) => {
          const total = bar.reduce((sum, beats) => sum + beats, 0);
          expect(total, `${warmup.id} bar ${index + 1}`).toBeCloseTo(4, 9);
        });
      }
    }
  });

  it('gives a scale four bars, which is what makes it countable', () => {
    const scales = INSTRUMENTS.flatMap((i) =>
      allWarmupsFor(i).filter((w) => w.id.endsWith('-major') || w.id.includes('scale')),
    );

    expect(scales.length).toBeGreaterThan(0);
    for (const warmup of scales) {
      expect(bars(warmup.notes), warmup.id).toHaveLength(4);
    }
  });
});

describe('warmupScore', () => {
  it('divides the score into the same bars the exercise is written in', () => {
    for (const instrument of INSTRUMENTS) {
      for (const warmup of allWarmupsFor(instrument)) {
        const score = warmupScore(warmup);
        const written = warmup.notes.filter((n) => n.barBefore).length || 1;

        expect(score.measures, warmup.id).toHaveLength(written);
        expect(score.measures.flatMap((m) => m.notes ?? []), warmup.id).toHaveLength(
          warmup.notes.length,
        );
      }
    }
  });

  it('carries a duration the shared table knows for every note', () => {
    // `VALUE_DURATIONS` maps four note values. A warmup written with a fifth
    // would produce `undefined`, which the scheduler treats as one beat and
    // nothing reports.
    for (const instrument of INSTRUMENTS) {
      for (const warmup of allWarmupsFor(instrument)) {
        for (const note of warmupScore(warmup).measures.flatMap((m) => m.notes ?? [])) {
          expect(BEATS[note.duration], `${warmup.id}: ${note.duration}`).toBeTypeOf('number');
        }
      }
    }
  });

  it('says the clef the exercise was written in', () => {
    for (const instrument of INSTRUMENTS) {
      for (const warmup of allWarmupsFor(instrument)) {
        expect(warmupScore(warmup).clef, warmup.id).toBe(warmup.clef);
      }
    }
  });
});

describe('the same warmup all day', () => {
  it('does not change between morning and midnight', () => {
    const morning = warmupFor('cello', new Date(2026, 4, 17, 0, 0, 1));
    const night = warmupFor('cello', new Date(2026, 4, 17, 23, 59, 59));

    expect(night.id).toBe(morning.id);
  });

  it('moves on the next day', () => {
    const sets = allWarmupsFor('cello');
    const today = warmupFor('cello', new Date(2026, 4, 17, 12));
    const tomorrow = warmupFor('cello', new Date(2026, 4, 18, 12));

    // Only meaningful while there is more than one to rotate through.
    expect(sets.length).toBeGreaterThan(1);
    expect(tomorrow.id).not.toBe(today.id);
  });

  it('counts days in local time, so it turns over at local midnight', () => {
    // **Under a real timezone, or this proves nothing.** Written first without
    // the `TZ` juggling, it passed whether `dayIndex` used local components or
    // UTC ones — because the sandbox and CI both run in UTC, where the two are
    // the same thing. A mutation swapping it to `getUTCDate` stayed green.
    //
    // What it is guarding: a UTC day index rolls over mid-afternoon for a
    // musician far enough west, so "today's warmup" would change while they
    // were in the middle of working on it.
    const original = process.env.TZ;
    process.env.TZ = 'America/Los_Angeles';
    try {
      expect(
        new Date().getTimezoneOffset(),
        'the runner ignored TZ, so this test would pass vacuously',
      ).not.toBe(0);

      // 23:30 on the 17th in Los Angeles is already the 18th in UTC, so a UTC
      // index calls these two the same day and a local one does not.
      const lateEvening = new Date(2026, 4, 17, 23, 30);
      const justAfterMidnight = new Date(2026, 4, 18, 0, 30);

      expect(dayIndex(justAfterMidnight) - dayIndex(lateEvening)).toBe(1);
    } finally {
      process.env.TZ = original;
    }
  });
});
