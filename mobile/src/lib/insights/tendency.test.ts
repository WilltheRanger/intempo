import { describe, expect, it } from 'vitest';

import type { Tolerance } from '../../data/types';
import { judgeAggregate, pieceWordTone, readPieceWord, readTendency, tempoWanders } from './tendency';
import { bandFor, directionFor } from '../tempo';

/** The shipped defaults from `backend/config.toml`. */
const TOLERANCE: Tolerance = {
  rushing_inner_pct: 5,
  rushing_mid_pct: 10,
  rushing_outer_pct: 20,
  dragging_inner_pct: 5,
  dragging_mid_pct: 10,
  dragging_outer_pct: 20,
};

/** Dragging tolerated more than rushing, which is the asymmetry §4 describes. */
const ASYMMETRIC: Tolerance = {
  rushing_inner_pct: 4,
  rushing_mid_pct: 8,
  rushing_outer_pct: 16,
  dragging_inner_pct: 7,
  dragging_mid_pct: 14,
  dragging_outer_pct: 26,
};

describe('bandFor', () => {
  it('reads the boundary as inside the band, the way the pipeline does', () => {
    // `classify_band` uses `<=`, so exactly 5% is on tempo and not slight.
    expect(bandFor(5, TOLERANCE)).toBe('on');
    expect(bandFor(5.01, TOLERANCE)).toBe('slight');
    expect(bandFor(10, TOLERANCE)).toBe('slight');
    expect(bandFor(20, TOLERANCE)).toBe('rush_drag');
    expect(bandFor(20.01, TOLERANCE)).toBe('severe');
  });

  it('picks the side by sign, rush-positive', () => {
    // 6% is beyond the rushing inner (4) and inside the dragging one (7). The
    // sign has to select the set, or a musician is judged by the thresholds
    // for the side they were not on.
    expect(bandFor(6, ASYMMETRIC)).toBe('slight');
    expect(bandFor(-6, ASYMMETRIC)).toBe('on');
  });

  it('falls back for takes that carry no thresholds', () => {
    expect(bandFor(4, null)).toBe('on');
    expect(bandFor(25, null)).toBe('severe');
  });
});

describe('directionFor', () => {
  it('names no side inside tolerance', () => {
    expect(directionFor(3, 'on')).toBe('on');
  });

  it('is rush-positive', () => {
    expect(directionFor(9, 'slight')).toBe('rush');
    expect(directionFor(-9, 'slight')).toBe('drag');
  });
});

describe('tempoWanders', () => {
  it('is true when the bias is inside tolerance and the distance is not', () => {
    expect(
      tempoWanders({ meanDeviationPct: 0, spreadPct: 18, tolerance: TOLERANCE }),
    ).toBe(true);
  });

  it('is false when the drift has a direction that explains it', () => {
    // A musician who rushes 12% every bar: mean and spread agree, and the
    // honest headline is the direction.
    expect(
      tempoWanders({ meanDeviationPct: 12, spreadPct: 12, tolerance: TOLERANCE }),
    ).toBe(false);
  });

  it('is false for a musician who is genuinely steady', () => {
    expect(
      tempoWanders({ meanDeviationPct: 1.2, spreadPct: 3.4, tolerance: TOLERANCE }),
    ).toBe(false);
  });

  it('uses the wider inner threshold, so it never invents a problem', () => {
    // 6% of a beat is beyond the rushing inner and inside the dragging one. A
    // spread has no side to choose a set with, and the quiet reading wins:
    // this app's credibility rests on not naming problems it can't defend.
    expect(
      tempoWanders({ meanDeviationPct: 0, spreadPct: 6, tolerance: ASYMMETRIC }),
    ).toBe(false);
    expect(
      tempoWanders({ meanDeviationPct: 0, spreadPct: 8, tolerance: ASYMMETRIC }),
    ).toBe(true);
  });
});

