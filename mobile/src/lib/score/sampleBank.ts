import { Asset } from 'expo-asset';
import type { Instrument } from '../../data/types';
import { SAMPLE_ASSETS } from './sampleAssets';
import { readSampleBytes } from './sampleBytes';
import type { Schedule } from './schedule';

export interface InstrumentSample {
  midi: number;
  tune: number;
  rate: number;
  pcm: Float32Array;
}

/** Assets are generated as canonical mono, 16-bit PCM. Reject corrupt downloads. */
export function decodeSample(
  bytes: ArrayBuffer,
): Pick<InstrumentSample, 'rate' | 'pcm'> {
  const view = new DataView(bytes);
  const tag = (p: number) =>
    String.fromCharCode(...new Uint8Array(bytes, p, 4));
  if (
    bytes.byteLength < 44 ||
    tag(0) !== 'RIFF' ||
    tag(8) !== 'WAVE' ||
    tag(12) !== 'fmt ' ||
    view.getUint32(16, true) !== 16 ||
    view.getUint16(20, true) !== 1 ||
    view.getUint16(22, true) !== 1 ||
    view.getUint16(34, true) !== 16 ||
    tag(36) !== 'data'
  ) {
    throw new Error(
      'The instrument sound could not be read. Please try again.',
    );
  }
  const rate = view.getUint32(24, true);
  const size = view.getUint32(40, true);
  if (
    rate < 8000 ||
    rate > 96000 ||
    size % 2 ||
    size < rate * 2 ||
    size + 44 > bytes.byteLength
  ) {
    throw new Error('The instrument sound is incomplete. Please try again.');
  }
  const pcm = new Float32Array(size / 2);
  for (let i = 0; i < pcm.length; i++)
    pcm[i] = view.getInt16(44 + i * 2, true) / 32768;
  return { rate, pcm };
}

export function nearestSample<T extends { midi: number }>(
  samples: T[],
  frequency: number,
): T {
  if (!samples.length || !Number.isFinite(frequency) || frequency <= 0)
    throw new Error('Invalid note pitch');
  const midi = 69 + 12 * Math.log2(frequency / 440);
  return samples.reduce((best, sample) =>
    Math.abs(sample.midi - midi) < Math.abs(best.midi - midi) ? sample : best,
  );
}

// Only the roots used by the current score are loaded. Failed promises are
// evicted, and the bounded decoded cache never grows past this 20-sample bank.
const cache = new Map<number, Promise<InstrumentSample>>();
export async function loadSamples(
  instrument: Instrument,
  schedule: Schedule,
): Promise<InstrumentSample[]> {
  const roots = [
    ...new Set(
      schedule.notes
        .filter((n) => Number.isFinite(n.frequency) && n.frequency > 0)
        .map((n) => nearestSample(SAMPLE_ASSETS[instrument], n.frequency)),
    ),
  ];
  return Promise.all(
    roots.map((root) => {
      const previous = cache.get(root.asset);
      if (previous) return previous;
      const pending = (async () => {
        const asset = Asset.fromModule(root.asset);
        // Web fetch has an abort deadline; native assets use Expo's disk cache.
        const bytes = await readSampleBytes(asset);
        return { ...root, ...decodeSample(bytes) };
      })();
      cache.set(root.asset, pending);
      void pending.catch(() => cache.delete(root.asset));
      return pending;
    }),
  );
}
