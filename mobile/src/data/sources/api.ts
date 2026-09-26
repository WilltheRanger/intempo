import { getAnalysis, getAnalysisRecording, listAnalyses } from '../api/analyses';
import { submitTake, TakeSubmissionError, waitForAnalysis } from '../practice/submitTake';
import { rememberPendingAnalysis } from '../practice/pendingAnalysis';
import { newestReadable, type Readable } from '../practice/newestReadable';
import { getMe } from '../api/me';
import { ApiError } from '../api/client';
import {
  createScore,
  deleteScore,
  getCurrentScore,
  getScore,
  listScores,
  updateScore,
} from '../api/scores';
import { getAuthAvatarUrl } from '../auth/session';
import { stableImage } from '../../lib/imageSource';
import { verdictFor } from '../../lib/tempo';
import { judgeAggregate } from '../../lib/insights/tendency';
import { wasTimed } from '../../lib/verdict/measureReading';
import type {
  AnalysisResponse,
  AnalysisResultJson,
  AnalysisStatus,
  Band,
  IntonationSummaryJson,
  MeasureVerdict,
  PerMeasureResult,
  Piece,
  PieceInsight,
  PracticeInsights,
  ScoreResponse,
  TakeIntonation,
  TakeResult,
  Tolerance,
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
    // Only `GET /v1/scores/:id` fills `image_urls`; the listing sends page one
    // alone. Falling back to the thumbnail keeps a listed piece showing its
    // photograph rather than none, and an older backend that has never heard
    // of the field behaves exactly as it did.
    pages: (score.image_urls?.length
      ? score.image_urls.map(stableImage)
      : [stableImage(score.image_url)]
    ).filter((page): page is NonNullable<typeof page> => page !== null),
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
    // **Two fields out of two hundred rows.** This builds the map of "when
    // did I last play this", which reads `score_id` and `created_at` and
    // nothing else — and it runs on every Library open and every piece open.
    // With the analysis attached that is 10 MB off the database and down the
    // wire for about four kilobytes of answer.
    const analyses = await listAnalyses({ limit: 200, includeResult: false });
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
      /*
        **On again, and the cost is the point of the feature.**

        This was turned off because it walks the whole library, so the notation
        it carried was every piece's, every time the tab was opened past
        `STALE_TIME_MS` — measured at 111 to 130 bytes a note — and *nothing
        downstream drew a note from it*. That last clause is what changed:
        the library is a shelf now, and every tile engraves the opening of its
        piece from this field. See `PieceTile`.

        The trade, stated rather than assumed. A forty-piece library of
        hundred-note openings is on the order of half a megabyte uncompressed,
        in **one request per page of fifty** — against the alternative that was
        rejected, one signed-URL image fetch per row of a full-resolution phone
        photograph, which the owner reported as "incredibly laggy". It is also
        cached: React Query holds the listing for `STALE_TIME_MS`, so browsing
        back to the tab does not re-ask.

        Two cheaper shapes exist and neither is available here. Asking for the
        first two bars would need a backend parameter and a deploy before the
        app could rely on it; fetching per visible tile would be forty requests
        where this is one. If the payload becomes a problem, the first of those
        is the fix.
      */
      includeScore: true,
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
    // One request where the server has the endpoint. An API not yet on the
    // build that added it answers 404, and the two-step lookup below is the
    // same rule worked out here — so the app and the API can deploy in either
    // order.
    try {
      const current = await getCurrentScore();
      return current.score ? toPiece(current.score, current.last_practiced_at) : null;
    } catch (cause) {
      if (!(cause instanceof ApiError) || cause.status !== 404) {
        throw cause;
      }
    }

    // The piece to continue is the one most recently *played*, not the one
    // most recently added — so the newest analysis names it. A library with no
    // analyses yet falls back to the newest score, which is the only sensible
    // thing to offer someone who has never recorded.
    const analyses = await listAnalyses({ limit: 1, includeResult: false }).catch(
      () => [],
    );
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

/**
 * The bars a take was actually judged on.
 *
 * **Only the bars that were timed.** A four-bar `rit.` played exactly as
 * marked reports a real, large deviation on each of its bars, and averaging
 * those into "how steadily was this played" answers the question with a number
 * the pipeline explicitly refused to judge.
 *
 * **One function because both readings below must select the same bars.** They
 * used to filter separately with identical code, which is what let the call
 * site fall back from the spread to `Math.abs(mean)` — unreachable while the
 * two agreed, and the most flattering possible answer the moment they did not.
 * Sharing the selection makes them agree by construction rather than by
 * coincidence, and lets the emptiness check happen once, where the decision to
 * skip the take belongs.
 */
function timedMeasures(result: AnalysisResultJson): PerMeasureResult[] {
  return (result.per_measure ?? []).filter((m) =>
    wasTimed({
      underTempoChange: m.under_tempo_change === true,
      timedNoteCount: m.timed_note_count ?? null,
    }),
  );
}

/** The mean deviation of a finished take, rush-positive. Bars must be timed. */
function meanDeviationOf(measures: PerMeasureResult[]): number {
  const mean =
    measures.reduce((total, m) => total + m.avg_delta_pct, 0) / measures.length;
  return toRushPositive(mean);
}

/**
 * How far this take sat from the beat, ignoring which side.
 *
 * The sibling `meanDeviationOf` cannot answer that, and reading it as though
 * it could is what made Insights claim a direction over a musician who had
 * none: a bar 18% ahead and a bar 18% behind average to zero, and the same
 * two bars are 18 out here.
 *
 * Averaged over the take's **measures**, not taken as the take's own mean,
 * because that is where the cancelling happens — a take whose bars alternate
 * has a mean of zero and every one of its bars is a long way off.
 *
 * Takes the same bars as its sibling — `timedMeasures` selects them once, for
 * the same reason: a `rit.` played exactly as marked reports a real, large
 * deviation per bar, and it is not distance from a beat the page asked for.
 */
function spreadOf(measures: PerMeasureResult[]): number {
  return (
    measures.reduce((total, m) => total + Math.abs(m.avg_delta_pct), 0) /
    measures.length
  );
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

/** One finished take, reduced to what a summary is built out of. */
interface Reading {
  at: number;
  deviationPct: number;
  spreadPct: number;
  tolerance: Tolerance | null;
}

/**
 * A set of takes, judged as a set.
 *
 * **The band and direction come from the aggregate**, not from whichever take
 * sat nearest its mean. The old code borrowed them, defending it with "the
 * thresholds are the server's and they move" — true, and answered by the fact
 * that the thresholds travel with each take, so `judgeAggregate` applies the
 * server's own cutoffs to the aggregate figure. Borrowing produced a headline
 * that flipped between "You tend to rush" and "You tend to drag" when two
 * opposite takes arrived in the other order, over identical practice.
 *
 * One function for the window and for each piece, because they are the same
 * question at two scales and they have disagreed before — `api.test.ts` still
 * carries the test named for the last time they did.
 *
 * The tolerance is the **newest** take's: a window can span a retune, and the
 * numbers a musician is judged by now are the ones their chart should be
 * scaled to. Ties fall to the widest, so the answer never depends on the order
 * the server happened to return two same-second takes in.
 */
function summarise(readings: Reading[]) {
  const meanDeviationPct =
    readings.reduce((total, r) => total + r.deviationPct, 0) / readings.length;
  const spreadPct =
    readings.reduce((total, r) => total + r.spreadPct, 0) / readings.length;
  const current = readings.reduce((newest, r) =>
    r.at > newest.at ||
    (r.at === newest.at && outerWidth(r.tolerance) > outerWidth(newest.tolerance))
      ? r
      : newest,
  );
  return {
    meanDeviationPct,
    spreadPct,
    ...judgeAggregate(meanDeviationPct, current.tolerance),
    tolerance: current.tolerance,
  };
}

/** Only ever compared, never shown. `null` sorts below every real set. */
function outerWidth(tolerance: Tolerance | null): number {
  return tolerance === null
    ? -1
    : tolerance.rushing_outer_pct + tolerance.dragging_outer_pct;
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
        // **One selection, one emptiness check.** A take with nothing timed
        // has neither a mean nor a spread, and skipping it here is what makes
        // both readings below unconditional — no fallback, and therefore no
        // chance of answering the spread with `|mean|`, which is the one
        // number it exists not to be.
        const timed = timedMeasures(result);
        if (timed.length === 0) {
          return [];
        }
        return [
          {
            scoreId: analysis.score_id,
            at: Date.parse(analysis.created_at),
            deviationPct: meanDeviationOf(timed),
            spreadPct: spreadOf(timed),
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
        const summary = summarise(group);
        return {
          pieceId: scoreId,
          title: score?.title ?? 'Unknown piece',
          composer: score?.composer ?? null,
          sessions: group.length,
          ...summary,
        };
      })
      // **By distance from the beat, not by bias.** Sorting on the signed mean
      // put a piece a musician plays 18% out on both sides at the bottom of
      // the list, under pieces they play a consistent 3% ahead of it — and the
      // first row of this list is what Today reads to name the piece worth a
      // look. `spreadPct` is never smaller than the bias, so for a piece that
      // does drift one way this is the same ordering it always was.
      .sort((a, b) => b.spreadPct - a.spreadPct);

    return {
      windowDays: INSIGHTS_WINDOW_DAYS,
      sessions: readings.length,
      ...summarise(readings),
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
    playedBpm: typeof m.played_bpm === 'number' ? m.played_bpm : null,
    pitchCents: typeof m.pitch_cents === 'number' ? m.pitch_cents : null,
    targetBpm: typeof m.target_bpm === 'number' ? m.target_bpm : null,
  }));

  return {
    id: analysis.id,
    recordingAvailable: true,
    comparisonKey: typeof result.comparison_key === 'string' ? result.comparison_key : null,
    pieceId: analysis.score_id,
    pieceTitle: score?.title ?? 'Unknown piece',
    composer: score?.composer ?? null,
    recordedAt: analysis.created_at,
    targetBpm: analysis.target_bpm,
    tempoBeatUnit: score?.score_json?.tempo_beat_unit ?? null,
    failure: null,
    status: result.status,
    headline: result.verdict,
    finding: result.insights?.lead ?? null,
    direction: result.verdict_direction,
    verdict: verdictFor(worstBandOf(result), result.verdict_direction),
    lowConfidence: result.low_confidence,
    measures,
    // Already rush-positive from the pipeline — the one field that isn't flipped.
    trend: result.trend ?? [],
    tolerance: result.tolerance ?? null,
    intonation: toIntonation(result.intonation),
    missedNotes: result.n_missed_notes ?? 0,
    extraNotes: result.n_extra_notes ?? 0,
    wrongNotes: (result.wrong_notes ?? []).map((w) => ({
      bar: w.measure_number,
      heard: w.heard,
      written: w.written,
    })),
    restEntries: (result.rest_entries ?? []).map((r) => ({
      restBar: r.rest_measure,
      bar: r.measure_number,
      beats: r.beats,
      barBeats: r.bar_beats ?? null,
    })),
  };
}

