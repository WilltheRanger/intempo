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
export type CreateScoreInput =
  | StrictTranscribedScoreInput
  | HandEnteredScoreInput;

/**
 * Fields the mobile client can send for a photographed score.
 *
 * Kept as an interface because the backend's request-shape contract test reads
 * these declarations directly. `StrictTranscribedScoreInput` below adds the
 * exactly-one-of rule that TypeScript needs.
 */
export interface TranscribedScoreInput {
  image_url?: string;
  image_urls?: string[];
  title: string;
  composer?: string | null;
  movement?: string | null;
}

type StrictTranscribedScoreInput = TranscribedScoreInput &
  (
    | { image_url: string; image_urls?: never }
    | { image_urls: string[]; image_url?: never }
  );

export interface HandEnteredScoreInput {
  image_url?: never;
  image_urls?: never;
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
 * With one or more images this creates a queued transcription and returns
 * immediately; the worker reads every page in order. A hand-entered piece
 * skips OCR and returns straight away.
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
  /**
   * Correct the clef without resending the whole transcription.
   *
   * The clef lives inside `score_json`, so this was already possible by
   * sending the entire score back — reading it, changing one word, and writing
   * hundreds of notes, losing every concurrent edit in between. The backend
   * does a read-modify-write of the single field instead, and refuses to do it
   * at all alongside a `score_json`, because two sources for one field is how
   * they come to disagree.
   *
   * **Omit to leave it alone; send `null` to clear it.** `undefined` drops out
   * of the JSON body, which is what the server reads as "not sent" — an
   * explicit null is a real answer, because a part can honestly be unlabelled
   * and `ScoreJson.clef` is nullable for that reason.
   */
  clef?: Clef | null;
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
