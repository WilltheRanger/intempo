import { beforeEach, describe, expect, it, vi } from 'vitest';

// `vi.hoisted`, because `vi.mock` is lifted above every declaration in the
// file — a plain `const` above it is still in its temporal dead zone when the
// factory runs.
const {
  listAnalyses,
  listScores,
  submitTake,
  waitForAnalysis,
  rememberPendingAnalysis,
} = vi.hoisted(() => ({
  listAnalyses: vi.fn(),
  listScores: vi.fn(),
  submitTake: vi.fn(),
  waitForAnalysis: vi.fn(),
  rememberPendingAnalysis: vi.fn(),
}));

vi.mock('../api/analyses', () => ({ listAnalyses, getAnalysis: vi.fn() }));
vi.mock('../api/scores', () => ({
  listScores,
  getScore: vi.fn(),
  createScore: vi.fn(),
  updateScore: vi.fn(),
  deleteScore: vi.fn(),
}));
vi.mock('../api/me', () => ({ getMe: vi.fn() }));
vi.mock('../practice/submitTake', () => ({ submitTake, waitForAnalysis, TakeSubmissionError: class TakeSubmissionError extends Error {} }));
vi.mock('../practice/pendingAnalysis', () => ({ rememberPendingAnalysis }));
vi.mock('../auth/session', () => ({ getAuthAvatarUrl: vi.fn() }));
vi.mock('../api/client', () => ({ ApiError: class ApiError extends Error {} }));

import { apiInsightsSource, apiTakeSubmissionSource, toPiece } from './api';

/**
 * The mapping layer, and the one sign in it.
 *
 * `per_note` and `per_measure` come off the pipeline as `actual - expected`,
 * so **early reads negative** — drag-positive. The app shows rush-positive.
 * That flip happens in exactly one function here, whose own comment calls
 * getting it wrong "the one mistake this app cannot make": every take would be
 * reported on the wrong side of the beat, consistently, and a musician who
 * rushes would be told to speed up.
 *
 * Nothing tested it. These do, from the outside — through `getInsights`,
 * which is where a musician actually reads the number.
 */

function analysis(overrides: Record<string, unknown> = {}) {
  return {
    id: 'a1',
    score_id: 's1',
    status: 'done',
    created_at: new Date().toISOString(),
    result_json: {
      status: 'ok',
      verdict: 'Steady',
      verdict_direction: 'drag',
      per_measure: [{ measure_number: 1, avg_delta_pct: 8, worst_band: 'slight' }],
      tolerance: null,
    },
    ...overrides,
  };
}

const SCORE = { id: 's1', title: 'Suite No. 1', composer: 'Bach' };

beforeEach(() => {
  vi.clearAllMocks();
  listScores.mockResolvedValue([SCORE]);
});

describe('the sign convention', () => {
  it('reports a take that dragged as negative', async () => {
    // The pipeline says +8% — eight percent of a beat **late**. Rush-positive
    // means the musician reads that as -8.
    listAnalyses.mockResolvedValue([analysis()]);

    const insights = await apiInsightsSource.getInsights();

    expect(insights!.meanDeviationPct).toBeLessThan(0);
    expect(insights!.meanDeviationPct).toBeCloseTo(-8, 9);
  });

  it('reports a take that rushed as positive', async () => {
    listAnalyses.mockResolvedValue([
      analysis({
        result_json: {
          status: 'ok',
          verdict: 'Rushing',
          verdict_direction: 'rush',
          per_measure: [{ measure_number: 1, avg_delta_pct: -8, worst_band: 'slight' }],
          tolerance: null,
        },
      }),
    ]);

    const insights = await apiInsightsSource.getInsights();

    expect(insights!.meanDeviationPct).toBeCloseTo(8, 9);
  });

  it('flips the per-piece number the same way as the headline', async () => {
    // Two places compute a mean. If only one flipped, a piece row and the
    // summary above it would disagree about which way the musician plays.
    listAnalyses.mockResolvedValue([analysis()]);

    const insights = await apiInsightsSource.getInsights();

    expect(insights!.pieces[0].meanDeviationPct).toBeCloseTo(
      insights!.meanDeviationPct,
      9,
    );
  });
});

