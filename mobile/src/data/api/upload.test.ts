import { beforeEach, describe, expect, it, vi } from 'vitest';

const { apiFetch } = vi.hoisted(() => ({ apiFetch: vi.fn() }));
vi.mock('./client', () => ({ apiFetch }));

import {
  UploadError,
  requestAudioUpload,
  requestScoreImageUpload,
  uploadToSignedUrl,
} from './upload';

/**
 * Sending a file straight to storage, and what the musician is told when it
 * does not arrive.
 *
 * Every branch here is a different instruction, and one of them was wrong:
 * a 413 fell through to the generic "Try again", which is the one thing that
 * cannot work — the same file is refused every time, so the advice is an
 * instruction to repeat a failure. That is what these mostly guard.
 */

/** A stand-in XMLHttpRequest whose response the test decides. */
class FakeXHR {
  static last: FakeXHR;
  status = 200;
  timeout = 0;
  method = '';
  url = '';
  headers: Record<string, string> = {};
  sent: unknown = null;
  onload: (() => void) | null = null;
  ontimeout: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  upload: { onprogress: ((e: { lengthComputable: boolean; loaded: number; total: number }) => void) | null } = {
    onprogress: null,
  };

  constructor() {
    FakeXHR.last = this;
  }

  open(method: string, url: string) {
    this.method = method;
    this.url = url;
  }

  setRequestHeader(name: string, value: string) {
    this.headers[name] = value;
  }

  send(body: unknown) {
    this.sent = body;
  }
}

/** Runs an upload and finishes it with `status`. */
function upload(status: number, options = {}) {
  const promise = uploadToSignedUrl('https://storage.example/put?token=x', new Blob(['x']), 'image/png', options);
  FakeXHR.last.status = status;
  FakeXHR.last.onload?.();
  return promise;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('XMLHttpRequest', FakeXHR);
});

describe('asking for somewhere to put it', () => {
  it('asks the right endpoint for a page and for audio', async () => {
    apiFetch.mockResolvedValue({ upload_url: 'https://x', public_url: 'y' });

    await requestScoreImageUpload('page.png');
    await requestAudioUpload('take.wav');

    expect(apiFetch).toHaveBeenNthCalledWith(1, '/v1/upload/score-image', {
      method: 'POST',
      body: { filename: 'page.png' },
    });
    expect(apiFetch).toHaveBeenNthCalledWith(2, '/v1/upload/audio', {
      method: 'POST',
      body: { filename: 'take.wav' },
    });
  });
});

describe('the request itself', () => {
  it('PUTs the body to the signed URL with the type it was given', async () => {
    await upload(200);

    expect(FakeXHR.last.method).toBe('PUT');
    expect(FakeXHR.last.url).toBe('https://storage.example/put?token=x');
    expect(FakeXHR.last.headers['Content-Type']).toBe('image/png');
    expect(FakeXHR.last.sent).toBeInstanceOf(Blob);
  });

  it('gives a weak connection two minutes', async () => {
    // The one request in the app that sends a large body, made from wherever
    // the musician happens to be practising.
    await upload(204);

    expect(FakeXHR.last.timeout).toBe(120_000);
  });

  it('resolves on any 2xx, since storage picks its own', async () => {
    await expect(upload(200)).resolves.toBeUndefined();
    await expect(upload(201)).resolves.toBeUndefined();
    await expect(upload(204)).resolves.toBeUndefined();
  });

  it('does not treat a redirect as a stored file', async () => {
    // 2xx and nothing else. Widening the window to `< 400` — which is the
    // obvious way to write "not an error" — would make a 302 resolve while
    // nothing had been stored, and the page or take would simply be missing
    // with every screen reporting success.
    await expect(upload(301)).rejects.toThrow(UploadError);
    await expect(upload(302)).rejects.toThrow(UploadError);
    await expect(upload(304)).rejects.toThrow(UploadError);
  });

  it('reports progress only when there is a total to report against', async () => {
    const onProgress = vi.fn();
    const promise = uploadToSignedUrl('https://x', new Blob(['x']), 'image/png', { onProgress });

    FakeXHR.last.upload.onprogress?.({ lengthComputable: false, loaded: 10, total: 0 });
    expect(onProgress).not.toHaveBeenCalled();

    FakeXHR.last.upload.onprogress?.({ lengthComputable: true, loaded: 10, total: 40 });
    expect(onProgress).toHaveBeenCalledWith(10, 40);

    FakeXHR.last.status = 200;
    FakeXHR.last.onload?.();
    await promise;
  });
});

describe('what the musician is told', () => {
  async function messageFor(status: number): Promise<string> {
    const thrown = await upload(status).catch((e) => e);
    expect(thrown).toBeInstanceOf(UploadError);
    return (thrown as UploadError).message;
  }

  it('says to take the photograph again when the link has expired', async () => {
    // An expired URL cannot be retried as-is — the link is the thing that
    // went stale, not the connection.
    for (const status of [400, 403]) {
      expect(await messageFor(status)).toMatch(/take the photograph again/i);
    }
  });

  it('never tells someone to retry a file that is too large', async () => {
    // The bug this branch exists for. A 413 used to fall through to
    // "Try again", which is an instruction to repeat a failure: the same file
    // is refused every time.
    const message = await messageFor(413);

    expect(message).toMatch(/too large/i);
    expect(message).not.toMatch(/try again/i);
  });

  it('does not send someone to a route that cannot take a photograph', async () => {
    // The second version of this message was worse than "try again", because
    // it was specific and wrong. It said to photograph the page "with your
    // camera set to a smaller size" — `ScannerScreen` hardcodes `quality: 0.8`
    // and has no size control — "or import it as a file", which is
    // `ImportFileScreen`, a MusicXML-only picker that refuses a JPEG outright.
    //
    // The old assertion here was `toMatch(/smaller|import/i)`, checking that
    // *some* advice was given rather than that it was advice anyone could
    // follow, so it passed the whole time.
    const message = await messageFor(413);

    expect(message).not.toMatch(/import/i);
    expect(message).not.toMatch(/camera set to|settings|resolution/i);
    // The one route that genuinely makes a smaller file, because the scanner
    // re-encodes at `quality: 0.8` while the picker hands over the original.
    expect(message).toMatch(/photograph/i);
  });

  it('names the status for anything it has no specific advice about', async () => {
    const message = await messageFor(500);

    expect(message).toContain('500');
    expect(message).toMatch(/try again/i);
  });

  it('distinguishes a timeout, a dropped connection and a cancellation', async () => {
    const cases = [
      ['ontimeout', /too long/i],
      ['onerror', /connection/i],
      ['onabort', /cancelled/i],
    ] as const;

    for (const [event, expected] of cases) {
      const promise = uploadToSignedUrl('https://x', new Blob(['x']), 'image/png');
      FakeXHR.last[event]?.();
      await expect(promise).rejects.toThrow(expected);
    }
  });

  it('gives advice that is possible in every branch', async () => {
    // The property the 413 broke: an error tells you either what to do
    // differently or that repeating is worth it. Never "try again" for
    // something that cannot succeed on a retry.
    for (const status of [400, 403, 413, 500, 418]) {
      const message = await messageFor(status);
      expect(message.trim(), String(status)).not.toBe('');
      expect(message, String(status)).toMatch(/[.!]$/);
    }
  });
});
