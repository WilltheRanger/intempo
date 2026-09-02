import { getAnalysis, getAnalysisRecording, listAnalyses } from '../api/analyses';
import { submitTake, TakeSubmissionError, waitForAnalysis } from '../practice/submitTake';
import { rememberPendingAnalysis } from '../practice/pendingAnalysis';
import { getMe } from '../api/me';
import { createScore, deleteScore, getScore, listScores, updateScore } from '../api/scores';
import { getAuthAvatarUrl } from '../auth/session';
import { stableImage } from '../../lib/imageSource';
import { verdictFor } from '../../lib/tempo';
import { wasTimed } from '../../lib/verdict/measureReading';
import type {
  AnalysisResponse,
  AnalysisResultJson,
  AnalysisStatus,
  Band,
  Direction,
  MeasureVerdict,
  Piece,
  PieceInsight,
  PracticeInsights,
  ScoreResponse,
  TakeResult,
} from '../types';
import { toMusician } from './musician';
import type {
  InsightsSource,
  MusicianSource,
  PieceSource,
  TakeSource,
  TakeSubmissionSource,
} from './types';

/**
 * The real backend, mapped into the shape the UI renders.
 *
 * **Every field is live.** Two used to be listed here as permanently null and
 * both are now resolved, in opposite directions: `progress` was deleted,
 * because nothing in the product could compute it and none of it was coming;
 * `movement` was given a column, because it is a fact the musician already
 * knows and was already being asked for. `lastPracticedAt` comes from
 * `/v1/analyses`, and `thumbnail` from the download URL the backend signs on
 * every read.
 */
export function toPiece(
  score: ScoreResponse,
  lastPracticedAt: string | null = null,
): Piece {
  return {
    id: score.id,
    title: score.title,
    composer: score.composer,
    movement: score.movement,
    lastPracticedAt,
    // Signed on read and good for an hour. Null when signing failed, which is
    // a thumbnail-shaped hole rather than an error — `ScoreThumbnail` already
    // falls back to its ruled-staff drawing.
    thumbnail: stableImage(score.image_url),
    markedBpm: score.score_json?.bpm_hint ?? null,
    score: score.score_json ?? null,
    concerns: score.concerns ?? [],
    // Defaulted rather than required: a backend that predates the column sends
    // nothing, and treating that as "finished" is right — every score it wrote
    // was transcribed before it was inserted at all.
    transcriptionStatus: score.transcription_status ?? 'done',
    transcriptionStage: score.transcription_stage ?? null,
    transcriptionError: score.transcription_error ?? null,
    transcriptionAccepted: Boolean(score.transcription_accepted_at),
    pageImageDiscarded: Boolean(score.page_image_discarded_at),
  };
}

/**
 * When each score was last recorded against, from the analyses list.
 *
 * One extra request for the whole library rather than one per piece:
 * `/v1/analyses` is newest-first, so the first row naming a score is that
 * score's most recent take and everything after it can be ignored.
 *
 * A failure here costs the "3 days ago" line and nothing else, so it degrades
 * to an empty map instead of taking the library down with it.
 */
async function lastPracticedByScore(): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  try {
    const analyses = await listAnalyses({ limit: 200 });
    for (const analysis of analyses) {
      if (!out.has(analysis.score_id)) {
        out.set(analysis.score_id, analysis.created_at);
      }
    }
  } catch {
    // Fall through with what we have.
  }
  return out;
}

/** The endpoint's own ceiling (`le=200` on `/v1/scores`). */
const SCORES_PAGE = 200;

/**
 * A hard stop, so a server that always returns a full page cannot spin this
 * forever. Forty thousand pieces is not a library anyone has; reaching it means
 * something is wrong, and stopping is better than hanging.
 */
const MAX_SCORE_PAGES = 200;

/**
 * Every score, not the first page of them.
 *
 * `listScores()` defaults to 50 and the library rendered exactly that, with no
 * indication there was more — and `LibraryScreen`'s search filters the array it
 * is given, so piece 51 was not merely below the fold, it was unfindable.
 *
 * Paged rather than given a big limit: a cap of 200 is the same bug at a higher
 * number. This asks until the answer is short, which is the only way to know it
 * has them all.
 */
async function listAllScores(): Promise<ScoreResponse[]> {
  const all: ScoreResponse[] = [];
  for (let page = 0; page < MAX_SCORE_PAGES; page += 1) {
    const batch = await listScores({
      limit: SCORES_PAGE,
      offset: page * SCORES_PAGE,
    });
    all.push(...batch);
    // A short page is the last page. An exactly-full final page costs one more
    // request that comes back empty, which is the price of not guessing.
    if (batch.length < SCORES_PAGE) {
      break;
    }
  }
  return all;
}

