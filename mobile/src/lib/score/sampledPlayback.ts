import type { Instrument } from '../../data/types';
import type { Schedule } from './schedule';
import type { PlaybackHandle, PlayOptions } from './player.types';
import type { RenderedInstrument } from './soundfontRender';

/** Returns immediately so loading itself can be stopped or superseded. */
export function beginSampledPlayback(
  schedule: Schedule,
  instrument: Instrument,
  options: PlayOptions,
  start: (
    audio: RenderedInstrument,
    cancelled: () => boolean,
    finish: () => void,
  ) => Promise<() => void>,
): PlaybackHandle {
  let stopped = false;
  let stage: 'loading' | 'rendering' | 'starting' = 'loading';
  let cleanup: (() => void) | undefined;
  const finish = () => {
    if (stopped) return;
    stopped = true;
    cleanup?.();
    options.onLoading?.(false);
    options.onEnd?.();
  };
  options.onLoading?.(true);
  void (async () => {
    try {
      const { loadSoundfont } = await import('./soundfontBank');
      const { renderSoundfont } = await import('./soundfontRender');
      if (stopped) return;
      const bank = await loadSoundfont(instrument);
      if (stopped) return;
      stage = 'rendering';
      const pcm = await renderSoundfont(
        schedule,
        bank,
        instrument,
        () => stopped,
      );
      if (stopped) return;
      stage = 'starting';
      cleanup = await start(pcm, () => stopped, finish);
      if (stopped) cleanup();
      else options.onLoading?.(false);
    } catch (error) {
      if (!stopped) {
        options.onError?.(
          error instanceof Error &&
            (error.message.includes('ten minutes') ||
              error.message.includes('no playable'))
            ? error.message
            : stage === 'loading'
              ? 'Couldn’t load the instrument sound. Check your connection and tap Listen to retry.'
              : stage === 'rendering'
                ? 'Couldn’t prepare the audio. Try a shorter passage and tap Listen to retry.'
                : 'Audio couldn’t start. Tap Listen to retry.',
        );
        finish();
      }
    }
  })();
  return { stop: finish, isPlaying: () => !stopped };
}
