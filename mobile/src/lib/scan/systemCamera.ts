/**
 * Photographing a page with the phone's own camera.
 *
 * **The camera, not a picture of a camera.** The scanner used to be an in-app
 * viewfinder: the live video drawn into a portrait page-shaped window with
 * `cover`, and every photograph then cropped down to that window
 * (`cropToViewfinder`). What reached the reader was whatever rectangle the
 * window happened to show — on a phone browser, a 16:9 stream cut to a 0.74
 * page, so a page held in the frame lost its edges and the musician had no way
 * to see what had been kept. It was reported as "it crops it really weirdly",
 * and the request was to use the actual camera instead (2026-10-23).
 *
 * So this opens the system camera and keeps the whole photograph, at the
 * sensor's own shape. On an app build that is the iPhone's camera; on the web
 * it is an `<input capture="environment">`, which a phone answers with its
 * camera app and the full-resolution picture — the route the browser cannot
 * cap, because no `getUserMedia` stream is involved.
 *
 * **Opened inside the tap, or not at all, on the web.** A browser opens a file
 * input only during the user activation that asked for it, and
 * `expo-image-picker` says so: called outside one, it "will block the request
 * without a warning". So on the web nothing is awaited before
 * `launchCameraAsync` — no permission check (a browser has none for this) and
 * no lazy import. The picker module is passed in by the screen, which imports
 * it statically, for the same reason: `expo-image-picker` reaches
 * `react-native` at import time, whose Flow syntax vitest cannot parse, so
 * importing it here would make this module untestable.
 *
 * **Native asks first.** iOS refuses `launchCameraAsync` outright without the
 * camera permission (`MissingCameraPermissionException`), so the permission is
 * requested before the camera opens, and a refusal is an answer of its own
 * rather than a silent nothing.
 */

/** The options every page photograph is taken with. */
export const PAGE_PHOTO_OPTIONS = {
  mediaTypes: ['images'] as const,
  // No cropping — the whole photograph is the page.
  allowsEditing: false,
  // **0.95 on an app build, and nothing on the web.** iOS re-encodes the
  // camera's photograph at this quality; the web hands back the camera app's
  // own file untouched. 0.95 rather than 1 because 1 is a multi-megabyte file
  // for no detail a staff line can show, and rather than 0.8 because JPEG
  // artefacts land hardest on exactly this: one-pixel lines on white paper.
  // `shrink.ts` trades quality later, and only for a page over the limit.
  quality: 0.95,
  exif: false,
  base64: false,
};

/** The parts of `expo-image-picker` this uses, so a test can stand in for it. */
export interface CameraPicker {
  launchCameraAsync(options: Record<string, unknown>): Promise<{
    canceled: boolean;
    assets?: ReadonlyArray<{ uri: string; width?: number; height?: number }> | null;
  }>;
  requestCameraPermissionsAsync(): Promise<{ granted: boolean; canAskAgain: boolean }>;
  CameraType: { back: unknown };
}

/** What happened when the camera was asked for a page. */
export type Photograph =
  | { kind: 'photo'; uri: string; width: number | null; height: number | null }
  /** The camera was closed without a photograph. */
  | { kind: 'cancelled' }
  /** An app build without the camera permission. */
  | { kind: 'refused'; canAskAgain: boolean }
  /** The camera could not be opened, or gave back something unusable. */
  | { kind: 'failed' };

/**
 * Open the camera for one page. Never throws.
 *
 * Returns a promise whose camera is already opening by the time this returns
 * on the web — the caller must call it directly from the press handler, with
 * nothing awaited first.
 */
export function photographPage(picker: CameraPicker, os: string): Promise<Photograph> {
  const options = { ...PAGE_PHOTO_OPTIONS, cameraType: picker.CameraType.back };
  if (os === 'web') {
    return settle(() => picker.launchCameraAsync(options));
  }
  return (async () => {
    let permission: { granted: boolean; canAskAgain: boolean };
    try {
      permission = await picker.requestCameraPermissionsAsync();
    } catch {
      return { kind: 'failed' } as const;
    }
    if (!permission.granted) {
      return { kind: 'refused', canAskAgain: permission.canAskAgain } as const;
    }
    return settle(() => picker.launchCameraAsync(options));
  })();
}

/** The picker's answer, as one of the four outcomes, whatever it throws. */
async function settle(open: () => ReturnType<CameraPicker['launchCameraAsync']>): Promise<Photograph> {
  try {
    const result = await open();
    if (result.canceled) {
      return { kind: 'cancelled' };
    }
    // One page. The camera takes one photograph at a time.
    const asset = result.assets?.[0];
    if (!asset?.uri) {
      return { kind: 'failed' };
    }
    return {
      kind: 'photo',
      uri: asset.uri,
      width: positive(asset.width),
      height: positive(asset.height),
    };
  } catch {
    return { kind: 'failed' };
  }
}

function positive(value: number | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}
