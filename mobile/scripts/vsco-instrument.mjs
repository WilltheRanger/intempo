// Solo violin and solo double bass from VS Chamber Orchestra 2: Community
// Edition — real recordings, CC0 — built into the same single-preset SF2 banks
// the app has always loaded, so the engine that plays them (envelopes, release
// tails, filters, reverb) is unchanged.
//
// **The loud layer only.** VSCO records each note soft and loud. The soft
// violin notes swell for 0.7–3.4 s before they reach full level and one soft
// bass note takes 6 s, which in a timing reference is a note that sounds late.
// The loud ones reach it in ~60 ms. Softer dynamics come from velocity, which
// the engine already turns into level and a darker filter.
//
// **Trimmed and looped.** The recordings are 7–17 s of stereo each. What a
// note needs is its attack and enough sustain to loop: a loop over whole
// vibrato cycles, found by correlation and crossfaded so the jump is inaudible,
// with the bow's slow drift taken out of it so a held note does not pulse.
import {
  BasicInstrument,
  BasicPreset,
  BasicSoundBank,
  EmptySample,
  GeneratorTypes,
  SampleTypes,
} from 'spessasynth_core';

/** The pinned commit of the SFZ branch every sample is read from. */
export const VSCO_REVISION = '6dd651d55dde97fd4028699be9d4481f26917891';
export const VSCO_BASE = `https://raw.githubusercontent.com/sgossner/VSCO-2-CE/${VSCO_REVISION}/`;

/**
 * The loud-layer regions of each SFZ, as the library maps them: the sample,
 * the keys it covers, the key it was played at, and its tuning correction.
 * Copied from `SViolinVib.sfz` and `ContrabassSusVB.sfz` at the revision above.
 */
export const VSCO_INSTRUMENTS = {
  violin: {
    program: 40,
    name: 'Violin',
    folder: 'Strings/Solo Violin/Arco Vib/',
    rate: 32000,
    level: -11.7,
    regions: [
      ['LLVln_ArcoVib_G3_f.wav', 55, 55, 55, 0],
      ['LLVln_ArcoVib_A3_f.wav', 56, 58, 57, 0],
      ['LLVln_ArcoVib_C4_f.wav', 59, 61, 60, 0],
      ['LLVln_ArcoVib_E4_f.wav', 62, 65, 64, 0],
      ['LLVln_ArcoVib_G4_f.wav', 66, 67, 67, 0],
      ['LLVln_ArcoVib_A4_f.wav', 68, 70, 69, 0],
      ['LLVln_ArcoVib_C5_f.wav', 71, 73, 72, 0],
      ['LLVln_ArcoVib_E5_f.wav', 74, 77, 76, 0],
      ['LLVln_ArcoVib_G5_f.wav', 78, 79, 79, 0],
      ['LLVln_ArcoVib_A5_f.wav', 80, 82, 81, 0],
      ['LLVln_ArcoVib_C6_f.wav', 83, 85, 84, 0],
      ['LLVln_ArcoVib_E6_f.wav', 86, 89, 88, 0],
      ['LLVln_ArcoVib_G6_f.wav', 90, 91, 91, 0],
      ['LLVln_ArcoVib_A6_f.wav', 92, 94, 93, 0],
      ['LLVln_ArcoVib_C7_f.wav', 95, 96, 96, 0],
    ],
  },
  double_bass: {
    program: 43,
    name: 'Double Bass',
    folder: 'Strings/Solo Contrabass/SusVib/',
    rate: 22050,
    level: -14.0,
    regions: [
      ['BKCtbss_SusVib_F#0_v3_rr1.wav', 24, 30, 30, 0],
      ['BKCtbss_SusVib_G0_v3_rr1.wav', 31, 32, 31, 0],
      ['BKCtbss_SusVib_A#0_v3_rr1.wav', 33, 34, 34, 0],
      ['BKCtbss_SusVib_C1_v3_rr1.wav', 35, 36, 36, 0],
      ['BKCtbss_SusVib_D1_v3_rr1.wav', 37, 38, 38, 0],
      ['BKCtbss_SusVib_E1_v3_rr1.wav', 39, 40, 40, 0],
      ['BKCtbss_SusVib_F#1_v3_rr1.wav', 41, 42, 42, 0],
      ['BKCtbss_SusVib_G#1_v3_rr1.wav', 43, 44, 44, 0],
      ['BKCtbss_SusVib_A1_v3_rr1.wav', 45, 46, 45, 0],
      ['BKCtbss_SusVib_C#2_v3_rr1.wav', 47, 50, 49, 0],
      ['BKCtbss_SusVib_E2_v3_rr1.wav', 51, 53, 52, 0],
      ['BKCtbss_SusVib_G#2_v3_rr1.wav', 54, 57, 56, 0],
      ['BKCtbss_SusVib_B2_v3_rr1.wav', 58, 60, 59, 0],
    ],
  },
};