export const apiPieceSource: PieceSource = {
  async listPieces() {
    const [scores, practiced] = await Promise.all([
      listAllScores(),
      lastPracticedByScore(),
    ]);
    return scores.map((score) => toPiece(score, practiced.get(score.id) ?? null));
  },

  async getCurrentPiece() {
    // The piece to continue is the one most recently *played*, not the one
    // most recently added — so the newest analysis names it. A library with no
    // analyses yet falls back to the newest score, which is the only sensible
    // thing to offer someone who has never recorded.
    const analyses = await listAnalyses({ limit: 1 }).catch(() => []);
    const [latest] = analyses;

    if (latest) {
      const score = await getScore(latest.score_id).catch(() => null);
      if (score) {
        return toPiece(score, latest.created_at);
      }
    }

    const [mostRecent] = await listScores({ limit: 1 });
    return mostRecent ? toPiece(mostRecent) : null;
  },

  async getPiece(id) {
    const [score, practiced] = await Promise.all([
      getScore(id),
      lastPracticedByScore(),
    ]);
    return toPiece(score, practiced.get(id) ?? null);
  },

  async createPiece(input) {
    const score = await createScore({
      title: input.title,
      composer: input.composer,
      movement: input.movement,
      clef: input.clef,
      time_signature: input.timeSignature,
      bpm_hint: input.bpm,
    });
    // Never practised — it was created a moment ago.
    return toPiece(score, null);
  },

  async updatePiece(id, input) {
    const score = await updateScore(id, {
      title: input.title,
      composer: input.composer,
      movement: input.movement,
    });
    // The edit doesn't touch practice history, so keep the date the rest of
    // the app is showing rather than dropping it to null.
    const practiced = await lastPracticedByScore();
    return toPiece(score, practiced.get(id) ?? null);
  },

  async deletePiece(id) {
    // The endpoint owns the whole lifecycle: assignments, analyses, score row,
    // recording audio and any retained page image. A failure is retryable and
    // already phrased for the musician by the API error layer.
    await deleteScore(id);
  },
};

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
  // **Only the bars that were timed.** A four-bar `rit.` played exactly as
  // marked reports a real, large deviation on each of its bars, and averaging
  // those into "how steadily was this played" answers the question with a
  // number the pipeline explicitly refused to judge.
  const measures = (result.per_measure ?? []).filter((m) =>
    wasTimed({
      underTempoChange: m.under_tempo_change === true,
      timedNoteCount: m.timed_note_count ?? null,
    }),
  );
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
      // All of them, not the first 200: this is the id → title map, and a
      // missing entry renders as "Unknown piece" on the insights list. A
      // library past the cap would have quietly started mislabelling its
      // oldest pieces.
      listAllScores(),
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
            tolerance: result.tolerance ?? null,
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
          tolerance: nearest.tolerance,
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
      tolerance: headline.tolerance,
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
    // **Both were dropped here**, and the screen then drew a bar under a
    // written `rit.` as a large deviation labelled "On the beat". See
    // `lib/verdict/measureReading.ts`.
    underTempoChange: m.under_tempo_change === true,
    uneven: m.uneven === true,
    timedNoteCount: m.timed_note_count ?? null,
    untimedReason: m.untimed_reason ?? null,
  }));

  return {
    id: analysis.id,
    recordingAvailable: true,
    pieceId: analysis.score_id,
    pieceTitle: score?.title ?? 'Unknown piece',
    composer: score?.composer ?? null,
    recordedAt: analysis.created_at,
    targetBpm: analysis.target_bpm,
    tempoBeatUnit: score?.score_json?.tempo_beat_unit ?? null,
    failure: null,
    status: result.status,
    headline: result.verdict,
    direction: result.verdict_direction,
    verdict: verdictFor(worstBandOf(result), result.verdict_direction),
    lowConfidence: result.low_confidence,
    measures,
    // Already rush-positive from the pipeline — the one field that isn't flipped.
    trend: result.trend ?? [],
    tolerance: result.tolerance ?? null,
    missedNotes: result.n_missed_notes ?? 0,
    extraNotes: result.n_extra_notes ?? 0,
  };
}

/**
 * A run that failed instead of producing a result.
 *
 * Every field an analysis would have described is empty, because there is no
 * analysis — this exists so the screen can tell "the pipeline failed" apart
 * from "there is no such take", which are the same `null` otherwise and read
 * to the musician as very different things.
 */
