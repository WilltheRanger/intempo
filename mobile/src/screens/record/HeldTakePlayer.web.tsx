import { useEffect, useRef, useState } from 'react';

import { Pause, Play } from '../../components/icons';
import { SecondaryButton } from '../../components/primitives';

import { prepareForPlayback } from '../../lib/audio/session';

export interface HeldTakePlayerProps {
  /** A URL for the take being held — see `lib/audio/heldTake.ts`. */
  url: string;
  style?: Parameters<typeof SecondaryButton>[0]['style'];
}

/**
 * Hear a take the app is holding, before it has been sent.
 *
 * **Proof rather than a claim.** The line above this says "your take is safe on
 * this device", which is the sentence a musician most needs to believe after a
 * failed upload, and it was an assertion. A take they can play is the same
 * thing demonstrated.
 *
 * **The platform's own element rather than `expo-audio`.** Measured in
 * Chromium: `useAudioPlayer({ uri })` given a `blob:` URL creates no player and
 * never fetches it — nothing appears in
 * `performance.getEntriesByType('resource')` — so the control flipped nothing
 * and the take stayed unheard. The verdict screen's playback works because its
 * source is a signed https URL. A take that has not been sent has no URL but
 * the object one, so this uses `Audio`, which takes it.
 *
 * **The audio session, which is the hazard on this screen and only this
 * screen.** Declaring `playback` is what `App.tsx` does at boot and what WebKit
 * then refuses all capture under, for the life of the document — the failure
 * that cost six diagnoses. It is safe here because the invariant lives on the
 * capture side: `audioRecorder.web.ts` declares `play-and-record` immediately
 * before every take, so whatever this leaves behind is replaced before the next
 * recording rather than outliving it. `session.capture.test.ts` holds that,
 * because no browser in this container can.
 */
export function HeldTakePlayer({ url, style }: HeldTakePlayerProps) {
  const [playing, setPlaying] = useState(false);
  const element = useRef<HTMLAudioElement | null>(null);

  // One element per held take, torn down with it. Pausing on the way out
  // matters: the URL is revoked by the screen a moment later, and a playing
  // element holding a revoked source is the one way this can make a noise
  // nothing on screen can stop.
  useEffect(() => {
    const audio = new Audio(url);
    element.current = audio;
    // The element is the source of truth about whether it is playing, not the
    // press: it stops on its own at the end of the take, and the label has to
    // follow it back rather than be set optimistically and left saying Stop.
    const stop = () => setPlaying(false);
    const start = () => setPlaying(true);
    audio.addEventListener('ended', stop);
    audio.addEventListener('pause', stop);
    audio.addEventListener('play', start);
    return () => {
      audio.removeEventListener('ended', stop);
      audio.removeEventListener('pause', stop);
      audio.removeEventListener('play', start);
      audio.pause();
      element.current = null;
    };
  }, [url]);

  async function toggle(): Promise<void> {
    const audio = element.current;
    if (!audio) {
      return;
    }
    try {
      if (!audio.paused) {
        audio.pause();
        return;
      }
      await prepareForPlayback();
      if (audio.ended) {
        audio.currentTime = 0;
      }
      await audio.play();
    } catch {
      // Autoplay refused, or an element torn down underneath us by leaving the
      // screen. The take is still held either way, which is the claim the
      // control makes.
      setPlaying(false);
    }
  }

  return (
    <SecondaryButton
      label={playing ? 'Stop' : 'Hear it'}
      icon={playing ? Pause : Play}
      onPress={() => void toggle()}
      style={style}
    />
  );
}