/** How much of each recording to keep: the attack and room for a loop. */
const KEEP_S = 1.8;
/**
 * Where a loop may start and how long it may be, in seconds. At least 0.6 s,
 * so a held note repeats about once a second: shorter loops of the same audio
 * came out 0.35 s long and repeated nearly three times a second, which reads
 * as a pulse however clean the join.
 */
const LOOP_START_S = [0.5, 0.9];
const LOOP_LENGTH_S = [0.6, 1.0];
/** Crossfade baked in before the loop end, so the jump back is seamless. */
const CROSSFADE_S = 0.04;
/**
 * The window the loop's slow level is measured over: one vibrato cycle (a
 * player's 5–6 Hz), so what is flattened is the bow's drift, not the vibrato.
 */
const LEVEL_WINDOW_S = 0.19;
/**
 * Each instrument's `level` is the RMS, in dBFS, every one of its notes is
 * matched to over its loop, so no key jumps out — and chosen so the instrument
 * plays as loud as the GeneralUser preset it replaces. Measured by rendering
 * every other key of both banks at velocity 72 through the app's engine: at
 * −20 dB the violin came out a median 8.3 dB quieter and the bass 6.0 dB.
 */
const PEAK_CEILING = 10 ** (-1 / 20);
/** How far ahead the attack limiter looks, and how fast it lets go. */
const LIMIT_LOOKAHEAD_S = 0.005;
const LIMIT_RELEASE_S = 0.05;
/** A bowed string's release, the moment the bow leaves. */
const RELEASE_S = 0.3;

/** 16-bit PCM WAV, any channel count, to mono float. */
function decodeWav(buffer) {
  const view = new DataView(buffer);
  const tag = (at) => String.fromCharCode(...new Uint8Array(buffer, at, 4));
  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') throw new Error('Not a WAV file');
  let at = 12;
  let channels = 0;
  let rate = 0;
  let bits = 0;
  let data = null;
  while (at + 8 <= buffer.byteLength) {
    const id = tag(at);
    const size = view.getUint32(at + 4, true);
    if (id === 'fmt ') {
      channels = view.getUint16(at + 10, true);
      rate = view.getUint32(at + 12, true);
      bits = view.getUint16(at + 22, true);
    } else if (id === 'data') {
      data = { start: at + 8, size };
    }
    at += 8 + size + (size % 2);
  }
  if (!data || bits !== 16 || !channels) throw new Error('Expected 16-bit PCM');
  const frames = Math.floor(data.size / (2 * channels));
  const mono = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    let sum = 0;
    for (let c = 0; c < channels; c++) {
      sum += view.getInt16(data.start + (i * channels + c) * 2, true);
    }
    mono[i] = sum / channels / 32768;
  }
  return { samples: mono, rate };
}

