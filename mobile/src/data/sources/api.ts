import { getAnalysis, listAnalyses } from '../api/analyses';
import { getMe } from '../api/me';
import { getScore, listScores } from '../api/scores';
import { getAuthAvatarUrl } from '../auth/session';
import { verdictFor } from '../../lib/tempo';
import type {
  AnalysisResponse,
  AnalysisResultJson,
  Band,
  Direction,
  MeasureVerdict,
  Musician,
  Piece,
  PieceInsight,
  PracticeInsights,
  ScoreResponse,
  TakeResult,
} from '../types';
import type {
  InsightsSource,
  MusicianSource,
  PieceSource,
  TakeSource,
} from './types';

/**
 * The real backend, mapped into the shape the UI renders.
 *
 * Four fields come back null because nothing behind `/v1/scores` can supply
 * them yet. They are listed here rather than quietly omitted so the work
 * needed to light each one up stays visible:
 *
 *  - `movement`         — no column on `scores`.
 *  - `progress`         — no progress concept anywhere in the schema.
 *  - `lastPracticedAt`  — would come from `analyses.created_at`; `/v1/analyses`
 *                         is unbuilt (Batch 4).
 *  - `thumbnail`        — score images sit in a private bucket and no endpoint
 *                         signs a download URL.
 */
function toPiece(score: ScoreResponse): Piece {
  return {
    id: score.id,
    title: score.title,
    composer: score.composer,
    movement: null,
    progress: null,
    lastPracticedAt: null,
    thumbnail: null,
  };
}

export const apiPieceSource: PieceSource = {
  async listPieces() {
    const scores = await listScores();
    return scores.map(toPiece);
  },

  async getCurrentPiece() {
    // `/v1/scores` is ordered created_at DESC, so this is "most recently
    // added". Once analyses exist it should become "score of the most recent
    // analysis", which is what "continue practicing" actually means.
    const scores = await listScores({ limit: 1 });
    const [mostRecent] = scores;
    return mostRecent ? toPiece(mostRecent) : null;
  },

  async getPiece(id) {
    return toPiece(await getScore(id));
  },
};

/**
 * The account, from `/v1/me` plus the auth session.
 *
 * Every field but the photo comes from the endpoint. The photo has no column
 * on `users` and no upload endpoint, so it is read from the Supabase auth
 * user's metadata — the one avatar the app can reach without a schema change,
 * and only present for accounts created through an OAuth provider.
 */
function toMusician(
  me: Awaited<ReturnType<typeof getMe>>,
  avatarUrl: string | null,
): Musician {
  return {
    id: me.id,
    email: me.email,
    tier: me.tier,
    role: me.role,
    studioId: me.studio_id,
    avatarUrl,
  };
}

export const apiMusicianSource: MusicianSource = {
  async getMusician() {
    // Both read the session that's already established; neither depends on the
    // other, so there's no reason to wait on them in turn.
    const [me, avatarUrl] = await Promise.all([getMe(), getAuthAvatarUrl()]);
    return toMusician(me, avatarUrl);
  },
};

/** The window Insights reports on. */
const INSIGHTS_WINDOW_DAYS = 30;

/**
 * `result_json`, checked rather than trusted.
 *
 * It is `Record<string, unknown>` on the wire because the pipeline's schema is
 * still being tuned. This is the one place it becomes typed, and a payload
 * missing what a screen needs is rejected here rather than being allowed
 * halfway in.
 */
function asResult(analysis: AnalysisResponse): AnalysisResultJson | null {
  const raw = analysis.result_json;
  if (!raw || typeof raw.verdict !== 'string' || typeof raw.status !== 'string') {
    return null;
  }
  return raw as unknown as AnalysisResultJson;
}

/**
 * The pipeline's drag-positive deltas, flipped to the app's rush-positive
 * convention.
 *
 * The only sign flip in the client. `per_note` and `per_measure` are
 * `actual - expected` so early reads negative; `trend` is already flipped by
 * the pipeline. Getting this wrong would show every take on the wrong side of
 * the beat, which is the one mistake this app cannot make.
 */
function toRushPositive(dragPositivePct: number): number {
  return -dragPositivePct;
}

/** The mean deviation of a finished take, rush-positive, or null. */
function meanDeviationOf(result: AnalysisResultJson): number | null {
  const measures = result.per_measure ?? [];
  if (measures.length === 0) {
    return null;
  }
  const mean =
    measures.reduce((total, m) => total + m.avg_delta_pct, 0) / measures.length;
  return toRushPositive(mean);
}

/** The worst band in the take, which is what a summary should lead with. */
const BAND_SEVERITY: Record<Band, number> = {
  on: 0,
  slight: 1,
  rush_drag: 2,
  severe: 3,
};

function worstBandOf(result: AnalysisResultJson): Band {
  return (result.per_measure ?? []).reduce<Band>(
    (worst, m) =>
      BAND_SEVERITY[m.worst_band] > BAND_SEVERITY[worst] ? m.worst_band : worst,
    'on',
  );
}

