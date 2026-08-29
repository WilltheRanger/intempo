import { uploadPage } from './uploadPage';

import type { UploadOptions } from '../../data/api/upload';
import type { CapturedPage } from '../../data/captureSession';

/**
 * The most pages one scan may hold.
 *
 * **The server's number, restated here so the refusal happens before the
 * upload rather than after it.** `MAX_PAGES` in `backend/app/routers/scores.py`
 * is the authority and `uploadPages.test.ts` asserts the two agree — a scan of
 * thirteen pages that uploads all thirteen and is then refused by
 * `POST /v1/scores` costs the musician the whole uplink for nothing, and the
 * sentence it fails with is written for whoever wrote the client.
 */
export const MAX_PAGES = 12;

/** Where a multi-page upload has got to. */
export interface PageUploadProgress {
  /** 1-based, the page currently going up. */
  page: number;
  /** How many pages in all. */
  total: number;
  /** Bytes sent for *this page*. */
  sent: number;
  /** Bytes to send for this page. Zero until the transfer reports. */
  bytes: number;
}

/**
 * Every page of one part, uploaded in page order.
 *
 * **Sequentially, and that is a choice.** Uploading in parallel would finish
 * sooner on a fast link and is the wrong trade on the link this actually runs
 * over: `UPLOAD_TIMEOUT_MS` is a *total* per-request timeout, so N transfers
 * sharing one uplink each get 1/N of the bandwidth while each keeps the whole
 * two minutes — which turns a slow connection that would have completed into N
 * simultaneous timeouts. One at a time also means the page counter is a real
 * count of finished pages rather than N bars all moving at once.
 *
 * **Progress is per page, not across the scan.** An overall fraction would have
 * to weight pages against each other before their sizes are known, and the only
 * available weighting — treat every page as equal — is a guess dressed as a
 * measurement. A measured bar for the page in flight, plus a count of the pages
 * behind it, says exactly what is known. Same shape as `Reading stave 3 of 7`.
 *
 * **All or nothing.** A part that uploads five of its seven pages is a piece
 * missing two pages of music, and `alignment.py` accumulates durations — so the
 * bars after the gap are judged against music that is not there. The first
 * failure throws, naming the page, and the pages already sent are abandoned
 * rather than saved. Those become orphaned objects in the bucket, which is the
 * known lifecycle hole recorded in `CLAUDE.md`, not something new here.
 */
export async function uploadPages(
  pages: readonly CapturedPage[],
  options: {
    signal?: AbortSignal;
    onProgress?: (progress: PageUploadProgress) => void;
  } = {},
): Promise<string[]> {
  if (pages.length === 0) {
    throw new Error('There are no pages to send.');
  }
  if (pages.length > MAX_PAGES) {
    throw new Error(
      `A scan can hold ${MAX_PAGES} pages. This one has ${pages.length} — ` +
        'remove some, or save the rest as a second piece.',
    );
  }

  const total = pages.length;
  const urls: string[] = [];

  for (const [index, page] of pages.entries()) {
    const number = index + 1;
    // Reported before the transfer starts so the counter moves the moment the
    // page changes, rather than staying on the previous page until its
    // successor's first byte lands.
    options.onProgress?.({ page: number, total, sent: 0, bytes: 0 });

    const perPage: UploadOptions = {
      signal: options.signal,
      onProgress: (sent, bytes) =>
        options.onProgress?.({ page: number, total, sent, bytes }),
    };

    urls.push(await uploadPage(page, perPage));
  }

  return urls;
}
