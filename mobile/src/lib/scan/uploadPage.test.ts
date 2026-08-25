import { beforeEach, describe, expect, it, vi } from 'vitest';

const { requestScoreImageUpload, uploadToSignedUrl, fromModule, UploadError } =
  vi.hoisted(() => ({
    requestScoreImageUpload: vi.fn(),
    uploadToSignedUrl: vi.fn(),
    fromModule: vi.fn(),
    UploadError: class UploadError extends Error {
      constructor(message: string, readonly cause?: unknown) {
        super(message);
        this.name = 'UploadError';
      }
    },
  }));

// `UploadError` and `CANCELLED` are stubbed alongside the two network calls
// rather than left out of the mock. This module *constructs* an `UploadError`
// on the cancel path, so a mock that omitted it would turn that into
// "UploadError is not a constructor" — a harness failure wearing the costume
// of a bug.
//
// Not `importActual`: the real module reaches `api/client`, which reaches the
// Supabase session, which pulls react-native into a plain Node test run.
// The *wording* of the sentence is `api/upload.test.ts`'s subject, against the
// real constant; what matters here is which error type is raised, because that
// is the difference between telling someone their phone failed and telling
// them they cancelled.
vi.mock('../../data/api/upload', () => ({
  requestScoreImageUpload,
  uploadToSignedUrl,
  CANCELLED: 'cancelled',
  UploadError,
}));
vi.mock('expo-asset', () => ({ Asset: { fromModule } }));

import { MAX_PAGE_BYTES, ScanUploadError, uploadPage, uriFor } from './uploadPage';

/**
 * Getting a photographed page into storage.
 *
 * The interesting part is the content type, and it has already been wrong
 * once. On web a captured page is a `blob:` URI with **no extension at all**,
 * so the name says nothing; a canvas capture is PNG. Labelling it from the
 * name meant the first real scan from a phone stored PNG bytes under
 * `image/jpeg`, and the vision API — which checks — rejected the page with a
 * 400. The blob knew its own type the whole time.
 *
 * These lock that in from both sides: the blob's type wins when it has one,
 * and the name is still consulted when it does not, because `blob.type` is
 * empty for a `file:` URI on native.
 */

function respondWith(blob: Blob, ok = true, status = 200) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok, status, blob: async () => blob })),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  requestScoreImageUpload.mockImplementation(async (name: string) => ({
    upload_url: `https://storage.example/upload/${name}?token=abc`,
  }));
  uploadToSignedUrl.mockResolvedValue(undefined);
});

describe('what the bytes are called', () => {
  it('believes the blob over the name, which is how the web capture works', async () => {
    respondWith(new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }));

    await uploadPage({ source: 'blob:https://app.example/8f2c-91a0' } as never);

    expect(requestScoreImageUpload).toHaveBeenCalledWith('page.png');
    expect(uploadToSignedUrl).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Blob),
      'image/png',
      {},
    );
  });

  it('falls back to the name when the blob has no type, which is native', async () => {
    respondWith(new Blob([new Uint8Array([1])])); // `blob.type` is ''

    await uploadPage({ source: 'file:///var/mobile/photos/IMG_0042.heic' } as never);

    expect(requestScoreImageUpload).toHaveBeenCalledWith('page.heic');
    expect(uploadToSignedUrl.mock.calls[0][2]).toBe('image/heic');
  });

  it('strips parameters off a declared type', async () => {
    respondWith(new Blob([new Uint8Array([1])], { type: 'image/PNG; charset=binary' }));

    await uploadPage({ source: 'blob:whatever' } as never);

    expect(uploadToSignedUrl.mock.calls[0][2]).toBe('image/png');
  });

  it('reads the extension off the path, not the query string', async () => {
    // A signed URL carries dots in its token. Reading the last dot in the
    // whole string would file a JPEG under whatever the token happened to end
    // with.
    respondWith(new Blob([new Uint8Array([1])]));

    await uploadPage({ source: 'https://x.example/page.png?sig=a.b.c' } as never);

    expect(requestScoreImageUpload).toHaveBeenCalledWith('page.png');
  });

  it('sends jpeg for a name it does not recognise, rather than nothing', async () => {
    respondWith(new Blob([new Uint8Array([1])]));

    await uploadPage({ source: 'file:///tmp/scan.tiff' } as never);

    expect(uploadToSignedUrl.mock.calls[0][2]).toBe('image/jpeg');
    // **And files it under the name it just declared.** This assertion is the
    // fix. The content type had a fallback and the extension did not, so an
    // unrecognised name was sent through as `page.tiff` — and
    // `POST /v1/upload/score-image` answers anything outside its five
    // spellings with a 400 whose detail, `extension 'tiff' is not allowed`,
    // is shown to the musician unchanged. The old test asserted only the
    // content type, so it passed the whole time the filename was wrong.
    expect(requestScoreImageUpload).toHaveBeenCalledWith('page.jpg');
  });

  it('files a .heif page as heic, which is the same format spelled differently', async () => {
    // Android's picker copies to cache keeping the source extension, and
    // `blob.type` is empty for the `file:` URI it hands back — so this was
    // every HEIF page picked on Android, refused before a byte left the phone.
    respondWith(new Blob([new Uint8Array([1])]));

    await uploadPage({ source: 'file:///data/user/0/app/cache/ImagePicker/x.heif' } as never);

    expect(requestScoreImageUpload).toHaveBeenCalledWith('page.heic');
    expect(uploadToSignedUrl.mock.calls[0][2]).toBe('image/heic');
  });

  it('never asks storage for an extension the server refuses', async () => {
    // The rule, rather than four examples of it. `_extract_ext` in
    // `routers/upload.py` allows exactly these; anything else is a 400 before
    // the upload starts, and the client has no business proposing one.
    const ALLOWED = ['jpg', 'jpeg', 'png', 'heic', 'webp'];

    for (const name of ['x.gif', 'x.bmp', 'x.tif', 'x.tiff', 'x.heif', 'x.avif', 'x']) {
      vi.clearAllMocks();
      respondWith(new Blob([new Uint8Array([1])]));

      await uploadPage({ source: `file:///tmp/${name}` } as never);

      const sent = requestScoreImageUpload.mock.calls[0][0] as string;
      expect(ALLOWED, `${name} was filed as ${sent}`).toContain(
        sent.split('.').pop(),
      );
    }
  });
});

