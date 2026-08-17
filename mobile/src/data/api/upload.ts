import type { UploadResponse } from '../types';
import { apiFetch } from './client';

/**
 * POST /v1/upload/score-image — presigned PUT straight to Supabase Storage.
 * Files never stream through FastAPI.
 *
 * Pass the returned `upload_url` to `POST /v1/scores` as `image_url`: it is
 * the only form the backend's validator accepts, because `public_url` comes
 * back as a bare bucket path with no scheme. It expires five minutes after
 * issue, so create the score in the same flow as the upload rather than
 * storing it for later.
 *
 * That expiry is why `scores.source_image_url` is never rendered. Displaying
 * a score image reads `image_url` from `/v1/scores`, which the backend signs
 * fresh on every read and returns with `image_url_expires_at`.
 */
export function requestScoreImageUpload(
  filename: string,
): Promise<UploadResponse> {
  return apiFetch<UploadResponse>('/v1/upload/score-image', {
    method: 'POST',
    body: { filename },
  });
}

/** POST /v1/upload/audio — same flow, for practice recordings. */
export function requestAudioUpload(filename: string): Promise<UploadResponse> {
  return apiFetch<UploadResponse>('/v1/upload/audio', {
    method: 'POST',
    body: { filename },
  });
}

/** Uploads bytes to a presigned URL. Returns once storage has accepted them. */
export async function uploadToSignedUrl(
  uploadUrl: string,
  file: Blob,
  contentType: string,
): Promise<void> {
  const response = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': contentType },
    body: file,
  });
  if (!response.ok) {
    throw new Error(`Upload failed (${response.status})`);
  }
}
