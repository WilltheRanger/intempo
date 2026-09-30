import { describe, expect, it } from 'vitest';

import type { MeasureVerdict, TakeIntonation, Tolerance } from '../../data/types';
import {
  barsLabel,
  pitchPassageAt,
  pitchPassageLine,
  tempoPassageAt,
  tempoPassageLine,
} from './barPassage';

const TOLERANCE: Tolerance = {
  rushing_inner_pct: 5,
  rushing_mid_pct: 10,
  rushing_outer_pct: 20,
  dragging_inner_pct: 5,
  dragging_mid_pct: 10,
  dragging_outer_pct: 20,
};

const INTONATION: TakeIntonation = {
  tuningCents: 0,
  spreadCents: 10,
  notes: 40,
  inTuneCents: 15,
  slightCents: 30,
  tuningWorthSayingCents: 10,
};

function bar(measure: number, playedBpm: number | null, over: Partial<MeasureVerdict> = {}) {
  const value: MeasureVerdict = {
    measure,
    playedBpm,
    pitchCents: null,
    targetBpm: null,
    noteCount: 4,
    deviationPct: 0,
    band: 'on',
    direction: 'on',
    verdict: 'on_tempo',
    underTempoChange: false,
    uneven: false,
    timedNoteCount: 4,
    untimedReason: null,
    ...over,
  };
  return value;
}

// Against 96: steady, then bars 5–8 ahead (one of them well ahead), then steady.
const TAKE = [96, 97, 95, 96, 103, 110, 105, 102, 96, 97].map((bpm, i) => bar(i + 1, bpm));

describe('the tempo passage around a tapped bar', () => {
  it('takes in every neighbour that also ran ahead, a little or a lot', () => {
    const passage = tempoPassageAt(TAKE, 6, 96, 'quarter', TOLERANCE)!;
    expect(passage).toMatchObject({ from: 5, to: 8, kind: 'rush' });
    expect(tempoPassageLine(passage)).toBe('Bars 5–8 · about 105, aiming for 96');
  });

  it('is the same passage from any of its bars', () => {
    expect(tempoPassageAt(TAKE, 5, 96, 'quarter', TOLERANCE)).toMatchObject({ from: 5, to: 8 });
    expect(tempoPassageAt(TAKE, 8, 96, 'quarter', TOLERANCE)).toMatchObject({ from: 5, to: 8 });
  });

  it('says a steady stretch without a number', () => {
    expect(tempoPassageLine(tempoPassageAt(TAKE, 2, 96, 'quarter', TOLERANCE)!)).toBe(
      'Bars 1–4 · on tempo',
    );
  });

  it('keeps bars the page said not to judge apart', () => {
    const take = [...TAKE, bar(11, null, { underTempoChange: true, timedNoteCount: 0 })];
    expect(tempoPassageLine(tempoPassageAt(take, 11, 96, 'quarter', TOLERANCE)!)).toBe(
      'Bar 11 · not timed',
    );
  });

  it('is nothing for a bar that is not in the take', () => {
    expect(tempoPassageAt(TAKE, 40, 96, 'quarter', TOLERANCE)).toBeNull();
  });
});

describe('the pitch passage around a tapped bar', () => {
  const pitched = [0, 5, -40, -35, -20, 3].map((cents, i) =>
    bar(i + 1, 96, { pitchCents: cents }),
  );

  it('groups the flat bars, a little flat or well flat, into one', () => {
    const passage = pitchPassageAt(pitched, 4, INTONATION)!;
    expect(passage).toMatchObject({ from: 3, to: 5, kind: 'flat' });
    expect(pitchPassageLine(passage)).toBe('Bars 3–5 · played flat');
  });

  it('says in tune and unread in words', () => {
    expect(pitchPassageLine(pitchPassageAt(pitched, 1, INTONATION)!)).toBe('Bars 1–2 · in tune');
    const unread = [bar(1, 96, { pitchCents: null })];
    expect(pitchPassageLine(pitchPassageAt(unread, 1, INTONATION)!)).toBe('Bar 1 · pitch not read');
  });
});

describe('barsLabel', () => {
  it('says one bar as a bar', () => {
    expect(barsLabel({ from: 6, to: 6 })).toBe('Bar 6');
    expect(barsLabel({ from: 5, to: 8 })).toBe('Bars 5–8');
  });
});
