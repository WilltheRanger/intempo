import { secondsPerBeat } from './beats';
import type { ClickTrack, ClickTrackOptions } from './click.types';

/**
 * Audible clicks in a browser, scheduled against the audio clock.
 *
 * A take can run fifteen minutes, so the clicks can't all be scheduled up
 * front the way `scorePlayer.web.ts` schedules a piece. Instead a timer wakes
 * up a few times a second and books whatever falls inside the next window.
 * The timer only decides *when the booking happens*; every click's time is
 * still `startedAt + index × period` on the audio clock, so a late wake-up
 * costs nothing and the clicks never drift. This is the standard Web Audio
 * lookahead pattern, and it is the reason the metronome is trustworthy while
 * the beat clock next door is merely punctual.
 */

/** How far ahead clicks are booked. Comfortably longer than the wake-up gap. */
const LOOKAHEAD_S = 0.25;
const WAKE_MS = 60;

/**
 * Slack before the first click, so it is not booked into a moment that has
 * already passed.
 *
 * Reported back as `ClickTrack.leadInS` so the beat clock driving the screen
 * can start from the same instant. See that field for what the mismatch cost.
 */
const LEAD_IN_S = 0.1;

/**
 * A click, not a tone.
 *
 * Short and hard on purpose: the ear places a transient far more precisely
 * than it places the start of anything that fades in, and placing the beat is
 * the entire job. Two pitches so the downbeat is distinguishable without being
 * louder — a louder accent bleeds further into the microphone.
 */
const CLICK_HZ = 1000;
const ACCENT_HZ = 1600;
const CLICK_S = 0.03;
const CLICK_GAIN = 0.25;

export function startClicks({ bpm, perBar }: ClickTrackOptions): ClickTrack {
  const AudioContextCtor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;

  if (!AudioContextCtor) {
    // Nothing will sound, so nothing has to be waited for.
    return { stop: () => {}, leadInS: 0 };
  }

  const context = new AudioContextCtor();
  const period = secondsPerBeat(bpm);
  const startedAt = context.currentTime + LEAD_IN_S;
  let next = 0;
  let stopped = false;

  function schedule(at: number, accented: boolean) {
    const oscillator = context.createOscillator();
    const envelope = context.createGain();

    oscillator.type = 'square';
    oscillator.frequency.value = accented ? ACCENT_HZ : CLICK_HZ;

    // Straight to full and decayed away. An attack ramp would soften exactly
    // the edge the ear is timing from.
    envelope.gain.setValueAtTime(CLICK_GAIN, at);
    envelope.gain.exponentialRampToValueAtTime(0.0001, at + CLICK_S);

    oscillator.connect(envelope);
    envelope.connect(context.destination);
    oscillator.start(at);
    oscillator.stop(at + CLICK_S + 0.01);
  }

  function pump() {
    if (stopped) {
      return;
    }
    const until = context.currentTime + LOOKAHEAD_S;
    while (startedAt + next * period < until) {
      schedule(startedAt + next * period, perBar !== null && next % perBar === 0);
      next += 1;
    }
  }

  pump();
  const timer = setInterval(pump, WAKE_MS);

  // Autoplay policy can hand back a suspended context even from a tap; without
  // this the clicks are booked into a clock that isn't running.
  if (context.state === 'suspended') {
    void context.resume();
  }

  return {
    leadInS: LEAD_IN_S,
    stop() {
      if (stopped) {
        return;
      }
      stopped = true;
      clearInterval(timer);
      // Closing takes everything already booked with it, which is the point:
      // a click scheduled 250ms out must not sound after the take has ended.
      void context.close();
    },
  };
}
