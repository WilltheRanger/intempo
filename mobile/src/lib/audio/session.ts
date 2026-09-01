import { setAudioModeAsync } from 'expo-audio';

/**
 * The device audio session, configured once and re-asserted before playback.
 *
 * **Because nothing ever configured it.** No call to `setAudioModeAsync`
 * existed anywhere in the app, so iOS used whatever category the session
 * happened to be in — which respects the ring/silent switch. A musician with
 * their phone on silent, which is most musicians in most rehearsal rooms,
 * pressed Listen and heard nothing. Nothing was broken in the player; the
 * operating system was doing exactly what an unconfigured session asks it to.
 *
 * Two reasons it is also re-asserted rather than set once at launch:
 *
 *  - **Recording takes the session away.** `AudioStream.start()` puts iOS into
 *    `.record` with mode `.measurement` and `stop()` deactivates it — which is
 *    right, and is why `audioRecorder.ts` deliberately does not fight it. What
 *    is left afterwards is not a playback session, so the next click or the
 *    next Listen would inherit it.
 *  - It is idempotent and cheap, so the alternative — tracking whose turn it
 *    is — is more state for no benefit.
 *
 * **Unverified on hardware.** There is no device in this environment. This is
 * written against `expo-audio`'s documented `AudioMode` and typechecks; what
 * cannot be checked here is the thing it exists for, which is whether a phone
 * with the switch flipped makes a sound.
 */

/**
 * `doNotMix`, not the package default of `mixWithOthers`.
 *
 * A metronome is not a sound effect. Practising against a click while another
 * app plays a recording of the same piece is not a thing anybody does on
 * purpose, and a metronome that another app can duck is a metronome that
 * disappears under the beat it is supposed to give you.
 */
const PLAYBACK = {
  playsInSilentMode: true,
  interruptionMode: 'doNotMix',
  // iOS drops output to the receiver-level volume in `.playAndRecord`. Nothing
  // here records — the recorder configures its own session — so asking for the
  // recording category would only make playback quieter.
  allowsRecording: false,
  // Background audio needs `UIBackgroundModes` in the app config, which this
  // app does not declare. Claiming it here would be a promise the build does
  // not keep.
  shouldPlayInBackground: false,
} as const;

/**
 * Make the device able to play sound, including on silent.
 *
 * Never throws: every caller is about to make a noise, and failing to
 * configure the session is a reason for that noise to be quiet, not a reason
 * for the screen to break.
 */
export async function prepareForPlayback(): Promise<void> {
  try {
    await setAudioModeAsync(PLAYBACK);
  } catch {
    // An older runtime, or a platform that has no session to set. The player
    // still plays; it may just obey the switch.
  }
}
