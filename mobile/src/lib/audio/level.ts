/**
 * How loud the take actually was — enough to know it was not nothing.
 *
 * **Not a level meter, and deliberately not a quality judgement.** The
 * pipeline's onset detector is amplitude-invariant: `onset_strength`
 * differences a dB-scaled mel spectrogram, so scaling a waveform shifts every
 * frame by a constant the differencing removes. Measured on all six audio
 * fixtures, requantised to 16 bit at each level, the onset count is identical
 * from 0 dBFS down to -90 dBFS — see `analysis._why_nothing_to_compare` and
 * `test_the_detector_hears_the_same_notes_however_quiet_the_take_is`.
 *
 * So a quiet take is a perfectly good take, and an app that warned about one
 * would be inventing a problem it had measured the absence of. The only thing
 * worth knowing here is the case with no argument in it: **every sample zero**,
 * which is what a muted input, a revoked permission or a device recording from
 * a source with nothing routed to it all produce.
 */

/**
 * Loudest sample seen so far, as a running value.
 *
 * Running rather than a pass over the finished take, because the finished take
 * is up to fifteen minutes — 43 million samples at 48 kHz — and stopping a
 * recording should not walk all of it. Each chunk is already handed to the main
 * thread as it arrives; this looks at it once on the way past.
 */
export interface PeakMeter {
  /** Fold one chunk of captured samples into the running peak. */
  observe(chunk: Int16Array): void;
  /** The loudest sample so far, 0 to 1. */
  peak(): number;
  /** Forget everything, for a take that is being restarted. */
  reset(): void;
}

/** 16-bit full scale. The negative range reaches one step further. */
const FULL_SCALE = 32768;

export function createPeakMeter(): PeakMeter {
  let loudest = 0;
  return {
    observe(chunk) {
      for (let i = 0; i < chunk.length; i += 1) {
        // `Math.abs` on the raw sample, not the scaled one: one division at
        // the end instead of one per sample.
        const magnitude = chunk[i] < 0 ? -chunk[i] : chunk[i];
        if (magnitude > loudest) {
          loudest = magnitude;
        }
      }
    },
    peak() {
      return loudest / FULL_SCALE;
    },
    reset() {
      loudest = 0;
    },
  };
}

/**
 * Did anything at all reach the microphone?
 *
 * Strictly zero, and that strictness is the point. A take with any signal in it
 * — however quiet, down to a single bit — is one the pipeline can read, so
 * refusing it here would take a take away from a musician who could have had a
 * verdict on it. A take of exact zeros is one the pipeline answers `no_onsets`
 * to, after an upload and a wait, having spent one of three free analyses for
 * the month.
 *
 * This is not the same set as the server's `no_onsets`, and must not claim to
 * be: constant DC also yields no onsets while being far from zero here. It is
 * the subset that can be known on the phone with certainty, which is the only
 * subset worth refusing without asking.
 */
export function capturedNothing(peak: number): boolean {
  return peak === 0;
}
