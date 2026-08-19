import { Asset } from 'expo-asset';

import {
  requestScoreImageUpload,
  uploadToSignedUrl,
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

/** What the storage bucket accepts, mapped from the file extension. */
const MIME_BY_EXT: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  heic: 'image/heic',
};

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
export async function uploadPage(page: CapturedPage): Promise<string> {
  const uri = uriFor(page);
  if (!uri) {
    throw new ScanUploadError('That page could not be read from the device.');
  }

  const ext = extensionOf(uri);
  const contentType = MIME_BY_EXT[ext] ?? 'image/jpeg';

  // `fetch` on a local URI is how bytes are obtained on both platforms: web
  // handles blob:/data:/http:, and native handles file:. A failure here is a
  // read failure, not a network one, and says so.
  let bytes: Blob;
  try {
    const response = await fetch(uri);
    if (!response.ok) {
      throw new Error(`reading the image returned ${response.status}`);
    }
    bytes = await response.blob();
  } catch (cause) {
    throw new ScanUploadError('That page could not be read from the device.', cause);
  }

  if (bytes.size === 0) {
    throw new ScanUploadError('That page came back empty.');
  }

  const signed = await requestScoreImageUpload(`page.${ext}`);
  await uploadToSignedUrl(signed.upload_url, bytes, contentType);
  return signed.upload_url;
}
