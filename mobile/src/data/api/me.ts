import type { MeResponse } from '../types';
import { apiFetch } from './client';

/**
 * GET /v1/me
 *
 * Must be called once on app open, before any other authenticated request.
 * The backend provisions the `public.users` row on first touch; calling
 * `/v1/scores` first fails with a foreign-key error (recorded in EDIT_LOG.md).
 */
export function getMe(): Promise<MeResponse> {
  return apiFetch<MeResponse>('/v1/me');
}
