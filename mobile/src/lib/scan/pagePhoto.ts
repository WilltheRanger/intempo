import type { CaptureOutcome, CapturedSource } from '../../data/captureSession';

/**
 * Where a photograph from the camera goes, and what the scan screen says.
 *
 * The rules of the camera flow, in a module because a rule inside a `.tsx` is
 * a rule nothing checks (`CLAUDE.md` §3) — the screens only ask.
 */

/** Why the camera was opened. */
export type CameraIntent =
  /** The first page of a new scan, optionally for a piece that exists. */
  | { kind: 'new'; attachToPieceId?: string }
  /** Another page for the scan on the review list. */
  | { kind: 'add' }
  /** A better photograph of one page, in its place. */
  | { kind: 'retake'; pageId: string };

/** The parts of `captureSession` this drives. */
export interface PhotoSession {
  reset(options?: { attachToPieceId?: string }): void;
  beginRetake(id: string): void;
  capture(source: CapturedSource): CaptureOutcome;
}

/**
 * Put a photograph where the intent says. Called only once there is one.
 *
 * **Nothing changes until a photograph arrives**, and that is the rule this
 * replaced two halves of. The viewfinder reset the session as it opened, so
 * opening the camera and closing it again threw away a scan nobody had
 * finished; and a retake was marked before the camera opened, so a camera
 * closed without a shot left a retake pending on a page the musician was still
 * looking at. Here a cancelled camera leaves the session exactly as it was,
 * with nothing to undo.
 *
 * A retake swaps the photograph in where the old page sits — `capture`'s rule,
 * and the reason `beginRetake` is called here rather than by the screen. A page
 * deleted while the camera was open is simply added at the end: the photograph
 * is the musician's, and dropping it would be the worse surprise.
 */
export function landPhoto(
  session: PhotoSession,
  intent: CameraIntent,
  source: CapturedSource,
): CaptureOutcome {
  if (intent.kind === 'new') {
    session.reset({ attachToPieceId: intent.attachToPieceId });
  } else if (intent.kind === 'retake') {
    session.beginRetake(intent.pageId);
  }
  return session.capture(source);
}

/** What went wrong the last time the camera was asked, if anything. */
export type CameraProblem = 'refused' | 'failed';

/** The scan screen's route parameters. */
export interface ScannerParams {
  adding?: boolean;
  attachToPieceId?: string;
  /** The id of the page a retake is for. */
  retake?: string;
  problem?: CameraProblem;
}

/** The same, as a web refresh reads them back out of the address bar. */
export type ScannerParamsAsRead = Omit<ScannerParams, 'adding'> & {
  adding?: boolean | string;
};

/** The scan screen's parameters for an intent, so it can try the same thing again. */
export function scannerParamsFor(intent: CameraIntent): ScannerParams {
  switch (intent.kind) {
    case 'add':
      return { adding: true };
    case 'retake':
      return { retake: intent.pageId };
    default:
      return intent.attachToPieceId ? { attachToPieceId: intent.attachToPieceId } : {};
  }
}

/**
 * The intent the scan screen was opened for.
 *
 * **`adding` may be a string.** On the web a refresh rebuilds the parameters
 * from the address bar, where every value is text, so `adding=false` would be
 * truthy as `"false"`. Only the two spellings of yes count.
 */
export function intentFromParams(params: ScannerParamsAsRead | undefined): CameraIntent {
  if (params?.retake) {
    return { kind: 'retake', pageId: params.retake };
  }
  if (params?.adding === true || params?.adding === 'true') {
    return { kind: 'add' };
  }
  return params?.attachToPieceId
    ? { kind: 'new', attachToPieceId: params.attachToPieceId }
    : { kind: 'new' };
}

export type LauncherRoute = 'camera' | 'settings' | 'import';

export interface LauncherCopy {
  title: string;
  description: string | null;
  hint: string | null;
  primary: { label: string; route: LauncherRoute };
  secondary: { label: string; route: LauncherRoute };
}

/**
 * The scan screen, which is no longer a viewfinder.
 *
 * It is what `/scan` opens to and where a camera that would not open explains
 * itself. Every button that photographs a page opens the camera directly, so
 * most scans never see this screen at all.
 *
 * **Both ways in are always named.** The camera is the one the musician came
 * for, and photos already on the phone are the way round any camera problem —
 * the same pair the empty review list offers.
 */
export function launcherCopy(problem: CameraProblem | null, os: string): LauncherCopy {
  const photos = { label: 'Choose photos', route: 'import' as const };

  // Only an app build has a camera permission to refuse; a browser's camera
  // app asks for nothing, so a refusal there is a failure like any other.
  if (problem === 'refused' && os !== 'web') {
    return {
      title: 'Camera access is off',
      description: 'Turn it on in Settings, or choose photos.',
      hint: null,
      primary: { label: 'Open Settings', route: 'settings' },
      secondary: photos,
    };
  }
  if (problem) {
    return {
      title: 'Couldn’t take that photo',
      // The camera returning nothing is the ordinary shape of this failure on
      // both platforms, and saying so is what makes "try again" believable.
      description: 'The camera gave nothing back. Try again.',
      hint: null,
      primary: { label: 'Try again', route: 'camera' },
      secondary: photos,
    };
  }
  return {
    title: 'Photograph a page',
    description: null,
    // The one sentence most likely to save a failed transcription, from the
    // review list's own empty state: everything downstream is decided by how
    // the page was photographed.
    hint: 'Flat, in daylight, whole page in frame.',
    primary: { label: 'Open camera', route: 'camera' },
    secondary: photos,
  };
}
