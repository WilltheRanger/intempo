/**
 * Making the browser audible, including on a phone that is on silent.
 *
 * **The comment this replaces said "the browser has no audio session, and no
 * silent switch to override".** That is true of a laptop and false of the
 * device most of this app's users hold: Safari on iOS applies the ring/silent
 * switch to Web Audio, and has since forever. A musician with the switch
 * flipped — which is most musicians in most practice rooms — pressed Listen on
 * the web build and heard nothing, and the native fix for this
 * (`setAudioModeAsync`) is a no-op here.
 *
 * `navigator.audioSession` is the browser-side equivalent and exists for
 * exactly this: `type = 'playback'` declares that this page's audio is the
 * point rather than an incidental noise, and playback then ignores the switch.
 * Safari 16.4 and later; absent everywhere else, where there is nothing to
 * override and the guard below does the right thing by doing nothing.
 *
 * **Unverified on hardware**, like its native counterpart. There is no iPhone
 * in this environment. What can be checked here is that it is called on every
 * path that makes a sound, and that it cannot throw.
 */

interface AudioSession {
  type: string;
}

function audioSession(): AudioSession | null {
  if (typeof navigator === 'undefined') {
    return null;
  }
  return (
    (navigator as unknown as { audioSession?: AudioSession }).audioSession
    ?? null
  );
}

/**
 * Ask for a category, and never fail a caller over the answer.
 *
 * Every caller is inside a button press that is about to start a sound or a
 * take; a throw there takes the press down, which is worse than the quiet this
 * module exists to prevent.
 */
function declare(type: string): void {
  const session = audioSession();
  if (!session) {
    return;
  }
  try {
    session.type = type;
  } catch {
    // A browser that exposes the object and refuses the value.
  }
}

export async function prepareForPlayback(): Promise<void> {
  declare('playback');
}

/**
 * The category a take needs, and **the bug that five fixes walked past.**
 *
 * The line this replaces read: *"'playback' rather than 'play-and-record':
 * this app records through a separate path with its own session, and asking
 * for the recording category here would drop the output volume for no gain."*
 * That is true on iOS native — `audioRecorder.ts` configures its own
 * `AVAudioSession` — and **false on web**, where `navigator.audioSession` is a
 * property of the page and the recorder has no session of its own to own.
 *
 * So the app declared `playback` at boot (`App.tsx`) and WebKit took it at its
 * word. `MediaDevices::getUserMedia` refuses capture outright while a category
 * override other than `PlayAndRecord` is in force:
 *
 *     auto categoryOverride = AudioSession::singleton().categoryOverride();
 *     if (categoryOverride != AudioSessionCategory::None
 *         && categoryOverride != AudioSessionCategory::PlayAndRecord)
 *         promise.reject(Exception { ExceptionCode::InvalidStateError,
 *             "AudioSession category is not compatible with audio capture."_s });
 *
 * That guard is evaluated on whether audio was asked for **at all**, before
 * any constraint is read and before any device is chosen — which is why four
 * fixes to the `AudioContext` and one to the constraints changed nothing, and
 * why the plain `{ audio: true }` retry failed in exactly the same words as
 * the constrained ask. It is also why the stock WebRTC sample records on the
 * same phone: it never touches `navigator.audioSession`, so its override stays
 * `None`, which the guard permits.
 *
 * **`play-and-record` rather than `auto`**, which would also pass the guard:
 * the metronome plays *during* a take, and `auto` surrenders the ring/silent
 * override that is this module's entire reason for existing. The old comment's
 * one true half — that the recording category costs output volume — is a real
 * cost, and the right place to pay it is for the length of a take rather than
 * for the life of the page.
 */
export async function prepareForCapture(): Promise<void> {
  declare('play-and-record');
}
