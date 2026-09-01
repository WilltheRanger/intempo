import type { UploadResponse } from '../types';
import { apiFetch } from './client';

/**
 * POST /v1/upload/score-image — presigned PUT straight to Supabase Storage.
 * Files never stream through FastAPI.
 *
 * Use `upload_url` only for the PUT. Once storage accepts the bytes, pass the
 * returned owner-prefixed `object_key` to `POST /v1/scores` as the page
 * reference. Unlike the upload permission it does not expire while later pages
 * are still moving or while the musician names the piece.
 *
 * The backend validates ownership, stores a token-free private-storage
 * reference, and signs a fresh `image_url` for every read.
 */
export function requestScoreImageUpload(
  filename: string,
): Promise<UploadResponse> {
  return apiFetch<UploadResponse>('/v1/upload/score-image', {
    method: 'POST',
    body: { filename },
  });
}

/**
 * POST /v1/upload/avatar — the same flow, for a profile picture.
 *
 * Its own bucket rather than a folder in `score-images`: a page photograph is
 * transient and deleted when the reading is accepted, an avatar lives as long
 * as the account.
 *
 * **The server refuses HEIC here**, unlike a score page, and the asymmetry is
 * deliberate: a page is decoded by Pillow on the way through, an avatar is
 * handed straight to an `<img>` from a signed URL, and Chrome and Firefox
 * cannot display HEIC. An iPhone shoots HEIC by default, so ask
 * `expo-image-picker` for a quality — that re-encodes to JPEG — rather than
 * discovering it at the upload.
 *
 * The `object_key` it returns is what `updateMe` wants. Never the URL: a
 * signed URL expires, and `/v1/me` signs a fresh one on every read.
 */
export function requestAvatarUpload(filename: string): Promise<UploadResponse> {
  return apiFetch<UploadResponse>('/v1/upload/avatar', {
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

/**
 * Said when the upload was stopped on purpose.
 *
 * One constant because two places raise it — a signal that was already
 * aborted before the request opened, and one that fires during the transfer —
 * and a caller distinguishing "cancelled" from "failed" has to be able to.
 */
export const CANCELLED = 'The upload was cancelled.';

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

  /**
   * Stops the transfer.
   *
   * **The Cancel button on the sending screen did not cancel anything.** It
   * navigated away and set a flag that made the result be ignored; the
   * transfer went on pushing megabytes at storage from a screen that was no
   * longer there. On the connection this app is used over — a phone, in a
   * practice room, on the far side of a house from the router — that is the
   * whole uplink, so the scan the musician started *instead* had to share the
   * line with the one they thought they had stopped, and every request behind
   * it queued. Cancelling made the app slower.
   *
   * It compounds: nothing stopped a second attempt beginning while the first
   * was still running, so cancel-and-retry on a slow connection left two
   * uploads of the same page racing, both slower for the company.
   */
  signal?: AbortSignal;
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
  { onProgress, signal }: UploadOptions = {},
): Promise<void> {
  return new Promise((resolve, reject) => {
    // Already cancelled before anything opened — the screen was left while the
    // bytes were still being read off the device. Nothing to abort, and
    // starting a transfer in order to abort it a moment later would send the
    // first packets of a page nobody is waiting for.
    if (signal?.aborted) {
      reject(new UploadError(CANCELLED));
      return;
    }

    const request = new XMLHttpRequest();
    request.open('PUT', uploadUrl);
    request.setRequestHeader('Content-Type', contentType);
    request.timeout = UPLOAD_TIMEOUT_MS;

    const stop = () => request.abort();
    signal?.addEventListener('abort', stop);
    // Every ending goes through here, so the listener is removed once whatever
    // it was watching for can no longer happen. A signal that outlives the
    // upload — and this one does, it belongs to the screen — would otherwise
    // hold a reference to each finished request for as long as it lives.
    const settle = (finish: () => void) => {
      signal?.removeEventListener('abort', stop);
      finish();
    };

    request.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        onProgress?.(event.loaded, event.total);
      }
    };

    request.onload = () => {
      if (request.status >= 200 && request.status < 300) {
        settle(resolve);
        return;
      }
      // Named separately because they need different things from the
      // musician: an expired URL means start the scan again, and anything
      // else means try again as-is.
      if (request.status === 400 || request.status === 403) {
        settle(() => reject(
          new UploadError(
            'The upload link expired before the page finished sending. Take the photograph again.',
          ),
        ));
        return;
      }
      // Too large for the bucket. "Try again" is the one thing that cannot
      // work here — the same file will be refused every time — and that was
      // the advice this used to give, because 413 fell through to the generic
      // branch below.
      //
      // The replacement was no better, and worse in a particular way: it named
      // two remedies that **do not exist in this app**. "Set your camera to a
      // smaller size" — the only camera here is `ScannerScreen`, which
      // hardcodes `quality: 0.8` and exposes no size control, so
      // re-photographing produces the same file and fails identically. "Import
      // it as a file" — `ImportFileScreen`'s picker is MusicXML-only and
      // refuses a JPEG outright, while "Import score" re-sends the same bytes.
      // Confident, specific, and a dead end in both directions.
      //
      // `uploadPage` now refuses an oversized page before sending it, so this
      // is the case where the client's figure and the bucket's disagree. It
      // says what happened and offers the one route that genuinely produces a
      // smaller file, and nothing else.
      if (request.status === 413) {
        settle(() => reject(
          new UploadError(
            'Storage refused the page for being too large. Photographing it ' +
              "with this app's camera makes a smaller file than the original " +
              'from your camera roll.',
          ),
        ));
        return;
      }
      settle(() =>
        reject(new UploadError(`Storage refused the page (${request.status}). Try again.`)),
      );
    };

    request.ontimeout = () =>
      settle(() =>
        reject(
          new UploadError(
            'Sending the page took too long. A stronger connection — or moving closer to the router — usually fixes it.',
          ),
        ),
      );

    request.onerror = () =>
      settle(() =>
        reject(
          new UploadError(
            'The page could not be sent. Check your connection and try again.',
          ),
        ),
      );

    request.onabort = () => settle(() => reject(new UploadError(CANCELLED)));

    request.send(file);
  });
}
