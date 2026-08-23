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
  movement?: string | null;
}

export interface HandEnteredScoreInput {
  image_url?: never;
  title: string;
  composer?: string | null;
  movement?: string | null;
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
  movement?: string | null;
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

/**
 * POST /v1/scores/:id/accept — the reading is right, discard the photograph.
 *
 * Irreversible: the page image is deleted from storage and the score keeps
 * only its transcription. The backend refuses while a page is still being read
 * and for one that failed, so this cannot destroy a photograph that is still
 * the only record of the music.
 */
export function acceptTranscription(id: string): Promise<ScoreResponse> {
  return apiFetch<ScoreResponse>(`/v1/scores/${id}/accept`, { method: 'POST' });
}

/**
 * POST /v1/scores/:id/transcribe — read the page again.
 *
 * The photograph is still in storage, so a failed reading does not need
 * re-photographing: a rate limit or a truncated response is not a problem the
 * megabytes caused. Refused while a page is already being read, and for a page
 * whose photograph was discarded on acceptance.
 */
export function retranscribeScore(id: string): Promise<ScoreResponse> {
  return apiFetch<ScoreResponse>(`/v1/scores/${id}/transcribe`, { method: 'POST' });
}

export interface ImportScoreInput {
  title: string;
  composer?: string | null;
  movement?: string | null;
  /** The MusicXML document. Uncompressed — a `.mxl` is unzipped client-side. */
  musicxml: string;
  /**
   * Which part to read, by id (`P3`) or by printed name ("Violoncello").
   *
   * Omitted for a single-part file. The backend refuses to guess on a
   * multi-part one rather than silently handing a cellist the piccolo line.
   */
  part?: string | null;
}

/**
 * POST /v1/scores/import — a piece from a notation file.
 *
 * Synchronous, unlike the camera path: parsing XML involves no model, so there
 * is nothing to background and nothing to poll. The piece comes back with its
 * notes already in it, and `ocr_confidence` null — a file is not *confident*,
 * it is *stated*.
 */
export function importScore(input: ImportScoreInput): Promise<ScoreResponse> {
  return apiFetch<ScoreResponse>('/v1/scores/import', {
    method: 'POST',
    body: input,
  });
}