/** The stored intonation summary in the app's shape, or null. */
export function toIntonation(
  json: IntonationSummaryJson | null | undefined,
): TakeIntonation | null {
  if (!json || typeof json.spread_cents !== 'number') {
    return null;
  }
  return {
    tuningCents: json.tuning_cents,
    spreadCents: json.spread_cents,
    notes: json.notes,
    inTuneCents: json.in_tune_cents,
    slightCents: json.slight_cents,
    tuningWorthSayingCents: json.tuning_worth_saying_cents,
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
    finding: null,
    direction: 'on',
    verdict: 'on_tempo',
    lowConfidence: false,
    measures: [],
    trend: [],
    tolerance: null,
    intonation: null,
    missedNotes: 0,
    extraNotes: 0,
    wrongNotes: [],
    restEntries: [],
  };
}

const RUN_FAILED = new Set<AnalysisStatus>(['failed', 'failed_recoverable']);

/**
 * The newest finished takes whose result can actually be read.
 *
 * Both take readers wanted the same thing and each built it differently — one
 * fetched the whole default page and took the first readable row, the other
 * fetched `×3` and hoped. One function so they cannot disagree about what
 * "the newest takes" means, in the same spirit as `readTakeFailure`.
 *
 * The server orders newest first and `test_analyses_api.py` holds it to that,
 * which is what lets this page by offset rather than sorting the world.
 */
