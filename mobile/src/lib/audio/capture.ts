/**
 * What the microphone actually delivered, as opposed to what was asked for.
 *
 * **The app has always asked for raw audio and never checked it got it.**
 * `audioRecorder.web.ts` requests `autoGainControl`, `noiseSuppression` and
 * `echoCancellation` all off, because every one of them moves an attack and
 * the analysis measures where attacks land. Nothing then read the track's own
 * settings back. So whether a take was captured raw or through the phone's
 * voice-call processing was never recorded anywhere, and could not be asked.
 *
 * It matters because that processing is a plausible cause of the one fault
 * every take this app has received shares: far more attacks detected than the
 * page writes. Auto-gain lifts the room between notes and spectral flux reads
 * the rising floor as an onset; noise suppression gates in and out, and each
 * edge is a transient. Neither was ever shown to be happening. Neither was
 * ever shown not to be.
 *
 * **It can happen two ways, and only one was visible even in principle.**
 *
 *  - The request is refused, and `shouldRetryUnconstrained` retries with
 *    `{ audio: true }` — the browser's full voice processing, deliberately, so
 *    a device that cannot give raw audio still gets to record. Correct, and
 *    silent: the take carried no mark that it had happened.
 *  - The request is *accepted* and the constraints are not honoured.
 *    Constraints are requests, not guarantees, and a browser may keep its
 *    processing on regardless. Only `getSettings()` can tell, because the
 *    request itself succeeded.
 *
 * This reads both, and says so on the take.
 *
 * Rules live here rather than in the recorder because there is no React
 * Native testing library in this project (`DECISIONS.md`, 2026-08-24) and
 * a rule inside a platform file is a rule nothing checks.
 */

/**
 * The processing a take went through, as the device reports it.
 *
 * **`null` is "the device did not say", and it is not `false`.** A browser
 * that omits a setting from `getSettings()` has made no claim about it, and
 * recording that as "off" would be asserting the thing this exists to find
 * out.
 */
export interface CaptureReport {
  autoGainControl: boolean | null;
  noiseSuppression: boolean | null;
  echoCancellation: boolean | null;
  /** What the hardware ran at, which `getSettings` knows before a sample does. */
  sampleRate: number | null;
  channelCount: number | null;
  /** True when the raw request was refused and the unconstrained one used. */
  fellBack: boolean;
}

/**
 * The subset of `MediaTrackSettings` read here.
 *
 * Declared rather than imported so this module has no DOM dependency and runs
 * under the node test environment the rest of `lib/` uses.
 */
interface TrackSettingsLike {
  autoGainControl?: unknown;
  noiseSuppression?: unknown;
  echoCancellation?: unknown;
  sampleRate?: unknown;
  channelCount?: unknown;
}

function flag(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

function count(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : null;
}

/**
 * Turn a track's reported settings into the report stored with the take.
 *
 * `settings` is `undefined` where the track has no `getSettings` at all — an
 * old WebView — and every field is then `null` rather than a guess.
 */
export function describeCapture(
  settings: TrackSettingsLike | undefined,
  { fellBack }: { fellBack: boolean },
): CaptureReport {
  return {
    autoGainControl: flag(settings?.autoGainControl),
    noiseSuppression: flag(settings?.noiseSuppression),
    echoCancellation: flag(settings?.echoCancellation),
    sampleRate: count(settings?.sampleRate),
    channelCount: count(settings?.channelCount),
    fellBack,
  };
}