/** Windowed-sinc resampling, low-passed below the new Nyquist. */
function resample(input, from, to) {
  if (from === to) return input.slice();
  const ratio = from / to;
  const cutoff = Math.min(1, to / from) * 0.95;
  const half = 24;
  const out = new Float32Array(Math.floor(input.length / ratio));
  for (let n = 0; n < out.length; n++) {
    const centre = n * ratio;
    const first = Math.ceil(centre - half / cutoff);
    const last = Math.floor(centre + half / cutoff);
    let sum = 0;
    let weight = 0;
    for (let k = first; k <= last; k++) {
      if (k < 0 || k >= input.length) continue;
      const x = (k - centre) * cutoff;
      const sinc = x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x);
      const t = (k - centre) / (half / cutoff);
      const blackman = 0.42 + 0.5 * Math.cos(Math.PI * t) + 0.08 * Math.cos(2 * Math.PI * t);
      const w = sinc * blackman;
      sum += input[k] * w;
      weight += w;
    }
    out[n] = weight ? sum / weight : 0;
  }
  return out;
}

function rms(x, from, to) {
  let s = 0;
  for (let i = from; i < to; i++) s += x[i] * x[i];
  return Math.sqrt(s / Math.max(1, to - from));
}

/** Correlation of two equal windows, normalised to -1..1. */
function similarity(x, a, b, length) {
  let ab = 0;
  let aa = 0;
  let bb = 0;
  for (let i = 0; i < length; i++) {
    ab += x[a + i] * x[b + i];
    aa += x[a + i] * x[a + i];
    bb += x[b + i] * x[b + i];
  }
  return ab / Math.sqrt(aa * bb + 1e-12);
}

/**
 * The loop: where to jump back to, and from where.
 *
 * Scored on two scales, because vibrato has two: the waveform either side of
 * the join must match sample for sample (30 ms), and the level and pitch
 * contour must too, or the loop audibly pulses once per repeat (200 ms).
 * Searched coarse then fine.
 */
function findLoop(x, rate) {
  const fine = Math.round(0.03 * rate);
  const broad = Math.round(0.2 * rate);
  let best = { score: -Infinity, start: 0, end: 0 };
  const step = Math.round(0.005 * rate);
  for (
    let start = Math.round(LOOP_START_S[0] * rate);
    start <= Math.round(LOOP_START_S[1] * rate);
    start += step * 2
  ) {
    for (
      let length = Math.round(LOOP_LENGTH_S[0] * rate);
      length <= Math.round(LOOP_LENGTH_S[1] * rate);
      length += step
    ) {
      const end = start + length;
      if (end + broad >= x.length) continue;
      const score =
        similarity(x, start - fine, end - fine, 2 * fine) +
        0.5 * similarity(x, start - broad, end - broad, broad);
      if (score > best.score) best = { score, start, end };
    }
  }
  // Refine the end to the sample, around the coarse winner, on the fine
  // (waveform) score alone: the broad contour cannot change within 5 ms.
  let refined = best;
  let refinedScore = similarity(x, best.start - fine, best.end - fine, 2 * fine);
  for (let end = best.end - step; end <= best.end + step; end++) {
    const score = similarity(x, best.start - fine, end - fine, 2 * fine);
    if (score > refinedScore) {
      refinedScore = score;
      refined = { ...best, end };
    }
  }
  return refined;
}

/**
 * Take the bow's slow drift out of the loop, and keep the vibrato.
 *
 * **Measured, because a clean join is not enough.** The violin's loops joined
 * without a click, and still swung 3–5.6 dB in level within each repeat —
 * the bow's natural drift, which in a recording is phrasing and in a loop is
 * the same swell, over and over, one to three times a second. GeneralUser's
 * loops swing 0.6–2.2 dB. This divides the loop by its own level contour,
 * measured circularly so the gain at the end meets the gain at the start, and
 * eases the audio before the loop onto the gain the loop begins with.
 */
