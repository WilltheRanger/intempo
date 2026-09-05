import type { Instrument } from '../../data/types';
import type { Schedule } from './schedule';
import type { PlaybackHandle, PlayOptions } from './player.types';

/** Returns immediately so loading itself can be stopped or superseded. */
export function beginSampledPlayback(
  schedule: Schedule,
  instrument: Instrument,
  options: PlayOptions,
  start: (
    pcm: Int16Array,
    cancelled: () => boolean,
    finish: () => void,
  ) => Promise<() => void>,
): PlaybackHandle {
  let stopped = false;
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
      const { loadSamples } = await import('./sampleBank');
      const { renderSamples } = await import('./sampleRender');
      if (stopped) return;
      const bank = await loadSamples(instrument, schedule);
      if (stopped) return;
      const pcm = await renderSamples(schedule, bank, () => stopped);
      if (stopped) return;
      cleanup = await start(pcm, () => stopped, finish);
      if (stopped) cleanup();
      else options.onLoading?.(false);
    } catch (error) {
      if (!stopped) {
        options.onError?.(
          error instanceof Error && error.message.includes('ten minutes')
            ? error.message
            : 'Couldn’t load the instrument sound. Check your connection and tap Listen to retry.',
        );
        finish();
      }
    }
  })();
  return { stop: finish, isPlaying: () => !stopped };
}
