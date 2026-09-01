import type { Instrument } from '../../data/types';

/**
 * What a played-back note sounds like.
 *
 * **This used to be one four-harmonic tone for everything**, and its own
 * comment argued for that: *"a synthesised approximation that almost sounds
 * like a cello is worse than a clean tone that obviously isn't one, because
 * the near-miss invites the comparison."* The owner overruled it on
 * 2026-09-01 — *"Add actual instruments for their chosen instrument so we
 * wont use that default computer sound to play the notes"* — and they are
 * right about the symptom: four harmonics with a fixed spectrum is a test
 * signal, and a musician checking a transcription against it is listening past
 * the sound rather than to it.
 *
 * These are **synthesised, not sampled**, and the app should never imply
 * otherwise. What makes them sound like instruments rather than like a
 * transposed waveform is the one thing the old voice had no way to express:
 *
 * ## The body is fixed in frequency; the string is not
 *
 * A violin's spectrum is not a shape you slide up and down the keyboard. The
 * string produces a near-sawtooth — Helmholtz motion, harmonic *n* at roughly
 * `1/n` — and then the **body** filters it through resonances that sit at the
 * same frequencies whatever note is being played: the air resonance in the
 * f-holes, the main body modes, and the broad "bridge hill" a couple of
 * octaves up. Play a G3 and the fourth harmonic lands on the body's main
 * resonance and blooms; play a G5 and the fundamental lands there instead.
 * That difference between registers *is* the instrument's voice, and a fixed
 * list of harmonic amplitudes cannot produce it — which is exactly why a
 * transposed sampler and a fixed-spectrum synth both sound synthetic in the
 * same way.
 *
 * So a voice here is a **string slope plus a set of body resonances in hertz**,
 * and `harmonicsFor` evaluates them against the note actually being played.
 * Both renderers already loop over per-harmonic amplitudes, so each changed by
 * one line.
 *
 * The resonance frequencies are the ones violin acoustics has measured for
 * each instrument; they are approximate and every real instrument differs, but
 * they are in the right place, which is the whole difference being reached for.
 */

/** One body resonance: where it sits, how sharp it is, how much it lifts. */
export interface Resonance {
  hz: number;
  /** Sharpness. 1 is a broad hill; 8 is a narrow peak. */
  q: number;
  /** Linear gain added at the peak. 1 means "twice as loud there". */
  lift: number;
}

export interface Voice {
  /**
   * How fast the string's own harmonics fall away: amplitude of harmonic *n*
   * is `n ** -slope`. A perfect sawtooth is 1; bowed strings measure a little
   * steeper as bow pressure drops.
   */
  slope: number;
  /** How many harmonics to synthesise, before the Nyquist cap. */
  partials: number;
  /** Fixed in frequency — see the note above. */
  body: Resonance[];
  /** Everything above this rolls off; the bow and the body both stop helping. */
  brightnessHz: number;
  /**
   * Below this, the instrument stops radiating — a second-order roll-off.
   *
   * **The physics that was missing, and the reason a low note sounded wrong.**
   * A wooden box only pushes air efficiently above its air resonance; below it
   * the sound falls away steeply however hard the string is driven. It is why
   * a violin's open G sounds thin in its fundamental and full in its
   * harmonics, and why a double bass's low E — 41 Hz, well under the 60 Hz
   * resonance — is heard almost entirely through the harmonics above it.
   *
   * Without this term every voice put its loudest partial on the fundamental
   * at the bottom of its range, which is the one place no real instrument
   * does.
   */
  radiationHz: number;
  /** Seconds to reach full amplitude. A bow is not a hammer. */
  attackS: number;
  /** Seconds to fall silent after the note's written end. */
  releaseS: number;
  /** Overall level, before any mixing headroom. */
  gain: number;
}

export type VoiceName = Instrument | 'reference';

/**
 * Where each instrument's open strings sit, for orientation while reading the
 * numbers below:
 *
 *   violin      G3 196 · D4 294 · A4 440 · E5 659
 *   viola       C3 131 · G3 196 · D4 294 · A4 440
 *   cello       C2  65 · G2  98 · D3 147 · A3 220
 *   double bass E1  41 · A1  55 · D2  73 · G2  98   (written an octave higher)
 */
