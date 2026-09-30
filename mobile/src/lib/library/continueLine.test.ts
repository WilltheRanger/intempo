import { describe, expect, it } from 'vitest';

import type { Piece, ScoreJson } from '../../data/types';
import { continueLineFor, pendingLineFor, type PendingCheck } from './continueLine';

/**
 * The Continue row at the top of the Library, and the hand-off line under it.
 *
 * `ContinueRow.tsx` decides where these go; this decides what they are. There
 * is no React Native testing library here (`DECISIONS.md`, 2026-08-24).
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

describe('the Continue row', () => {
  it('names the piece without its catalogue number', () => {
    const line = continueLineFor({ piece: piece(), status: null, searching: false });

    expect(line?.title).toBe('Sonata No. 1 in G minor');
  });

  it('says how it last went, in the shelf’s own words', () => {
    const line = continueLineFor({
      piece: piece(),
      status: 'Rushed in the middle',
      searching: false,
    });

    expect(line?.detail).toBe('Rushed in the middle');
  });

  it('falls back to the composer, and to nothing, rather than an empty line', () => {
    expect(continueLineFor({ piece: piece(), status: null, searching: false })?.detail).toBe(
      'J. S. Bach',
    );
    expect(
      continueLineFor({ piece: piece({ composer: null }), status: null, searching: false })
        ?.detail,
    ).toBeNull();
  });

  it('says the page is being read while it is, whatever the last take said', () => {
    for (const status of ['queued', 'reading'] as const) {
      const line = continueLineFor({
        piece: piece({ transcriptionStatus: status }),
        status: 'Steady all the way through',
        searching: false,
      });
      expect(line?.detail).toMatch(/reading/i);
    }
  });

  it('promises the screen the tap opens', () => {
    // A piece with no bars opens its detail screen, not the recorder.
    expect(
      continueLineFor({ piece: piece({ score: SCORE(0) }), status: null, searching: false })
        ?.actionLabel,
    ).toBe('Open');
    expect(continueLineFor({ piece: piece(), status: null, searching: false })?.actionLabel).toBe(
      'Practice',
    );
  });

  it('is not there for an empty library, whose empty state already asks', () => {
    expect(continueLineFor({ piece: null, status: null, searching: false })).toBeNull();
  });

  it('steps aside while a search is narrowing the shelf', () => {
    expect(continueLineFor({ piece: piece(), status: null, searching: true })).toBeNull();
  });
});

describe('the pending take line', () => {
  const ALL: PendingCheck[] = ['checking', 'working', 'ready', 'unavailable'];

  it('only opens the result when there is one', () => {
    expect(pendingLineFor('ready', 'Caprice No. 24').ready).toBe(true);
    for (const check of ['checking', 'working', 'unavailable'] as PendingCheck[]) {
      expect(pendingLineFor(check, 'Caprice No. 24').ready).toBe(false);
    }
  });

  it('names the piece when it knows it, and stays true when it does not', () => {
    expect(pendingLineFor('working', 'Caprice No. 24').label).toContain('Caprice No. 24');
    const unnamed = pendingLineFor('working', null).label;
    expect(unnamed).not.toContain('undefined');
    expect(unnamed).not.toContain('null');
    expect(unnamed.trim()).toBe(unnamed);
  });

  it('never says the recording failed, because it has not', () => {
    const label = pendingLineFor('unavailable', 'Caprice No. 24').label.toLowerCase();
    expect(label).not.toContain('fail');
    expect(label).not.toContain('lost');
    expect(label).toContain('retry');
  });

  it('says something different in every state', () => {
    const labels = ALL.map((check) => pendingLineFor(check, 'Caprice No. 24').label);
    expect(new Set(labels).size).toBe(ALL.length);
  });

  it('fits on one line at phone width', () => {
    // A proxy, named as one: 14pt Inter inside a 20pt gutter each side of a
    // 390pt phone runs out near 48 characters. The fixed wording must fit; the
    // title is what the one-line clamp is for.
    for (const check of ALL) {
      expect(pendingLineFor(check, null).label.length).toBeLessThanOrEqual(48);
    }
  });
});
