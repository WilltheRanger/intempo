import { beforeEach, describe, expect, it, vi } from 'vitest';

const { uploadPage } = vi.hoisted(() => ({ uploadPage: vi.fn() }));
vi.mock('./uploadPage', () => ({ uploadPage }));

import { MAX_PAGES, uploadPages, type PageUploadProgress } from './uploadPages';
import type { CapturedPage } from '../../data/captureSession';

function pages(count: number): CapturedPage[] {
  return Array.from({ length: count }, (_unused, index) => ({
    id: `page-${index + 1}`,
    source: `file:///page-${index + 1}.jpg`,
  }));
}

beforeEach(() => {
  uploadPage.mockReset();
  uploadPage.mockImplementation(async (page: CapturedPage) => `signed://${page.id}`);
});

describe('uploadPages', () => {
  it('returns one URL per page, in page order', async () => {
    await expect(uploadPages(pages(3))).resolves.toEqual([
      'signed://page-1',
      'signed://page-2',
      'signed://page-3',
    ]);
  });

  it('uploads one page at a time rather than all at once', async () => {
    // The failure this guards is not slowness. `UPLOAD_TIMEOUT_MS` is a total
    // per-request timeout, so parallel transfers sharing one uplink each get a
    // fraction of the bandwidth and the whole two minutes — a connection that
    // would have completed sequentially times out N times at once instead.
    let inFlight = 0;
    let peak = 0;
    uploadPage.mockImplementation(async (page: CapturedPage) => {
      peak = Math.max(peak, ++inFlight);
      await Promise.resolve();
      inFlight -= 1;
      return `signed://${page.id}`;
    });

    await uploadPages(pages(4));

    expect(peak).toBe(1);
  });

  it('reports the page it is on before that page sends a byte', async () => {
    // Otherwise the counter stays on the previous page until the next one's
    // first byte lands, which on a slow link is most of the wait.
    const seen: PageUploadProgress[] = [];
    await uploadPages(pages(2), { onProgress: (progress) => seen.push(progress) });

    expect(seen[0]).toEqual({ page: 1, total: 2, sent: 0, bytes: 0 });
    expect(seen.map((progress) => progress.page)).toEqual([1, 2]);
  });

  it('passes each page its own measured progress through', async () => {
    uploadPage.mockImplementation(
      async (page: CapturedPage, options: { onProgress?: (sent: number, bytes: number) => void }) => {
        options.onProgress?.(512, 1024);
        return `signed://${page.id}`;
      },
    );

    const seen: PageUploadProgress[] = [];
    await uploadPages(pages(2), { onProgress: (progress) => seen.push(progress) });

    expect(seen).toContainEqual({ page: 2, total: 2, sent: 512, bytes: 1024 });
  });

  it('stops at the first page that fails, and does not send the rest', async () => {
    // All or nothing. A part saved with five of its seven pages is a piece with
    // two pages of music missing, and `alignment.py` accumulates durations — so
    // every bar after the gap is judged against music that is not there.
    uploadPage.mockImplementation(async (page: CapturedPage) => {
      if (page.id === 'page-2') {
        throw new Error('That page came back empty.');
      }
      return `signed://${page.id}`;
    });

    await expect(uploadPages(pages(4))).rejects.toThrow('That page came back empty.');
    expect(uploadPage).toHaveBeenCalledTimes(2);
  });

  it('hands the abort signal to every page', async () => {
    const controller = new AbortController();
    await uploadPages(pages(2), { signal: controller.signal });

    for (const call of uploadPage.mock.calls) {
      expect(call[1].signal).toBe(controller.signal);
    }
  });

  it('refuses a scan longer than the server will accept, before uploading', async () => {
    // The point of the check is *before*: uploading thirteen pages and then
    // being refused by POST /v1/scores costs the whole uplink for nothing.
    await expect(uploadPages(pages(MAX_PAGES + 1))).rejects.toThrow(
      /can hold 12 pages/,
    );
    expect(uploadPage).not.toHaveBeenCalled();
  });

  it('accepts a scan of exactly the limit', async () => {
    await expect(uploadPages(pages(MAX_PAGES))).resolves.toHaveLength(MAX_PAGES);
  });

  it('refuses an empty scan', async () => {
    await expect(uploadPages([])).rejects.toThrow('no pages to send');
  });
});
