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
  byNote: [],
  byNoteShowNotes: 4,
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

/** The line with its no-break spaces as spaces, as it reads. */
const plain = (line: string) => line.replace(/\u00A0/g, ' ');

describe('the tempo passage around a tapped bar', () => {
  it('takes in every neighbour that also ran ahead, a little or a lot', () => {
    const passage = tempoPassageAt(TAKE, 6, 96, 'quarter', TOLERANCE)!;
    expect(passage).toMatchObject({ from: 5, to: 8, kind: 'rush' });
    expect(plain(tempoPassageLine(passage))).toBe('Bars 5–8 were fast: 105 beats a minute, not 96');
  });

  it('is the same passage from any of its bars', () => {
    expect(tempoPassageAt(TAKE, 5, 96, 'quarter', TOLERANCE)).toMatchObject({ from: 5, to: 8 });
    expect(tempoPassageAt(TAKE, 8, 96, 'quarter', TOLERANCE)).toMatchObject({ from: 5, to: 8 });
  });

  it('says a steady stretch without a number', () => {
    expect(tempoPassageLine(tempoPassageAt(TAKE, 2, 96, 'quarter', TOLERANCE)!)).toBe(
      'Bars 1–4 were on tempo',
    );
  });

  it('keeps bars the page said not to judge apart', () => {
    const take = [...TAKE, bar(11, null, { underTempoChange: true, timedNoteCount: 0 })];
    expect(tempoPassageLine(tempoPassageAt(take, 11, 96, 'quarter', TOLERANCE)!)).toBe(
      "Bar 11 wasn't timed",
    );
  });

  it('is nothing for a bar that is not in the take', () => {
    expect(tempoPassageAt(TAKE, 40, 96, 'quarter', TOLERANCE)).toBeNull();
  });

  it('says a slow passage in a sentence, and one bar as one bar (2026-09-30)', () => {
    expect(plain(tempoPassageLine({ from: 15, to: 24, kind: 'drag', bpm: 95, aim: 104 }))).toBe(
      'Bars 15–24 were slow: 95 beats a minute, not 104',
    );
    expect(plain(tempoPassageLine({ from: 6, to: 6, kind: 'rush', bpm: 110, aim: 96 }))).toBe(
      'Bar 6 was fast: 110 beats a minute, not 96',
    );
  });

  it('breaks, when it must, after the colon — never before the target', () => {
    const line = tempoPassageLine({ from: 5, to: 8, kind: 'rush', bpm: 104, aim: 96 });
    const after = line.slice(line.indexOf(':') + 2);

    expect(after).not.toContain(' ');
  });

  it('says which way without a number when the bars have no tempo', () => {
    expect(tempoPassageLine({ from: 2, to: 3, kind: 'drag', bpm: null, aim: null })).toBe(
      'Bars 2–3 were slow',
    );
  });
});

describe('the pitch passage around a tapped bar', () => {
  const pitched = [0, 5, -40, -35, -20, 3].map((cents, i) =>
    bar(i + 1, 96, { pitchCents: cents }),
  );

  it('groups the flat bars, a little flat or well flat, into one', () => {
    const passage = pitchPassageAt(pitched, 4, INTONATION)!;
    expect(passage).toMatchObject({ from: 3, to: 5, kind: 'flat' });
    expect(pitchPassageLine(passage)).toBe('Bars 3–5 were flat');
  });

  it('says one flat bar as one', () => {
    expect(pitchPassageLine({ from: 7, to: 7, kind: 'sharp' })).toBe('Bar 7 was sharp');
    expect(pitchPassageLine({ from: 3, to: 4, kind: 'unread' })).toBe(
      "The pitch of bars 3–4 couldn't be read",
    );
  });

  it('says in tune and unread in words', () => {
    expect(pitchPassageLine(pitchPassageAt(pitched, 1, INTONATION)!)).toBe('Bars 1–2 were in tune');
    const unread = [bar(1, 96, { pitchCents: null })];
    expect(pitchPassageLine(pitchPassageAt(unread, 1, INTONATION)!)).toBe("Bar 1's pitch couldn't be read");
  });
});

describe('barsLabel', () => {
  it('says one bar as a bar', () => {
    expect(barsLabel({ from: 6, to: 6 })).toBe('Bar 6');
    expect(barsLabel({ from: 5, to: 8 })).toBe('Bars 5–8');
  });
});
