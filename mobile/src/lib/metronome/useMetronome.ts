import { useEffect, useRef, useState } from 'react';

import { usePreferences } from '../../data/preferences';
import type { MetronomeMode } from '../../data/types';
import { impact, ImpactFeedbackStyle } from '../haptics';
import { metronomePulse, type Beat } from './beats';
import { countInOutputs, metronomeRuns, takeOutputs } from './countIn';
import { startBeatClock, startPlannedBeatClock } from './clock';
import { startClicks } from './click';
import type { PlannedBeat } from './plan';

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
  /**
   * Exact count-in and score pulses when the piece changes meter.
   * Omitted for callers that need an indefinite fixed metronome.
   */
  beatPlan?: readonly PlannedBeat[];
  /**
   * True while the count-in is running, false once the take is.
   *
   * The hook needs both because they get **different outputs from the same
   * clock**: the count-in ticks and taps whatever the mode says, and the take
   * only does what the microphone can survive. See `countIn.ts`.
   */
  countingIn: boolean;
  /**
   * True while the take is inside a written rest.
   *
   * Changes what the same clock produces — see `takeOutputs`. Held in a ref
   * below like `mode`, because a rest beginning must not restart the
   * metronome: the pulse a musician is counting has to survive the bar line
   * that starts the silence.
   */
  resting?: boolean;
}

export function useMetronome({
  mode,
  bpm,
  timeSignature,
  running,
  countingIn,
  beatPlan,
  resting = false,
}: MetronomeOptions): MetronomeState {
  const [beat, setBeat] = useState<Beat | null>(null);
  const { haptics } = usePreferences();

  // Held in refs so the effect below doesn't restart the metronome — and the
  // beat count with it — every time a beat re-renders the screen.
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const hapticsRef = useRef(haptics);
  hapticsRef.current = haptics;
  const restingRef = useRef(resting);
  restingRef.current = resting;
  const countingInRef = useRef(countingIn);
  countingInRef.current = countingIn;
  /** The running click track, so the boundary effect can silence it. */
  const clicksRef = useRef<{ stop: () => void } | null>(null);

  // A count-in runs even with the metronome off: it is how a take starts, not
  // a setting. See `metronomeRuns`.
  const active = metronomeRuns(mode, { countingIn, capturing: running });
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
    //
    // **Always started, sometimes stopped.** The count-in is audible whatever
    // the take's mode is, and the click track owns its own clock — so
    // restarting it at the downbeat would move the clicks off the beat the
    // screen is pulsing. It starts once and is silenced at the boundary
    // instead, by the effect below, when the take may not click.
    const clicks = startClicks({ bpm: pulseBpm, perBar, beats: beatPlan });
    clicksRef.current = clicks;

    const receiveBeat = (next: Beat) => {
      setBeat(next);
      const outputs = countingInRef.current
        ? countInOutputs(hapticsRef.current)
        : takeOutputs(modeRef.current, hapticsRef.current, {
            resting: restingRef.current,
          });
      if (outputs.haptic) {
        // Weight distinguishes the downbeat, the way the accent pitch does
        // for the ear. It is the only cue a hand has.
        //
        // **A rest lifts every pulse by one step**, downbeats included: with
        // no sound of your own to count against, the hand is doing the whole
        // job. The downbeat stays the stronger of the two so the bar is still
        // legible through the silence.
        const strong = next.downbeat;
        impact(
          outputs.emphasis
            ? strong
              ? ImpactFeedbackStyle.Heavy
              : ImpactFeedbackStyle.Medium
            : strong
              ? ImpactFeedbackStyle.Medium
              : ImpactFeedbackStyle.Light,
        );
      }
    };
    const clock = beatPlan
      ? startPlannedBeatClock({
          beats: beatPlan,
          leadInS: clicks.leadInS,
          onBeat: receiveBeat,
        })
      : startBeatClock({
          bpm: pulseBpm,
          perBar,
          leadInS: clicks.leadInS,
          onBeat: receiveBeat,
        });

    // Its own clock, on purpose: clicks are booked against the audio clock on
    // web, which is the whole reason they're trustworthy. Sharing the timer
    // here would throw that away to save an object — what they share instead
    // is the instant they start counting from.
    return () => {
      clock.stop();
      clicks.stop();
      clicksRef.current = null;
    };
    // `mode` is deliberately absent, and `modeRef` is how — the effect reads
    // `modeRef.current`, so the linter is right that nothing is missing.
    // Depending on `mode` itself would restart the count on a preference write
    // from anywhere else in the app, mid-take.
  }, [active, beatPlan, perBar, pulseBpm]);

  // Silence the clicks the moment the count-in ends, unless this take is one
  // that may click. Separate from the effect above because stopping them must
  // not restart the clock: the downbeat the screen shows and the downbeat the
  // ear hears are the same instant, and they stay that way only if nothing
  // re-counts from here.
  useEffect(() => {
    if (countingIn) {
      return;
    }
    if (!takeOutputs(modeRef.current, hapticsRef.current).click) {
      clicksRef.current?.stop();
      clicksRef.current = null;
    }
  }, [countingIn]);

  return {
    beat,
    // A mode that produces nothing at all. Not reachable from the count-in,
    // which is always audible; this is the take, where "haptic" with the
    // profile switch off is a metronome that is on and does nothing — the
    // exact bug this feature originally was.
    silent: active && !countingIn && mode === 'haptic' && !haptics,
  };
}