describe('readTendency', () => {
  it('leads with the wandering, not with a direction it cannot support', () => {
    // The measured case: one take alternating 18% ahead and 18% behind. The
    // screen used to title this "You tend to rush" over a bar sitting dead
    // centre.
    const reading = readTendency({
      sessions: 1,
      meanDeviationPct: 0,
      spreadPct: 18,
      verdict: 'on_tempo',
      tolerance: TOLERANCE,
    });

    expect(reading.title).toBe('Your tempo wanders');
    // The chart says "both sides" better than a clause can; the words carry
    // the one thing a picture cannot, which is how far.
    expect(reading.detail).toContain('either way');
    expect(reading.detail).toContain('18%');
    // Singular. This copy is assembled, and assembled copy ships "1 sessions".
    expect(reading.detail).toContain('1 session.');
    expect(reading.detail).not.toContain('1 sessions');
  });

  it('draws the bar both ways only when the finding is the wandering', () => {
    expect(
      readTendency({
        sessions: 4,
        meanDeviationPct: 0.4,
        spreadPct: 14,
        verdict: 'on_tempo',
        tolerance: TOLERANCE,
      }).showsSpread,
    ).toBe(true);

    // A signed reading keeps the signed bar: a musician who really does rush
    // needs to see which side of the centre they are on.
    expect(
      readTendency({
        sessions: 4,
        meanDeviationPct: 12,
        spreadPct: 13,
        verdict: 'rushing',
        tolerance: TOLERANCE,
      }).showsSpread,
    ).toBe(false);
  });

  it('keeps the direction headline when there is a direction', () => {
    const reading = readTendency({
      sessions: 9,
      meanDeviationPct: -7.6,
      spreadPct: 8.4,
      verdict: 'slight_drag',
      tolerance: TOLERANCE,
    });
    expect(reading.title).toBe('You drift slightly behind');
    expect(reading.detail).toBe('Across 9 sessions, you sat a little behind the beat.');
  });

  it('still says the musician is steady when they are', () => {
    const reading = readTendency({
      sessions: 6,
      meanDeviationPct: 1.1,
      spreadPct: 2.9,
      verdict: 'on_tempo',
      tolerance: TOLERANCE,
    });
    expect(reading.title).toBe('You play steadily');
    expect(reading.showsSpread).toBe(false);
  });
});

describe('readPieceWord', () => {
  it('says Uneven rather than On tempo for a piece with no direction', () => {
    expect(
      readPieceWord({
        meanDeviationPct: 1.4,
        spreadPct: 11.8,
        tolerance: TOLERANCE,
        verdict: 'on_tempo',
      }),
    ).toBe('Uneven');
  });

  it('keeps the verdict word everywhere else', () => {
    expect(
      readPieceWord({
        meanDeviationPct: 12.4,
        spreadPct: 13.1,
        tolerance: TOLERANCE,
        verdict: 'rushing',
      }),
    ).toBe('Rushing');
  });
});

describe('judgeAggregate', () => {
  it('derives the verdict from the figure rather than from a sample take', () => {
    expect(judgeAggregate(0, TOLERANCE)).toEqual({
      band: 'on',
      direction: 'on',
      verdict: 'on_tempo',
    });
    expect(judgeAggregate(-12, TOLERANCE)).toEqual({
      band: 'rush_drag',
      direction: 'drag',
      verdict: 'dragging',
    });
  });
});

describe('who is allowed to word a tendency', () => {
  /**
   * **`formatTendency` had one legitimate caller and grew a second.**
   *
   * The headline wording used to be a plain lookup from a verdict, so any
   * screen could call it. It is a *rule* now — the direction is only the
   * finding when the wandering is not — and a screen reaching past
   * `readTendency` gets the old answer with none of that.
   *
   * Not hypothetical: Insights was fixed and **Today was not**, so for one
   * commit a musician read "Your tempo wanders" on one tab and "You tend to
   * rush" on the next, about the same thirty days. Found by driving the app in
   * a browser, which is not something that happens on every change.
   *
   * The guard is that both functions are **module-private here** rather than
   * exported from `lib/tempo.ts`, so a third caller does not compile. That is
   * worth more than the source-scanning test written first: this one cannot be
   * out of date, cannot be skipped, and reports at the call site.
   *
   * What is left to check is that the monopoly is real — that `readTendency`
   * actually answers the same question, so removing the export took nothing
   * away that a caller legitimately needed.
   */
  it('answers the plain-direction case that callers used to ask directly', () => {
    for (const [meanDeviationPct, verdict, expected] of [
      [12.4, 'rushing', 'You tend to rush'],
      [-12.4, 'dragging', 'You tend to drag'],
      [7, 'slight_rush', 'You drift slightly ahead'],
      [-7, 'slight_drag', 'You drift slightly behind'],
      [1, 'on_tempo', 'You play steadily'],
    ] as const) {
      expect(
        readTendency({
          sessions: 5,
          meanDeviationPct,
          // Equal to the bias: a musician who drifts one way consistently, so
          // no wandering, so the direction is the finding.
          spreadPct: Math.abs(meanDeviationPct),
          verdict,
          tolerance: TOLERANCE,
        }).title,
      ).toBe(expected);
    }
  });
});

describe('pieceWordTone', () => {
  const piece = (verdict: 'on_tempo' | 'slight_rush' | 'rushing' | 'dragging', spreadPct = 2) => ({
    meanDeviationPct: 1,
    spreadPct,
    tolerance: TOLERANCE,
    verdict,
  });

  it('greens on the beat, flags rushing and dragging, and leaves a slight one in ink', () => {
    expect(pieceWordTone(piece('on_tempo'))).toBe('verdictOn');
    expect(pieceWordTone(piece('rushing'))).toBe('verdictMid');
    expect(pieceWordTone(piece('dragging'))).toBe('verdictMid');
    expect(pieceWordTone(piece('slight_rush'))).toBe('textSecondary');
  });

  it('flags an uneven piece even when its mean sits on the beat', () => {
    expect(pieceWordTone(piece('on_tempo', 11.8))).toBe('verdictMid');
  });
});
