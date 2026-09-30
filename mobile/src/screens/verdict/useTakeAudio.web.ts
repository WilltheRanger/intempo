import { useCallback, useEffect, useRef, useState } from 'react';

import { prepareForPlayback } from '../../lib/audio/session';
import type { TakeAudio } from './useTakeAudio';

const EVENTS = [
  'loadedmetadata',
  'durationchange',
  'canplay',
  'timeupdate',
  'play',
  'pause',
  'ended',
  'seeked',
  'error',
] as const;

/**
 * The web half of `useTakeAudio`: the browser's own `<audio>`, which opens a
 * signed https link and a held take's `blob:` URL alike.
 *
 * **The element is the truth about whether it is playing**, not the press: it
 * stops on its own at the end of the take, and the control has to follow it
 * back rather than be set optimistically and left showing Pause.
 *
 * **The audio session, which is the hazard on the record screen and nowhere
 * else.** Declaring `playback` is what WebKit then refuses all capture under,
 * for the life of the document — the failure that cost six diagnoses. It is
 * safe here because the invariant lives on the capture side:
 * `audioRecorder.web.ts` declares `play-and-record` immediately before every
 * take, so whatever a review leaves behind is replaced before the next
 * recording. `session.capture.test.ts` holds that, because no browser in this
 * container can.
 */
export function useTakeAudio(uri: string): TakeAudio {
  const element = useRef<HTMLAudioElement | null>(null);
  const [state, setState] = useState({
    ready: false,
    playing: false,
    failed: false,
    current: 0,
    duration: 0,
  });

  // One element per recording, torn down with it. Pausing on the way out
  // matters: a held take's URL is revoked by the screen a moment later, and a
  // playing element on a revoked source is a sound nothing on screen can stop.
  useEffect(() => {
    const audio = new Audio(uri);
    audio.preload = 'metadata';
    element.current = audio;
    const read = () =>
      setState({
        ready: audio.readyState >= HTMLMediaElement.HAVE_METADATA,
        playing: !audio.paused && !audio.ended,
        failed: audio.error !== null,
        current: audio.currentTime,
        duration: Number.isFinite(audio.duration) ? audio.duration : 0,
      });
    for (const name of EVENTS) audio.addEventListener(name, read);
    read();
    return () => {
      for (const name of EVENTS) audio.removeEventListener(name, read);
      audio.pause();
      element.current = null;
    };
  }, [uri]);

  const pause = useCallback(() => {
    element.current?.pause();
  }, []);

  const seekTo = useCallback(async (seconds: number) => {
    const audio = element.current;
    if (audio) audio.currentTime = seconds;
  }, []);

  const play = useCallback(async (stillWanted: () => boolean) => {
    const audio = element.current;
    if (!audio) return;
    await prepareForPlayback();
    if (!stillWanted() || element.current !== audio) return;
    if (audio.ended) audio.currentTime = 0;
    try {
      await audio.play();
    } catch (error) {
      // A pause that lands before playback begins rejects the play it
      // interrupted, and a browser can refuse one it does not count as a tap.
      // Neither means the recording is broken, and saying it cannot be played
      // would put a dead control on screen for good.
      const name = error instanceof DOMException ? error.name : '';
      if (name !== 'AbortError' && name !== 'NotAllowedError') throw error;
    }
  }, []);

  return { ...state, play, pause, seekTo };
}
