import type { ThumbnailSource } from '../data/types';

/**
 * A signed storage URL, made cacheable on the phone.
 *
 * A Supabase signed URL is the object path plus `?token=…`, and the token is
 * different every time it is minted. expo-image's disk cache is keyed on the
 * URL string, so every rotation of the token used to be a cache miss and a
 * full re-download of a photograph that had not changed — the server now
 * reuses each URL for most of an hour, and this carries the fix across the
 * rotation too: `cacheKey` pins the cache entry to the *path*, which is the
 * object's identity, so the image downloads once per device rather than once
 * per token.
 *
 * Correct because a storage object here is immutable: pages are written once
 * at upload and only ever deleted, never replaced in place — so a stale cache
 * entry cannot show the wrong photograph, only a discarded one it already had.
 *
 * On web expo-image renders an `<img>` and ignores `cacheKey`; the browser's
 * HTTP cache keys on the full URL, which the server-side reuse now keeps
 * stable. Native and web are therefore fixed by different halves of the same
 * change, which is why both exist.
 */
export function stableImage(url: string | null | undefined): ThumbnailSource | null {
  if (!url) {
    return null;
  }
  try {
    return { uri: url, cacheKey: new URL(url).pathname };
  } catch {
    // Not parseable as a URL — a fixture path, a relative asset. The default
    // behaviour (cache on the string itself) is already right for those.
    return url;
  }
}

/**
 * What makes two sources the same picture.
 *
 * `ScoreThumbnail` falls back to its ruled-staff placeholder when an image
 * fails to load, and a *new* source has to clear that failure. Deciding "new"
 * by object identity does not work: a `{ uri, cacheKey }` is built where the
 * API response is mapped, so a refetch returning the same photograph builds a
 * new object — and a genuinely dead URL would then retry, fail, reset, and
 * flicker. The identity has to come from inside the source.
 *
 * Here rather than in the component because the component imports
 * `expo-image`, and a module that does cannot be loaded under vitest at all —
 * the same reason `captureSession` and `transcriptionProgress` are modules.
 */
export function sourceIdentity(
  source: ThumbnailSource | null,
): string | number | null {
  if (source === null || typeof source !== 'object') {
    return source;
  }
  // The cache key is the storage path, which is the object's identity — the
  // `uri` carries a token that rotates for the same photograph.
  return source.cacheKey || source.uri;
}