function flattenLoop(out, start, end, rate) {
  const period = end - start;
  const w = Math.round(LEVEL_WINDOW_S * rate);
  const squares = new Float64Array(period * 3 + 1);
  for (let i = 0; i < period * 3; i++) {
    const v = out[start + (i % period)];
    squares[i + 1] = squares[i] + v * v;
  }
  const power = new Float64Array(period);
  let mean = 0;
  for (let t = 0; t < period; t++) {
    const from = t + period - (w >> 1);
    power[t] = (squares[from + w] - squares[from]) / w;
    mean += power[t] / period;
  }
  const gain = new Float64Array(period);
  for (let t = 0; t < period; t++) {
    gain[t] = Math.min(2, Math.max(0.5, Math.sqrt(mean / Math.max(power[t], 1e-12))));
  }
  for (let t = 0; t < period; t++) out[start + t] *= gain[t];
  const ramp = Math.min(start, Math.round(0.15 * rate));
  for (let i = 0; i < ramp; i++) {
    out[start - ramp + i] *= 1 + (gain[0] - 1) * ((i + 1) / (ramp + 1));
  }
}

/**
 * The gain that holds `x` under the ceiling, lowering only the milliseconds
 * that are over: in over the look-ahead, out over the release, never a step.
 */
function limiterGain(x, rate) {
  const reach = Math.round(LIMIT_LOOKAHEAD_S * rate);
  const need = new Float64Array(x.length);
  for (let i = 0; i < x.length; i++) {
    need[i] = Math.min(1, PEAK_CEILING / Math.max(Math.abs(x[i]), 1e-9));
  }
  // The lowest gain any sample within the look-ahead needs, then a release.
  const gain = new Float64Array(x.length);
  const release = Math.exp(-1 / (LIMIT_RELEASE_S * rate));
  let level = 1;
  for (let i = 0; i < x.length; i++) {
    let lowest = 1;
    for (let k = i; k < Math.min(x.length, i + reach); k++) {
      lowest = Math.min(lowest, need[k]);
    }
    level = Math.min(lowest, 1 - (1 - level) * release);
    gain[i] = level;
  }
  // Smoothed backwards from each dip, so the way into it is a ramp.
  for (let i = x.length - 2; i >= 0; i--) {
    gain[i] = Math.min(gain[i], 1 - (1 - gain[i + 1]) * Math.exp(-1 / reach));
  }
  return gain;
}

/**
 * Keep every note at its level and every sample under the ceiling.
 *
 * A bowed attack peaks 9–14 dB above the note it becomes, and a loop with
 * vibrato has single cycles that stand 11–13 dB above its RMS. Scaling a whole
 * note down until those fit cost six violin keys 0.6–2.2 dB against their
 * neighbours; limiting takes only the milliseconds that are over.
 *
 * **The loop is limited as the repeating signal it becomes** — three copies,
 * keeping the middle one's gain — so the gain at its end is the gain at its
 * start and the join stays seamless. A gain computed along the file instead
 * would differ across the jump, a step on every pass.
 */
function limitPeaks(out, loop, rate) {
  const period = loop.end - loop.start;
  const body = out.subarray(loop.start, loop.end);
  const cycled = new Float32Array(period * 3);
  for (let c = 0; c < 3; c++) cycled.set(body, c * period);
  const loopGain = limiterGain(cycled, rate).subarray(period, 2 * period);
  const headGain = limiterGain(out.subarray(0, loop.end), rate);
  for (let i = 0; i < loop.start; i++) out[i] *= headGain[i];
  for (let t = 0; t < period; t++) out[loop.start + t] *= loopGain[t];
  for (let i = 0; i <= 64; i++) out[loop.end + i] = out[loop.start + i];
}

/**
 * One recording, ready for the bank: trimmed, looped, crossfaded, levelled.
 * Returns the audio and its loop, in samples at `rate`.
 */
