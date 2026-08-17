import type { Clef, ScoreJson, ScoreResponse } from '../types';
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

/**
 * A new piece, from a photograph or from typing. The two are exclusive and the
 * backend rejects a body that mixes them, so these are separate shapes rather
 * than one shape with optional halves.
 */
export type CreateScoreInput = TranscribedScoreInput | HandEnteredScoreInput;

export interface TranscribedScoreInput {
  image_url: string;
  title: string;
  composer?: string | null;
}

export interface HandEnteredScoreInput {
  image_url?: never;
  title: string;
  composer?: string | null;
  /**
   * Required: OCR would have read it off the page, and nothing did. The app
   * derives it from the musician's instrument rather than asking.
   */
  clef: Clef;
  /** `"4/4"`. Null when the musician left it blank. */
  time_signature?: string | null;
  /** The tempo to practise at. Null when they didn't say. */
  bpm_hint?: number | null;
}

/**
 * POST /v1/scores
 *
 * With an image this runs OCR inline and takes 10–14 seconds in practice
 * (EDIT_LOG.md, Batch 2), so any caller needs a real progress state rather
 * than a brief spinner. A hand-entered piece skips OCR and returns straight
 * away.
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