/**
 * Insights, aggregated from the caller's finished analyses.
 *
 * The grouping happens here rather than on the server because the endpoint
 * returns takes, not summaries — a deliberate choice, since one list is
 * useful to several screens and a bespoke summary endpoint is useful to one.
 * With the 200-take page cap that is a page of JSON, not a scan.
 */
export const apiInsightsSource: InsightsSource = {
  async getInsights(): Promise<PracticeInsights | null> {
    const [analyses, scores] = await Promise.all([
      listAnalyses({ status: 'done' }),
      listScores({ limit: 200 }),
    ]);

    const since = Date.now() - INSIGHTS_WINDOW_DAYS * 24 * 60 * 60 * 1000;
    const titles = new Map(scores.map((score) => [score.id, score]));

    const readings = analyses
      .filter((analysis) => Date.parse(analysis.created_at) >= since)
      .flatMap((analysis) => {
        const result = asResult(analysis);
        if (!result || result.status !== 'ok') {
          return [];
        }
        const deviationPct = meanDeviationOf(result);
        if (deviationPct === null) {
          return [];
        }
        return [
          {
            scoreId: analysis.score_id,
            deviationPct,
            band: worstBandOf(result),
            direction: result.verdict_direction,
          },
        ];
      });

    if (readings.length === 0) {
      return null;
    }

    const byScore = new Map<string, typeof readings>();
    for (const reading of readings) {
      const group = byScore.get(reading.scoreId) ?? [];
      group.push(reading);
      byScore.set(reading.scoreId, group);
    }

    const pieces: PieceInsight[] = [...byScore.entries()]
      .map(([scoreId, group]) => {
        const score = titles.get(scoreId);
        const mean =
          group.reduce((total, r) => total + r.deviationPct, 0) / group.length;
        // The band of the take nearest the mean, rather than a band computed
        // here: the thresholds are the server's and they move.
        const nearest = group.reduce((best, r) =>
          Math.abs(r.deviationPct - mean) < Math.abs(best.deviationPct - mean)
            ? r
            : best,
        );
        return {
          pieceId: scoreId,
          title: score?.title ?? 'Unknown piece',
          composer: score?.composer ?? null,
          sessions: group.length,
          meanDeviationPct: mean,
          band: nearest.band,
          direction: nearest.direction,
          verdict: verdictFor(nearest.band, nearest.direction),
        };
      })
      .sort((a, b) => Math.abs(b.meanDeviationPct) - Math.abs(a.meanDeviationPct));

    const sessions = readings.length;
    const meanDeviationPct =
      readings.reduce((total, r) => total + r.deviationPct, 0) / sessions;
    const headline = readings.reduce((best, r) =>
      Math.abs(r.deviationPct - meanDeviationPct) <
      Math.abs(best.deviationPct - meanDeviationPct)
        ? r
        : best,
    );

    return {
      windowDays: INSIGHTS_WINDOW_DAYS,
      sessions,
      meanDeviationPct,
      band: headline.band,
      direction: headline.direction,
      verdict: verdictFor(headline.band, headline.direction),
      pieces,
    };
  },
};

/**
 * One analysed take.
 *
 * `alignment_failed` and `no_onsets` are outcomes, not errors: the pipeline
 * ran, heard something it couldn't use, and wrote a sentence saying so. They
 * come through with that sentence and no measures, and the screen renders the
 * sentence rather than an empty chart.
 */
function toTake(
  analysis: AnalysisResponse,
  result: AnalysisResultJson,
  score: ScoreResponse | null,
): TakeResult {
  const measures: MeasureVerdict[] = (result.per_measure ?? []).map((m) => ({
    measure: m.measure_number,
    noteCount: m.note_count,
    deviationPct: toRushPositive(m.avg_delta_pct),
    band: m.worst_band,
    direction: m.direction,
    verdict: verdictFor(m.worst_band, m.direction),
  }));

  return {
    id: analysis.id,
    pieceId: analysis.score_id,
    pieceTitle: score?.title ?? 'Unknown piece',
    composer: score?.composer ?? null,
    recordedAt: analysis.created_at,
    targetBpm: analysis.target_bpm,
    status: result.status,
    headline: result.verdict,
    direction: result.verdict_direction,
    verdict: verdictFor(worstBandOf(result), result.verdict_direction),
    lowConfidence: result.low_confidence,
    measures,
    // Already rush-positive from the pipeline — the one field that isn't flipped.
    trend: result.trend ?? [],
    missedNotes: result.n_missed_notes ?? 0,
    extraNotes: result.n_extra_notes ?? 0,
  };
}

export const apiTakeSource: TakeSource = {
  async getTake(analysisId) {
    const analysis = await getAnalysis(analysisId);
    const result = asResult(analysis);
    if (!result) {
      return null;
    }
    // A deleted score would 404 the whole screen over a title, so a missing
    // one degrades to "Unknown piece" instead.
    const score = await getScore(analysis.score_id).catch(() => null);
    return toTake(analysis, result, score);
  },
};
