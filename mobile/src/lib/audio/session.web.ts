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

export async function prepareForPlayback(): Promise<void> {
  if (typeof navigator === 'undefined') {
    return;
  }
  const session = (navigator as unknown as { audioSession?: AudioSession })
    .audioSession;
  if (!session) {
    return;
  }
  try {
    // 'playback' rather than 'play-and-record': this app records through a
    // separate path with its own session, and asking for the recording
    // category here would drop the output volume for no gain.
    session.type = 'playback';
  } catch {
    // A browser that exposes the object and refuses the value. Nothing to do,
    // and nothing worth failing a Listen over.
  }
}
