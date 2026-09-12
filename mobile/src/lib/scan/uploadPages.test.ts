import { describe, expect, it, vi } from 'vitest';

import type { CapturedPage } from '../../data/captureSession';
import { uploadPages, type PageUploader } from './uploadPages';

const pages: CapturedPage[] = [
  { id: 'page-1', source: 'file:///one.jpg' },
  { id: 'page-2', source: 'file:///two.jpg' },
  { id: 'page-3', source: 'file:///three.jpg' },
];

describe('uploadPages', () => {
  it('uploads sequentially and returns durable keys in the chosen page order', async () => {
    const started: string[] = [];
    let finishFirst!: (url: string) => void;
    const first = new Promise<string>((resolve) => {
      finishFirst = resolve;
    });

    const upload: PageUploader = vi.fn(async (page) => {
      started.push(page.id);
      if (page.id === 'page-1') {
        return first;
      }
      return `user-1/${page.id}`;
    });

    const pending = uploadPages(pages, { upload });
    await Promise.resolve();

    expect(started).toEqual(['page-1']);

    finishFirst('user-1/page-1');
    await expect(pending).resolves.toEqual([
      'user-1/page-1',
      'user-1/page-2',
      'user-1/page-3',
    ]);
    expect(started).toEqual(['page-1', 'page-2', 'page-3']);
  });

  it('reports which page each byte count belongs to', async () => {
    const seen: unknown[] = [];
    const upload: PageUploader = async (page, options) => {
      options?.onProgress?.(25, 100);
      return `user-1/${page.id}`;
    };

    await uploadPages(pages.slice(0, 2), {
      upload,
      onProgress: (progress) => seen.push(progress),
    });

    expect(seen).toEqual([
      { page: 1, pageCount: 2, sent: 25, total: 100 },
      { page: 2, pageCount: 2, sent: 25, total: 100 },
    ]);
  });

  it('stops before later pages after a failure', async () => {
    const started: string[] = [];
    const failure = new Error('page two failed');
    const upload: PageUploader = async (page) => {
      started.push(page.id);
      if (page.id === 'page-2') {
        throw failure;
      }
      return `user-1/${page.id}`;
    };

    await expect(uploadPages(pages, { upload })).rejects.toBe(failure);
    expect(started).toEqual(['page-1', 'page-2']);
  });

  it('passes one abort signal through the whole scan', async () => {
    const controller = new AbortController();
    const signals: Array<AbortSignal | undefined> = [];
    const upload: PageUploader = async (page, options) => {
      signals.push(options?.signal);
      return `user-1/${page.id}`;
    };

    await uploadPages(pages, { upload, signal: controller.signal });

    expect(signals).toEqual([
      controller.signal,
      controller.signal,
      controller.signal,
    ]);
  });
});