function donePage(
  want: number,
): Promise<Readable<AnalysisResponse, AnalysisResultJson>[]> {
  return newestReadable(
    (offset, limit) =>
      listAnalyses({ status: 'done', limit, offset }),
    asResult,
    want,
  );
}


/**
 * How far back the count on a piece's history looks.
 *
 * The endpoint's own ceiling is 200. A full page means "at least this many",
 * and `getPieceHistory` stops claiming a start date at that point rather than
 * naming the oldest row it happened to see.
 */
const HISTORY_PAGE = 200;

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
    // **One request for a handful of rows, not two hundred.** This used to ask
    // for every finished analysis — the default page — sort them here, and
    // return the first whose result could be read, to render one verdict. Each
    // row carries its per-note analysis at 214 bytes a note, so a library of
    // 200-note takes moved 10 MB for one screen.
    //
    // It could not simply ask for one, and the reason was real: a finished
    // analysis whose `result_json` cannot be read is not a take anyone can be
    // shown, so how many rows are needed is not known until they are read.
    // `newestReadable` pages instead, and its ceiling is the same 200 this
    // examined, so a library that produced an answer still produces that one.
    const [newest] = await donePage(1);
    if (!newest) {
      return null;
    }

    // A deleted score would 404 the whole screen over a title, so a missing
    // one degrades to "Unknown piece" instead.
    const score = await getScore(newest.row.score_id).catch(() => null);
    return toTake(newest.row, newest.result, score);
  },

  async getRecentTakes(limit = 3) {
    const safeLimit = Math.max(1, Math.round(limit));
    // **`×3` was a guess, and it was short when it was wrong.** The old call
    // asked for three times as many rows as it wanted and kept whichever of
    // those happened to be readable — so a run of unreadable takes silently
    // returned fewer than the homepage asked for, with nothing to say why.
    // Paging asks again instead.
    const recent = await donePage(safeLimit);

    if (recent.length === 0) {
      return [];
    }

    // One score listing instead of one request per row. A missing score only
    // costs its title; the take and its verdict remain valid practice history.
    // Titles and composers for the takes on Today. No notation is drawn here
    // at all — `toTake` reads the piece's name and nothing else from these.
    const scores = await listScores({ includeScore: false }).catch(() => []);
    const scoresById = new Map(scores.map((score) => [score.id, score]));
    return recent.map(({ row, result }) =>
      toTake(row, result, scoresById.get(row.score_id) ?? null),
    );
  },

  /**
   * How much practice this piece has behind it.
   *
   * **Two calls, because the two questions cost differently.** The count and
   * the date are answered by the rows alone, and `include_result=false`
   * narrows the SQL projection rather than hiding a field Postgres has already
   * read — `result_json` is 214 bytes a note, so a page of forty takes is
   * megabytes for two columns' worth of answer. What the last few takes
   * *sounded like* does need the results, so only `window` of them are asked
   * for.
   *
   * In parallel: neither answer depends on the other, and this runs while a
   * musician is looking at the piece they are about to play.
   */
  async getPieceHistory(pieceId, window = 12) {
    const [rows, detailed] = await Promise.all([
      listAnalyses({
        scoreId: pieceId,
        status: 'done',
        includeResult: false,
        limit: HISTORY_PAGE,
      }).catch(() => []),
      listAnalyses({
        scoreId: pieceId,
        status: 'done',
        includeResult: true,
        limit: Math.max(1, window),
      }).catch(() => []),
    ]);

    // Newest first is what the endpoint orders by, so the oldest in the page
    // is the last row. **`since` is only honest while the page is not full** —
    // beyond `HISTORY_PAGE` takes the oldest one here is not the oldest there
    // is, and a card reading "since March" about a piece played since January
    // is a wrong fact rather than a missing one.
    const oldest = rows.length < HISTORY_PAGE ? rows[rows.length - 1] : undefined;

    const recent = detailed
      .map((analysis) => {
        const result = asResult(analysis);
        return result ? toTake(analysis, result, null) : null;
      })
      .filter((take): take is TakeResult => take !== null);

    return {
      takes: rows.length,
      since: oldest?.created_at ?? null,
      recent,
    };
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
  async submit(input, options) {
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
      await waitForAnalysis(submitted.analysisId, {
        onStage: options?.onStage,
        assertOwner: input.assertOwner,
      });
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
