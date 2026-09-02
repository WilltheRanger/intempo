import { describe, expect, it } from 'vitest';

import type { Piece, PieceInsight, PracticeInsights } from '../data/types';
import { suggestionsFor } from './today';

/**
 * What Today puts under the practice card — which had no tests, while making
 * two claims about a musician's own practice on the app's first screen.
 */

const NOW = new Date('2026-09-02T20:00:00Z');

function piece(id: string, title: string, lastPracticedAt: string | null): Piece {
  return {
    id,
    title,
    composer: 'Anon.',
    movement: null,
    lastPracticedAt,
    thumbnail: null,
    markedBpm: null,
    score: null,
  } as unknown as Piece;
}

function insight(over: Partial<PieceInsight> & { pieceId: string }): PieceInsight {
  return {
    title: 'A study',
    sessions: 4,
    meanDeviationPct: 8,
    spreadPct: 8,
    verdict: 'rushing',
    tolerance: null,
    ...over,
  } as unknown as PieceInsight;
}

function insights(pieces: PieceInsight[]): PracticeInsights {
  return {
    windowDays: 30,
    sessions: pieces.reduce((n, p) => n + p.sessions, 0),
    meanDeviationPct: 8,
    spreadPct: 8,
    verdict: 'rushing',
    tolerance: null,
    pieces,
  } as unknown as PracticeInsights;
}

describe('the piece worth attention', () => {
  it('names the drift and how much practice it is based on', () => {
    const out = suggestionsFor({
      pieces: [],
      insights: insights([insight({ pieceId: 'p1', title: 'Kreutzer 2', sessions: 4 })]),
      excludeIds: [],
      now: NOW,
    });

    expect(out.attention?.pieceId).toBe('p1');
    // The rule the module opens with: never name a piece without saying why.
    expect(out.attention?.detail).toContain('4 sessions');
  });

  it('counts one session as a session, not "1 sessions"', () => {
    const out = suggestionsFor({
      pieces: [],
      insights: insights([insight({ pieceId: 'p1', sessions: 1 })]),
      excludeIds: [],
      now: NOW,
    });

    expect(out.attention?.detail).toContain('1 session');
    expect(out.attention?.detail).not.toContain('1 sessions');
  });

  it('skips a piece already named elsewhere on the screen', () => {
    // Two true statements that read as one bug.
    const out = suggestionsFor({
      pieces: [],
      insights: insights([
        insight({ pieceId: 'p1' }),
        insight({ pieceId: 'p2', title: 'Second' }),
      ]),
      excludeIds: ['p1'],
      now: NOW,
    });

    expect(out.attention?.pieceId).toBe('p2');
  });

  it('invents no problem when everything is on tempo and steady', () => {
    const out = suggestionsFor({
      pieces: [],
      insights: insights([
        insight({ pieceId: 'p1', verdict: 'on_tempo', meanDeviationPct: 0.4, spreadPct: 0.6 }),
      ]),
      excludeIds: [],
      now: NOW,
    });

    expect(out.attention).toBeNull();
  });
});

describe('the piece left alone longest', () => {
  it('prefers one never practised over one practised long ago', () => {
    const out = suggestionsFor({
      pieces: [
        piece('old', 'Worked in June', '2026-06-01T10:00:00Z'),
        piece('new', 'Never opened', null),
      ],
      insights: null,
      excludeIds: [],
      now: NOW,
    });

    expect(out.neglected?.pieceId).toBe('new');
    expect(out.neglected?.detail).toBe('Ready for a first session');
  });

  it('picks the same piece whichever order the library came back in', () => {
    /**
     * **Two pieces worked in one session, then left.** `daysSincePracticed`
     * counts whole calendar days, so they tie — and the old strict `>` kept
     * whichever the list returned first, making "the piece you have left
     * longest" a function of row order. The same defect Insights had, one
     * screen over.
     */
    const morning = piece('morning', 'Zebra study', '2026-08-19T09:00:00Z');
    const evening = piece('evening', 'Alpha study', '2026-08-19T21:00:00Z');

    const one = suggestionsFor({
      pieces: [morning, evening], insights: null, excludeIds: [], now: NOW,
    });
    const other = suggestionsFor({
      pieces: [evening, morning], insights: null, excludeIds: [], now: NOW,
    });

    expect(one.neglected?.pieceId).toBe(other.neglected?.pieceId);
    // And it is the right one: played at nine in the morning, so left longer.
    expect(one.neglected?.pieceId).toBe('morning');
  });

  it('breaks a true tie by title, so even identical timestamps are stable', () => {
    const a = piece('a', 'Zebra', '2026-08-19T09:00:00Z');
    const b = piece('b', 'Alpha', '2026-08-19T09:00:00Z');

    expect(
      suggestionsFor({ pieces: [a, b], insights: null, excludeIds: [], now: NOW })
        .neglected?.pieceId,
    ).toBe('b');
    expect(
      suggestionsFor({ pieces: [b, a], insights: null, excludeIds: [], now: NOW })
        .neglected?.pieceId,
    ).toBe('b');
  });

  it('describes the piece against the same clock it chose it with', () => {
    // The choice used the injected `now` and the label used the wall clock, so
    // a take from a year before the given instant read "Practiced yesterday".
    const out = suggestionsFor({
      pieces: [piece('a', 'Study', '2026-08-19T09:00:00Z')],
      insights: null,
      excludeIds: [],
      now: new Date('2027-09-02T20:00:00Z'),
    });

    expect(out.neglected?.detail).toMatch(/months ago|year/);
    expect(out.neglected?.detail).not.toContain('yesterday');
  });

  it('does not repeat the piece it just named for attention', () => {
    const out = suggestionsFor({
      pieces: [
        piece('p1', 'The drifting one', '2026-06-01T10:00:00Z'),
        piece('p2', 'The forgotten one', '2026-07-01T10:00:00Z'),
      ],
      insights: insights([insight({ pieceId: 'p1', title: 'The drifting one' })]),
      excludeIds: [],
      now: NOW,
    });

    expect(out.attention?.pieceId).toBe('p1');
    expect(out.neglected?.pieceId).toBe('p2');
  });

  it('says nothing when every piece is spoken for', () => {
    const out = suggestionsFor({
      pieces: [piece('p1', 'Only piece', null)],
      insights: null,
      excludeIds: ['p1'],
      now: NOW,
    });

    expect(out.neglected).toBeNull();
  });
});
