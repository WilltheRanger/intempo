import type { Instrument } from '../../data/types';
import type { Schedule } from './schedule';
import type { PlaybackHandle, PlayOptions } from './player.types';
import { LOAD_DEADLINE_MS, RENDER_DEADLINE_MS, within } from './deadline';
import { listenFailure } from './listenFailure';
import type { RenderedInstrument } from './soundfontRender';

/**
 * How much of the passage is final, for a player that starts before it all is.
 *
 * Handed to every `start`: complete already when the player was given the whole
 * passage, filling when it was started early (`StreamOptions`).
 */
export interface Rendering {
  /** Frames of the passage's buffer that are final. */
  written(): number;
  /** Told each new count of final frames, the last time with all of them. */
  subscribe(listener: (written: number) => void): () => void;
}

/**
 * Start playing before the render has finished, for a player that can.
 *
 * **A player that cannot keep up must not start early**, so both numbers are
 * checked at the moment it would: enough music to begin on, and a render that
 * has been running fast enough to stay ahead of the music it is making. A
 * render slower than that finishes first, and the passage plays whole, as
 * every passage used to.
 */
export interface StreamOptions {
  /** Seconds of music that must be final before playing. */
  leadS: number;
  /** How many times faster than real time the render must be going. */
  minSpeed: number;
}

/** Returns immediately so loading itself can be stopped or superseded. */
export function beginSampledPlayback(
  schedule: Schedule,
  instrument: Instrument,
  options: PlayOptions,
  start: (
    audio: RenderedInstrument,
    cancelled: () => boolean,
    finish: () => void,
    rendering: Rendering,
  ) => Promise<() => void>,
  stream?: StreamOptions,
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
      const { loadSoundfont, renderSoundfont } = await import('./soundfontEngine');
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

      let written = 0;
      const listeners = new Set<(written: number) => void>();
      const rendering: Rendering = {
        written: () => written,
        subscribe(listener) {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
      };
      // The passage as it stood when it was early enough to start on.
      let early: RenderedInstrument | undefined;
      let startEarly: () => void = () => {};
      const startedEarly = new Promise<'early'>((resolve) => {
        startEarly = () => resolve('early');
      });
      const renderBegan = Date.now();
      const rendered = renderSoundfont(schedule, bank, instrument, () => stopped, (audio, count) => {
        written = count;
        listeners.forEach((listener) => listener(count));
        if (!stream || early || count >= audio.pcm.length / audio.channels) return;
        const seconds = count / audio.sampleRate;
        const took = Math.max(1, Date.now() - renderBegan) / 1000;
        if (seconds >= stream.leadS && seconds / took >= stream.minSpeed) {
          early = audio;
          startEarly();
        }
      });

      // The deadline is on the wait, not on the render: once the music has
      // started ahead of it, the rest of the render is not a stall to give up on.
      const first = await within(Promise.race([rendered, startedEarly]), RENDER_DEADLINE_MS);
      if (stopped) return;
      const audio = first === 'early' && early ? early : (first as RenderedInstrument);
      if (first !== 'early') {
        written = audio.pcm.length / audio.channels;
      }
      stage = 'starting';
      cleanup = await start(audio, () => stopped, finish, rendering);
      if (stopped) {
        cleanup();
        return;
      }
      options.onLoading?.(false);
      if (first === 'early') {
        // Playing; a render that fails now is a render failure, and stops it.
        stage = 'rendering';
        await rendered;
      }
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
