import type { UploadResponse } from '../types';
import { apiFetch } from './client';

/**
 * POST /v1/upload/score-image — presigned PUT straight to Supabase Storage.
 * Files never stream through FastAPI.
 *
 * Known backend issue, flagged in the Phase 1 audit: the signed upload URL
 * expires after 5 minutes, and it is the only form `POST /v1/scores` accepts
 * for `image_url` (the returned `public_url` is a bare bucket path with no
 * scheme, which the backend's validator rejects). So `scores.source_image_url`
 * is not usable for display later. Reading a score image back needs a signed
 * download endpoint that does not exist yet.
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
