import { beforeEach, describe, expect, it, vi } from 'vitest';

// `expo-image-manipulator` reaches `react-native`, whose Flow syntax vitest
// cannot parse — and `shrinkToFit` now imports it lazily when a page is too
// large. `compressTo` is what each test says the re-encode achieves.
const { compressTo } = vi.hoisted(() => ({ compressTo: { size: 0 } }));
vi.mock('expo-image-manipulator', () => ({
  manipulateAsync: vi.fn(async (uri: string) => ({
    uri: `${uri}#smaller`,
    width: 0,
    height: 0,
  })),
  SaveFormat: { JPEG: 'jpeg' },
}));

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

/**
 * A `fetch` that answers each successive read with the next blob.
 *
 * `uploadPage` reads the page's bytes, and reads them again after each
 * re-encode to see how large it got — so a too-large page makes several reads
 * and a single canned answer would loop forever at the original size.
 */
function respondWithEach(blobs: Blob[]) {
  let index = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      const blob = blobs[Math.min(index, blobs.length - 1)];
      index += 1;
      return { ok: true, status: 200, blob: async () => blob };
    }),
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

  it('is re-encoded and sent, not refused', async () => {
    // **The behaviour this replaced.** A 14.8 MB page chosen on a laptop was
    // turned away with advice to use the app's camera instead — which on a
    // desktop is a webcam, and a webcam capture of a page is exactly what the
    // server's legibility check exists to reject. Nothing was wrong with the
    // photograph; it was a good page in a large file.
    respondWithEach([
      ofSize(14.8 * 1024 * 1024), // the original
      ofSize(3 * 1024 * 1024), // measured after re-encoding
      ofSize(3 * 1024 * 1024), // read back for the upload
    ]);

    await uploadPage({ source: 'file:///tmp/page.jpg' } as never);

    expect(uploadToSignedUrl).toHaveBeenCalled();
  });

  it('says both sizes when even the smallest version is too large', async () => {
    // "Too large" alone leaves someone guessing whether they missed by a little
    // or by a lot. Now there are two numbers that matter: what they gave, and
    // what the app could get it down to.
    respondWithEach([ofSize(40 * 1024 * 1024), ...Array(12).fill(ofSize(13 * 1024 * 1024))]);

    const message = await refusalFor('file:///tmp/page.jpg');

    expect(message).toContain('40.0 MB');
    expect(message).toContain('13.0 MB');
    expect(message).toContain('10.0 MB');
  });

  it('does not send someone to a route that cannot take a photograph', async () => {
    // `ImportFileScreen` is a MusicXML-only picker and refuses a JPEG; the
    // scanner has no size control to turn down; and on a desktop there is no
    // camera roll and the camera is a webcam. Every remedy the old message
    // offered was one the app could not honour.
    respondWithEach([ofSize(40 * 1024 * 1024), ...Array(12).fill(ofSize(13 * 1024 * 1024))]);

    const message = await refusalFor('file:///tmp/page.jpg');

    expect(message).not.toMatch(/import/i);
    expect(message).not.toMatch(/camera roll/i);
    expect(message).not.toMatch(/this app's camera/i);
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

// ---------------------------------------------------------------------------
// The cap and the timeout are one statement about somebody's connection
// ---------------------------------------------------------------------------

// Imported rather than read off disk: this project has no `@types/node`, so
// `readFileSync` does not typecheck (see `bootWatchdog.test.ts`).
import uploadSource from './uploadPage.ts?raw';
import apiUploadSource from '../../data/api/upload.ts?raw';

/** `const NAME = 10 * 1024 * 1024;` — or `export const` — as a number. */
function constantIn(source: string, name: string): number {
  const match = new RegExp(`const ${name}\\s*=\\s*([0-9_*\\s]+);`).exec(source);
  if (!match) {
    throw new Error(`${name} is not declared in the form this test reads`);
  }
  // Digits, underscores, spaces and `*` only — checked by the pattern above.
  return Number(
    match[1]
      .replace(/_/g, '')
      .split('*')
      .map((part) => Number(part.trim()))
      .reduce((a, b) => a * b, 1),
  );
}

describe('the largest page and the time allowed to send it', () => {
  it('states the connection speed it actually implies', () => {
    // **The two constants are a claim about a musician's connection, and the
    // claim was 27% out.** `UPLOAD_TIMEOUT_MS` is an XHR *total* timeout, so
    // an upload slower than cap/timeout is killed at exactly two minutes with
    // no progress kept and no resume. The comment in `uploadPage.ts` said 550
    // kbps — the figure for an 8 MiB cap — in the same commit that set the cap
    // to 10 MiB. Somebody on a 600 kbps link was inside the documented
    // envelope and outside the real one.
    const cap = constantIn(uploadSource, 'MAX_PAGE_BYTES');
    const timeoutMs = constantIn(apiUploadSource, 'UPLOAD_TIMEOUT_MS');

    const kbps = Math.round((cap * 8) / (timeoutMs / 1000) / 1000);

    // One assertion doing one job: the prose carries the number, so checking
    // the prose checks the arithmetic. Pinning the figure separately only
    // added a second failure with a worse message — "expected 350 to be 699"
    // reads as a bug when what happened is that somebody improved the timeout
    // and left the comment behind.
    const stated = /roughly \*\*(\d+) kbps\*\*/.exec(uploadSource);
    expect(stated, 'the documented floor is no longer written where this reads it')
      .not.toBeNull();
    expect(
      Math.round(Number(stated![1]) / 100),
      `the comment says ${stated?.[1]} kbps and the constants imply ${kbps}. ` +
        'Whichever moved, the other has to follow — this figure is what a ' +
        'musician on a weak connection is being promised.',
    ).toBe(Math.round(kbps / 100));
  });

  it('does not ask for a connection a musician away from a router will not have', () => {
    // A ceiling on the ceiling. Raising the cap without raising the timeout
    // does not fail loudly — it quietly moves the floor up until the app only
    // works on wifi, which is the opposite of where this is used: "from
    // wherever the musician happens to be practising, which is not usually
    // next to the router" (`upload.ts`).
    //
    // 1.5 Mbps is roughly a weak 4G uplink. Not tuned — it is the point at
    // which "several megabytes from a practice room" stops being a claim this
    // app can make.
    const cap = constantIn(uploadSource, 'MAX_PAGE_BYTES');
    const timeoutMs = constantIn(apiUploadSource, 'UPLOAD_TIMEOUT_MS');

    const kbps = (cap * 8) / (timeoutMs / 1000) / 1000;
    expect(kbps).toBeLessThan(1500);
  });
});
