import type { AnalysisResponse, Instrument, MetronomeMode } from '../types';
import { apiFetch } from './client';

export interface ListAnalysesParams {
  scoreId?: string;
  /** Insights only aggregates finished takes. */
  status?: 'queued' | 'processing' | 'done' | 'failed' | 'failed_recoverable';
  limit?: number;
  offset?: number;
  /**
   * Whether each row needs its per-note analysis.
   *
   * **Default true, because most callers here read it** — Insights aggregates
   * across `result_json` and the verdict screen renders it. Say `false` when
   * you only want the rows: it is by far the largest field in each one, and
   * the backend then narrows the SQL projection rather than merely hiding it.
   *
   * Measured against the real response models: **214 bytes per note**, so a
   * 200-note take is 52 KB and a page of 200 takes is **10 MB**. The map of
   * "when did I last play this" reads `score_id` and `created_at` out of that
   * — about four kilobytes of answer — on every Library open.
   */
  includeResult?: boolean;
}

/** GET /v1/analyses — the caller's takes, newest first. */
export function listAnalyses({
  scoreId,
  status,
  limit = 200,
  offset = 0,
  includeResult = true,
}: ListAnalysesParams = {}): Promise<AnalysisResponse[]> {
  const query = new URLSearchParams({
    limit: String(limit),
    offset: String(offset),
  });
  // Sent only when narrowing. The parameter defaults to true on the server, so
  // an older deployment that has never heard of it answers exactly as before
  // rather than treating an unknown value as false and dropping the field
  // every caller here still expects.
  if (!includeResult) {
    query.set('include_result', 'false');
  }
  if (scoreId) {
    query.set('score_id', scoreId);
  }
  if (status) {
    query.set('status', status);
  }
  return apiFetch<AnalysisResponse[]>(`/v1/analyses?${query}`);
}

/** GET /v1/analyses/:id — poll one take while it runs. */
export function getAnalysis(id: string): Promise<AnalysisResponse> {
  return apiFetch<AnalysisResponse>(`/v1/analyses/${id}`);
}

export interface RecordingPlaybackResponse {
  /** A short-lived owner-only read URL. Never persist it. */
  url: string;
  expires_in: number;
}

/** GET /v1/analyses/:id/recording — a fresh private playback permission. */
export function getAnalysisRecording(
  id: string,
): Promise<RecordingPlaybackResponse> {
  return apiFetch<RecordingPlaybackResponse>(
    `/v1/analyses/${id}/recording`,
  );
}

export interface CreateAnalysisInput {
  score_id: string;
  /** Durable owner-prefixed key returned by POST /v1/upload/audio. */
  audio_key: string;
  target_bpm: number;
  bpm_source: 'manual' | 'calibration_clip';
  metronome_mode: MetronomeMode;
  /**
   * What the musician plays, so the pipeline can look for onsets the way this
   * instrument produces them.
   *
   * A double bass note swells in rather than snapping in and sits where onset
   * detection is weakest, so it needs a lower threshold and a filter. That
   * setting existed in the backend from the start and nothing had ever sent
   * the value that turns it on.
   */
  instrument?: Instrument;
  /**
   * The take was played with runs of rest shortened.
   *
   * The worker shortens the score the same way before building the timeline —
   * `fixtures/practice/long_rests.json` is the contract both sides keep. Sent
   * always, including false, because the API writes the key only when true and
   * a deployment without migration 012 is therefore untouched until someone
   * actually skips a rest.
   */
  skip_long_rests?: boolean;
  /**
   * The bar the musician entered on, as numbered on the page.
   *
   * Omitted for a take from the beginning, which is what every take before
   * this field meant. The server trims the score to match before it builds a
   * timeline — a timeline that still contains the bars nobody played is
   * misaligned at every onset.
   */
  from_measure?: number;
}

/**
 * POST /v1/analyses — 202 Accepted.
 *
 * Returns as soon as the row exists; the pipeline runs behind it. Poll
 * `getAnalysis` until `status` leaves `queued`/`processing`.
 */
export function createAnalysis(
  input: CreateAnalysisInput,
): Promise<{ analysis_id: string; status: string }> {
  return apiFetch<{ analysis_id: string; status: string }>('/v1/analyses', {
    method: 'POST',
    body: input,
  });
}