describe('which takes count', () => {
  it('ignores anything older than the window', async () => {
    const old = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString();
    listAnalyses.mockResolvedValue([analysis({ created_at: old })]);

    expect(await apiInsightsSource.getInsights()).toBeNull();
  });

  it('ignores a run that produced no measures', async () => {
    // `alignment_failed` and `no_onsets` are outcomes, not errors — the
    // pipeline ran and heard something it could not use. There is no number in
    // them to average.
    listAnalyses.mockResolvedValue([
      analysis({
        result_json: {
          status: 'no_onsets',
          verdict: "Couldn't hear anything",
          verdict_direction: 'on',
          per_measure: [],
          tolerance: null,
        },
      }),
    ]);

    expect(await apiInsightsSource.getInsights()).toBeNull();
  });

  it('ignores a run that failed but still carried numbers', async () => {
    // Written with measures on purpose. The version of this test above has an
    // empty `per_measure`, so it is dropped for having nothing to average and
    // says nothing about the status check — a mutation deleting that check
    // survived it. This one can only be excluded by the status.
    //
    // Whether the pipeline emits such a payload today is beside the point: the
    // guard exists so that a take the analysis did not stand behind cannot be
    // averaged into somebody's practice summary.
    listAnalyses.mockResolvedValue([
      analysis({
        result_json: {
          status: 'alignment_failed',
          verdict: "Couldn't follow the page",
          verdict_direction: 'drag',
          per_measure: [{ measure_number: 1, avg_delta_pct: 40, worst_band: 'severe' }],
          tolerance: null,
        },
      }),
    ]);

    expect(await apiInsightsSource.getInsights()).toBeNull();
  });

  it('ignores a result the shape of which it cannot read', async () => {
    listAnalyses.mockResolvedValue([analysis({ result_json: { nonsense: true } })]);

    expect(await apiInsightsSource.getInsights()).toBeNull();
  });

  it('counts every take, not every piece', async () => {
    listAnalyses.mockResolvedValue([analysis({ id: 'a1' }), analysis({ id: 'a2' })]);

    const insights = await apiInsightsSource.getInsights();

    expect(insights!.sessions).toBe(2);
    expect(insights!.pieces).toHaveLength(1);
    expect(insights!.pieces[0].sessions).toBe(2);
  });
});

describe('the worst band leads', () => {
  it('takes the worst measure in a take, not the first or the last', async () => {
    listAnalyses.mockResolvedValue([
      analysis({
        result_json: {
          status: 'ok',
          verdict: 'Uneven',
          verdict_direction: 'drag',
          per_measure: [
            { measure_number: 1, avg_delta_pct: 1, worst_band: 'on' },
            { measure_number: 2, avg_delta_pct: 2, worst_band: 'severe' },
            { measure_number: 3, avg_delta_pct: 1, worst_band: 'slight' },
          ],
          tolerance: null,
        },
      }),
    ]);

    const insights = await apiInsightsSource.getInsights();

    expect(insights!.band).toBe('severe');
  });
});

describe('a piece the library no longer names', () => {
  it('still appears, rather than being dropped', async () => {
    // The insight is about takes, and the take happened. Losing the row
    // because the title lookup missed would hide practice that was done.
    listScores.mockResolvedValue([]);
    listAnalyses.mockResolvedValue([analysis()]);

    const insights = await apiInsightsSource.getInsights();

    expect(insights!.pieces[0].title).toBe('Unknown piece');
    expect(insights!.sessions).toBe(1);
  });
});

describe('toPiece', () => {
  it('treats a score with no transcription column as finished', async () => {
    // "A backend that predates the column sends nothing, and treating that as
    // 'finished' is right — every score it wrote was transcribed before it was
    // inserted at all."
    const piece = toPiece({ ...SCORE, movement: null, image_url: null } as never);

    expect(piece.transcriptionStatus).toBe('done');
    expect(piece.concerns).toEqual([]);
    expect(piece.transcriptionAccepted).toBe(false);
    expect(piece.markedBpm).toBeNull();
  });

  it('reads the marked tempo out of the score, not off the row', async () => {
    const piece = toPiece({
      ...SCORE,
      movement: null,
      image_url: null,
      score_json: { bpm_hint: 96 },
    } as never);

    expect(piece.markedBpm).toBe(96);
  });
});

