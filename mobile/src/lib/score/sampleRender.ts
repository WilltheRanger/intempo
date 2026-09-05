import type { InstrumentSample } from './sampleBank';
import { nearestSample } from './sampleBank';
import type { Schedule } from './schedule';

export const SAMPLE_RENDER_RATE = 22050;

/** Sustain through a crossfaded loop, retaining the original recorded attack. */
export function sampleValue(
  sample: InstrumentSample,
  position: number,
): number {
  const pcm = sample.pcm;
  const start = Math.floor(pcm.length * 0.25);
  const end = Math.floor(pcm.length * 0.75);
  const fade = Math.min(
    Math.floor(sample.rate * 0.08),
    Math.floor((end - start) / 4),
  );
  let p = position;
  if (p >= end) p = start + fade + ((p - end) % (end - start - fade));
  const read = (x: number) => {
    const i = Math.floor(x);
    return (pcm[i] ?? 0) * (1 - (x - i)) + (pcm[i + 1] ?? 0) * (x - i);
  };
  if (p >= end - fade) {
    const blend = (p - (end - fade)) / fade;
    return read(p) * (1 - blend) + read(start + p - (end - fade)) * blend;
  }
  return read(p);
}

/** Cooperative render: timing lives in PCM, never in JS note-start timers. */
export async function renderSamples(
  schedule: Schedule,
  bank: InstrumentSample[],
  cancelled: () => boolean,
): Promise<Int16Array> {
  if (
    !Number.isFinite(schedule.durationS) ||
    schedule.durationS <= 0 ||
    schedule.durationS > 600
  ) {
    throw new Error('Choose a passage shorter than ten minutes to listen.');
  }
  const rate = SAMPLE_RENDER_RATE;
  const mix = new Float32Array(Math.ceil(schedule.durationS * rate));
  let work = 0;
  for (const note of schedule.notes) {
    if (
      !Number.isFinite(note.frequency) ||
      note.frequency <= 0 ||
      !Number.isFinite(note.startS) ||
      note.startS < 0 ||
      !Number.isFinite(note.durationS) ||
      note.durationS <= 0
    )
      continue;
    const sample = nearestSample(bank, note.frequency);
    const step =
      (((sample.rate / rate) * note.frequency) /
        (440 * 2 ** ((sample.midi - 69) / 12))) *
      2 ** (sample.tune / 1200);
    const start = Math.floor(note.startS * rate);
    const length = Math.min(
      Math.floor(note.durationS * rate),
      mix.length - start,
    );
    const fade = Math.max(1, Math.min(Math.floor(rate * 0.035), length / 3));
    for (let i = 0; i < length; i++) {
      mix[start + i] +=
        sampleValue(sample, i * step) *
        Math.min(1, i / (rate * 0.005), (length - 1 - i) / fade) *
        0.7;
      if (++work >= 32768) {
        work = 0;
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        if (cancelled()) throw new Error('Playback cancelled');
      }
    }
  }
  if (cancelled()) throw new Error('Playback cancelled');
  let peak = 1;
  for (const value of mix) peak = Math.max(peak, Math.abs(value));
  const pcm = new Int16Array(mix.length);
  for (let i = 0; i < pcm.length; i++)
    pcm[i] = Math.round((mix[i] / peak) * 32767);
  return pcm;
}