export function prepareSample(wav, rate, levelDb) {
  const decoded = decodeWav(wav);
  let x = resample(decoded.samples, decoded.rate, rate);
  // Start at the note, not before it.
  let peak = 0;
  for (const v of x) peak = Math.max(peak, Math.abs(v));
  let onset = 0;
  while (onset < x.length && Math.abs(x[onset]) < peak * 0.01) onset++;
  x = x.slice(Math.max(0, onset - Math.round(0.002 * rate)), Math.max(0, onset) + Math.round(KEEP_S * rate) + Math.round(0.4 * rate));

  const loop = findLoop(x, rate);
  const fade = Math.round(CROSSFADE_S * rate);
  const out = x.slice(0, loop.end + 1 + 64);
  // Equal-power crossfade into the loop end from the audio before the loop
  // start, so the samples just before the jump already sound like the ones
  // just before where it lands.
  for (let i = 0; i < fade; i++) {
    const t = (i + 1) / fade;
    const a = Math.cos((t * Math.PI) / 2);
    const b = Math.sin((t * Math.PI) / 2);
    out[loop.end - fade + i] = x[loop.end - fade + i] * a + x[loop.start - fade + i] * b;
  }
  flattenLoop(out, loop.start, loop.end, rate);
  // From the loop end on, the loop's own beginning: SF2's loop end is the
  // sample that *would* be the loop start, and the interpolator reads past it.
  for (let i = 0; i <= 64; i++) out[loop.end + i] = out[loop.start + i];

  const level = rms(out, loop.start, loop.end);
  const gain = 10 ** (levelDb / 20) / Math.max(level, 1e-6);
  for (let i = 0; i < out.length; i++) out[i] *= gain;
  limitPeaks(out, loop, rate);
  return { audio: out, loopStart: loop.start, loopEnd: loop.end, score: loop.score };
}

/** Build one instrument's single-preset bank from its prepared samples. */
export function buildBank(instrument, prepared) {
  const spec = VSCO_INSTRUMENTS[instrument];
  const bank = new BasicSoundBank();
  bank.soundBankInfo.name = `InTempo ${spec.name} (VSCO 2 CE)`;
  const inst = new BasicInstrument();
  inst.name = spec.name;
  const releaseTimecents = Math.round(1200 * Math.log2(RELEASE_S));
  const samples = [];
  const last = spec.regions.length - 1;
  for (const [index, [file, lo, hi, root, cents]] of spec.regions.entries()) {
    const p = prepared[file];
    const sample = new EmptySample();
    sample.name = file.replace(/\.wav$/, '').slice(0, 20);
    sample.originalKey = root;
    sample.pitchCorrection = 0;
    sample.sampleType = SampleTypes.monoSample;
    sample.setAudioData(p.audio, spec.rate);
    sample.loopStart = p.loopStart;
    sample.loopEnd = p.loopEnd;
    samples.push(sample);
    const zone = inst.createZone(sample);
    // The outermost recordings stretch to the ends of the keyboard, as
    // GeneralUser's do. A note no violin or bass can play still reaches here
    // from a misread clef, and a note that sounds wrong can be heard to be
    // wrong; one that is silent reads as the app dropping the passage.
    zone.keyRange = { min: index === 0 ? 0 : lo, max: index === last ? 127 : hi };
    zone.setGenerator(GeneratorTypes.sampleModes, 1);
    zone.setGenerator(GeneratorTypes.releaseVolEnv, releaseTimecents);
    if (cents) zone.setGenerator(GeneratorTypes.fineTune, cents);
  }
  const preset = new BasicPreset(bank);
  preset.name = spec.name;
  preset.program = spec.program;
  preset.bankMSB = 0;
  preset.bankLSB = 0;
  // The reverb send GeneralUser gives every one of its string presets (7%),
  // so the four instruments sit in the same room at the same distance.
  preset.globalZone.setGenerator(GeneratorTypes.reverbEffectsSend, 70);
  preset.createZone(inst);
  bank.addSamples(...samples);
  bank.addInstruments(inst);
  bank.addPresets(preset);
  return bank;
}
