/**
 * Hearing a take the app is still holding, before it has been sent.
 *
 * **The screen says the take is safe and had no way to show it.** "Your take is
 * safe on this device" is the sentence a musician most needs to believe after a
 * failed upload, and it was an assertion. A take they can play is the same
 * claim, proved.
 *
 * The bytes are a `Blob` on both platforms — `lib/audio/types.ts` — and a
 * player wants a URI, so this is the one step between them.
 *
 * **Null rather than a broken source.** `URL.createObjectURL` is a browser API;
 * where it is absent, the caller draws no control at all rather than one that
 * does nothing when pressed (§3: a drawn affordance must do the thing it
 * depicts). The native half of this module returns null for the same reason
 * and says why.
 *
 * **The URL is for an `<audio>` element and not for `expo-audio`.** Measured in
 * Chromium: `useAudioPlayer({ uri })` given a `blob:` URL creates no player and
 * never fetches it — nothing in `performance.getEntriesByType('resource')` — so
 * the control flipped nothing. It works for the verdict screen's take because
 * that is a signed https URL. `HeldTakePlayer.web.tsx` uses the platform's own
 * element instead.
 */

/**
 * A URL a player can open, or null where one cannot be made.
 *
 * Revoke it with `releaseHeldTake` when the take is sent or discarded: an
 * object URL pins the whole blob in memory for the life of the document, and a
 * take is minutes of audio.
 */
export function heldTakeUrl(audio: Blob): string | null {
  const factory =
    typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function'
      ? URL.createObjectURL
      : null;
  if (!factory) {
    return null;
  }
  try {
    return factory.call(URL, audio);
  } catch {
    // A platform that exposes the name and refuses a Blob.
    return null;
  }
}

/** Safe to call with null, and safe to call twice. */
export function releaseHeldTake(url: string | null): void {
  if (!url || typeof URL === 'undefined' || typeof URL.revokeObjectURL !== 'function') {
    return;
  }
  try {
    URL.revokeObjectURL(url);
  } catch {
    // Already revoked, or a platform that does not track them.
  }
}
