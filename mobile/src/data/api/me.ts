import type { Instrument, MeResponse } from '../types';
import { apiFetch } from './client';
import { parseMe } from './responseSchemas';

/**
 * GET /v1/me
 *
 * Must be called once on app open, before any other authenticated request.
 * The backend provisions the `public.users` row on first touch; calling
 * `/v1/scores` first fails with a foreign-key error (recorded in EDIT_LOG.md).
 */
export function getMe(): Promise<MeResponse> {
  return apiFetch<unknown>('/v1/me').then(parseMe);
}

export interface UpdateMeInput {
  /**
   * Omit to leave alone; send `null` to clear. The same contract
   * `updateScore` uses — someone taking their name or photograph back off the
   * account has to have a way to say so, and "omitted" cannot mean both
   * "leave it" and "remove it".
   *
   * `undefined` drops out of the JSON body, which is what the server reads as
   * "not sent". That is the whole mechanism, so do not spread a partial object
   * with explicit `undefined`s into this expecting them to clear anything.
   */
  instrument?: Instrument | null;
  display_name?: string | null;
  /** The object key from `uploadAvatar`, never a URL. Null removes the picture. */
  avatar_key?: string | null;
  /**
   * Explicit permission to retain corrected readings and their source pages
   * for improving the reader. False withdraws permission and asks the server
   * to delete data that was retained under it.
   */
  training_consent?: boolean;
  /**
   * Marks onboarding as shown. Only ever `true` — the server refuses to move
   * it back, because a client that could would put the screen in front of
   * someone who had already dealt with it.
   */
  onboarded?: true;
}

/** PATCH /v1/me — at least one field required. */
export function updateMe(input: UpdateMeInput): Promise<MeResponse> {
  return apiFetch<unknown>('/v1/me', { method: 'PATCH', body: input }).then(parseMe);
}
