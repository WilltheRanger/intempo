import type { AnalysisResponse } from '../types';
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
