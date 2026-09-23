import { useEffect, useRef, useState } from 'react';

import { heldTakeUrl, releaseHeldTake } from '../../lib/audio/heldTake';
import { prepareForPlayback } from '../../lib/audio/session';

/**
 * Play a picked file before sending it, and say where it has got to.
 *
 * The same mechanism as `HeldTakePlayer` — an `<audio>` element on an object
 * URL — with the position reported, so the waveform can fill as it plays.
 * `prepareForPlayback` first, which is what keeps a play here from leaving the
 * page in a category WebKit refuses capture under (`docs/subsystems.md`,
 * the recording path).
 */
export function usePreviewPlayback(audio: Blob | null) {
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState<number | null>(null);
  const element = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    setPlaying(false);
    setPosition(0);
    setDuration(null);
    const url = audio ? heldTakeUrl(audio) : null;
    if (!url) {
      element.current = null;
      return;
    }
    const player = new Audio(url);
    player.preload = 'metadata';
    element.current = player;
    const onTime = () => setPosition(player.currentTime);
    // The file's length, from its own metadata: cheap, and right for any
    // format the browser can play.
    const onMeta = () =>
      setDuration(Number.isFinite(player.duration) ? player.duration : null);
    const onEnd = () => {
      setPlaying(false);
      setPosition(0);
    };
    const onPause = () => setPlaying(false);
    const onPlay = () => setPlaying(true);
    player.addEventListener('timeupdate', onTime);
    player.addEventListener('loadedmetadata', onMeta);
    player.addEventListener('ended', onEnd);
    player.addEventListener('pause', onPause);
    player.addEventListener('play', onPlay);
    return () => {
      player.removeEventListener('timeupdate', onTime);
      player.removeEventListener('loadedmetadata', onMeta);
      player.removeEventListener('ended', onEnd);
      player.removeEventListener('pause', onPause);
      player.removeEventListener('play', onPlay);
      player.pause();
      element.current = null;
      releaseHeldTake(url);
    };
  }, [audio]);

  async function toggle(): Promise<void> {
    const player = element.current;
    if (!player) {
      return;
    }
    try {
      if (!player.paused) {
        player.pause();
        return;
      }
      await prepareForPlayback();
      await player.play();
    } catch {
      setPlaying(false);
    }
  }

  return { available: audio !== null, playing, position, duration, toggle };
}
