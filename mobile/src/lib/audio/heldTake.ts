/**
 * Hearing a take the app is still holding, before it has been sent.
 *
 * **Nothing on a native build, deliberately.** The bytes are a `Blob`
 * (`lib/audio/types.ts`) and a native player wants a file: `expo-audio`'s
 * native source resolves paths, not object URLs, so a URL made here would
 * produce a control that appears and does nothing — the affordance §3 rules
 * out drawing at all. Writing the take to a temporary file first is a real
 * piece of work and is not faked over.
 *
 * `heldTake.web.ts` is where it is possible, and the web build is what ships
 * today — see `CLAUDE.md` §4.
 */

/** Null on native: see above. The caller draws no control when it is null. */
export function heldTakeUrl(_audio: Blob): string | null {
  return null;
}

/** Nothing to release when nothing was made. Safe to call. */
export function releaseHeldTake(_url: string | null): void {}
