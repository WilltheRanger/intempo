import { Asset } from 'expo-asset';

import {
  CANCELLED,
  requestScoreImageUpload,
  UploadError,
  uploadToSignedUrl,
  type UploadOptions,
} from '../../data/api/upload';
import type { CapturedPage } from '../../data/captureSession';

/**
 * Getting a captured page into storage.
 *
 * The one piece of the scan flow that never existed. Everything around it was
 * built — the scanner, the page list, the progress screen, the review form —
 * and nothing between them ever sent a byte anywhere. `TranscribeScreen` was a
 * `setTimeout` and "Save piece" navigated to a hardcoded fixture id.
 */

/**
 * What the storage bucket accepts, mapped from the file extension.
 *
 * The keys are what a *filename* can say; the values are what the bucket and
 * `POST /v1/upload/score-image` accept. `heif` is here because it is not a
 * different format from `heic` — same container, and Android's picker hands
 * back either spelling — while the server's allow-list holds only `heic`.
 */
const MIME_BY_EXT: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  heic: 'image/heic',
  heif: 'image/heic',
};

/** Sent when nothing — not the blob, not the name — says what the bytes are. */
const FALLBACK = { contentType: 'image/jpeg', ext: 'jpg' } as const;

/**
 * The largest page the bucket will take.
 *
 * Matched to the `score-images` bucket, the way `MAX_UPLOAD_BYTES` in
 * `lib/audio/types.ts` is matched to the audio one — and for the same reason,
 * which is that finding out afterwards costs the musician something they
 * cannot get back cheaply. A take costs the playing; a page costs two minutes
 * of uplink and, on a weak connection, cannot be sent at all:
 * `UPLOAD_TIMEOUT_MS` is an XHR *total* timeout rather than an idle one, so
 * anything under roughly 550 kbps is killed at exactly two minutes however
 * much progress it made, with no resume and no retry — every attempt starting
 * again from zero and meeting the same wall.
 *
 * The server keeps its own, larger figure (`MAX_IMAGE_BYTES`, 12 MB, "with
 * headroom"). This is the bucket's, because the bucket is what answers 413.
 */
export const MAX_PAGE_BYTES = 10 * 1024 * 1024;

/** Bytes as a musician would say them: "12.4 MB". */
function megabytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * A URI the platform can read bytes from, for any captured page.
 *
 * A page's `source` is a `ThumbnailSource`. Real capture gives a URL string —
 * a `file:` URI on device, a `blob:` one on web — and that is now the only
 * thing the scanner produces. The **number** branch is for a bundled asset,
 * the module id Metro assigns to `require('…/page.jpg')`: the type still
 * permits it, so it is still handled rather than left to fail at runtime if
 * anything ever routes one here.
 *
 * `Image.resolveAssetSource` is the obvious call and it is **not available on
 * react-native-web** — it throws `resolveAssetSource is not a function`, which
 * is precisely how this was found: the upload step failed on the one platform
 * this build can be driven on. `expo-asset` is Expo's supported resolver and
 * works on both, which is why it is now a direct dependency rather than a
 * transitive one.
 */
export function uriFor(page: CapturedPage): string | null {
  if (typeof page.source === 'string') {
    return page.source;
  }
  // Bundled assets are already local on both platforms, so `.uri` is populated
  // without `downloadAsync()`. A remote asset would need that call, and the
  // scanner has none.
  return Asset.fromModule(page.source).uri ?? null;
}

