import type { UploadOptions } from '../../data/api/upload';
import type { CapturedPage } from '../../data/captureSession';
export interface PageUploadProgress {
  /** One-based position of the page currently moving. */
  page: number;
  pageCount: number;
  sent: number;
  total: number;
}

export type PageUploader = (
  page: CapturedPage,
  options?: UploadOptions,
) => Promise<string>;

export interface UploadPagesOptions {
  signal?: AbortSignal;
  onProgress?: (progress: PageUploadProgress) => void;
  /** Platform uploader supplied by the screen; tests can stay runtime-free. */
  upload: PageUploader;
}

/**
 * Uploads a scan one page at a time and preserves the musician's chosen order.
 *
 * Sequential transfer matters on a phone: several page photographs in
 * parallel compete for the same uplink and make both progress and cancellation
 * misleading. A failure stops the scan immediately, so later pages never start
 * after the user cancels or one page cannot be sent.
 */
export async function uploadPages(
  pages: readonly CapturedPage[],
  options: UploadPagesOptions,
): Promise<string[]> {
  const send = options.upload;
  const urls: string[] = [];

  for (const [index, page] of pages.entries()) {
    const url = await send(page, {
      signal: options.signal,
      onProgress: (sent, total) =>
        options.onProgress?.({
          page: index + 1,
          pageCount: pages.length,
          sent,
          total,
        }),
    });
    urls.push(url);
  }

  return urls;
}
