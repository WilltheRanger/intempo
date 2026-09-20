import type { Instrument } from '../../data/types';
import type { Schedule } from './schedule';
import type { PlaybackHandle, PlayOptions } from './player.types';
import { LOAD_DEADLINE_MS, RENDER_DEADLINE_MS, within } from './deadline';
import { listenFailure } from './listenFailure';
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
      // **Bounded, because a stalled download does not reject.** Without a
      // deadline the await below never returned and the Listen spinner spun
      // for as long as the musician was willing to watch it — while
      // `listenFailure` already held the right sentence for a load that fails
      // and had no way of being reached. See `deadline.ts` for why the bound
      // is generous rather than tight.
      const bank = await within(loadSoundfont(instrument), LOAD_DEADLINE_MS);
      if (stopped) return;
      stage = 'rendering';
      const pcm = await within(
        renderSoundfont(schedule, bank, instrument, () => stopped),
        RENDER_DEADLINE_MS,
      );
      if (stopped) return;
      stage = 'starting';
      cleanup = await start(pcm, () => stopped, finish);
      if (stopped) cleanup();
      else options.onLoading?.(false);
    } catch (error) {
      if (!stopped) {
        // The stage *and* what the browser called it — see `listenFailure`.
        // Three stages behind three fixed sentences made a screenshot of this
        // narrow the cause to one of three, which is where a real report from
        // an iPhone left us on 2026-09-12.
        options.onError?.(listenFailure(stage, error));
        finish();
      }
    }
  })();
  return { stop: finish, isPlaying: () => !stopped };
}