/** The extension storage will see, taken from the URI rather than guessed. */
function extensionOf(uri: string): string {
  // Query strings on signed URLs, and `;base64,` on data URIs, both contain
  // dots — so the extension is read from the path only.
  const path = uri.split(/[?#]/)[0];
  const match = /\.([a-z0-9]{1,8})$/i.exec(path);
  return (match?.[1] ?? 'jpg').toLowerCase();
}

/** The extension to file a blob's own type under, when it has one. */
const EXT_BY_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
};

/**
 * What the bytes are, preferring the blob's own type over the URI's name.
 *
 * On web a captured page is a `blob:` URI with **no extension at all**, so
 * `extensionOf` falls back to `jpg` and the upload was labelled `image/jpeg`
 * whatever it held. A canvas capture is PNG, so the first real scan from a
 * phone stored PNG bytes under a JPEG content type, and the vision API — which
 * checks — rejected the page with a 400. The blob knew its own type the whole
 * time.
 *
 * `blob.type` is empty for a `file:` URI on native, which is why the name is
 * still consulted rather than replaced.
 *
 * **The two halves have to agree.** The content type had a fallback and the
 * extension did not, so an unrecognised name declared `image/jpeg` and then
 * filed the object under the raw extension anyway: `page.heif`. The server's
 * `_extract_ext` allows five spellings and answers anything else with a 400 —
 * `extension 'heif' is not allowed` — which `describeScanFailure` shows to the
 * musician unchanged. A server rule string, naming a constraint they were never
 * shown, for a page that never left the phone. Android's picker keeps the
 * source extension when it copies to cache and `blob.type` is empty for the
 * `file:` URI it returns, so this was every `.heif` page picked on Android.
 *
 * Filing unknown bytes as JPEG is safe because the extension is a *storage*
 * name and nothing downstream trusts it: the backend sniffs the real type from
 * the bytes (`media_type_of`, magic numbers plus the HEIF brands) and passes
 * that to the vision provider. What matters is that the object uploads at all.
 */
function typeOf(bytes: Blob, uri: string): { contentType: string; ext: string } {
  const declared = bytes.type?.split(';')[0].trim().toLowerCase() ?? '';
  const ext = EXT_BY_MIME[declared];
  if (ext) {
    return { contentType: declared, ext };
  }
  const fromName = extensionOf(uri);
  const named = MIME_BY_EXT[fromName];
  if (named) {
    // The extension follows the *type*, never the filename it was read from.
    // `heif` and `heic` are one format with two spellings and the server's
    // allow-list holds only one of them, so passing the name through is how a
    // page the client had correctly identified was still refused.
    return { contentType: named, ext: EXT_BY_MIME[named] ?? FALLBACK.ext };
  }
  return { ...FALLBACK };
}

export class ScanUploadError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = 'ScanUploadError';
  }
}

/**
 * Uploads one captured page and returns the URL to create a score from.
 *
 * The value returned is the **signed upload URL**, not a download URL, because
 * that is the only form `POST /v1/scores` accepts — see `api/upload.ts`. It
 * expires five minutes after issue, so the caller must create the score in the
 * same flow rather than storing it.
 */
export async function uploadPage(
  page: CapturedPage,
  options: UploadOptions = {},
): Promise<string> {
  const uri = uriFor(page);
  if (!uri) {
    throw new ScanUploadError('That page could not be read from the device.');
  }

  // `fetch` on a local URI is how bytes are obtained on both platforms: web
  // handles blob:/data:/http:, and native handles file:. A failure here is a
  // read failure, not a network one, and says so.
  //
  // The signal is passed here too. Reading a twelve-megapixel photograph off
  // the device is not instant, and leaving the screen during it should stop
  // the scan rather than let it run on to ask the API for somewhere to put a
  // page nobody is waiting for.
  let bytes: Blob;
  try {
    const response = await fetch(uri, { signal: options.signal });
    if (!response.ok) {
      throw new Error(`reading the image returned ${response.status}`);
    }
    bytes = await response.blob();
  } catch (cause) {
    // A cancelled read is not a device that could not be read. Saying it was
    // would put "That page could not be read from the device" on screen for
    // someone who had just pressed Cancel, blaming their phone for their own
    // decision.
    if (options.signal?.aborted) {
      throw new UploadError(CANCELLED);
    }
    throw new ScanUploadError('That page could not be read from the device.', cause);
  }

  if (bytes.size === 0) {
    throw new ScanUploadError('That page came back empty.');
  }

  // Checked here rather than discovered from a 413, because the difference is
  // the whole upload. The bytes are already in hand; refusing now costs a
  // moment, and refusing after costs however long it took to push ten
  // megabytes over cellular — or the two-minute timeout, which a slow uplink
  // hits before the bucket ever answers.
  if (bytes.size > MAX_PAGE_BYTES) {
    throw new ScanUploadError(
      `That photograph is ${megabytes(bytes.size)} — too large to send, and ` +
        `the limit is ${megabytes(MAX_PAGE_BYTES)}. Photographing the page ` +
        `with this app's camera makes a smaller file than the original from ` +
        `your camera roll.`,
    );
  }

  const { contentType, ext } = typeOf(bytes, uri);
  // Checked between the two network calls. Asking for a signed URL commits the
  // musician to nothing, but it is an authenticated round trip that can sit
  // behind a cold start — long enough to leave the screen in — and issuing a
  // link with a five-minute life for a scan that has been abandoned is work
  // nobody will collect.
  if (options.signal?.aborted) {
    throw new UploadError(CANCELLED);
  }
  const signed = await requestScoreImageUpload(`page.${ext}`);
  // Not wrapped in a `ScanUploadError`. `uploadToSignedUrl` already throws an
  // `UploadError` whose message is written for the musician and names which of
  // the several ways this can fail actually happened — re-wrapping it would
  // replace a specific sentence with a general one.
  await uploadToSignedUrl(signed.upload_url, bytes, contentType, options);
  return signed.upload_url;
}
