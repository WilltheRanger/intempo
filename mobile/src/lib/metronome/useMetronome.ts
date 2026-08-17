import { useEffect, useRef, useState } from 'react';

import { usePreferences } from '../../data/preferences';
import type { MetronomeMode } from '../../data/types';
import { impact, ImpactFeedbackStyle } from '../haptics';
import { beatsPerBar, type Beat } from './beats';
import { startBeatClock } from './clock';
import { startClicks } from './click';

/**
 * The metronome, for the duration of a take.
 *
 * One hook because the three modes are one feature with three outputs, and
 * splitting them would let the beat they share come from three places.
 *
 * It runs only while recording. Before the take, `ListenButton` already
 * answers "how does this go at this tempo" with the actual notes, and two
 * things counting at once on a screen with one tempo on it is one too many.
 *
 * There is no count-in. A take is aligned against the score by what was
 * played, not by when the file starts, so an offset at the top costs nothing —
 * and a count-in that the recorder captures as silence is a product decision
 * with a UI, not a detail to slip in here.
 */

export interface MetronomeState {
  /** The most recent beat, or null before the first one. Drives the display. */
  beat: Beat | null;
  /**
   * True when the chosen mode can't actually produce anything — haptics turned
   * off in the profile while the mode is haptic. A mode that silently does
   * nothing is the exact bug this whole feature was: stored, displayed, and
   * connected to nothing.
   */
  silent: boolean;
}

export interface MetronomeOptions {
  mode: MetronomeMode;
  bpm: number;
  /** The score's time signature, for the accent. Absent is fine. */
  timeSignature: string | null | undefined;
  /** Only ever true during a take. */
  running: boolean;
}

export function useMetronome({
  mode,
  bpm,
  timeSignature,
  running,
}: MetronomeOptions): MetronomeState {
  const [beat, setBeat] = useState<Beat | null>(null);
  const { haptics } = usePreferences();

  // Held in a ref so the effect below doesn't restart the metronome — and the
  // beat count with it — every time a beat re-renders the screen.
  const modeRef = useRef(mode);
  modeRef.current = mode;

  const active = running && mode !== 'off';
  const perBar = beatsPerBar(timeSignature);

  useEffect(() => {
    if (!active) {
      setBeat(null);
      return;
    }

    const clock = startBeatClock({
      bpm,
      perBar,
      onBeat: (next) => {
        setBeat(next);
        if (modeRef.current === 'haptic') {
          // Weight distinguishes the downbeat, the way the accent pitch does
          // for the ear. It is the only cue a hand has.
          impact(
            next.downbeat ? ImpactFeedbackStyle.Medium : ImpactFeedbackStyle.Light,
          );
        }
      },
    });

    // Its own clock, on purpose: clicks are booked against the audio clock on
    // web, which is the whole reason they're trustworthy. Sharing the timer
    // here would throw that away to save an object.
    const clicks = mode === 'audio_with_headphones' ? startClicks({ bpm, perBar }) : null;

    return () => {
      clock.stop();
      clicks?.stop();
    };
    // `mode` is deliberately absent: changing it mid-take is impossible (the
    // control is locked while recording), and including it would restart the
    // count on a preference write from anywhere else in the app.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, bpm, perBar]);

  return {
    beat,
    silent: active && mode === 'haptic' && !haptics,
  };
}
