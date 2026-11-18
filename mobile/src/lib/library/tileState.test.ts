import { describe, expect, it } from 'vitest';

import type { Piece, ScoreJson } from '../../data/types';
import {
  QUEUED_MESSAGE,
  READING_MESSAGE,
  UNREADABLE_MESSAGE,
  readingLine,
  tileMessage,
  tileState,
} from './tileState';

/**
 * What a blank tile is allowed to leave unexplained: nothing.
 *
 * Nine unreadable scans sat on the owner's shelf for three weeks looking
 * exactly like a piece still being read and exactly like one typed in by hand.
 */

type TilePiece = Pick<Piece, 'score' | 'transcriptionStatus' | 'thumbnail'>;

function piece(over: Partial<TilePiece> = {}): TilePiece {
  return {
    score: null,
    transcriptionStatus: 'done',
    thumbnail: null,
    ...over,
  };
}

function scoreWith(measures: number): ScoreJson {
  return {
    measures: Array.from({ length: measures }, () => ({ notes: [] })),
  } as unknown as ScoreJson;
}

describe('tileState', () => {
  it('draws the music whenever there is music', () => {
    expect(tileState(piece({ score: scoreWith(12) }))).toEqual({ kind: 'engraved' });
  });

  it('prefers the notation to a stale failure', () => {
    // A re-read that worked after one that did not. A tile that hid real music
    // behind an error would be wrong about the only thing it is for.
    const settled = piece({ score: scoreWith(8), transcriptionStatus: 'failed' });

    expect(tileState(settled)).toEqual({ kind: 'engraved' });
    expect(tileMessage(tileState(settled))).toBeNull();
  });

  it('says a scan is still coming, for both of the states that mean it', () => {
    for (const status of ['queued', 'reading'] as const) {
      const state = tileState(piece({ transcriptionStatus: status }));
      expect(state).toEqual({ kind: 'reading' });
      // The page draws its staves and the reading's own line instead.
      expect(tileMessage(state)).toBeNull();
    }
  });

  it('says a page could not be read, and offers the re-read while one can be made', () => {
    const state = tileState(
      piece({ transcriptionStatus: 'failed', thumbnail: 'https://e.test/p.jpg' }),
    );

    expect(state).toEqual({ kind: 'unreadable', canReadAgain: true });
    expect(tileMessage(state)).toBe(UNREADABLE_MESSAGE);
  });

  it('withholds the re-read when there is no photograph left to read', () => {
    // An accepted transcription discards the page, and a piece that never had
    // one cannot be re-read. A button that cannot work is worse than no button.
    expect(tileState(piece({ transcriptionStatus: 'failed' }))).toEqual({
      kind: 'unreadable',
      canReadAgain: false,
    });
  });

  it('leaves a piece with no scan at all alone', () => {
    // Typed in by hand, or imported without notes: nothing failed, nothing is
    // coming, and there is nothing to say about it.
    const state = tileState(piece());

    expect(state).toEqual({ kind: 'bare' });
    expect(tileMessage(state)).toBeNull();
  });

  it('treats an empty reading as no reading', () => {
    // `measures: []` is what a failed read leaves behind, and it is the value
    // that made all four states look alike.
    expect(tileState(piece({ score: scoreWith(0), transcriptionStatus: 'failed' }))).toEqual(
      { kind: 'unreadable', canReadAgain: false },
    );
  });
});

describe('readingLine', () => {
  it('says the step the reading has reached, as the piece screen does', () => {
    // The shelf said "Reading the page…" for the whole wait while the screen
    // one tap away counted the staves.
    expect(
      readingLine({ transcriptionStage: 'Reading stave 3 of 7', transcriptionStatus: 'reading' }),
    ).toBe('Reading stave 3 of 7');
    expect(
      readingLine({ transcriptionStage: 'Finding the staves', transcriptionStatus: 'reading' }),
    ).toBe('Finding the staves');
  });

  it('says what a page is waiting for before the worker names a step', () => {
    expect(readingLine({ transcriptionStage: null, transcriptionStatus: 'queued' })).toBe(
      QUEUED_MESSAGE,
    );
    expect(readingLine({ transcriptionStage: null, transcriptionStatus: 'reading' })).toBe(
      READING_MESSAGE,
    );
  });

  it('does not print a blank step', () => {
    expect(readingLine({ transcriptionStage: '  ', transcriptionStatus: 'reading' })).toBe(
      READING_MESSAGE,
    );
  });
});