describe('bars the pipeline refused to judge', () => {
  it('keeps a written tempo change out of the mean', async () => {
    // **The bar under a `rit.` reports a real, large deviation** — the
    // musician did slow, exactly as the page asked — while the pipeline forces
    // its band to `on` because the tolerance bands measure distance from a
    // steady beat and the page has said there is none. Averaging it in answers
    // "how steadily was this played" with a number nobody judged.
    listAnalyses.mockResolvedValue([
      analysis({
        result_json: {
          status: 'ok',
          verdict: 'Steady',
          verdict_direction: 'drag',
          per_measure: [
            { measure_number: 1, avg_delta_pct: 4, worst_band: 'on' },
            {
              measure_number: 2,
              avg_delta_pct: 40,
              worst_band: 'on',
              under_tempo_change: true,
            },
          ],
          tolerance: null,
        },
      }),
    ]);

    const insights = await apiInsightsSource.getInsights();

    // The mean of the timed bar alone, flipped: -4, not the -22 both would give.
    expect(insights!.meanDeviationPct).toBeCloseTo(-4, 9);
  });

  it('says nothing at all about a take that was entirely a tempo change', async () => {
    listAnalyses.mockResolvedValue([
      analysis({
        result_json: {
          status: 'ok',
          verdict: 'Steady',
          verdict_direction: 'on',
          per_measure: [
            {
              measure_number: 1,
              avg_delta_pct: 40,
              worst_band: 'on',
              under_tempo_change: true,
            },
          ],
          tolerance: null,
        },
      }),
    ]);

    // Nothing in it was timed, so there is no number — the same answer the
    // window filter and the failed-run filter give, and for the same reason.
    expect(await apiInsightsSource.getInsights()).toBeNull();
  });
});

describe('a bar nothing in which was timed', () => {
  it('stays out of the mean even without a tempo change', async () => {
    // A held final chord under a fermata. `under_tempo_change` is false — the
    // page did not mark a `rit.` — and the bar is still not a verdict.
    listAnalyses.mockResolvedValue([
      analysis({
        result_json: {
          status: 'ok',
          verdict: 'Steady',
          verdict_direction: 'drag',
          per_measure: [
            { measure_number: 1, avg_delta_pct: 4, worst_band: 'on', timed_note_count: 4 },
            { measure_number: 2, avg_delta_pct: 64, worst_band: 'on', timed_note_count: 0 },
          ],
          tolerance: null,
        },
      }),
    ]);

    const insights = await apiInsightsSource.getInsights();

    expect(insights!.meanDeviationPct).toBeCloseTo(-4, 9);
  });

  it('counts a take stored before the field existed exactly as before', async () => {
    // No `timed_note_count` anywhere. Every bar is a verdict, which is what
    // those rows meant — reading a missing field as zero would silently drop
    // every measure of every take already recorded.
    listAnalyses.mockResolvedValue([analysis()]);

    const insights = await apiInsightsSource.getInsights();

    expect(insights!.meanDeviationPct).toBeCloseTo(-8, 9);
  });
});


describe('accepted take hand-off', () => {
  it('remembers the analysis before waiting for the worker', async () => {
    submitTake.mockResolvedValue({
      audioKey: 'user-1/take.wav',
      analysisId: 'analysis-9',
    });
    rememberPendingAnalysis.mockResolvedValue(undefined);
    waitForAnalysis.mockResolvedValue({ id: 'analysis-9', status: 'done' });
    const order: string[] = [];
    rememberPendingAnalysis.mockImplementation(async () => {
      order.push('remember');
    });
    waitForAnalysis.mockImplementation(async () => {
      order.push('wait');
      return { id: 'analysis-9', status: 'done' };
    });

    await expect(
      apiTakeSubmissionSource.submit({
        scoreId: 'score-3',
        targetBpm: 88,
        metronomeMode: 'off',
        audio: new Blob(['wav']),
        filename: 'take.wav',
      }),
    ).resolves.toBe('analysis-9');

    expect(rememberPendingAnalysis).toHaveBeenCalledWith({
      analysisId: 'analysis-9',
      scoreId: 'score-3',
      createdAt: expect.any(Number),
    });
    expect(order).toEqual(['remember', 'wait']);
  });
});
