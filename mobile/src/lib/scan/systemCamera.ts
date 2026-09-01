/**
 * Photographing a page with the phone's own camera app.
 *
 * **The route the browser cannot cap.** The in-app viewfinder photographs
 * through `getUserMedia`, and on the web build the browser decides how many
 * pixels that stream carries — `captureImage` then draws its canvas at exactly
 * that size, so the stream *is* the photograph. A page of music needs eight
 * source pixels between staff lines (`legibility.ts`), and a capped stream
 * cannot supply them however the page is framed. Handing the job to the system
 * camera sidesteps the whole question: on iOS and Android an
 * `<input capture="environment">` opens the camera app and returns the sensor's
 * full picture, and on a real app build it opens the native camera.
 *
 * `expo-image-picker` already does exactly this — `launchCameraAsync` sets
 * `capture` on its file input on web — so this is a name for the call and its
 * options, not a new mechanism.
 *
 * **Imported lazily**, for the reason `framing.ts` and `shrink.ts` are: the
 * package reaches `react-native` at import time, whose Flow syntax vitest
 * cannot parse, so a value import here would make every module that touches
 * the scanner untestable.
 *
 * Returns the photograph's URI, or null for a cancel. **Never throws:** this is
 * reached from a musician trying to recover from a bad photograph, and a
 * recovery route that fails loudly is worse than one that quietly was not
 * there — the page they already have is still in the scan either way.
 */
export async function photographWithSystemCamera(): Promise<string | null> {
  try {
    const picker = await import('expo-image-picker');
    const result = await picker.launchCameraAsync({
      mediaTypes: ['images'],
      // The back camera. On web this is what turns the input's `capture`
      // attribute into `environment` rather than `user` — a page of music
      // photographed with the selfie camera is the one outcome worth ruling
      // out, and it is the browser's default when `capture` is bare.
      cameraType: picker.CameraType.back,
      // No cropping and no re-encode. Every pixel is the point here.
      allowsEditing: false,
      quality: 1,
    });
    if (result.canceled) {
      return null;
    }
    // One page. The camera app takes one photograph, and the caller is
    // replacing one page with it.
    return result.assets?.[0]?.uri ?? null;
  } catch {
    return null;
  }
}
