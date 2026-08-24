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

/**
 * How long to give the upload before deciding it is not going to finish.
 *
 * Two minutes. A phone photograph of a page is several megabytes and this is
 * the one request in the app that sends a large body, so it is the one that
 * suffers on a weak connection — and it is doing so from wherever the musician
 * happens to be practising, which is not usually next to the router.
 */
const UPLOAD_TIMEOUT_MS = 120_000;

export class UploadError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = 'UploadError';
  }
}

export interface UploadOptions {
  /**
   * Bytes sent so far and bytes in total, as the upload proceeds.
   *
   * Real numbers off the transfer — the reason this is `XMLHttpRequest` and
   * not `fetch`, which cannot report the progress of a request body at all.
   * A screen that has to sit through a multi-megabyte upload deserves better
   * than a spinner, and this is the one step in the scan whose progress is
   * genuinely measurable rather than merely staged.
   */
  onProgress?: (sent: number, total: number) => void;
}

/**
 * Uploads bytes to a presigned URL. Returns once storage has accepted them.
 *
 * **Every failure here used to reach the musician as the platform's own
 * wording.** This was a bare `fetch` with no timeout and no `catch`, so a
 * connection that died mid-upload threw `TypeError: Load failed` — iOS
 * Safari's phrasing — and `TranscribeScreen` rendered `cause.message`
 * verbatim. That is the "Load failed" that kept appearing on real scans: not
 * the backend, not OCR, but the upload before either of them, reporting itself
 * in a string that names no cause and suggests no remedy.
 */
export function uploadToSignedUrl(
  uploadUrl: string,
  file: Blob,
  contentType: string,
  { onProgress }: UploadOptions = {},
): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open('PUT', uploadUrl);
    request.setRequestHeader('Content-Type', contentType);
    request.timeout = UPLOAD_TIMEOUT_MS;

    request.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        onProgress?.(event.loaded, event.total);
      }
    };

    request.onload = () => {
      if (request.status >= 200 && request.status < 300) {
        resolve();
        return;
      }
      // Named separately because they need different things from the
      // musician: an expired URL means start the scan again, and anything
      // else means try again as-is.
      if (request.status === 400 || request.status === 403) {
        reject(
          new UploadError(
            'The upload link expired before the page finished sending. Take the photograph again.',
          ),
        );
        return;
      }
      // Too large for the bucket. "Try again" is the one thing that cannot
      // work here — the same file will be refused every time — and that was
      // the advice this used to give, because 413 fell through to the generic
      // branch below.
      if (request.status === 413) {
        reject(
          new UploadError(
            'That photograph is too large to send. Photograph the page again ' +
              'with your camera set to a smaller size, or import it as a file.',
          ),
        );
        return;
      }
      reject(new UploadError(`Storage refused the page (${request.status}). Try again.`));
    };

    request.ontimeout = () =>
      reject(
        new UploadError(
          'Sending the page took too long. A stronger connection — or moving closer to the router — usually fixes it.',
        ),
      );

    request.onerror = () =>
      reject(
        new UploadError(
          'The page could not be sent. Check your connection and try again.',
        ),
      );

    request.onabort = () => reject(new UploadError('The upload was cancelled.'));

    request.send(file);
  });
}
