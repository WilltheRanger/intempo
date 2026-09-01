import type { PageSamples } from './legibility';

/**
 * Greyscale samples from a photograph, for the legibility check. Native: none.
 *
 * **There is no way to read a photograph's pixels on native here.** React
 * Native has no canvas, and `expo-image-manipulator` resizes and crops without
 * ever handing back a buffer — reading pixels would mean a native module,
 * which is a dependency and a build, not a check.
 *
 * Returning null is the honest answer and it costs nothing that exists today:
 * `page_image.too_small_to_read` on the server is still the real check on every
 * platform, and this only ever moved its *timing* earlier. A native build
 * behaves exactly as the app did before this file.
 *
 * The web build is the one deployed, so the check runs where the musicians are.
 * Same split as `metronome/click.ts` and `scorePlayer.ts`.
 */
export async function pageSamples(_uri: string): Promise<PageSamples | null> {
  return null;
}
