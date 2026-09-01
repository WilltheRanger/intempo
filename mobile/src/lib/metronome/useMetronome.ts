import { useEffect, useRef, useState } from 'react';

import { usePreferences } from '../../data/preferences';
import type { MetronomeMode } from '../../data/types';
import { impact, ImpactFeedbackStyle } from '../haptics';
import { metronomePulse, type Beat } from './beats';
import { startBeatClock } from './clock';
import { startClicks } from './click';

/**
 * The metronome, for the duration of a take.
 *
 * One hook because the three modes are one feature with three outputs, and
 * splitting them would let the beat they share come from three places.
 *
 * It runs while the practice clock is active: through the one-bar count-in
 * and, when the chosen mode is on, through the take. The Record screen owns the
 * transition because the first beat after a complete count-in bar is the
 * score's downbeat; this hook owns the shared clock so that transition cannot
 * restart it or move the pulse.
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
  /** True during the count-in and, when enabled, the take. */
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
  const pulse = metronomePulse(timeSignature);
  const perBar = pulse?.pulsesPerBar ?? null;
  // Stored BPM is always quarter-note BPM. Dividing by the pulse duration
  // preserves the score's real time while clicking the beat the meter implies.
  const pulseBpm = bpm / (pulse?.quarterBeats ?? 1);

  useEffect(() => {
    if (!active) {
      setBeat(null);
      return;
    }

    // Started **before** the clock, because the clock needs its lead-in. Web
    // books the first click a tenth of a second out and the screen used to
    // pulse that far ahead of it, every beat of every take.
    const clicks = mode === 'audio_with_headphones' ? startClicks({ bpm: pulseBpm, perBar }) : null;

    const clock = startBeatClock({
      bpm: pulseBpm,
      perBar,
      leadInS: clicks?.leadInS ?? 0,
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
    // here would throw that away to save an object — what they share instead
    // is the instant they start counting from.
    return () => {
      clock.stop();
      clicks?.stop();
    };
    // `mode` is deliberately absent: changing it mid-take is impossible (the
    // control is locked while recording), and including it would restart the
    // count on a preference write from anywhere else in the app.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, perBar, pulseBpm]);

  return {
    beat,
    silent: active && mode === 'haptic' && !haptics,
  };
}
