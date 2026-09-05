import type { Asset } from 'expo-asset';

export async function readSampleBytes(asset: Asset): Promise<ArrayBuffer> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(asset.uri, { signal: controller.signal });
    if (!response.ok) throw new Error('Instrument download failed');
    return await response.arrayBuffer();
  } finally {
    clearTimeout(timer);
  }
}
