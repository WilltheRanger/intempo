import { beforeEach, describe, expect, it, vi } from 'vitest';

const { requestScoreImageUpload, uploadToSignedUrl, fromModule } = vi.hoisted(() => ({
  requestScoreImageUpload: vi.fn(),
  uploadToSignedUrl: vi.fn(),
  fromModule: vi.fn(),
}));

vi.mock('../../data/api/upload', () => ({ requestScoreImageUpload, uploadToSignedUrl }));
vi.mock('expo-asset', () => ({ Asset: { fromModule } }));

import { ScanUploadError, uploadPage, uriFor } from './uploadPage';

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
