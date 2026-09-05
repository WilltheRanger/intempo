// Test-only Node API; the Expo app deliberately does not include Node types.
// @ts-expect-error Node's file reader is provided by the Vitest runtime.
import { readFileSync, readdirSync } from 'node:fs';
import { expect, it, vi } from 'vitest';
vi.mock('expo-asset', () => ({ Asset: {} }));
vi.mock('./sampleAssets', () => ({ SAMPLE_ASSETS: {} }));
vi.mock('./sampleBytes', () => ({ readSampleBytes: vi.fn() }));
import {
  decodeSample,
  nearestSample,
  type InstrumentSample,
} from './sampleBank';
import { renderSamples, sampleValue, SAMPLE_RENDER_RATE } from './sampleRender';
import type { Schedule } from './schedule';

const assets = new URL('../../../assets/instruments/', import.meta.url);
function load(name: string): InstrumentSample {
  const bytes = readFileSync(new URL(name, assets));
  return {
    midi: 69,
    tune: 0,
    ...decodeSample(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    ),
  };
}
const schedule: Schedule = {
  bpm: 60,
  durationS: 0.25,
  notes: [
    {
      startS: 0.05,
      durationS: 0.1,
      frequency: 440,
      measureNumber: 1,
      globalIndex: 0,
    },
  ],
};

it('decodes every bundled recording with real nonzero PCM', () => {
  const names: string[] = readdirSync(assets).filter((n: string) =>
    n.endsWith('.wav'),
  );
  expect(names).toHaveLength(20);
  for (const name of names) {
    const sample = load(name);
    expect(sample.rate).toBe(44100);
    expect(sample.pcm.length).toBe(220500);
    expect(sample.pcm.some((x) => Math.abs(x) > 0.1)).toBe(true);
    expect(sample.pcm.every(Number.isFinite)).toBe(true);
  }
});
it('rejects HTML and truncated assets instead of playing noise', () => {
  expect(() => decodeSample(new ArrayBuffer(44))).toThrow();
  const bytes = readFileSync(new URL('violin-69.wav', assets));
  expect(() =>
    decodeSample(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + 100)),
  ).toThrow();
});
it('chooses the closest recorded MIDI root without changing score pitch', () => {
  const roots = [{ midi: 28 }, { midi: 36 }, { midi: 44 }, { midi: 52 }];
  expect(nearestSample(roots, 82.4069).midi).toBe(44);
  expect(nearestSample(roots, 41.2034).midi).toBe(28);
  expect(() => nearestSample(roots, NaN)).toThrow();
});
it('preserves note timing, rests and the input schedule', async () => {
  const before = JSON.stringify(schedule);
  const pcm = await renderSamples(
    schedule,
    [load('violin-69.wav')],
    () => false,
  );
  expect(pcm.length).toBe(Math.ceil(0.25 * SAMPLE_RENDER_RATE));
  expect(pcm.slice(0, 1000).every((x) => x === 0)).toBe(true);
  expect(pcm.slice(1200, 3000).some((x) => x !== 0)).toBe(true);
  expect(pcm.slice(3400).every((x) => x === 0)).toBe(true);
  expect(JSON.stringify(schedule)).toBe(before);
});
it('crossfades the sustain wrap without a discontinuity', () => {
  const sample = load('double_bass-36.wav');
  const end = Math.floor(sample.pcm.length * 0.75);
  expect(
    Math.abs(sampleValue(sample, end - 0.001) - sampleValue(sample, end)),
  ).toBeLessThan(0.001);
  expect(Number.isFinite(sampleValue(sample, end * 500))).toBe(true);
});
it('cancels cooperative rendering and bounds memory for long scores', async () => {
  await expect(
    renderSamples(schedule, [load('violin-69.wav')], () => true),
  ).rejects.toThrow('cancelled');
  await expect(
    renderSamples({ ...schedule, durationS: 601 }, [], () => false),
  ).rejects.toThrow('ten minutes');
});