export const VOICES: Record<VoiceName, Voice> = {
  /**
   * Violin. The air resonance sits near open D, the main body modes just above
   * it, and the bridge hill — the broad lift that gives a violin its carrying
   * power — sits around 2.5 kHz.
   */
  violin: {
    slope: 1.0,
    partials: 28,
    body: [
      { hz: 280, q: 2.2, lift: 3.0 },
      { hz: 470, q: 2.4, lift: 3.4 },
      { hz: 700, q: 2.0, lift: 1.6 },
      // The bridge hill: broad, high, and the reason a violin carries over an
      // orchestra. A narrow peak here would sound like a resonant filter
      // rather than like an instrument.
      { hz: 2600, q: 0.9, lift: 5.0 },
    ],
    brightnessHz: 6000,
    radiationHz: 230,
    attackS: 0.03,
    releaseS: 0.12,
    gain: 0.2,
  },

  /** Viola: the same shape a fifth lower, and darker — a smaller box than its
   *  string length wants, which is precisely why a viola sounds like a viola. */
  viola: {
    slope: 1.1,
    partials: 28,
    body: [
      { hz: 220, q: 2.2, lift: 3.0 },
      { hz: 370, q: 2.4, lift: 3.4 },
      { hz: 560, q: 2.0, lift: 1.6 },
      { hz: 2000, q: 0.9, lift: 4.0 },
    ],
    brightnessHz: 4800,
    radiationHz: 180,
    attackS: 0.035,
    releaseS: 0.14,
    gain: 0.2,
  },

  cello: {
    slope: 1.2,
    partials: 34,
    body: [
      { hz: 100, q: 2.2, lift: 2.4 },
      { hz: 195, q: 2.4, lift: 3.6 },
      { hz: 300, q: 2.0, lift: 2.0 },
      { hz: 1400, q: 0.9, lift: 3.4 },
    ],
    brightnessHz: 4000,
    radiationHz: 90,
    attackS: 0.04,
    releaseS: 0.16,
    gain: 0.2,
  },

  /**
   * Double bass — the owner's own instrument, so it is the one worth getting
   * least wrong. Its fundamental is often *weaker* than its second and third
   * harmonics: an E1 at 41 Hz is below the body's air resonance and below what
   * most phone speakers reproduce at all, and what a listener hears as the
   * pitch is largely the harmonics above it. The low `lift` on the 60 Hz peak
   * and the strong one at 110 Hz are that, not a mistake.
   */
  double_bass: {
    slope: 1.35,
    partials: 40,
    body: [
      { hz: 60, q: 2.2, lift: 0.8 },
      { hz: 110, q: 2.2, lift: 5.0 },
      { hz: 200, q: 2.2, lift: 3.0 },
      { hz: 900, q: 0.9, lift: 2.4 },
    ],
    brightnessHz: 3000,
    radiationHz: 62,
    attackS: 0.05,
    releaseS: 0.18,
    gain: 0.2,
  },

  /**
   * The old tone, kept and reachable.
   *
   * Not dead code: it is the right voice for anything that is *not* a
   * transcription of an instrument's part — and it is the answer if the
   * synthesised strings turn out to sit in the uncanny valley the previous
   * comment warned about, which is a judgement that needs ears and a device.
   * No resonances, so `harmonicsFor` returns the plain series it always had.
   */
  reference: {
    slope: 1.6,
    partials: 4,
    body: [],
    // Neither shaping term does anything: the old tone, exactly.
    brightnessHz: Number.POSITIVE_INFINITY,
    radiationHz: 0,
    attackS: 0.012,
    releaseS: 0.09,
    gain: 0.22,
  },
};

export const DEFAULT_VOICE: VoiceName = 'reference';

/** The voice for a musician's instrument. Total, so no screen needs a branch. */
export function voiceForInstrument(instrument: Instrument): VoiceName {
  return instrument;
}

/** Above this, a partial is inaudible on a phone and costs a multiply a sample. */
const AUDIBLE_CEILING_HZ = 10000;

/** Gain of one resonance at a frequency — a plain resonant peak. */
function resonanceAt(resonance: Resonance, hz: number): number {
  const ratio = hz / resonance.hz;
  // Symmetric in log-frequency, which a `(f/f0 - f0/f)` term gives for free.
  const detune = ratio - 1 / ratio;
  return resonance.lift / (1 + resonance.q * resonance.q * detune * detune);
}

/**
 * The amplitude of each harmonic of `f0` for this voice.
 *
 * **Normalised to a constant peak**, deliberately. A low note has four times
 * the partials of a high one, and without this a bass line would be four times
 * as loud as the melody above it purely because it had more of them to add up.
 * Peak rather than energy, because the renderers sum these into a fixed-point
 * buffer and what must not happen is clipping.
 */
export function harmonicsFor(voice: Voice, f0: number): number[] {
  if (!Number.isFinite(f0) || f0 <= 0) {
    return [];
  }

  const out: number[] = [];
  for (let n = 1; n <= voice.partials; n += 1) {
    const hz = n * f0;
    if (hz > AUDIBLE_CEILING_HZ) {
      break;
    }
    const string = Math.pow(n, -voice.slope);
    let body = 1;
    for (const resonance of voice.body) {
      body += resonanceAt(resonance, hz);
    }
    // A gentle first-order roll-off rather than a wall: the bow stops driving
    // and the body stops radiating, and neither does so at a cliff edge.
    const air = 1 / (1 + (hz / voice.brightnessHz) ** 2);
    // And the matching roll-off at the bottom — see `radiationHz`. Second
    // order, because a box's radiation falls about twice as fast below its air
    // resonance as its brightness falls above the bridge hill.
    const belowBody = voice.radiationHz > 0 ? (hz / voice.radiationHz) ** 2 : Infinity;
    const radiates = voice.radiationHz > 0 ? belowBody / (1 + belowBody) : 1;
    out.push(string * body * air * radiates);
  }

  const total = out.reduce((a, b) => a + b, 0);
  if (total <= 0) {
    return [];
  }
  return out.map((a) => a / total);
}