describe('a page too large for the bucket', () => {
  /** The message `uploadPage` refused with. Fails the test if it resolved. */
  async function refusalFor(uri: string): Promise<string> {
    try {
      await uploadPage({ source: uri } as never);
    } catch (thrown) {
      return (thrown as Error).message;
    }
    throw new Error('uploadPage resolved when it should have refused');
  }

  /** A blob that claims a size without allocating it. */
  function ofSize(size: number): Blob {
    const blob = new Blob([new Uint8Array([1])]);
    Object.defineProperty(blob, 'size', { value: size });
    return blob;
  }

  it('is refused before a byte is sent, not after', async () => {
    // The difference is the whole upload. `UPLOAD_TIMEOUT_MS` is an XHR
    // *total* timeout rather than an idle one, so a weak uplink is cut off at
    // exactly two minutes however much progress it made — with no resume and
    // no retry, every attempt starting from zero and meeting the same wall.
    // Finding out from a 413 means paying that first.
    respondWith(ofSize(MAX_PAGE_BYTES + 1));

    await expect(uploadPage({ source: 'file:///tmp/page.jpg' } as never)).rejects.toThrow(
      ScanUploadError,
    );
    expect(requestScoreImageUpload).not.toHaveBeenCalled();
    expect(uploadToSignedUrl).not.toHaveBeenCalled();
  });

  it('says how large it is and how large it may be', async () => {
    // "Too large" alone leaves someone guessing whether they missed by a
    // little or by a lot, which decides whether trying a different page is
    // worth anything.
    respondWith(ofSize(13 * 1024 * 1024));

    const message = await refusalFor('file:///tmp/page.jpg');

    expect(message).toContain('13.0 MB');
    expect(message).toContain('10.0 MB');
  });

  it('does not send someone to a route that cannot take a photograph', async () => {
    // The same property the 413 message has to hold: `ImportFileScreen` is a
    // MusicXML-only picker and refuses a JPEG, and the scanner has no size
    // control to turn down. The only true remedy is that the scanner
    // re-encodes at `quality: 0.8` while the picker hands over the original.
    respondWith(ofSize(MAX_PAGE_BYTES * 2));

    const message = await refusalFor('file:///tmp/page.jpg');

    expect(message).not.toMatch(/import/i);
    expect(message).toMatch(/photograph/i);
  });

  it('sends a page exactly at the limit', async () => {
    // Off-by-one here is a page refused for being precisely allowed.
    respondWith(ofSize(MAX_PAGE_BYTES));

    await uploadPage({ source: 'file:///tmp/page.jpg' } as never);
    expect(uploadToSignedUrl).toHaveBeenCalled();
  });

  it('matches the bucket the pages actually go to', () => {
    // The server keeps a larger figure with headroom (`MAX_IMAGE_BYTES`, 12
    // MB). This one is the bucket's, because the bucket is what answers 413.
    expect(MAX_PAGE_BYTES).toBe(10 * 1024 * 1024);
  });
});

