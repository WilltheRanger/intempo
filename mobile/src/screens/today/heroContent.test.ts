import { describe, expect, it } from 'vitest';

import type { Piece, ScoreJson } from '../../data/types';
import { heroContentFor } from './heroContent';

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
      lastTakeHeadline: 'You rushed across measures 5 to 8.',
    });

    expect(hero.label).toBe('Continue practicing');
    expect(hero.title).toBe('Sonata No. 1 in G minor, BWV 1001');
    expect(hero.meta).toContain('J. S. Bach');
    expect(hero.meta).toContain('I. Adagio');
    expect(hero.meta).toContain('92');
    expect(hero.detail).toBe('You rushed across measures 5 to 8.');
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

      expect(hero.detail).toMatch(/reading the notation/i);
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
    ).toBe('Open the piece');

    expect(
      heroContentFor({ piece: piece(), workingBpm: 92, lastTakeHeadline: null })
        .actionLabel,
    ).toBe('Continue practice');
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
    expect(hero.detail).toMatch(/photograph|import|hand/i);
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
        lastTakeHeadline: 'You rushed across measures 5 to 8.',
      }).detail,
    ).not.toContain('rushed');
  });
});
