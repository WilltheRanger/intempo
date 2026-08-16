import type { AnalysisResponse, MetronomeMode } from '../types';
import { apiFetch } from './client';

export interface ListAnalysesParams {
  scoreId?: string;
  /** Insights only aggregates finished takes. */
  status?: 'queued' | 'processing' | 'done' | 'failed' | 'failed_recoverable';
  limit?: number;
  offset?: number;
}

/** GET /v1/analyses — the caller's takes, newest first. */
export function listAnalyses({
  scoreId,
  status,
  limit = 200,
  offset = 0,
}: ListAnalysesParams = {}): Promise<AnalysisResponse[]> {
  const query = new URLSearchParams({
    limit: String(limit),
    offset: String(offset),
  });
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

export interface CreateAnalysisInput {
  score_id: string;
  audio_url: string;
  target_bpm: number;
  bpm_source: 'manual' | 'calibration_clip';
  metronome_mode: MetronomeMode;
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