describe('when the page cannot be read', () => {
  it('says so, and keeps the cause', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ENOENT'); }));

    const thrown = await uploadPage({ source: 'file:///gone.jpg' } as never).catch((e) => e);

    expect(thrown).toBeInstanceOf(ScanUploadError);
    expect(thrown.message).toMatch(/could not be read/i);
    expect((thrown as ScanUploadError).cause).toBeInstanceOf(Error);
    expect(uploadToSignedUrl).not.toHaveBeenCalled();
  });

  it('treats a non-ok read as a read failure, not a network one', async () => {
    respondWith(new Blob([new Uint8Array([1])]), false, 404);

    await expect(uploadPage({ source: 'blob:gone' } as never)).rejects.toThrow(
      /could not be read/i,
    );
  });

  it('refuses an empty page rather than storing nothing', async () => {
    // Storing it would produce a score whose transcription fails later, with
    // an error about the reading rather than about the photograph.
    respondWith(new Blob([]));

    await expect(uploadPage({ source: 'blob:empty' } as never)).rejects.toThrow(/empty/i);
    expect(requestScoreImageUpload).not.toHaveBeenCalled();
  });

  it('lets the upload layer speak for itself', async () => {
    // `uploadToSignedUrl` throws an `UploadError` whose message names which of
    // the several ways this can fail actually happened. Re-wrapping it would
    // replace a specific sentence with a general one.
    respondWith(new Blob([new Uint8Array([1])]));
    uploadToSignedUrl.mockRejectedValue(new Error('That recording is too large to upload.'));

    await expect(uploadPage({ source: 'blob:x' } as never)).rejects.toThrow(
      'That recording is too large to upload.',
    );
  });
});

describe('what it returns', () => {
  it('returns the upload URL, which is the only form the API accepts', async () => {
    respondWith(new Blob([new Uint8Array([1])], { type: 'image/jpeg' }));

    const url = await uploadPage({ source: 'blob:x' } as never);

    expect(url).toBe('https://storage.example/upload/page.jpg?token=abc');
  });
});

describe('uriFor', () => {
  it('passes a captured URL straight through', () => {
    expect(uriFor({ source: 'file:///a.jpg' } as never)).toBe('file:///a.jpg');
  });

  it('resolves a bundled asset through expo-asset, not Image', () => {
    // `Image.resolveAssetSource` is the obvious call and does not exist on
    // react-native-web — it throws, which is how this was found: the upload
    // step failed on the one platform this build can be driven on.
    fromModule.mockReturnValue({ uri: 'asset:///page.jpg' });

    expect(uriFor({ source: 42 } as never)).toBe('asset:///page.jpg');
    expect(fromModule).toHaveBeenCalledWith(42);
  });

  it('is null when an asset has no uri, rather than undefined', () => {
    fromModule.mockReturnValue({});

    expect(uriFor({ source: 42 } as never)).toBeNull();
  });
});


/**
 * Leaving the screen while a page is being sent.
 *
 * There are three places a scan can be abandoned in, and only the last of them
 * was ever stoppable: reading the bytes off the device, asking the API for
 * somewhere to put them, and the transfer itself. A cancel that only covered
 * the third would still let an abandoned scan read a twelve-megapixel
 * photograph into memory and then spend an authenticated round trip — possibly
 * behind a cold start — claiming a signed URL with a five-minute life that
 * nobody will ever use.
 */
describe('a scan the musician walked away from', () => {
  it('does not ask for somewhere to put a page that was cancelled', async () => {
    const abort = new AbortController();
    // Cancelled while the bytes were being read, which is where a large
    // photograph spends real time.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        abort.abort();
        return { ok: true, status: 200, blob: async () => new Blob(['x'], { type: 'image/png' }) };
      }),
    );

    await expect(
      uploadPage({ id: 'p1', source: 'blob:x' } as never, { signal: abort.signal }),
    ).rejects.toBeInstanceOf(UploadError);

    expect(requestScoreImageUpload, 'a signed URL was claimed for an abandoned scan')
      .not.toHaveBeenCalled();
    expect(uploadToSignedUrl).not.toHaveBeenCalled();
  });

  it('blames the cancellation, not the phone', async () => {
    // An aborted `fetch` rejects, and the catch around it says "That page
    // could not be read from the device" — which would tell someone who had
    // just pressed Cancel that their phone was at fault.
    const abort = new AbortController();
    abort.abort();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new DOMException('Aborted', 'AbortError');
      }),
    );

    const thrown = await uploadPage(
      { id: 'p1', source: 'blob:x' } as never,
      { signal: abort.signal },
    ).catch((error: unknown) => error);

    expect(thrown).toBeInstanceOf(UploadError);
    expect(thrown, 'a cancellation reported as a broken phone').not.toBeInstanceOf(
      ScanUploadError,
    );
  });

  it('hands the signal on to the transfer', async () => {
    const abort = new AbortController();
    respondWith(new Blob(['x'], { type: 'image/png' }));

    await uploadPage({ id: 'p1', source: 'blob:x' } as never, { signal: abort.signal });

    expect(uploadToSignedUrl.mock.calls[0][3]).toMatchObject({ signal: abort.signal });
  });
});
