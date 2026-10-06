import { describe, expect, it } from 'vitest';

import { knowsItsMusic, pieceFromCaches } from './knownPiece';
import type { Piece } from '../types';

const piece = (id: string, title: string): Piece =>
  ({ id, title, composer: null, movement: null, lastPracticedAt: null,
     thumbnail: null, pages: [] } as unknown as Piece);

const bach = piece('bwv1001', 'Sonata No. 1');
const schubert = piece('d385', 'Sonata in A minor');

describe('pieceFromCaches', () => {
  it('finds the piece the library has already loaded', () => {
    expect(pieceFromCaches('bwv1001', [schubert, bach], undefined)).toBe(bach);
  });

  /**
   * Today leads with a piece chosen by most-recent analysis, which need not be
   * in any library page that has been fetched. Without this fallback the one
   * screen a musician opens most would be the one that still blanks.
   */
  it('falls back to the piece Today is leading with', () => {
    expect(pieceFromCaches('d385', undefined, schubert)).toBe(schubert);
    expect(pieceFromCaches('d385', [], schubert)).toBe(schubert);
  });

  /**
   * The whole point is showing what is *known*. Returning the wrong piece
   * would put another piece's title and cover on the screen for a moment,
   * which is worse than the blank this replaces.
   */
  it('never returns a different piece', () => {
    expect(pieceFromCaches('missing', [bach, schubert], schubert)).toBeUndefined();
    expect(pieceFromCaches('missing', undefined, schubert)).toBeUndefined();
  });

  it('has nothing to offer before anything has loaded', () => {
    expect(pieceFromCaches('bwv1001', undefined, undefined)).toBeUndefined();
    expect(pieceFromCaches('bwv1001', undefined, null)).toBeUndefined();
  });

  /** A deep link is exactly the case with no cache to draw on. */
  it('leaves a cold open to its own request', () => {
    expect(pieceFromCaches('bwv1001', [], null)).toBeUndefined();
  });
});

describe('knowsItsMusic', () => {
  const withNotation = {
    ...bach,
    score: { measures: [{ number: 1 }] },
  } as unknown as Piece;
  const withPhoto = { ...bach, score: null, thumbnail: { uri: 'https://x/p.jpg' } } as unknown as Piece;
  // What the listing kept on disk holds for every piece, whatever it has.
  const stripped = { ...bach, score: null, thumbnail: null } as unknown as Piece;

  it('trusts the piece once its own request has answered', () => {
    expect(knowsItsMusic(stripped, false)).toBe(true);
    expect(knowsItsMusic(withNotation, false)).toBe(true);
  });

  /**
   * The bug: a listing restored from disk carries no notation and no photo
   * for any piece, and the screen read that as a piece needing sheet music.
   */
  it('does not know, from a placeholder holding neither', () => {
    expect(knowsItsMusic(stripped, true)).toBe(false);
  });

  it('does know, from a placeholder holding either, because those are real', () => {
    expect(knowsItsMusic(withNotation, true)).toBe(true);
    expect(knowsItsMusic(withPhoto, true)).toBe(true);
  });
});