function toFailedTake(
  analysis: AnalysisResponse,
  score: ScoreResponse | null,
): TakeResult {
  return {
    id: analysis.id,
    recordingAvailable: true,
    pieceId: analysis.score_id,
    pieceTitle: score?.title ?? 'Unknown piece',
    composer: score?.composer ?? null,
    recordedAt: analysis.created_at,
    targetBpm: analysis.target_bpm,
    tempoBeatUnit: score?.score_json?.tempo_beat_unit ?? null,
    failure: {
      recoverable: analysis.status === 'failed_recoverable',
      reason: analysis.failure_reason,
    },
    // Placeholders. `failure` being set is the signal to ignore all of these;
    // they exist only because `TakeResult` is one shape.
    status: 'ok',
    headline: '',
    direction: 'on',
    verdict: 'on_tempo',
    lowConfidence: false,
    measures: [],
    trend: [],
    tolerance: null,
    missedNotes: 0,
    extraNotes: 0,
  };
}

const RUN_FAILED = new Set<AnalysisStatus>(['failed', 'failed_recoverable']);

export const apiTakeSource: TakeSource = {
  async getTake(analysisId) {
    const analysis = await getAnalysis(analysisId);
    // Before `asResult`, because a failed run has no `result_json` and would
    // otherwise fall into the same null as an id that doesn't exist. The
    // screen then said "It may have been removed, or the analysis never
    // finished" to someone who had just played — naming a cause that wasn't
    // the cause, and dropping the backend's own recoverable/not distinction,
    // which exists precisely so a retry can be offered.
    if (RUN_FAILED.has(analysis.status)) {
      const score = await getScore(analysis.score_id).catch(() => null);
      return toFailedTake(analysis, score);
    }
    const result = asResult(analysis);
    if (!result) {
      return null;
    }
    // A deleted score would 404 the whole screen over a title, so a missing
    // one degrades to "Unknown piece" instead.
    const score = await getScore(analysis.score_id).catch(() => null);
    return toTake(analysis, result, score);
  },

  async getLatestTake() {
    // The same call Insights makes, sorted rather than aggregated. No new
    // endpoint: `GET /v1/analyses` returns the caller's own analyses and the
    // ordering is settled here rather than assumed of the server.
    const analyses = await listAnalyses({ status: 'done' });

    const newest = analyses
      .slice()
      .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
      // A finished analysis whose `result_json` can't be read is not a take
      // anyone can be shown, so it is skipped rather than rendered blank.
      .map((analysis) => ({ analysis, result: asResult(analysis) }))
      .find((entry) => entry.result !== null);

    if (!newest?.result) {
      return null;
    }

    const score = await getScore(newest.analysis.score_id).catch(() => null);
    return toTake(newest.analysis, newest.result, score);
  },

  async getRecentTakes(limit = 3) {
    const safeLimit = Math.max(1, Math.round(limit));
    // Ask for a few extra rows because a finished row with an old or unreadable
    // result shape is deliberately skipped. The homepage still gets up to the
    // requested number of real, renderable takes.
    const analyses = await listAnalyses({
      status: 'done',
      limit: safeLimit * 3,
    });
    const recent = analyses
      .slice()
      .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
      .map((analysis) => ({ analysis, result: asResult(analysis) }))
      .filter(
        (
          entry,
        ): entry is {
          analysis: AnalysisResponse;
          result: AnalysisResultJson;
        } => entry.result !== null,
      )
      .slice(0, safeLimit);

    if (recent.length === 0) {
      return [];
    }

    // One score listing instead of one request per row. A missing score only
    // costs its title; the take and its verdict remain valid practice history.
    const scores = await listScores().catch(() => []);
    const scoresById = new Map(scores.map((score) => [score.id, score]));
    return recent.map(({ analysis, result }) =>
      toTake(analysis, result, scoresById.get(analysis.score_id) ?? null),
    );
  },

  async getRecordingUrl(analysisId) {
    const playback = await getAnalysisRecording(analysisId);
    return playback.url;
  },
};

/**
 * The real submission: upload, enqueue, wait.
 *
 * Waiting here rather than on the verdict screen keeps the "Listening back"
 * state honest — it ends when the pipeline ends, not on a timer, and the
 * screen it hands over to always has a finished analysis to read.
 */
export const apiTakeSubmissionSource: TakeSubmissionSource = {
  async submit(input) {
    const submitted = await submitTake(input);
    // The row and audio are durable at this point. Remember the hand-off before
    // the first poll so a refresh, tab close, or phone suspension can resume
    // from the accepted id instead of making the musician wonder where the
    // recording went.
    await rememberPendingAnalysis({
      analysisId: submitted.analysisId,
      scoreId: input.scoreId,
      createdAt: Date.now(),
    });
    try {
      await waitForAnalysis(submitted.analysisId);
      return submitted.analysisId;
    } catch (cause) {
      // Enqueue already succeeded. Keep its id so "Send it again" resumes the
      // poll instead of uploading the WAV and creating another analysis row.
      const message =
        cause instanceof Error
          ? cause.message
          : 'The analysis could not be checked. Try again.';
      throw new TakeSubmissionError(message, submitted, cause);
    }
  },
};
