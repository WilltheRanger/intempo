import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = new Map<string, string>();

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: async (key: string) => store.get(key) ?? null,
    setItem: async (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: async (key: string) => {
      store.delete(key);
    },
  },
}));

import {
  FALLBACK_BPM,
  MAX_BPM,
  MIN_BPM,
  clampBpm,
  hydratePracticeTempos,
  practiceTempo,
  tempoFor,
  tempoLadderFor,
} from './practiceTempo';

/**
 * The tempo a musician is working a piece at.
 *
 * This is where `target_bpm` comes from, so it is the number the whole verdict
 * is measured against. `MIN_BPM`/`MAX_BPM` are held to the API's own range in
 * `backend/app/tests/test_tempo_range.py`; this is the behaviour around them.
 */

const KEY = 'intempo.practiceTempo.v1';

beforeEach(async () => {
  store.clear();
  // An *empty object*, not nothing. `hydratePracticeTempos` returns early when
  // storage holds nothing and leaves the in-memory map alone — correct for its
  // documented use, which is once at startup when the map is already empty,
  // and the reason a test that merely cleared storage kept the previous test's
  // tempos.
  store.set(KEY, '{}');
  await hydratePracticeTempos();
});

describe('clampBpm', () => {
  it('rounds to a whole beat', () => {
    expect(clampBpm(72.4)).toBe(72);
    expect(clampBpm(72.6)).toBe(73);
  });

  it('holds both ends', () => {
    expect(clampBpm(1)).toBe(MIN_BPM);
    expect(clampBpm(10_000)).toBe(MAX_BPM);
    // An infinity still says which direction it went, so it lands on the
    // bound it was heading for rather than on the fallback.
    expect(clampBpm(-Infinity)).toBe(MIN_BPM);
    expect(clampBpm(Infinity)).toBe(MAX_BPM);
  });

  it('turns a number that is not one into the fallback', () => {
    // `Math.round(NaN)` is NaN, and so are `Math.max`/`Math.min` of it — so
    // this returned NaN, from the one function whose job is that the UI cannot
    // offer an invalid value. It would have become `target_bpm: null` in the
    // JSON and a 422 on the one request a musician makes after playing.
    expect(clampBpm(NaN)).toBe(FALLBACK_BPM);
    expect(Number.isFinite(clampBpm(NaN))).toBe(true);
  });

  it('always answers inside the range the API accepts', () => {
    for (const value of [NaN, Infinity, -Infinity, -5, 0, 19.4, 20, 300, 301, 1e9]) {
      const clamped = clampBpm(value);
      expect(Number.isFinite(clamped), String(value)).toBe(true);
      expect(clamped, String(value)).toBeGreaterThanOrEqual(MIN_BPM);
      expect(clamped, String(value)).toBeLessThanOrEqual(MAX_BPM);
    }
  });
});

describe('tempoFor', () => {
  it('prefers what the musician chose, then the score, then the fallback', () => {
    // "A musician's own choice outranks the score and the score outranks a
    // guess."
    expect(tempoFor('piece-1', 132)).toBe(132);
    practiceTempo.set('piece-1', 88);
    expect(tempoFor('piece-1', 132)).toBe(88);
    expect(tempoFor('never-touched', null)).toBe(FALLBACK_BPM);
  });

  it('clamps a marked tempo the score should not have had', () => {
    expect(tempoFor('piece-2', 5)).toBe(MIN_BPM);
    expect(tempoFor('piece-3', NaN)).toBe(FALLBACK_BPM);
  });

  it('remembers per piece, not globally', () => {
    practiceTempo.set('a', 60);
    practiceTempo.set('b', 120);

    expect(practiceTempo.for('a', null)).toBe(60);
    expect(practiceTempo.for('b', null)).toBe(120);
  });

  it('forgets the piece it was asked about and no others', () => {
    // Two, deliberately. With one stored piece, `clear` wiping the whole map
    // is indistinguishable from clearing the right entry — a mutation
    // replacing the map with `{}` survived the single-piece version.
    practiceTempo.set('gone', 60);
    practiceTempo.set('kept', 144);

    practiceTempo.clear('gone');

    expect(practiceTempo.for('gone', 100)).toBe(100);
    expect(practiceTempo.for('kept', 100)).toBe(144);
  });

  it('clamps on the way in, so nothing invalid is ever stored', () => {
    practiceTempo.set('wild', 9999);

    expect(practiceTempo.for('wild', null)).toBe(MAX_BPM);
  });
});

describe('hydrating from storage', () => {
  it('restores what was saved', async () => {
    store.set(KEY, JSON.stringify({ 'piece-x': 92 }));
    await hydratePracticeTempos();

    expect(practiceTempo.for('piece-x', 120)).toBe(92);
  });

  it('clamps a value written by an older build', async () => {
    // "A value written by an older build, or a corrupted entry, must not put
    // the recorder outside the range the backend will accept."
    store.set(KEY, JSON.stringify({ slow: 1, fast: 10_000 }));
    await hydratePracticeTempos();

    expect(practiceTempo.for('slow', null)).toBe(MIN_BPM);
    expect(practiceTempo.for('fast', null)).toBe(MAX_BPM);
  });

  it('drops entries that are not numbers rather than failing', async () => {
    store.set(KEY, JSON.stringify({ good: 90, bad: 'fast', worse: null, awful: {} }));
    await hydratePracticeTempos();

    expect(practiceTempo.for('good', null)).toBe(90);
    expect(practiceTempo.for('bad', 111)).toBe(111);
    expect(practiceTempo.for('worse', 111)).toBe(111);
    expect(practiceTempo.for('awful', 111)).toBe(111);
  });

  it('survives storage holding something that is not JSON', async () => {
    store.set(KEY, 'not json at all');

    await expect(hydratePracticeTempos()).resolves.toBeUndefined();
    expect(practiceTempo.for('anything', 100)).toBe(100);
  });

  it('writes through, so the next launch sees it', async () => {
    practiceTempo.set('kept', 76);
    await vi.waitFor(() => expect(store.get(KEY)).toBeTruthy());

    expect(JSON.parse(store.get(KEY)!)).toEqual({ kept: 76 });
  });
});


describe('tempoLadderFor', () => {
  it('builds from the working tempo toward a higher marked tempo', () => {
    expect(tempoLadderFor(80, 92)).toEqual([
      { bpm: 80, label: 'Current', selected: true },
      { bpm: 84, label: 'Next', selected: false },
      { bpm: 92, label: 'Marked', selected: false },
    ]);
  });

  it('uses the marked tempo as the top rung once it is close', () => {
    expect(tempoLadderFor(88, 92)).toEqual([
      { bpm: 84, label: 'Warm up', selected: false },
      { bpm: 88, label: 'Current', selected: true },
      { bpm: 92, label: 'Marked', selected: false },
    ]);
  });

  it('builds up to the marked tempo when the musician has reached it', () => {
    expect(tempoLadderFor(92, 92)).toEqual([
      { bpm: 84, label: 'Warm up', selected: false },
      { bpm: 88, label: 'Build', selected: false },
      { bpm: 92, label: 'Marked', selected: true },
    ]);
  });

  it('offers clearly suggested steps when the score has no marking', () => {
    expect(tempoLadderFor(80, null)).toEqual([
      { bpm: 80, label: 'Current', selected: true },
      { bpm: 84, label: 'Next', selected: false },
      { bpm: 88, label: 'Stretch', selected: false },
    ]);
  });
});
