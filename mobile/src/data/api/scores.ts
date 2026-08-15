import type { ScoreJson, ScoreResponse } from '../types';
import { apiFetch } from './client';

export interface ListScoresParams {
  limit?: number;
  offset?: number;
}

/** GET /v1/scores — newest first. */
export function listScores({
  limit = 50,
  offset = 0,
}: ListScoresParams = {}): Promise<ScoreResponse[]> {
  const query = new URLSearchParams({
    limit: String(limit),
    offset: String(offset),
  });
  return apiFetch<ScoreResponse[]>(`/v1/scores?${query}`);
}

/** GET /v1/scores/:id */
export function getScore(id: string): Promise<ScoreResponse> {
  return apiFetch<ScoreResponse>(`/v1/scores/${id}`);
}

export interface CreateScoreInput {
  image_url: string;
  title: string;
  composer?: string | null;
}

/**
 * POST /v1/scores
 *
 * Runs OCR inline and takes 10–14 seconds in practice (EDIT_LOG.md, Batch 2).
 * Any caller needs a real progress state, not a brief spinner. Moving this to
 * a background task is scoped for Batch 4.
 */
export function createScore(input: CreateScoreInput): Promise<ScoreResponse> {
  return apiFetch<ScoreResponse>('/v1/scores', {
    method: 'POST',
    body: input,
  });
}

export interface UpdateScoreInput {
  title?: string;
  composer?: string | null;
  score_json?: ScoreJson;
}

/** PATCH /v1/scores/:id — at least one field required. */
export function updateScore(
  id: string,
  input: UpdateScoreInput,
): Promise<ScoreResponse> {
  return apiFetch<ScoreResponse>(`/v1/scores/${id}`, {
    method: 'PATCH',
    body: input,
  });
}

/**
 * DELETE /v1/scores/:id
 *
 * Returns 409 when the score has dependent analyses — `analyses.score_id` is
 * ON DELETE RESTRICT and there is no soft delete. Surface that to the user
 * rather than treating it as a generic failure.
 */
export function deleteScore(id: string): Promise<void> {
  return apiFetch<void>(`/v1/scores/${id}`, { method: 'DELETE' });
}
