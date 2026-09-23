import { describe, expect, it } from 'vitest';

import type { Piece, ScoreJson } from '../../data/types';
import { heroContentFor, pendingLineFor, type PendingCheck } from './heroContent';

/**
 * What the Today hero says.
 *
 * The screen is a photograph with five lines of type on it, and there is no
 * React Native testing library here (`DECISIONS.md`, 2026-08-24) — so this is
 * the only place the lines can be held to anything. `PracticeHero.tsx` decides
 * where they go and how they are lit; this decides what they are.
 */

const SCORE = (measures: number): ScoreJson =>
  ({
    measures: Array.from({ length: measures }, () => ({})),
  }) as unknown as ScoreJson;

function piece(over: Partial<Piece> = {}): Piece {
  return {
    id: 'p1',
    title: 'Sonata No. 1 in G minor, BWV 1001',
    composer: 'J. S. Bach',
    movement: 'I. Adagio',
    markedBpm: null,
    score: SCORE(24),
    transcriptionStatus: 'done',
    transcriptionStage: null,
    transcriptionError: null,
    thumbnail: null,
    pages: [],
    lastPracticedAt: null,
    ...over,
  } as unknown as Piece;
}

describe('with a piece to continue', () => {
  it('puts the piece in the title and everything else under it', () => {
    const hero = heroContentFor({
      piece: piece(),
      workingBpm: 92,
      lastTakeHeadline: 'You rushed bars 5–8 by 4 BPM.',
    });

    expect(hero.label).toBe('Recommended');
    expect(hero.title).toBe('Sonata No. 1 in G minor, BWV 1001');
    expect(hero.meta).toContain('J. S. Bach');
    expect(hero.meta).toContain('I. Adagio');
    expect(hero.meta).toContain('92');
    expect(hero.detail).toBe('You rushed bars 5–8 by 4 BPM.');
    expect(hero.action).toBe('continue');
  });

  it('says nothing about a take that does not exist', () => {
    // An invented sentence would be worse than an empty line: this is the one
    // place on the screen the app speaks about the musician's playing.
    const hero = heroContentFor({
      piece: piece(),
      workingBpm: 92,
      lastTakeHeadline: null,
    });

    expect(hero.detail).toBeNull();
  });

  it('says the notation is coming while it is still being read', () => {
    // The middle state, and the reason `detail` is not just the headline. A
    // piece being read has no verdict and will not have one until it is read,
    // so silence would leave a musician looking at a title and a button with
    // no clue the app is mid-way through something.
    for (const status of ['queued', 'reading'] as const) {
      const hero = heroContentFor({
        piece: piece({ transcriptionStatus: status }),
        workingBpm: 92,
        lastTakeHeadline: 'A stale verdict from before the re-read.',
      });

      expect(hero.detail).toMatch(/reading/i);
    }
  });

  it('promises the screen the tap actually opens', () => {
    // `TodayScreen.openPractice` sends a piece with no measures to its detail
    // screen rather than to the recorder, so "Continue practice" there would
    // be describing something else entirely.
    expect(
      heroContentFor({
        piece: piece({ score: SCORE(0) }),
        workingBpm: 92,
        lastTakeHeadline: null,
      }).actionLabel,
    ).toBe('Open');

    expect(
      heroContentFor({ piece: piece(), workingBpm: 92, lastTakeHeadline: null })
        .actionLabel,
    ).toBe('Practice');
  });

  it('leaves out what the piece does not have', () => {
    const hero = heroContentFor({
      piece: piece({ composer: null, movement: null }),
      workingBpm: 60,
      lastTakeHeadline: null,
    });

    expect(hero.meta).not.toContain('·  ·');
    expect(hero.meta).toContain('60');
  });
});

describe('with nothing in the library', () => {
  it('is the same shape rather than a different screen', () => {
    // The hero is the whole screen, so "no piece" cannot mean "no content" —
    // it would be a photograph with a greeting on it and no way in.
    const hero = heroContentFor({
      piece: null,
      workingBpm: 0,
      lastTakeHeadline: null,
    });

    expect(hero.label).toBeTruthy();
    expect(hero.title).toBe('Add your first piece');
    expect(hero.detail).toBeNull();
    expect(hero.actionLabel).toBe('Add a piece');
    expect(hero.action).toBe('add');
  });

  it('offers no metadata rather than an empty line of it', () => {
    expect(
      heroContentFor({ piece: null, workingBpm: 0, lastTakeHeadline: null }).meta,
    ).toBeNull();
  });

  it('never quotes a take, whatever it is handed', () => {
    // The caller passes what it has; an account with no pieces can still have
    // a stale headline in a cache, and it would be about a piece that is gone.
    expect(
      heroContentFor({
        piece: null,
        workingBpm: 0,
        lastTakeHeadline: 'You rushed bars 5–8 by 4 BPM.',
      }).detail ?? '',
    ).not.toContain('rushed');
  });
});

/**
 * The last recording's hand-off, as the one line the hero has room for.
 *
 * Today does not scroll, so the card this replaced has nowhere to live. Four
 * states, one line each, and the difference between them has to be legible
 * without a second line to explain it.
 */
describe('the pending take line', () => {
  const ALL: PendingCheck[] = ['checking', 'working', 'ready', 'unavailable'];

  it('only opens the result when there is one', () => {
    expect(pendingLineFor('ready', 'Caprice No. 24').ready).toBe(true);
    for (const check of ['checking', 'working', 'unavailable'] as PendingCheck[]) {
      expect(pendingLineFor(check, 'Caprice No. 24').ready).toBe(false);
    }
  });

  it('names the piece when it knows it, and stays true when it does not', () => {
    // A musician who recorded three pieces in a rehearsal needs to know which
    // one came back; one who reinstalled the app has a stored analysis id and
    // no library row for it yet, and the line still has to read as English.
    expect(pendingLineFor('working', 'Caprice No. 24').label).toContain('Caprice No. 24');
    const unnamed = pendingLineFor('working', null).label;
    expect(unnamed).not.toContain('undefined');
    expect(unnamed).not.toContain('null');
    expect(unnamed.trim()).toBe(unnamed);
  });

  it('never says the recording failed, because it has not', () => {
    // The server accepted the take and still holds it. Only the question
    // failed, and a line that implied otherwise would have someone re-record
    // something that is safe.
    const label = pendingLineFor('unavailable', 'Caprice No. 24').label;
    expect(label.toLowerCase()).not.toContain('fail');
    expect(label.toLowerCase()).not.toContain('lost');
    expect(label.toLowerCase()).toContain('retry');
  });

  it('says something different in every state', () => {
    // Four states sharing a line would be a line that says nothing: the whole
    // reason this is a control rather than a caption is that pressing it means
    // different things.
    const labels = ALL.map((check) => pendingLineFor(check, 'Caprice No. 24').label);
    expect(new Set(labels).size).toBe(ALL.length);
  });

  it('fits on one line at phone width', () => {
    // There is no layout under test here, so this is a proxy and named as one:
    // 13pt Inter on a 390pt phone, inside a 20pt gutter each side, runs out at
    // roughly 52 characters. The title is what can blow it, so it is measured
    // with a long one — the line clamps to `numberOfLines={1}`, and a label
    // that needs the clamp for the *fixed* half of its wording is one nobody
    // can read.
    for (const check of ALL) {
      expect(pendingLineFor(check, null).label.length).toBeLessThanOrEqual(52);
    }
  });
});
